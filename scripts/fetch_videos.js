/**
 * fetch_videos.js
 *
 * 各チャンネルの配信アーカイブ（チャットが存在する動画）のみを
 * uploads プレイリストから最古 → 最新の昇順で取得する
 *
 * 除外対象：
 * - shorts / 通常動画
 * - フリーチャット（videoId 完全一致）
 */

import fs from 'fs';
import fetch from 'node-fetch';
import { CHANNELS } from './config/channels.js';

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  throw new Error('YOUTUBE_API_KEY が設定されていません');
}

const OUTPUT_PATH = 'docs/assets/data/videos.json';
const MAX_RESULTS = 50;

/**
 * 既存の videos.json を読み込み、videoId -> chatFetched を復元する
 * fetch_videos.js は配信一覧を毎回再構築するため、この引き継ぎがないと
 * fetch_comments.js の冪等制御（chatFetched=true）を破壊してしまう。
 *
 * @returns {Map<string, boolean>}
 */
function loadExistingChatFetchedMap() {
  try {
    if (!fs.existsSync(OUTPUT_PATH)) return new Map();
    const raw = fs.readFileSync(OUTPUT_PATH, 'utf-8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Map();

    const map = new Map();
    for (const v of arr) {
      if (!v?.videoId) continue;
      map.set(v.videoId, Boolean(v.chatFetched));
    }
    return map;
  } catch {
    // 壊れたJSON等があっても取得処理自体は止めない（再生成できるため）
    return new Map();
  }
}

/**
 * uploads プレイリストIDを取得
 */
async function getUploadsPlaylistId(channelId) {
  const url =
    'https://www.googleapis.com/youtube/v3/channels' +
    `?part=contentDetails` +
    `&id=${channelId}` +
    `&key=${API_KEY}`;

  const res = await fetch(url);
  const json = await res.json();

  if (!json.items || !json.items[0]) {
    throw new Error(`uploads playlist が取得できません: ${channelId}`);
  }

  return json.items[0].contentDetails.relatedPlaylists.uploads;
}

/**
 * uploads プレイリストから全 videoId を取得（最古まで）
 */
async function fetchAllVideoIds(playlistId) {
  const ids = [];
  let pageToken = '';

  do {
    const url =
      'https://www.googleapis.com/youtube/v3/playlistItems' +
      `?part=contentDetails` +
      `&playlistId=${playlistId}` +
      `&maxResults=${MAX_RESULTS}` +
      `&pageToken=${pageToken}` +
      `&key=${API_KEY}`;

    const res = await fetch(url);
    const json = await res.json();

    if (!json.items) break;

    json.items.forEach(item => {
      ids.push(item.contentDetails.videoId);
    });

    pageToken = json.nextPageToken || '';
  } while (pageToken);

  return ids;
}

/**
 * videos.list で配信アーカイブのみ抽出
 */
async function fetchLiveArchives(videoIds, channelKey, channel) {
  const results = [];

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

    json.items.forEach(video => {
      const videoId = video.id;

      // ★ 最優先：フリーチャット除外（完全一致）
      if (videoId === channel.freechatVideoId) return;

      // 除外対象配信を除外
      if (
        Array.isArray(channel.excludeVideoIds) &&
        channel.excludeVideoIds.includes(videoId)
      ) {
        return;
      }

      const live = video.liveStreamingDetails;

      // 配信以外（shorts / 通常動画）
      if (!live) return;

      results.push({
        videoId,
        channelKey,
        channelName: channel.channelName,
        publishedAt: video.snippet.publishedAt,
        title: video.snippet.title,
        status: live.actualEndTime ? 'ended' : 'live',
        // chatFetched は main() 側で既存値を引き継いで上書きする
        chatFetched: false
      });
    });
  }

  return results;
}

async function main() {
  const existingChatFetched = loadExistingChatFetchedMap();
  const allVideos = [];

  for (const [channelKey, channel] of Object.entries(CHANNELS)) {
    console.log(`Fetching: ${channel.channelName}`);

    const uploadsPlaylistId = await getUploadsPlaylistId(channel.channelId);
    const videoIds = await fetchAllVideoIds(uploadsPlaylistId);
    const archives = await fetchLiveArchives(videoIds, channelKey, channel);

    allVideos.push(...archives);
  }

  // 最古 → 最新
  allVideos.sort((a, b) => {
    return new Date(a.publishedAt) - new Date(b.publishedAt);
  });

  // chatFetched を既存 videos.json から引き継ぐ（videoId 単位）
  for (const v of allVideos) {
    if (existingChatFetched.has(v.videoId)) {
      v.chatFetched = existingChatFetched.get(v.videoId);
    }
  }

  fs.mkdirSync('docs/assets/data', { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(allVideos, null, 2),
    'utf-8'
  );

  console.log(`videos.json generated: ${allVideos.length} items`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
