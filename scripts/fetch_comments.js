/**
 * fetch_comments.js
 *
 * 配信中（live）のライブチャットを段階的に取得し、
 * /docs/assets/data/comments/{channelKey}/{videoId}.json に保存する
 *
 * - 配信中にポーリングで取得
 * - 初回実行時（JSON未生成、message[]が0件など）は全ページ読み切り
 * - 2回目以降は差分取得（10ページ制限）
 * - 冪等（chatFetched=true は再取得しない）
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

const MAX_VIDEOS_PER_RUN = 5; // ← 安全ブレーキ（10分間隔実行前提、最大4チャンネル同時配信想定）

// チャット取得を除外する videoId のリスト（アーカイブ取得実装までの一時的な措置）
// scripts/config/dissallow_fetch_comments_videos.js から読み込む
// このファイルは現時点の videos.json の内容を固定化したもので、
// 新しい配信が videos.json に追加されても、このファイルは更新されないため、
// 新しい配信は自動的にチャット取得対象になります
// （main() 関数内で読み込む）

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

  // 除外リストファイルの読み込み（存在しない場合は空配列）
  let DISALLOW_VIDEO_IDS = [];
  try {
    const disallowModule = await import('./config/dissallow_fetch_comments_videos.js');
    DISALLOW_VIDEO_IDS = disallowModule.DISSALLOW_FETCH_COMMENTS_VIDEOS || [];
  } catch (err) {
    console.warn('除外リストファイルが見つかりません。scripts/config/dissallow_fetch_comments_videos.js を確認してください。');
    DISALLOW_VIDEO_IDS = [];
  }

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
    // 除外リストに含まれている videoId はスキップ
    if (DISALLOW_VIDEO_IDS.includes(video.videoId)) {
      continue;
    }

    if (
      // 取得対象は「配信中（live）」のみ（配信予定（upcoming）は対象外）
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

    // 既存コメントファイルの存在確認（初回実行判定用）
    let existingMessagesCount = 0;
    if (fs.existsSync(outPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
        existingMessagesCount = existing.messages?.length || 0;
      } catch {
        // 既存が壊れていれば新規として扱う
      }
    }

    // 初回実行判定: JSONファイルが存在しない、または messages が空、かつ nextPageToken が無い
    const isFirstRun =
      (!fs.existsSync(outPath) || existingMessagesCount === 0) &&
      !vState.nextPageToken;

    // 1回の実行で取得するページ数の上限（クォータ制御用）
    // 初回実行時は全ページ読み切るため上限を大きくする（無限ループ防止のため1000ページ = 20万コメントまで）
    // 2回目以降は差分取得のため10ページ制限
    const MAX_PAGES_PER_RUN = isFirstRun ? 1000 : 10;
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

    // 重複チェック: 既存のコメントの時刻を Set で管理
    const existingTimestamps = new Set(
      existing.messages.map(msg => `${msg.t}|${msg.m}`)
    );

    // 新しいコメントを追加（重複を除外）
    const uniqueNewMessages = newMessages.filter(
      msg => !existingTimestamps.has(`${msg.t}|${msg.m}`)
    );

    // 時刻順にソートしてマージ（配信中は最新から古い順に取得されるため）
    existing.messages = [...existing.messages, ...uniqueNewMessages].sort(
      (a, b) => new Date(a.t) - new Date(b.t)
    );
    existing.fetchedAt = new Date().toISOString();

    fs.writeFileSync(
      outPath,
      JSON.stringify(existing, null, 2),
      'utf-8'
    );

    // 次回用の pageToken を保存
    // 配信中に nextPageToken が null になった場合でも、配信が終了していない限り
    // 次回実行時に再度 pageToken なしで呼び出して最新のコメントを取得する
    if (pageToken === null && video.status === 'live') {
      // 配信中は nextPageToken を空文字列にリセット（次回実行時に最新から再取得）
      vState.nextPageToken = '';
      console.log(`配信中に nextPageToken が null になりました: ${video.videoId} - 次回実行時に最新から再取得します`);
    } else if (pageToken === null) {
      // 配信終了後、全ページ読み切り完了
      video.chatFetched = true;
      vState.nextPageToken = null;
      console.log(`全ページ読み切り完了: ${video.videoId} - chatFetched=true に設定`);
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
