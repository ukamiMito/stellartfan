/**
 * fetch_comments.js
 *
 * 配信中（live）のライブチャットを段階的に取得し、
 * /docs/assets/data/comments/{channelKey}/{videoId}.json に保存する
 *
 * - 冪等（chatFetched=true は再取得しない）
 * - 差分取得
 * - 大量取得耐性（安全ブレーキ付き）
 */

import fs from 'fs';
import fetch from 'node-fetch';
import { CHANNELS } from './config/channels.js';

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  throw new Error('YOUTUBE_API_KEY が未設定です');
}

const VIDEOS_JSON = 'docs/assets/data/videos.json';
const COMMENTS_BASE_DIR = 'docs/assets/data/comments';

const MAX_VIDEOS_PER_RUN = 3; // ← 安全ブレーキ（daily 前提）

/**
 * YouTube LiveChatMessages API
 */
async function fetchAllChatMessages(liveChatId) {
  let messages = [];
  let pageToken = '';
  let fetched = 0;

  while (true) {
    const url =
      `https://www.googleapis.com/youtube/v3/liveChat/messages` +
      `?part=snippet` +
      `&liveChatId=${liveChatId}` +
      `&maxResults=200` +
      `&key=${API_KEY}` +
      (pageToken ? `&pageToken=${pageToken}` : '');

    const res = await fetch(url);
    const json = await res.json();

    if (!json.items) break;

    for (const item of json.items) {
      const s = item.snippet;
      messages.push({
        t: s.publishedAt,
        o: Math.floor(s.videoOffsetTimeMillis / 1000),
        m: s.displayMessage,
        type: s.type
      });
    }

    fetched += json.items.length;
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }

  return messages;
}

/**
 * liveChatId を videos.list から取得
 */
async function getLiveChatId(videoId) {
  const url =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=liveStreamingDetails` +
    `&id=${videoId}` +
    `&key=${API_KEY}`;

  const res = await fetch(url);
  const json = await res.json();

  const item = json.items?.[0];
  return item?.liveStreamingDetails?.activeLiveChatId || null;
}

async function main() {
  if (!fs.existsSync(VIDEOS_JSON)) {
    throw new Error('videos.json not found');
  }

  const videos = JSON.parse(fs.readFileSync(VIDEOS_JSON, 'utf-8'));
  const statePath = 'docs/assets/data/comments_state.json';
  /** @type {Record<string, { liveChatId?: string | null; nextPageToken?: string | null }>} */
  let state = {};

  try {
    if (fs.existsSync(statePath)) {
      state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    }
  } catch {
    // 壊れた場合は作り直す
    state = {};
  }

  let processed = 0;

  for (const video of videos) {
    if (
      // ★ 取得対象を「終了済み」から「配信中（live）」に変更
      video.status !== 'live' ||
      video.chatFetched ||
      processed >= MAX_VIDEOS_PER_RUN
    ) {
      continue;
    }

    const channelKey = video.channelKey;
    const outDir = `${COMMENTS_BASE_DIR}/${channelKey}`;
    const outPath = `${outDir}/${video.videoId}.json`;

    fs.mkdirSync(outDir, { recursive: true });

    const videoId = video.videoId;

    // 差分取得用ステートを読み込み
    const vState = state[videoId] || {};

    // liveChatId が未取得または null の場合、最新を取得して記録
    const liveChatId =
      vState.liveChatId !== undefined
        ? vState.liveChatId
        : await getLiveChatId(videoId);

    if (!liveChatId) {
      // activeLiveChatId が取得できない場合:
      // - 既に配信が終了して liveChatId が消えている
      // - もともとチャットが無効だった
      // などが考えられるため、この動画についてはこれ以上試行しない
      video.chatFetched = true;
      state[videoId] = { liveChatId: null, nextPageToken: null };
      continue;
    }

    // liveChatId をステートに保存
    vState.liveChatId = liveChatId;

    console.log(`チャット取得開始: ${video.videoId}`);

    // 1回の実行で取得するページ数の上限（クォータ制御用）
    const MAX_PAGES_PER_RUN = 10;
    let pageToken = vState.nextPageToken || '';
    let pagesFetched = 0;
    let newMessages = [];

    while (pagesFetched < MAX_PAGES_PER_RUN) {
      const url =
        `https://www.googleapis.com/youtube/v3/liveChat/messages` +
        `?part=snippet` +
        `&liveChatId=${liveChatId}` +
        `&maxResults=200` +
        `&key=${API_KEY}` +
        (pageToken ? `&pageToken=${pageToken}` : '');

      const res = await fetch(url);
      const json = await res.json();

      if (!json.items || !json.items.length) {
        pageToken = null;
        break;
      }

      for (const item of json.items) {
        const s = item.snippet;
        newMessages.push({
          t: s.publishedAt,
          o: Math.floor(s.videoOffsetTimeMillis / 1000),
          m: s.displayMessage,
          type: s.type
        });
      }

      pagesFetched += 1;
      pageToken = json.nextPageToken || null;

      if (!pageToken) {
        break;
      }
    }

    // 既存コメントとマージ（単純に後ろに追加）
    /** @type {{ videoId: string; channelKey: string; channelName: string; fetchedAt: string; messages: any[] }} */
    let existing = {
      videoId,
      channelKey,
      channelName: video.channelName,
      fetchedAt: new Date().toISOString(),
      messages: []
    };

    if (fs.existsSync(outPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      } catch {
        // 既存が壊れていれば新規として扱う
      }
    }

    existing.messages = [...existing.messages, ...newMessages];
    existing.fetchedAt = new Date().toISOString();

    fs.writeFileSync(
      outPath,
      JSON.stringify(existing, null, 2),
      'utf-8'
    );

    // 次回用の pageToken を保存（null の場合はこれ以上取得できない）
    vState.nextPageToken = pageToken;
    state[videoId] = vState;

    // chatFetched は「liveChatId が取得できなくなった時点」で true にする
    processed++;
    console.log(`取得完了: ${video.videoId}`);
  }

  fs.writeFileSync(
    VIDEOS_JSON,
    JSON.stringify(videos, null, 2),
    'utf-8'
  );

  // ステートを保存
  fs.mkdirSync(COMMENTS_BASE_DIR, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');

  console.log(`コメント取得: ${processed} 件`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
