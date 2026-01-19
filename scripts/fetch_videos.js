import fs from 'fs';
import fetch from 'node-fetch';
import { CHANNELS } from './config/channels.js';

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) throw new Error('YOUTUBE_API_KEY が未設定です');

const OUTPUT_DIR = 'docs/assets/data';
const VIDEOS_JSON = `${OUTPUT_DIR}/videos.json`;
const MAX_PER_RUN = 10; // 1日1回・安全上限

/**
 * 既存 videos.json を読み込む
 */
function loadVideos() {
  if (!fs.existsSync(VIDEOS_JSON)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(VIDEOS_JSON, 'utf-8'));
}

/**
 * 保存
 */
function saveVideos(videos) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    VIDEOS_JSON,
    JSON.stringify(videos, null, 2),
    'utf-8'
  );
}

/**
 * メイン
 */
async function main() {
  const videos = loadVideos();
  const knownIds = new Set(videos.map(v => v.videoId));
  let added = 0;

  for (const [channelKey, channel] of Object.entries(CHANNELS)) {
    if (added >= MAX_PER_RUN) break;

    let pageToken = '';
    while (added < MAX_PER_RUN) {
      const searchUrl =
        'https://www.googleapis.com/youtube/v3/search' +
        '?part=snippet' +
        `&channelId=${channel.channelId}` +
        '&type=video' +
        '&order=date' +
        '&maxResults=10' +
        `&pageToken=${pageToken}` +
        `&key=${API_KEY}`;

      const res = await fetch(searchUrl);
      const json = await res.json();
      if (!json.items) break;

      for (const item of json.items) {
        const videoId = item.id.videoId;
        if (knownIds.has(videoId)) continue;

        // videos.list で配信状態確認
        const detailUrl =
          'https://www.googleapis.com/youtube/v3/videos' +
          '?part=liveStreamingDetails' +
          `&id=${videoId}` +
          `&key=${API_KEY}`;

        const dRes = await fetch(detailUrl);
        const dJson = await dRes.json();
        const detail = dJson.items?.[0]?.liveStreamingDetails;

        if (!detail?.actualEndTime) {
          // 終了していない動画はスキップ
          continue;
        }

        videos.push({
          videoId,
          channelKey,
          channelName: channel.channelName,
          publishedAt: item.snippet.publishedAt,
          title: item.snippet.title,
          status: 'ended',
          chatFetched: false
        });

        knownIds.add(videoId);
        added++;
        if (added >= MAX_PER_RUN) break;
      }

      pageToken = json.nextPageToken;
      if (!pageToken) break;
    }
  }

  saveVideos(videos);
  console.log(`videos.json 更新完了（追加 ${added} 件）`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
