// J7 journey: item 11 in the app. Synthetic ring data through the ring service's own store port; UI via Playwright.
import { readFileSync } from 'node:fs';
import { chromium, newPage, bootApp, install, shot, goRoute, rec, results, save, BASE, repo } from './lib.mjs';
import { onboard } from '../j1/onboard.mjs';
import path from 'node:path';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const { page, errs } = await newPage(browser);
const ev = (fn, arg) => page.evaluate(fn, arg);
const ELIGIBLE = ['sleep_sessions', 'steps', 'workouts', 'body', 'daily_summary', 'hr', 'ibi', 'hrv', 'skin_temp'];
const ringSrc = (s) => s.sources.filter((x) => /^ble:|^file:lumen_cloudevents/.test(x.sourceKey));
const checkDefaults = (p) => p.length >= 18 && p.every((x) => x.imported && x.coach === 'daily+series' && x.scores === (x.stream !== 'vendor_scores') && x.engine === (ELIGIBLE.includes(x.stream)));
const state = (s) => s.ringSharing;
const sw = async (name) => (await page.getByRole('switch', { name, exact: true }).first().getAttribute('aria-checked').catch(() => null));
const T = Date.now();
await bootApp(page); const ob = await onboard(page, () => {}); await bootApp(page, '/'); await install(page);
// ---- S0
let s = await ev(() => __j7.sources());
rec('S0 fresh person: no ring source, master switch reads none', state(s) === 'none' && s.sources.length === 0 ? 'PASS' : 'FAIL', `ringSharing=${state(s)} sources=${s.sources.length} onboarding=${JSON.stringify(ob)}`);
await goRoute(page, '/settings#devices');
rec('S0b master switch hidden with no ring', (await page.getByText('Use my ring data in my plan and Coach').count()) === 0 ? 'PASS' : 'FAIL', 'count=' + (await page.getByText('Use my ring data in my plan and Coach').count()));
// ---- S1 BLE ring (J-Style 2301) through the ring service's store port, no switch pressed
const r1 = await ev(() => __j7.ring('jstyle2301', 'QA0001'));
s = await ev(() => __j7.sources());
const A = ringSrc(s)[0];
rec('S1 new J-Style 2301 ring (BLE key): every stream imported, scores, plan where eligible, Coach daily + detail', checkDefaults(A.policies) ? 'PASS' : 'FAIL', `${r1.key} policies=${A.policies.length} ingest=${JSON.stringify(r1.rep)} ringSharing=${state(s)} notice=${!!s.ringDefaultsNotice}`);
const base = await ev(() => __j7.coachAndMcp());
save('s2-baseline.json', base);
rec('S2 Coach briefing + MCP reads carry ring data with no switch pressed', base.briefingMentionsRing && base.mcpDailyDays.some((d) => d.sleep) && base.mcpSeriesPoints > 0 && base.mcpScores.some((x) => x.startsWith('sleep.tst:ok')) ? 'PASS' : 'FAIL', `briefingMentionsRing=${base.briefingMentionsRing} mcpDaily=${JSON.stringify(base.mcpDailyDays)} hrPoints=${base.mcpSeriesPoints} scoresOk=${base.mcpScores.filter((x) => x.includes(':ok:')).length} hidden=${JSON.stringify(base.mcpDailyHidden)}`);
// ---- S3 UI
await goRoute(page, '/settings#devices'); await page.waitForTimeout(1000);
await shot(page, 's3-devices-default.png');
const ui = await ev(() => {
  const nm = (e) => e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') ? document.getElementById(e.getAttribute('aria-labelledby'))?.innerText : '') || e.labels?.[0]?.innerText || '';
  const rows = [...document.querySelectorAll('input[role=switch]')].filter((e) => /^(bring in|my scores|my plan): /.test(nm(e)));
  const byLabel = Object.fromEntries(rows.map((e) => [nm(e), e.getAttribute('aria-checked')]));
  const coach = [...new Set(rows.filter((e) => /^my plan: /.test(nm(e))).map((e) => e))].map((e) => { let r = e; while (r && !r.querySelector('button')) r = r.parentElement; const pressed = [...r.querySelectorAll('button,[role=radio]')].filter((b) => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-current') === 'true' || b.dataset.state === 'on').map((b) => b.innerText.trim()); return { stream: nm(e).replace('my plan: ', ''), pressed }; });
  return { byLabel, coach, master: [...document.querySelectorAll('input[role=switch]')].find((e) => /^Use my ring data/.test(nm(e)))?.getAttribute('aria-checked') ?? null, help: /Your ring data is used for your plan and scores, and the Coach and your AI tools can see it/.test(document.body.innerText), notice: /now used for your plan and scores/.test(document.body.innerText) };
});
save('s3-ui-default.json', ui);
const labels = Object.entries(ui.byLabel);
const offs = labels.filter(([, v]) => v !== 'true').map(([k]) => k);
const expectedOff = labels.filter(([k]) => /^my plan: (blood oxygen|body temperature|breathing rate|distance|active energy|motion|sleep state|sleep stages|vendor)/.test(k)).length;
rec('S3 Settings > Devices per-stream switches on for eligible streams (scores everywhere; plan only where the engine can use it)', offs.every((k) => /^my plan: /.test(k) || k === 'my scores: vendor scores') && ['heart rate', 'steps', 'sleep', 'workouts', 'heart-rate variability', 'skin temperature'].every((n) => ui.byLabel['my plan: ' + n] === 'true') ? 'PASS' : 'FAIL', `switches=${labels.length} off=${JSON.stringify(offs)}`);
const coachAll = ui.coach.length && ui.coach.every((c) => c.pressed.some((p) => /daily \+ detail/.test(p)));
rec('S3b Coach sees "daily + detail" on every stream (UI)', coachAll ? 'PASS' : 'PARTIAL', `rows=${ui.coach.length} sample=${JSON.stringify(ui.coach.slice(0, 3))}`);
rec('S3c master switch on with the plain-words line (Devices screen)', ui.master === 'true' && ui.help ? 'PASS' : 'FAIL', `master=${ui.master} helpLine=${ui.help} notice=${ui.notice}`);
await goRoute(page, '/ring');
rec('S3d Ring page master switch', (await page.getByText('Use my ring data in my plan and Coach').count()) > 0 ? 'PASS' : 'FAIL', 'on this commit /ring renders: ' + JSON.stringify((await page.innerText('main').catch(() => '')).slice(0, 80)));
await shot(page, 's3d-ring-page.png');
// ---- S4 master off through the UI
await goRoute(page, '/settings#devices'); await page.waitForTimeout(800);
const masterSw = page.getByRole('switch', { name: 'Use my ring data in my plan and Coach' });
const mlab = 'Use my ring data in my plan and Coach';
let t0 = Date.now();
await masterSw.click({ force: true }).catch((e) => console.log('master click', e.message.split('\n')[0]));
let st = null;
for (let i = 0; i < 40; i++) { st = (await ev(() => __j7.sources())).ringSharing; if (st === 'off') break; await page.waitForTimeout(250); }
const offMs = Date.now() - t0;
await shot(page, 's4-master-off.png');
let after = null; t0 = Date.now(); let scoresGoneMs = null;
for (let i = 0; i < 60; i++) { after = await ev(() => __j7.coachAndMcp()); if (!after.mcpScores.some((x) => x.includes(':ok:'))) { scoresGoneMs = Date.now() - t0; break; } await page.waitForTimeout(500); }
save('s4-after-off.json', after);
const sOff = await ev(() => __j7.sources());
const planOff = ringSrc(sOff).every((x) => x.policies.every((p) => !p.engine && !p.scores && p.coach === 'hidden'));
rec('S4 master off (UI tap): state off, per-stream plan/scores off, Coach hidden', st === 'off' && planOff ? 'PASS' : 'FAIL', `state=${st} after ${offMs} ms (control "${mlab}") planOff=${planOff} importedKept=${ringSrc(sOff).every((x) => x.policies.every((p) => p.imported))}`);
rec('S4b master off removes ring data from Coach briefing and MCP reads', !after.briefingMentionsRing && after.mcpDailyDays.every((d) => !d.sleep && !d.keys.length) && !(after.mcpSeriesPoints > 0) ? 'PASS' : 'FAIL', `briefingMentionsRing=${after.briefingMentionsRing} mcpDaily=${JSON.stringify(after.mcpDailyDays)} hrPoints=${after.mcpSeriesPoints} seriesHidden=${after.mcpSeriesHidden} dailyHidden=${(after.mcpDailyHidden || []).length}; ring scores in MCP gone after ${scoresGoneMs} ms (scoresOk=${after.mcpScores.filter((x) => x.includes(':ok:')).length})`);
// ---- S5 master back on, then one stream off
await masterSw.click({ force: true }).catch((e) => console.log('master click', e.message.split('\n')[0]));
for (let i = 0; i < 40; i++) { st = (await ev(() => __j7.sources())).ringSharing; if (st === 'on') break; await page.waitForTimeout(250); }
const back = await ev(() => __j7.coachAndMcp());
rec('S5 master back on restores ring data without other steps', st === 'on' && back.briefingMentionsRing && back.mcpDailyDays.some((d) => d.sleep) ? 'PASS' : 'FAIL', `state=${st} briefing=${back.briefingMentionsRing} daily=${JSON.stringify(back.mcpDailyDays)} (ring scores back: ${back.mcpScores.filter((x) => x.includes(':ok:')).length})`);
// one stream off via the "my scores / Coach sees hidden" control for steps of the first ring
const rowOk = await ev(() => { const nm = (e) => e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') ? document.getElementById(e.getAttribute('aria-labelledby'))?.innerText : '') || e.labels?.[0]?.innerText || ''; const e = [...document.querySelectorAll('input[role=switch]')].find((x) => nm(x) === 'my plan: steps'); let r = e; while (r && !r.querySelector('button')) r = r.parentElement; const b = [...r.querySelectorAll('button')].find((x) => x.innerText.trim() === 'hidden'); if (!b) return 'no hidden button'; b.click(); return 'clicked'; });
await page.waitForTimeout(1500);
const one = await ev(() => __j7.coachAndMcp());
const sOne = await ev(() => __j7.sources());
const stepsOff = ringSrc(sOne).map((x) => x.policies.find((p) => p.stream === 'steps')).filter(Boolean);
await shot(page, 's5-steps-hidden.png');
save('s5-one-stream.json', { rowOk, one, steps: stepsOff });
rec('S5b per-stream "Coach sees: hidden" for steps removes only steps from Coach/MCP (sleep, heart rate stay)', one.mcpDailyDays.every((d) => !d.keys.includes('steps')) && one.mcpDailyDays.some((d) => d.sleep) && one.mcpSeriesPoints > 0 && state(sOne) === 'some' ? 'PASS' : 'FAIL', `click=${rowOk} daily=${JSON.stringify(one.mcpDailyDays)} hrPoints=${one.mcpSeriesPoints} master=${state(sOne)} steps policy sample=${JSON.stringify(stepsOff[0])}`);
// ---- S1b other families and the MQTT bridge
const fam = {};
for (const [d, ser] of [['colmi', 'QB0002'], ['crp', 'QB0003'], ['jring', 'QB0004'], ['luckring', 'QB0005'], ['rwfit', 'QB0006'], ['ycbt', 'QB0007']]) { try { fam[d] = await ev(([a, b]) => __j7.ring(a, b), [d, ser]); } catch (e) { fam[d] = { err: String(e.message).slice(0, 120) }; } }
const mq = await ev(async () => {
  const { mapEventsToBatch } = await import('/src/biometrics/core/events.ts');
  const { ingestRingBatch } = await import('/src/commands/bio/exec.ts');
  const t0 = Date.now() - 3 * 3600e3;
  const batch = mapEventsToBatch([{ kind: 'sample', type: 'sample', stream: 'hr', t: t0, value: 58, unit: 'bpm', origin: 'history' }, { type: 'sample', stream: 'hr', t: t0 + 60e3, value: 59, unit: 'bpm', origin: 'history' }], { tz: 'UTC', tzOffsetS: 0, channel: 'mqtt:lumen', device: { type: 'ring', manufacturer: 'J-Style', model: '2301', tier: 'C' }, decoder: 'qa', producer: { name: 'qa-j7', version: '0' }, ingestedAt: new Date().toISOString(), exportedAt: new Date().toISOString(), clockOffsetS: 0 });
  await ingestRingBatch(batch, { ringKey: 'file:lumen_cloudevents', signal: new AbortController().signal, progress: () => {} });
  const m = await import('/src/commands/index.ts'); await m.settleCommits();
  return { records: batch.records.length };
}).catch((e) => ({ err: String(e.message).slice(0, 200) }));
s = await ev(() => __j7.sources());
const rs = ringSrc(s);
save('s1b-sources.json', rs.map((x) => ({ key: x.sourceKey.replace(/serial:.*/, 'serial:QA'), n: x.policies.length, allDefault: checkDefaults(x.policies) })));
rec('S1b every ring family (7) + the same ring through the MQTT bridge start on the ring defaults', rs.length >= 8 && rs.filter((x) => !x.sourceKey.includes('QA0001')).every((x) => checkDefaults(x.policies)) ? 'PASS' : 'FAIL', `ring sources=${rs.length} keys=${rs.map((x) => x.sourceKey.split('/')[0].replace(/\|.*/, '')).join(',')} errs=${JSON.stringify(Object.entries(fam).filter(([, v]) => v.err))} mqtt=${JSON.stringify(mq)} allDefault=${rs.map((x) => checkDefaults(x.policies)).join(',')}`);
// master off / on over all eight ring sources (UI)
await goRoute(page, '/settings#devices'); await page.waitForTimeout(800);
await masterSw.click({ force: true }).catch(() => {}); await page.waitForTimeout(1500);
const s8 = await ev(() => __j7.sources());
const all8off = ringSrc(s8).every((x) => x.policies.every((p) => !p.engine && !p.scores && p.coach === 'hidden'));
const m8 = await ev(() => __j7.coachAndMcp());
rec('S4c master off over all 8 ring sources (7 families + MQTT): none shared, none in Coach/MCP', state(s8) === 'off' && all8off && !m8.briefingMentionsRing && m8.mcpDailyDays.every((d) => !d.sleep) ? 'PASS' : 'FAIL', `state=${state(s8)} allOff=${all8off} briefing=${m8.briefingMentionsRing} daily=${JSON.stringify(m8.mcpDailyDays)}`);
await masterSw.click({ force: true }).catch(() => {}); await page.waitForTimeout(1500);
const s9 = await ev(() => __j7.sources());
await masterSw.click({ force: true }).catch(() => {}); await page.waitForTimeout(1200);
const rN = await ev(() => __j7.ring('jstyle2301', 'QA0009'));
const s10 = await ev(() => __j7.sources());
const N = s10.sources.find((x) => x.sourceKey.includes('QA0009'));
rec('S4d master switch is remembered: a ring connected after the person turned it off stays off', state(s10) === 'off' && N.policies.every((p) => !p.scores && !p.engine && p.coach === 'hidden') ? 'PASS' : 'FAIL', `master after new ring=${state(s10)}; new ring coach=${[...new Set(N.policies.map((p) => p.coach))]} scores=${N.policies.filter((p) => p.scores).length} engine=${N.policies.filter((p) => p.engine).length}`);
await shot(page, 's4d-after-new-ring.png');
const m10 = await ev(() => __j7.coachAndMcp());
save('s4d.json', m10);
await goRoute(page, '/settings#devices'); await page.waitForTimeout(800);
await masterSw.click({ force: true }).catch(() => {}); await page.waitForTimeout(1500);
// a ring connected AFTER the person turned the master switch off: what does it start with?

// ---- S6 non-ring import (Apple Health file)
const xml = readFileSync(path.join(repo, '.e6-tmp', 'j7cand', 'src', 'biometrics', 'importers', '__fixtures__', 'export.xml'), 'utf8');
const before = (await ev(() => __j7.sources())).sources.map((x) => x.sourceKey);
const imp = await ev(async (x) => { const h = await import('/src/biometrics/app/handoff.ts'); const ref = h.stageFile(new Blob([x], { type: 'text/xml' }), 'export.xml'); const r = await __j7.dispatch('bio.import', { fileRef: ref }); return r; }, xml);
let nu = [];
for (let i = 0; i < 60; i++) { await page.waitForTimeout(500); const cur = (await ev(() => __j7.sources())).sources; nu = cur.filter((x) => !before.includes(x.sourceKey)); if (nu.length) { await page.waitForTimeout(1500); nu = (await ev(() => __j7.sources())).sources.filter((x) => !before.includes(x.sourceKey)); break; } }
const full = await ev(() => __j7.coachAndMcp());
save('s6-import.json', { imp: imp.ok ? 'ok' : imp.error, new: nu.map((x) => ({ k: x.sourceKey, policies: x.policies })) });
const apple = nu.flatMap((x) => x.policies);
rec('S6 Apple Health file import: streams are not shared with the Coach or the plan by default (opt-in)', nu.length && apple.every((p) => p.coach === 'hidden') ? (apple.every((p) => !p.imported || !p.scores) ? 'PASS' : 'PARTIAL') : 'FAIL', `new sources=${nu.map((x) => x.sourceKey.split('|')[0]).join(',')} streams=${apple.length} coach!=hidden=${apple.filter((p) => p.coach !== 'hidden').length} imported=${apple.filter((p) => p.imported).length} scores=${apple.filter((p) => p.scores).length} engine=${apple.filter((p) => p.engine).length}; Coach sees apple data: ${/Apple|Health/.test(full.ringLines.join(' '))}`);
save('results.json', { results, errs: errs.slice(0, 10), tookMs: Date.now() - T });
await browser.close();
