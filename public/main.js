async function load() {
  const ts = Date.now();

  const freechat = await fetch(`freechat.json?ts=${ts}`).then(r => r.json());
  const live = await fetch(`live_cache.json?ts=${ts}`).then(r => r.json());

  document.getElementById("freechat").innerText =
    JSON.stringify(freechat, null, 2);

  document.getElementById("live").innerText =
    JSON.stringify(live, null, 2);
}

load();