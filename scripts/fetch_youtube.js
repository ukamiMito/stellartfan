/**
 * YouTube Data API v3 を利用して配信情報を取得し、
 * 以下の JSON キャッシュを生成する
 *
 * - docs/assets/data/json/live_cache.json
 *   各チャンネルの配信予定・配信中情報（フリーチャット除外）
 *
 * - docs/assets/data/json/freechat.json
 *   各チャンネルのフリーチャット配信（動画ID固定）
 */

import fs from 'fs';
import fetch from 'node-fetch';

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  throw new Error('YOUTUBE_API_KEY が設定されていません');
}

/**
 * 対象チャンネル定義
 */
const CHANNELS = {
  channelA: {
    channelId: 'UCrxtv0Zc8uQNfsY0HsAGY8g',
    channelName: '天硝路ろまん',
    freechatVideoId: 'k0g-C_oCYb0'
  },
  channelB: {
    channelId: 'UCFernrRmaCRoOjZ55pwNxpw',
    channelName: '華鉈イオ',
    freechatVideoId: 'foFBBmkRyf0'
  }
};

/**
 * フリーチャット動画ID一覧
 */
const FREECHAT_IDS = new Set(
  Object.values(CHANNELS).map(channel => channel.freechatVideoId)
);

/**
 * 動画IDからサムネイルURLを生成する
 *
 * @param {string} videoId - YouTube動画ID
 * @param {'max' | 'hq' | 'mq'} size - サムネイルサイズ
 * @returns {string} サムネイル画像URL
 */
function getThumbnail(videoId, size = 'max') {
  switch (size) {
    case 'max':
      return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
    case 'hq':
      return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    default:
      return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  }
}

async function main() {
  /**
   * live_cache.json 用の結果オブジェクト
   */
  const liveResult = {
    updatedAt: new Date().toISOString(),
    channels: {}
  };

  /**
   * freechat.json 用の結果オブジェクト
   */
  const freechatResult = {};

  /**
   * videos.list API に渡す動画ID一覧
   * （search.list + freechat でまとめて収集）
   */
  const videoIdsForDetail = [];

  /**
   * 出力用ディレクトリパス
   */
  const OUTPUT_DIR = 'docs/assets/data/json';

  /**
   * 各チャンネルの search.list
   */
  for (const [key, channel] of Object.entries(CHANNELS)) {
    /**
     * search.list API
     * 配信予定（upcoming）の動画を取得する
     */
    const searchUrl =
      'https://www.googleapis.com/youtube/v3/search' +
      '?part=snippet' +
      `&channelId=${channel.channelId}` +
      '&type=video' +
      '&order=date' +
      '&maxResults=10' +
      `&key=${API_KEY}`;

    const searchResponse = await fetch(searchUrl);
    const searchJson = await searchResponse.json();

    liveResult.channels[key] = [];

    if (searchJson.items) {
      for (const item of searchJson.items) {
        const videoId = item.id.videoId;

        // フリーチャット除外
        if (FREECHAT_IDS.has(videoId)) continue;

        liveResult.channels[key].push({
          videoId,
          title: item.snippet.title,
          thumbnail: getThumbnail(videoId, 'hq'),
          url: `https://www.youtube.com/watch?v=${videoId}`,
          status: 'upcoming',
          scheduledStartTime: null,
          actualStartTime: null,
          actualEndTime: null
        });

        videoIdsForDetail.push(videoId);
      }
    }

    /**
     * freechat.json 用
     */
    freechatResult[key] = {
      videoId: channel.freechatVideoId,
      channelName: channel.channelName,
      thumbnail: getThumbnail(channel.freechatVideoId, 'max')
    };

    videoIdsForDetail.push(channel.freechatVideoId);
  }

  /**
   * videos.list（liveStreamingDetails 取得）
   */
  const videoDetailMap = new Map();

  if (videoIdsForDetail.length > 0) {
    const detailUrl =
      'https://www.googleapis.com/youtube/v3/videos' +
      '?part=liveStreamingDetails' +
      `&id=${videoIdsForDetail.join(',')}` +
      `&key=${API_KEY}`;

    const detailResponse = await fetch(detailUrl);
    const detailJson = await detailResponse.json();

    if (detailJson.items) {
      for (const item of detailJson.items) {
        videoDetailMap.set(item.id, item.liveStreamingDetails || null);
      }
    }
  }

  /**
   * 配信情報マージ
   * - live / upcoming のみ残す
   * - Shorts / 通常動画 / ended は除外
   */
  for (const channelKey of Object.keys(liveResult.channels)) {
    liveResult.channels[channelKey] = liveResult.channels[channelKey]
      .map(entry => {
        const detail = videoDetailMap.get(entry.videoId);

        // liveStreamingDetails を持たない動画は除外（Shorts / 通常動画）
        if (!detail) return null;

        // 配信中
        if (detail.actualStartTime && !detail.actualEndTime) {
          entry.status = 'live';
          entry.actualStartTime = detail.actualStartTime;
          return entry;
        }

        // 配信予定
        if (detail.scheduledStartTime && !detail.actualStartTime) {
          entry.status = 'upcoming';
          entry.scheduledStartTime = detail.scheduledStartTime;
          return entry;
        }

        // 終了済み or その他は除外
        return null;
      })
      .filter(Boolean);
  }

  /**
   * json用 ディレクトリを作成（存在しない場合）
   */
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  /**
   * JSON ファイルを書き出す
   */
  fs.writeFileSync(
    `${OUTPUT_DIR}/live_cache.json`,
    JSON.stringify(liveResult, null, 2),
    'utf-8'
  );

  fs.writeFileSync(
    `${OUTPUT_DIR}/freechat.json`,
    JSON.stringify(freechatResult, null, 2),
    'utf-8'
  );

  console.log('YouTube 配信キャッシュを更新しました');
}

/**
 * 実行
 */
main().catch(error => {
  console.error('スクリプト実行中にエラーが発生しました', error);
  process.exit(1);
});
