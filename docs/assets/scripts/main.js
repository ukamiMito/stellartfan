/**
 * ISO文字列を JST 表記に変換
 */
function formatJST(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo"
  });
}

/**
 * Skeleton を表示
 */
function showSkeleton(container, count = 4) {
  for (let i = 0; i < count; i++) {
    const div = document.createElement("div");
    div.className = "skeleton";
    container.appendChild(div);
  }
}

/**
 * テンプレートからカードを生成
 */
function createCard(video) {
  const template = document.getElementById("video-card-template");
  const card = template.content.firstElementChild.cloneNode(true);

  if (video.status === "ended") {
    card.classList.add("ended");
  }

  // link
  const link = card.querySelector(".video-link");
  link.href = video.url;

  // thumbnail
  const thumb = card.querySelector(".thumbnail");
  thumb.src = video.thumbnail;

  // channel
  const icon = card.querySelector(".channel-icon");
  icon.src = video.channelIcon;
  icon.alt = video.channelName;

  const name = card.querySelector(".channel-name");
  name.textContent = video.channelName;

  // badge
  const badge = card.querySelector(".badge");
  let badgeText = "予定";
  let badgeClass = "upcoming";

  if (video.status === "live") {
    badgeText = "配信中";
    badgeClass = "live";
  } else if (video.status === "ended") {
    badgeText = "配信終了";
    badgeClass = "ended";
  }

  badge.textContent = badgeText;
  badge.classList.add(badgeClass);

  // title
  card.querySelector(".title").textContent = video.title;

  // time
  const timeEl = card.querySelector(".time");
  if (video.scheduledStartTime) {
    timeEl.textContent = `開始予定：${formatJST(video.scheduledStartTime)}`;
  } else {
    timeEl.remove();
  }

  return card;
}

async function main() {
  const liveList = document.getElementById("live-list");
  const freechatList = document.getElementById("freechat-list");

  showSkeleton(liveList);
  showSkeleton(freechatList, 2);

  /* ---------- live_cache ---------- */
  const liveJson = await fetch("/assets/data/json/live_cache.json").then(r => r.json());

  let videos = Object.values(liveJson.channels).flat();

  // live → upcoming → ended
  const order = { live: 0, upcoming: 1, ended: 2 };
  videos.sort((a, b) => {
    return order[a.status] - order[b.status];
  });

  liveList.innerHTML = "";
  videos.forEach(v => liveList.appendChild(createCard(v)));

  /* ---------- freechat ---------- */
  const freechatJson = await fetch("/assets/data/json/freechat.json").then(r => r.json());

  freechatList.innerHTML = "";
  Object.values(freechatJson).forEach(fc => {
    freechatList.appendChild(
      createCard({
        title: "フリーチャット",
        thumbnail: fc.thumbnail,
        url: `https://www.youtube.com/watch?v=${fc.videoId}`,
        status: "freechat",
        channelName: fc.channelName,
        channelIcon: fc.channelIcon
      })
    );
  });
}

main().catch(console.error);
