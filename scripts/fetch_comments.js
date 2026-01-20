/**
 * fetch_comments.js
 *
 * 終了済み配信のライブチャットを段階的に取得し、
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

  let processed = 0;

  for (const video of videos) {
    if (
      video.status !== 'ended' ||
      video.chatFetched ||
      processed >= MAX_VIDEOS_PER_RUN
    ) {
      continue;
    }

    const channelKey = video.channelKey;
    const outDir = `${COMMENTS_BASE_DIR}/${channelKey}`;
    const outPath = `${outDir}/${video.videoId}.json`;

    fs.mkdirSync(outDir, { recursive: true });

    const liveChatId = await getLiveChatId(video.videoId);
    if (!liveChatId) {
      video.chatFetched = true; // チャット無し配信として確定
      continue;
    }

    console.log(`チャット取得開始: ${video.videoId}`);

    const messages = await fetchAllChatMessages(liveChatId);

    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          videoId: video.videoId,
          channelKey,
          channelName: video.channelName,
          fetchedAt: new Date().toISOString(),
          messages
        },
        null,
        2
      ),
      'utf-8'
    );

    video.chatFetched = true;
    processed++;
    console.log(`取得完了: ${video.videoId}`);
  }

  fs.writeFileSync(
    VIDEOS_JSON,
    JSON.stringify(videos, null, 2),
    'utf-8'
  );

  console.log(`コメント取得: ${processed} 件`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
