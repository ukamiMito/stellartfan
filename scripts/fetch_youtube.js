/**
 * YouTube Data API v3 を利用して配信情報を取得し、
 * 以下の JSON キャッシュを生成する
 *
 * - public/live_cache.json
 *   各チャンネルの配信予定・配信中情報（フリーチャット除外）
 *
 * - public/freechat.json
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
 * key は JSON 出力時の識別子として使用する
 */
const CHANNELS = {
  channelA: {
    channelId: 'UCrxtv0Zc8uQNfsY0HsAGY8g',
    freechatVideoId: 'k0g-C_oCYb0'
  },
  channelB: {
    channelId: 'UCFernrRmaCRoOjZ55pwNxpw',
    freechatVideoId: 'foFBBmkRyf0'
  }
};

/**
 * フリーチャット動画ID一覧
 * search.list の結果から除外するため Set として保持する
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

/**
 * メイン処理
 */
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
   * 各チャンネルごとの search.list 処理
   */
  for (const [key, channel] of Object.entries(CHANNELS)) {
    /**
     * search.list API
     * 配信予定（upcoming）の動画を取得する
     */
    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search` +
      `?part=snippet` +
      `&channelId=${channel.channelId}` +
      `&eventType=upcoming` +
      `&type=video` +
      `&maxResults=7` +
      `&key=${API_KEY}`;

    const searchResponse = await fetch(searchUrl);
    const searchJson = await searchResponse.json();

    if (!searchJson.items) {
      liveResult.channels[key] = [];
    } else {
      /**
       * フリーチャット動画を除外し、live_cache のベースを作成
       * （時刻・状態は後続の videos.list で補完する）
       */
      liveResult.channels[key] = searchJson.items
        .filter(item => !FREECHAT_IDS.has(item.id.videoId))
        .map(item => {
          const videoId = item.id.videoId;
          videoIdsForDetail.push(videoId);

          return {
            videoId,
            title: item.snippet.title,
            thumbnail: getThumbnail(videoId, 'hq'),
            url: `https://www.youtube.com/watch?v=${videoId}`,
            status: 'upcoming',
            scheduledStartTime: null,
            actualStartTime: null
          };
        });
    }

    /**
     * freechat.json 用データ
     * フリーチャットは動画ID固定・最大サイズサムネイルを使用
     */
    freechatResult[key] = {
      videoId: channel.freechatVideoId,
      thumbnail: getThumbnail(channel.freechatVideoId, 'max')
    };

    videoIdsForDetail.push(channel.freechatVideoId);
  }

  /**
   * videos.list API
   * scheduledStartTime / actualStartTime を取得する
   * ※ 動画IDをまとめて 1 回のみ呼び出す（ユニット最小）
   */
  let videoDetailMap = new Map();

  if (videoIdsForDetail.length > 0) {
    const detailUrl =
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=liveStreamingDetails` +
      `&id=${videoIdsForDetail.join(',')}` +
      `&key=${API_KEY}`;

    const detailResponse = await fetch(detailUrl);
    const detailJson = await detailResponse.json();

    if (detailJson.items) {
      detailJson.items.forEach(item => {
        videoDetailMap.set(item.id, item.liveStreamingDetails || {});
      });
    }
  }

  /**
   * live_cache.json に videos.list の情報をマージ
   */
  for (const channelKey of Object.keys(liveResult.channels)) {
    liveResult.channels[channelKey] = liveResult.channels[channelKey].map(
      entry => {
        const detail = videoDetailMap.get(entry.videoId);

        if (detail?.actualStartTime) {
          entry.status = 'live';
          entry.actualStartTime = detail.actualStartTime;
        }

        if (detail?.scheduledStartTime) {
          entry.scheduledStartTime = detail.scheduledStartTime;
        }

        if (detail?.actualEndTime) {
          entry.status = 'end';
          entry.actualEndTime = detail.actualEndTime;
        }

        return entry;
      }
    );
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
