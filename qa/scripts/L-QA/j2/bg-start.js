// Test-hook link (local test build only): open the J-Style link through the app's own transport, start the
// foreground service the way androidRingLink would ("Ring connected"), and record every drop; reconnect by address.
const T = window.__ringTest; if (!T) return { error: 'no test hook in this build' };
const t = T.pickTransport(); const d = T.drivers.find((x) => x.id === 'jstyle2301');
const ble = window.Capacitor.Plugins.BluetoothLe; const shell = window.Capacitor.Plugins.VitalsShell;
const bg = (window.__j2 = { start: Date.now(), ticks: [], drops: [], reconnects: [], rssiOk: 0, rssiErr: 0, errors: [] });
const t0 = Date.now();
let link = await t.requestDevice(d, { scanMs: 30000 });
bg.connectMs = Date.now() - t0;
let retrying = false;
const watch = (l) => l.onDisconnect(() => { bg.drops.push(Date.now()); if (!window.__j2Stop) retry(); });
async function retry() {
  if (retrying) return; retrying = true;
  for (;;) {
    const r0 = Date.now();
    try { link = await t.reconnect(link.deviceId, d); bg.reconnects.push([r0, Date.now() - r0]); watch(link); window.__j2Link = link; break; }
    catch (e) { bg.errors.push([Date.now(), String(e).slice(0, 80)]); await new Promise((r) => setTimeout(r, 15000)); }
  }
  retrying = false;
}
watch(link); window.__j2Link = link;
await shell.keepAlive({ on: true, text: 'Ring connected' });
bg.timer = setInterval(async () => {
  bg.ticks.push(Date.now());
  try { await ble.readRssi({ deviceId: window.__j2Link.deviceId }); bg.rssiOk++; } catch { bg.rssiErr++; }
}, 30000);
return { connectMs: bg.connectMs, state: await shell.getState() };
