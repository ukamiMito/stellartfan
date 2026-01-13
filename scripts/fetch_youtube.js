import fs from "fs";
import fetch from "node-fetch";

const API_KEY = process.env.YOUTUBE_API_KEY;

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

async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function main() {
  const liveResult = { updatedAt: new Date().toISOString(), channels: {} };
  const freechatResult = {};

  const videoIds = [];

  for (const [key, ch] of Object.entries(CHANNELS)) {
    const url =
      `https://www.googleapis.com/youtube/v3/search?part=snippet` +
      `&channelId=${ch.channelId}` +
      `&eventType=upcoming&type=video&order=date&maxResults=7` +
      `&key=${API_KEY}`;

    const json = await fetchJSON(url);
    liveResult.channels[key] = json.items.map(i => {
      videoIds.push(i.id.videoId);
      return { videoId: i.id.videoId, title: i.snippet.title };
    });

    freechatResult[key] = { videoId: ch.freechatVideoId };
    videoIds.push(ch.freechatVideoId);
  }

  const detailsUrl =
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails` +
    `&id=${videoIds.join(",")}&key=${API_KEY}`;

  const details = await fetchJSON(detailsUrl);

  for (const v of details.items) {
    for (const list of Object.values(liveResult.channels)) {
      const target = list.find(x => x.videoId === v.id);
      if (target) {
        target.thumbnail = v.snippet.thumbnails.medium.url;
      }
    }
  }

  fs.writeFileSync("public/live_cache.json", JSON.stringify(liveResult, null, 2));
  fs.writeFileSync("public/freechat.json", JSON.stringify(freechatResult, null, 2));
}

main();
