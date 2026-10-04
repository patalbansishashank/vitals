const bg = window.__j2; if (!bg) return { error: 'no __j2 state (page reloaded or process restarted?)' };
const now = Date.now(); const gaps = bg.ticks.map((x, i) => (i ? x - bg.ticks[i - 1] : x - bg.start));
return { minutes: ((now - bg.start) / 60000).toFixed(1), ticks: bg.ticks.length, maxTickGapS: Math.round(Math.max(0, ...gaps) / 1000),
  rssiOk: bg.rssiOk, rssiErr: bg.rssiErr, dropsAtS: bg.drops.map((x) => Math.round((x - bg.start) / 1000)),
  reconnects: bg.reconnects.map(([a, ms]) => ({ atS: Math.round((a - bg.start) / 1000), ms })), errors: bg.errors.length,
  visibility: document.visibilityState };
