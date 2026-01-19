/**
 * 配信アーカイブ（チャットあり動画）のみを
 * 最古 → 最新の昇順で取得し videos.json を生成する
 */

import fs from 'fs';
import fetch from 'node-fetch';
import CHANNELS from './config/channels.js';

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) throw new Error('YOUTUBE_API_KEY is not set');

const OUTPUT = 'docs/assets/data/videos.json';
const MAX_RESULTS = 50;

/**
 * search.list を最後まで辿り videoId をすべて取得
 */
async function fetchAllVideoIds(channelId) {
  const ids = [];
  let pageToken = '';

  do {
    const url =
      `https://www.googleapis.com/youtube/v3/search` +
      `?part=id,snippet` +
      `&channelId=${channelId}` +
      `&type=video` +
      `&order=date` +
      `&maxResults=${MAX_RESULTS}` +
      `&pageToken=${pageToken}` +
      `&key=${API_KEY}`;

    const res = await fetch(url);
    const json = await res.json();

    if (!json.items) break;

    json.items.forEach(item => {
      ids.push({
        videoId: item.id.videoId,
        publishedAt: item.snippet.publishedAt,
        title: item.snippet.title
      });
    });

    pageToken = json.nextPageToken || '';
  } while (pageToken);

  return ids;
}

/**
 * videos.list で配信動画のみ抽出
 */
async function enrichAndFilterVideos(videos, channelKey, channel) {
  const results = [];
  const chunks = [];

  while (videos.length) {
    chunks.push(videos.splice(0, 50));
  }

  for (const chunk of chunks) {
    const ids = chunk.map(v => v.videoId).join(',');

    const url =
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=liveStreamingDetails,snippet` +
      `&id=${ids}` +
      `&key=${API_KEY}`;

    const res = await fetch(url);
    const json = await res.json();

    if (!json.items) continue;

    json.items.forEach(item => {
      const live = item.liveStreamingDetails;
      const videoId = item.id;

      // フリーチャット除外
      if (videoId === channel.freechatVideoId) return;

      // 配信以外（shorts / 通常動画）除外
      if (!live || (!live.actualStartTime && !live.scheduledStartTime)) return;

      results.push({
        videoId,
        channelKey,
        channelName: channel.channelName,
        publishedAt: item.snippet.publishedAt,
        title: item.snippet.title,
        status: live.actualEndTime
          ? 'ended'
          : live.actualStartTime
          ? 'live'
          : 'upcoming',
        chatFetched: false
      });
    });
  }

  return results;
}

async function main() {
  const all = [];

  for (const [key, channel] of Object.entries(CHANNELS)) {
    console.log(`Fetching ${channel.channelName}`);

    const ids = await fetchAllVideoIds(channel.channelId);
    const videos = await enrichAndFilterVideos(ids, key, channel);

    all.push(...videos);
  }

  // 最古 → 最新
  all.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));

  fs.mkdirSync('docs/assets/data', { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(all, null, 2), 'utf-8');

  console.log(`Saved ${all.length} videos`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
