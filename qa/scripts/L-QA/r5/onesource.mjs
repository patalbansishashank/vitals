// R5 check 2: one ring = one source, never keyed or labelled by the advertised name, master switch remembered.
// The same J-Style 2301 ring goes through the app's real ring service (real connector + scripted peripheral from the
// family fixture) and the app's own store port twice, under two different advertised names; a Lumen (history import)
// batch goes in too. Vite dev server of the round-5 tree on 4345. Advertised names are synthetic placeholders.
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { onboard } from '../j1/onboard.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..', '..');
const out = path.join(repo, 'qa', 'results', 'L-QA', 'round2', 'private', 'r5');
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(path.join(repo, '.e6-tmp', 'cand', 'package.json'))('playwright-core');
const BASE = process.env.R5_BASE || 'http://127.0.0.1:4345';
const results = [];
const rec = (id, verdict, note) => { results.push({ id, verdict, note }); console.log(`${verdict}  ${id}  ${note}`); };
const save = (n, o) => writeFileSync(path.join(out, n), typeof o === 'string' ? o : JSON.stringify(o, null, 2));
const TK = `
window.__r5 = {
  async dispatch(id, input, actor) { const m = await import('/src/commands/index.ts'); const r = await m.dispatch(id, input, actor ? { actor } : undefined); await m.settleCommits(); return r.ok ? { ok: true, output: r.output } : { ok: false, error: r.error }; },
  async sources() { return (await this.dispatch('bio.sources', {})).output; },
  async pair(advName, address) {
    const { createRingService } = await import('/src/biometrics/service/ringService.ts');
    const { createRingsConnector } = await import('/src/biometrics/service/connectors/rings.ts');
    const { jstyle2301 } = await import('/packages/rings/src/jstyle2301/family.ts');
    const { fakeFromSession } = await import('/packages/rings/src/testing/fakePeripheral.ts');
    const { uuid16 } = await import('/packages/rings/src/types.ts');
    const app = await import('/src/biometrics/service/app.ts');
    const sessions = await (await fetch('/qa/fixtures/rings/jstyle2301/sessions.json')).json();
    const hs = sessions.sessions.find((x) => x.name.startsWith('v0525 handshake'));
    const factory = {
      platform: 'fake', available: async () => true,
      async scan(_f, onFound) { onFound({ name: advName, serviceUuids: [uuid16(0xfff0)], manufacturerData: [], platformId: address, rssi: -55 }); },
      async connect() { const f = fakeFromSession(hs, { name: advName, address }); f.script({ expect: { prefix: '54 00' }, reply: ['54 ff'] }); return f; },
    };
    const fast = { timers: { quietMs: 30, stallMs: 80 }, clock: { now: () => Date.now(), tzOffsetS: () => 0 } };
    const svc = createRingService({
      connector: createRingsConnector({ factory, families: [jstyle2301], session: fast }),
      store: app.appStorePort(), local: app.appLocalPort(), sync: app.appSyncPort(),
      clock: { now: () => Date.now(), setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); }, tz: () => 'UTC' },
      platform: 'android', producer: { name: 'vitals-ring', version: '1' },
    });
    await svc.start();
    const found = [];
    for await (const c of svc.scan(new AbortController().signal)) found.push(c);
    let status = null, err = null;
    try { status = await svc.pair(found[0].candidateId); } catch (e) { err = String(e && e.message || e).slice(0, 200); }
    await new Promise((r) => setTimeout(r, 2500));
    const rings = svc.rings();
    await svc.stop();
    const m = await import('/src/commands/index.ts'); await m.settleCommits();
    return { found: found.length, status, rings, err };
  },
  async lumen(hoursAgo) {
    const { mapEventsToBatch } = await import('/src/biometrics/core/events.ts');
    const { ingestRingBatch } = await import('/src/commands/bio/exec.ts');
    const t0 = Date.now() - hoursAgo * 3600e3;
    const batch = mapEventsToBatch([{ type: 'sample', stream: 'hr', t: t0, value: 58, unit: 'bpm', origin: 'history' }, { type: 'sample', stream: 'hr', t: t0 + 60e3, value: 59, unit: 'bpm', origin: 'history' }], { tz: 'UTC', tzOffsetS: 0, channel: 'mqtt:lumen', device: { type: 'ring', manufacturer: 'J-Style', model: '2301', tier: 'C' }, decoder: 'qa', producer: { name: 'qa-r5', version: '0' }, ingestedAt: new Date().toISOString(), exportedAt: new Date().toISOString(), clockOffsetS: 0 });
    await ingestRingBatch(batch, { ringKey: 'file:lumen_cloudevents', signal: new AbortController().signal, progress: () => {} });
    const m = await import('/src/commands/index.ts'); await m.settleCommits();
    return { records: batch.records.length };
  },
  async fold() { const b = await import('/src/commands/bio/index.ts'); await b.runRingFold(); const m = await import('/src/commands/index.ts'); await m.settleCommits(); },
};`;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
const boot = async (r = '/') => { await page.goto(BASE + r, { waitUntil: 'load' }); await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, null, { timeout: 90000 }); await page.waitForFunction(() => document.querySelectorAll('button, a[href]').length > 0, null, { timeout: 90000 }).catch(() => {}); };
const go = async (r) => { await page.evaluate((x) => { history.pushState({}, '', x); dispatchEvent(new PopStateEvent('popstate')); }, r); await page.waitForTimeout(1500); };
const ev = async (fn, a) => { await page.evaluate(TK); return page.evaluate(fn, a); };
const ringSrcs = (s) => s.sources.filter((x) => /^ble:|lumen|mqtt:/.test(x.sourceKey));
const brief = (s) => ringSrcs(s).map((x) => ({ key: x.sourceKey, label: x.label, streams: x.policies?.length }));
const ADV = /ADV-NAME|OTHER-RING|THIRD-RING/;
const T0 = Date.now();
await boot(); const ob = await onboard(page, () => {}); await boot('/');
let s = await ev(() => __r5.sources());
rec('A0 fresh person: no ring source', ringSrcs(s).length === 0 ? 'PASS' : 'FAIL', `sources=${s.sources.length} onboard=${ob.ok}`);
const lu1 = await ev(() => __r5.lumen(30));
s = await ev(() => __r5.sources()); const afterLumen = brief(s);
const p1 = await ev(() => __r5.pair('ADV-NAME 77', 'AA:BB:CC:DD:EE:07'));
await page.waitForTimeout(2000);
s = await ev(() => __r5.sources()); const after1 = brief(s); const sh1 = s.ringSharing;
rec('A1 first BLE read (advertised "ADV-NAME 77"): one ring source, key from the address, label J-Style 2301', p1.status && after1.filter((x) => x.key.startsWith('ble:')).length === 1 && after1.find((x) => x.key.startsWith('ble:'))?.label === 'J-Style 2301' && !ADV.test(JSON.stringify({ p1, s })) ? 'PASS' : 'FAIL', `pair=${JSON.stringify({ ringKey: p1.status?.ringKey, label: p1.status?.label, err: p1.err })} sources=${JSON.stringify(after1)} (Lumen before pairing: ${JSON.stringify(afterLumen)}) ringSharing=${sh1}`);
const p2 = await ev(() => __r5.pair('OTHER-RING 12', 'AA:BB:CC:DD:EE:07'));
await page.waitForTimeout(2000);
s = await ev(() => __r5.sources()); const after2 = brief(s);
rec('A2 same ring again under another advertised name: still ONE ring source, same key, label J-Style 2301', p2.status?.ringKey === p1.status?.ringKey && after2.filter((x) => x.key.startsWith('ble:')).length === 1 && !ADV.test(JSON.stringify({ p2, s })) ? 'PASS' : 'FAIL', `pair2=${JSON.stringify({ ringKey: p2.status?.ringKey, label: p2.status?.label, err: p2.err })} sources=${JSON.stringify(after2)}`);
const lumenSep = after2.some((x) => !x.key.startsWith('ble:'));
rec('A3 Lumen (history import) data folded into the one J-Style 2301 ring source after the first read', !lumenSep ? 'PASS' : 'FAIL', `ring sources after both reads=${JSON.stringify(after2)}`);
await ev(() => __r5.fold()); s = await ev(() => __r5.sources()); const afterFold = brief(s);
const lu2 = await ev(() => __r5.lumen(5));
await page.waitForTimeout(1500);
s = await ev(() => __r5.sources()); const after3 = brief(s);
rec('A4 new Lumen data after the fold files under the ring key (no new source)', after3.length === 1 && after3[0].key.startsWith('ble:') ? 'PASS' : 'FAIL', `after explicit fold=${JSON.stringify(afterFold)} after new Lumen batch=${JSON.stringify(after3)}`);
await boot('/'); await page.waitForTimeout(3000);
s = await ev(() => __r5.sources()); const afterReload = brief(s);
rec('A5 after a reload (boot fold runs again): still one ring source', afterReload.length === 1 ? 'PASS' : 'FAIL', JSON.stringify(afterReload));
const shBefore = (await ev(() => __r5.sources())).ringSharing;
await boot('/settings#devices'); await page.waitForTimeout(2500);
await page.waitForFunction(() => !document.body.innerText.includes('Reading your devices'), null, { timeout: 45000 }).catch(() => console.log('still "Reading your devices" after 45 s'));
await page.waitForTimeout(1000);
const body = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: path.join(out, 'a6-devices.png'), fullPage: true }).catch(() => {});
const jsCount = (body.match(/J-Style 2301/g) || []).length;
rec('A6 Settings > Devices: the ring shows as J-Style 2301, never the advertised name; no password/key prompt', !ADV.test(body) && jsCount >= 1 && !/passcode|password|pairing key/i.test(body) ? 'PASS' : 'FAIL', `"J-Style 2301" occurrences=${jsCount} advertisedNameShown=${ADV.test(body)} passwordText=${/passcode|password/i.test(body)}`);
save('a6-devices-text.txt', body.replace(/[0-9a-f]{2}(:[0-9a-f]{2}){5}/gi, 'MAC'));
// master switch remembered for a later ring (J7-01)
const sw = page.getByRole('switch', { name: 'Use my ring data in my plan and Coach' });
const swCount = await sw.count();
await sw.first().click({ force: true }).catch((e) => console.log('click', e.message.split('\n')[0]));
let st = null; for (let i = 0; i < 40; i++) { st = (await ev(() => __r5.sources())).ringSharing; if (st === 'off') break; await page.waitForTimeout(250); }
const p3 = await ev(() => __r5.pair('THIRD-RING 3', 'AA:BB:CC:DD:EE:08'));
await page.waitForTimeout(2000);
s = await ev(() => __r5.sources());
const N = s.sources.find((x) => x.sourceKey.includes('ee:08'));
rec('A7 master switch off is remembered: a ring added afterwards starts off (J7-01 regression)', st === 'off' && s.ringSharing === 'off' && N && N.policies.every((p) => !p.scores && !p.engine && p.coach === 'hidden') ? 'PASS' : 'FAIL', `switches=${swCount} stateAfterTap=${st} stateAfterNewRing=${s.ringSharing} newRing=${N ? N.sourceKey.replace(/mac:.*/, 'mac:…') + ' label=' + N.label + ' coach=' + [...new Set(N.policies.map((p) => p.coach))] + ' scores=' + N.policies.filter((p) => p.scores).length + ' engine=' + N.policies.filter((p) => p.engine).length : 'none'} p3err=${p3.err} sharingBeforeTap=${shBefore} p3=${JSON.stringify({ ringKey: p3.status?.ringKey, label: p3.status?.label, found: p3.found, rings: (p3.rings||[]).map((r) => r.ringKey) })}`);
rec('A8 two different rings stay two sources (not over-merged)', ringSrcs(s).filter((x) => x.sourceKey.startsWith('ble:')).length === 2 ? 'PASS' : 'FAIL', JSON.stringify(brief(s)));
save('onesource-results.json', { results, errs: errs.filter((e) => !/DevTools|React Router|vite/i.test(e)).slice(0, 30), lumen: [lu1, lu2], tookMs: Date.now() - T0 });
await browser.close();
