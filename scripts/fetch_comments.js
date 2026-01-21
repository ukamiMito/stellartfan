/**
 * fetch_comments.js
 *
 * 配信終了済み（ended）のライブチャットを全件取得し、
 * /docs/assets/data/comments/{channelKey}/{videoId}.json に保存する
 *
 * - 配信中は取得しない（ユニット消費削減）
 * - 配信終了後に1回だけ全ページ読み切り
 * - 完了後、chatFetched=true に設定
 * - 冪等（chatFetched=true は再取得しない）
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

// 例外的に取得対象とする videoId のリスト（テスト用など）
// 環境変数 FORCE_FETCH_VIDEO_IDS で指定可能（カンマ区切り）
const FORCE_FETCH_VIDEO_IDS = process.env.FORCE_FETCH_VIDEO_IDS
  ? process.env.FORCE_FETCH_VIDEO_IDS.split(',').map(id => id.trim())
  : [];

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
    // 例外的に取得対象とする videoId かどうか
    const isForceFetch = FORCE_FETCH_VIDEO_IDS.includes(video.videoId);

    if (
      // 取得対象は「配信終了済み（ended）」のみ
      // 配信中は取得しない（ユニット消費削減のため）
      // ただし、FORCE_FETCH_VIDEO_IDS で指定された videoId は例外的に取得対象とする
      (!isForceFetch && video.status !== 'ended') ||
      (!isForceFetch && video.chatFetched) ||
      processed >= MAX_VIDEOS_PER_RUN
    ) {
      continue;
    }

    // 強制取得対象の場合は chatFetched を一時的に無視
    if (isForceFetch && video.chatFetched) {
      console.log(`強制取得対象として処理します: ${video.videoId}`);
    }

    const channelKey = video.channelKey;
    const outDir = `${COMMENTS_BASE_DIR}/${channelKey}`;
    const outPath = `${outDir}/${video.videoId}.json`;

    fs.mkdirSync(outDir, { recursive: true });

    const videoId = video.videoId;

    // 差分取得用ステートを読み込み
    const vState = state[videoId] || {};

    // 配信終了後は activeLiveChatId を取得して全ページ読み切り
    const liveChatId = await getLiveChatId(videoId);

    if (!liveChatId) {
      // activeLiveChatId が取得できない場合:
      // - 配信終了後、liveChatId が既に消えている（時間が経ちすぎた）
      // - もともとチャットが無効だった
      // などが考えられるため、この動画についてはこれ以上試行しない
      video.chatFetched = true;
      state[videoId] = { liveChatId: null, nextPageToken: null };
      console.log(`activeLiveChatId が取得できません: ${video.videoId} - チャット取得をスキップします`);
      continue;
    }

    // liveChatId をステートに保存
    vState.liveChatId = liveChatId;

    console.log(`チャット取得開始: ${video.videoId}`);

    // 配信終了後は常に最初から全ページ読み切り
    // nextPageToken をリセット（既存のコメントファイルがあっても上書き）
    vState.nextPageToken = '';

    // 1回の実行で取得するページ数の上限（クォータ制御用）
    // 配信終了後は全ページ読み切るため上限を大きくする
    const MAX_PAGES_PER_RUN = 1000;
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

    // 既存コメントとマージ（重複チェック付き）
    // 配信終了後は最初から全ページ読み切るため、途中で中断された場合のみ既存コメントとマージ
    /** @type {{ videoId: string; channelKey: string; channelName: string; fetchedAt: string; messages: any[] }} */
    let existing = {
      videoId,
      channelKey,
      channelName: video.channelName,
      fetchedAt: new Date().toISOString(),
      messages: []
    };

    // 途中で中断された場合（pageToken !== null）は、既存コメントとマージ
    // 全ページ読み切り完了時（pageToken === null）は、既存コメントを上書き
    if (pageToken !== null && fs.existsSync(outPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      } catch {
        // 既存が壊れていれば新規として扱う
      }
    }

    if (pageToken !== null) {
      // 途中で中断された場合: 既存コメントとマージ（重複チェック付き）
      const existingTimestamps = new Set(
        existing.messages.map(msg => `${msg.t}|${msg.m}`)
      );
      const uniqueNewMessages = newMessages.filter(
        msg => !existingTimestamps.has(`${msg.t}|${msg.m}`)
      );
      existing.messages = [...existing.messages, ...uniqueNewMessages].sort(
        (a, b) => new Date(a.t) - new Date(b.t)
      );
    } else {
      // 全ページ読み切り完了時: 既存コメントを上書き（配信終了後は最初から全ページ読み切るため）
      existing.messages = newMessages.sort(
        (a, b) => new Date(a.t) - new Date(b.t)
      );
    }
    existing.fetchedAt = new Date().toISOString();

    fs.writeFileSync(
      outPath,
      JSON.stringify(existing, null, 2),
      'utf-8'
    );

    // 全ページ読み切り完了後、chatFetched を true に設定
    // ただし、強制取得対象の場合は chatFetched を更新しない（テスト用）
    if (pageToken === null) {
      // nextPageToken が null = 全ページ読み切り完了
      if (!isForceFetch) {
        video.chatFetched = true;
      }
      vState.nextPageToken = null;
      console.log(
        `全ページ読み切り完了: ${video.videoId} - ${isForceFetch ? '（強制取得対象のため chatFetched は更新しません）' : 'chatFetched=true に設定'}`
      );
    } else {
      // まだページが残っている場合は、次回実行時に続きから取得
      vState.nextPageToken = pageToken;
      console.log(`部分取得完了: ${video.videoId} - 次回実行時に続きから取得します（${pagesFetched}ページ取得）`);
    }
    state[videoId] = vState;

    processed++;
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
