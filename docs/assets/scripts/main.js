/**
 * チャンネルキー → 表示名マップ
 */
const CHANNEL_NAME_MAP = {
  channelA: '天硝路ろまん',
  channelB: '華鉈イオ'
};

/**
 * ISO文字列を JST 表記に変換
 * @param {string} iso
 * @returns {string}
 */
function formatJST(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo'
  });
}

/**
 * Skeleton を表示
 * @param {HTMLElement} container
 * @param {number} count
 */
function showSkeleton(container, count = 4) {
  container.textContent = '';
  for (let i = 0; i < count; i++) {
    const div = document.createElement('div');
    div.className = 'skeleton';
    container.appendChild(div);
  }
}

/**
 * ライブ配信データをソート
 * - live → upcoming
 * - scheduledStartTime 昇順
 * @param {Array} videos
 * @returns {Array}
 */
function sortLiveVideos(videos) {
  return [...videos].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'live' ? -1 : 1;
    }

    if (a.scheduledStartTime && b.scheduledStartTime) {
      return new Date(a.scheduledStartTime) - new Date(b.scheduledStartTime);
    }

    if (a.scheduledStartTime) return -1;
    if (b.scheduledStartTime) return 1;

    return 0;
  });
}

/**
 * テンプレートから動画カードを生成
 * @param {Object} video
 * @returns {HTMLElement}
 */
function createVideoCard(video) {
  const template = document.getElementById('video-card-template');
  const card = template.content.firstElementChild.cloneNode(true);

  // link
  const link = card.querySelector('.video-link');
  link.href = video.url;

  // thumbnail
  const thumb = card.querySelector('.thumbnail');
  thumb.src = video.thumbnail;
  thumb.alt = video.title;

  // badge
  const badge = card.querySelector('.badge');
  switch (video.status) {
    case 'live':
      badge.textContent = '配信中';
      break;

    case 'end':
      badge.textContent = '終了';
      break;

    default:
      badge.textContent = '予定'
      break;
  }
  badge.classList.add(video.status);

  // title
  card.querySelector('.title').textContent = video.title;

  // time
  const timeEl = card.querySelector('.time');
  if (video.scheduledStartTime) {
    timeEl.textContent = `開始予定：${formatJST(video.scheduledStartTime)}`;
  } else {
    timeEl.remove();
  }

  return card;
}

/**
 * チャンネル単位のライブ表示ブロックを生成
 * @param {string} channelName
 * @param {Array} videos
 * @returns {HTMLElement}
 */
function createLiveChannelBlock(channelName, videos) {
  const section = document.createElement('section');

  const h3 = document.createElement('h3');
  h3.textContent = channelName;

  const list = document.createElement('div');
  list.className = 'card-list';

  sortLiveVideos(videos).forEach(video => {
    list.appendChild(createVideoCard(video));
  });

  section.appendChild(h3);
  section.appendChild(list);

  return section;
}

/**
 * フリーチャット（スケジュール）表示ブロックを生成
 * @param {Object} freechat
 * @returns {HTMLElement}
 */
function createFreechatBlock(freechat) {
  const section = document.createElement('section');

  const h3 = document.createElement('h3');
  h3.textContent = freechat.channelName;

  const link = document.createElement('a');
  link.href = `https://www.youtube.com/watch?v=${freechat.videoId}`;
  link.target = '_blank';
  link.rel = 'noopener';

  const img = document.createElement('img');
  img.src = freechat.thumbnail;
  img.alt = `${freechat.channelName} 配信スケジュール`;

  link.appendChild(img);

  section.appendChild(h3);
  section.appendChild(link);

  return section;
}

/**
 * メイン処理
 */
async function main() {
  const liveList = document.getElementById('live-list');
  const freechatList = document.getElementById('freechat-list');
  const OUTPUT_DIR = '/assets/data/json';

  // Skeleton 表示
  showSkeleton(liveList, 4);
  showSkeleton(freechatList, 2);

  /* ---------- live_cache ---------- */
  const liveJson = await fetch(`${OUTPUT_DIR}/live_cache.json`).then(r => r.json());

  liveList.textContent = '';

  Object.entries(liveJson.channels).forEach(([key, videos]) => {
    if (!videos.length) return;

    liveList.appendChild(
      createLiveChannelBlock(CHANNEL_NAME_MAP[key], videos)
    );
  });

  /* ---------- freechat ---------- */
  const freechatJson = await fetch(`${OUTPUT_DIR}/freechat.json`).then(r => r.json());

  freechatList.textContent = '';

  Object.values(freechatJson).forEach(fc => {
    freechatList.appendChild(createFreechatBlock(fc));
  });
}

main().catch(console.error);
