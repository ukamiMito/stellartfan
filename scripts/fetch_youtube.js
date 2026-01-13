/**
 * YouTube API を利用して以下の JSON キャッシュを生成する
 *
 * - public/live_cache.json
 *   各チャンネルの配信予定（フリーチャット除外）
 *
 * - public/freechat.json
 *   各チャンネルのフリーチャット配信（動画ID固定）
 */

import fs from "fs";
import fetch from "node-fetch";

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  throw new Error("YOUTUBE_API_KEY が設定されていません");
}

/**
 * 対象チャンネル定義
 * key は JSON 出力時の識別子として利用する
 */
const CHANNELS = {
  channelA: {
    channelId: "UCrxtv0Zc8uQNfsY0HsAGY8g",
    freechatVideoId: "k0g-C_oCYb0"
  },
  channelB: {
    channelId: "UCFernrRmaCRoOjZ55pwNxpw",
    freechatVideoId: "foFBBmkRyf0"
  }
};

/**
 * フリーチャット動画ID一覧
 * search 結果から除外するため Set として保持する
 */
const FREECHAT_IDS = new Set(
  Object.values(CHANNELS).map(channel => channel.freechatVideoId)
);

/**
 * 動画IDからサムネイルURLを生成する
 *
 * @param {string} videoId - YouTube動画ID
 * @param {"max" | "hq" | "mq"} size - サムネイルサイズ
 * @returns {string} サムネイル画像URL
 */
function getThumbnail(videoId, size = "max") {
  switch (size) {
    case "max":
      return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
    case "hq":
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
   * videos.list で存在確認を行うための動画ID一覧
   * （将来拡張用・現在はユニット最小のため情報は利用しない）
   */
  const videoIdsForDetail = [];

  /**
   * 各チャンネルごとの処理
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
       * フリーチャット動画を除外し live_cache に格納
       */
      liveResult.channels[key] = searchJson.items
        .filter(item => !FREECHAT_IDS.has(item.id.videoId))
        .map(item => {
          const videoId = item.id.videoId;
          videoIdsForDetail.push(videoId);

          return {
            videoId,
            title: item.snippet.title,
            thumbnail: getThumbnail(videoId, "hq"),
            url: `https://www.youtube.com/watch?v=${videoId}`
          };
        });
    }

    /**
     * freechat.json 用データ
     * フリーチャットは動画ID固定・最大サイズサムネイルを使用
     */
    freechatResult[key] = {
      videoId: channel.freechatVideoId,
      thumbnail: getThumbnail(channel.freechatVideoId, "max")
    };

    videoIdsForDetail.push(channel.freechatVideoId);
  }

  /**
   * videos.list API
   * 動画の存在確認・将来の詳細取得用
   * （レスポンスは現時点では使用しない）
   */
  if (videoIdsForDetail.length > 0) {
    const detailUrl =
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=id` +
      `&id=${videoIdsForDetail.join(",")}` +
      `&key=${API_KEY}`;

    await fetch(detailUrl);
  }

  /**
   * public ディレクトリを作成（存在しない場合）
   */
  fs.mkdirSync("public", { recursive: true });

  /**
   * JSON ファイルを書き出す
   */
  fs.writeFileSync(
    "public/live_cache.json",
    JSON.stringify(liveResult, null, 2),
    "utf-8"
  );

  fs.writeFileSync(
    "public/freechat.json",
    JSON.stringify(freechatResult, null, 2),
    "utf-8"
  );

  console.log("YouTube キャッシュを更新しました");
}

/**
 * 実行
 */
main().catch(error => {
  console.error("スクリプト実行中にエラーが発生しました", error);
  process.exit(1);
});
