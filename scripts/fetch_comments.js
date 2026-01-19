import fs from 'fs';
import fetch from 'node-fetch';
import CHANNELS from './config/channels.js';

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) throw new Error('YOUTUBE_API_KEY が未設定です');

const DATA_DIR = 'docs/assets/data';
const VIDEOS_JSON = `${DATA_DIR}/videos.json`;
const COMMENTS_DIR = `${DATA_DIR}/comments`;
const MAX_VIDEOS_PER_RUN = 3;

/**
 * videos.json 読み込み
 */
function loadVideos() {
  return JSON.parse(fs.readFileSync(VIDEOS_JSON, 'utf-8'));
}

/**
 * 保存
 */
function saveVideos(videos) {
  fs.writeFileSync(
    VIDEOS_JSON,
    JSON.stringify(videos, null, 2),
    'utf-8'
  );
}

/**
 * ライブチャット取得
 */
async function fetchChat(videoId) {
  let chatId = null;

  // liveStreamingDetails 取得
  const detailUrl =
    'https://www.googleapis.com/youtube/v3/videos' +
    '?part=liveStreamingDetails' +
    `&id=${videoId}` +
    `&key=${API_KEY}`;

  const dRes = await fetch(detailUrl);
  const dJson = await dRes.json();
  chatId = dJson.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!chatId) return [];

  const messages = [];
  let pageToken = '';

  while (true) {
    const chatUrl =
      'https://www.googleapis.com/youtube/v3/liveChat/messages' +
      '?part=snippet' +
      `&liveChatId=${chatId}` +
      '&maxResults=200' +
      `&pageToken=${pageToken}` +
      `&key=${API_KEY}`;

    const res = await fetch(chatUrl);
    const json = await res.json();
    if (!json.items) break;

    for (const item of json.items) {
      messages.push({
        timestamp: item.snippet.publishedAt,
        videoTime: item.snippet.videoPublishedAt,
        message: item.snippet.displayMessage,
        type: item.snippet.type
      });
    }

    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }

  return messages;
}

/**
 * メイン
 */
async function main() {
  const videos = loadVideos();
  let processed = 0;

  for (const video of videos) {
    if (
      video.status !== 'ended' ||
      video.chatFetched ||
      processed >= MAX_VIDEOS_PER_RUN
    ) {
      continue;
    }

    const channelDir = `${COMMENTS_DIR}/${video.channelKey}`;
    fs.mkdirSync(channelDir, { recursive: true });

    const comments = await fetchChat(video.videoId);

    fs.writeFileSync(
      `${channelDir}/${video.videoId}.json`,
      JSON.stringify({
        videoId: video.videoId,
        title: video.title,
        channelName: video.channelName,
        comments
      }, null, 2),
      'utf-8'
    );

    video.chatFetched = true;
    processed++;
    console.log(`取得完了: ${video.videoId}`);
  }

  saveVideos(videos);
  console.log(`コメント取得 ${processed} 件`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
