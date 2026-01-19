/**
 * YouTube 各チャンネルの配信アーカイブ一覧を
 * 最古 → 最新の昇順で videos.json に蓄積する
 *
 * - 複数チャンネル対応
 * - pageToken で全件取得
 * - 既存 videos.json があれば差分のみ追加（冪等）
 */

import fs from 'fs';
import fetch from 'node-fetch';
import CHANNELS from './channels.js';

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  throw new Error('YOUTUBE_API_KEY が設定されていません');
}

const OUTPUT_PATH = 'docs/assets/data/videos.json';
const MAX_RESULTS = 50;

/**
 * 既存 videos.json を読み込む
 */
function loadExistingVideos() {
  if (!fs.existsSync(OUTPUT_PATH)) return [];
  return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
}

/**
 * YouTube search.list を pageToken で全件取得
 */
async function fetchAllVideosByChannel(channelKey, channel) {
  let results = [];
  let pageToken = null;

  do {
    const url =
      `https://www.googleapis.com/youtube/v3/search` +
      `?part=snippet` +
      `&channelId=${channel.channelId}` +
      `&type=video` +
      `&order=date` +
      `&maxResults=${MAX_RESULTS}` +
      `&key=${API_KEY}` +
      (pageToken ? `&pageToken=${pageToken}` : '');

    const res = await fetch(url);
    const json = await res.json();

    if (!json.items) break;

    for (const item of json.items) {
      results.push({
        videoId: item.id.videoId,
        channelKey,
        channelName: channel.channelName,
        publishedAt: item.snippet.publishedAt,
        title: item.snippet.title,
        status: 'ended',
        chatFetched: false
      });
    }

    pageToken = json.nextPageToken;
  } while (pageToken);

  return results;
}

/**
 * メイン処理
 */
async function main() {
  const existingVideos = loadExistingVideos();
  const existingIds = new Set(existingVideos.map(v => v.videoId));

  let newVideos = [];

  for (const [channelKey, channel] of Object.entries(CHANNELS)) {
    console.log(`Fetching videos for ${channel.channelName}...`);

    const fetched = await fetchAllVideosByChannel(channelKey, channel);

    const diff = fetched.filter(v => !existingIds.has(v.videoId));
    newVideos.push(...diff);
  }

  const merged = [...existingVideos, ...newVideos];

  // publishedAt 昇順（最古 → 最新）
  merged.sort(
    (a, b) => new Date(a.publishedAt) - new Date(b.publishedAt)
  );

  fs.mkdirSync('docs/assets/data', { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(merged, null, 2),
    'utf-8'
  );

  console.log(
    `videos.json 更新完了: 既存 ${existingVideos.length} 件 + 追加 ${newVideos.length} 件`
  );
}

main().catch(err => {
  console.error('fetch_videos.js エラー', err);
  process.exit(1);
});
