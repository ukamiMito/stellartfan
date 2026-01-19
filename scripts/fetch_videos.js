
import CHANNELS from './config/channels.js';/**
 * fetch_videos.js
 *
 * 各チャンネルのライブ配信アーカイブのみを取得し
 * docs/assets/data/videos.json を生成・更新する
 *
 * - shorts / 通常動画は除外
 * - フリーチャットは除外
 * - 最古 → 最新（昇順）
 * - 冪等
 */

import fs from 'fs';
import fetch from 'node-fetch';
import CHANNELS from './config/channels.js';

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  throw new Error('YOUTUBE_API_KEY が設定されていません');
}

const OUTPUT_PATH = 'docs/assets/data/videos.json';
const SEARCH_MAX = 50;

/**
 * 既存 videos.json 読み込み
 */
function loadExistingVideos() {
  if (!fs.existsSync(OUTPUT_PATH)) return [];
  return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
}

/**
 * search.list を全ページ取得（新→旧）
 */
async function fetchAllSearchResults(channelId) {
  let items = [];
  let pageToken = undefined;

  while (true) {
    const url =
      'https://www.googleapis.com/youtube/v3/search' +
      `?part=snippet` +
      `&channelId=${channelId}` +
      `&type=video` +
      `&order=date` +
      `&maxResults=${SEARCH_MAX}` +
      (pageToken ? `&pageToken=${pageToken}` : '') +
      `&key=${API_KEY}`;

    const res = await fetch(url);
    const json = await res.json();

    if (!json.items) break;

    items.push(...json.items);

    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }

  return items;
}

/**
 * videos.list で liveStreamingDetails を取得
 */
async function fetchLiveDetails(videoIds) {
  const map = new Map();

  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);

    const url =
      'https://www.googleapis.com/youtube/v3/videos' +
      `?part=liveStreamingDetails,snippet` +
      `&id=${chunk.join(',')}` +
      `&key=${API_KEY}`;

    const res = await fetch(url);
    const json = await res.json();

    if (!json.items) continue;

    json.items.forEach(item => {
      map.set(item.id, item);
    });
  }

  return map;
}

async function main() {
  const existing = loadExistingVideos();
  const existingIds = new Set(existing.map(v => v.videoId));
  const results = [...existing];

  for (const [channelKey, channel] of Object.entries(CHANNELS)) {
    console.log(`Fetching channel: ${channel.channelName}`);

    const searchItems = await fetchAllSearchResults(channel.channelId);

    const videoIds = searchItems
      .map(item => item.id.videoId)
      .filter(id => id && !existingIds.has(id));

    if (videoIds.length === 0) continue;

    const detailMap = await fetchLiveDetails(videoIds);

    for (const [videoId, item] of detailMap.entries()) {
      // フリーチャット除外
      if (channel.freechatVideoIds?.includes(videoId)) continue;

      // ライブ配信由来でない動画（shorts / 通常動画）除外
      if (!item.liveStreamingDetails) continue;

      const { actualEndTime } = item.liveStreamingDetails;

      results.push({
        videoId,
        channelKey,
        channelName: channel.channelName,
        publishedAt: item.snippet.publishedAt,
        title: item.snippet.title,
        status: actualEndTime ? 'ended' : 'live',
        chatFetched: false
      });

      existingIds.add(videoId);
    }
  }

  // 最古 → 最新
  results.sort((a, b) => {
    return new Date(a.publishedAt) - new Date(b.publishedAt);
  });

  fs.mkdirSync('docs/assets/data', { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(results, null, 2),
    'utf-8'
  );

  console.log(`videos.json updated: ${results.length} items`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
