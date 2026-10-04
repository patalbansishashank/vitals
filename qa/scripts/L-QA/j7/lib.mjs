// J7 helpers: drive the app (vite dev server, so the page can import its own modules) with synthetic ring data.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
export const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '..', '..', '..', '..');
export const out = path.join(repo, 'qa', 'results', 'L-QA', 'round2', 'j7');
export const BASE = process.env.J7_BASE || 'http://127.0.0.1:4337';
mkdirSync(out, { recursive: true });
const req = createRequire(path.join(repo, '.e6-tmp', 'cand', 'package.json'));
export const { chromium } = req('playwright-core');
export const results = [];
export const rec = (id, verdict, note) => { results.push({ id, verdict, note }); console.log(`${verdict}  ${id}  ${note}`); };
export const save = (name, obj) => writeFileSync(path.join(out, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
export async function newPage(browser, ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', ...ctxOpts });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  return { ctx, page, errs };
}
export async function shot(page, name) { await page.screenshot({ path: path.join(out, name), fullPage: true, timeout: 20000 }).catch((e) => console.log('shot fail', name, e.message.split('\n')[0])); }
/** The in-page toolkit: ring ingest through the ring service's own store port, reads as the Coach and as an MCP client. */
export const TOOLKIT = `
window.__j7 = {
  async dispatch(id, input, actor) { const m = await import('/src/commands/index.ts'); const r = await m.dispatch(id, input, actor ? { actor } : undefined); await m.settleCommits(); return r.ok ? { ok: true, output: r.output } : { ok: false, error: r.error }; },
  async sources() { const r = await this.dispatch('bio.sources', {}); return r.output; },
  async ring(driverId, serial, opts = {}) {
    const { appStorePort } = await import('/src/biometrics/service/app.ts');
    const { ringKeyOf, familyIdentity } = await import('/src/biometrics/service/identity.ts');
    const { buildRingBatch } = await import('/src/biometrics/service/ingest.ts');
    const key = ringKeyOf({ driverId, serial });
    const fam = familyIdentity(driverId);
    const port = appStorePort();
    await port.ready();
    await port.ensureSource(key, { driverId, label: fam.label, streams: [], channel: key, maker: fam.maker, model: fam.model, firmware: 'V0525' });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const now = Date.now();
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const mid = d0.getTime();
    const ev = [];
    const night = mid - 2 * 3600e3; // 22:00 yesterday
    const stages = Array.from({ length: 450 }, (_, i) => (i % 90 < 10 ? 'awake' : i % 90 < 50 ? 'light' : i % 90 < 70 ? 'deep' : 'rem'));
    ev.push({ type: 'sleepEpochs', start: night, epochS: 60, stages, rawCodes: stages.map(() => 2), firmware: 'V0525', complete: true });
    for (let h = 0; h < 8; h++) ev.push({ type: 'activityBucket', start: mid + (9 + h) * 3600e3 - 86400e3 * 0, durS: 3600, steps: 700 + h * 20 });
    ev.push({ type: 'dailyTotal', localDay: Date.UTC(d0.getFullYear(), d0.getMonth(), d0.getDate()), steps: 6000 });
    for (let i = 0; i < 30; i++) ev.push({ type: 'sample', stream: 'hr', t: night + i * 600e3, value: 52 + (i % 6), unit: 'bpm', origin: 'history' });
    for (let i = 0; i < 12; i++) ev.push({ type: 'sample', stream: 'hrv', t: night + i * 1800e3, value: 48 + (i % 5), unit: 'ms', origin: 'history' });
    for (let i = 0; i < 12; i++) ev.push({ type: 'sample', stream: 'skin_temp', t: night + i * 1800e3, value: 33.5 + (i % 3) * 0.1, unit: 'degC', origin: 'history' });
    for (let i = 0; i < 6; i++) ev.push({ type: 'sample', stream: 'spo2', t: night + i * 3600e3, value: 96 + (i % 2), unit: '%', origin: 'history' });
    const batch = buildRingBatch(ev, { ringKey: key, driverId, firmware: 'V0525', clockOffsetS: 0, tz, tzOffsetS: -new Date().getTimezoneOffset() * 60, nowMs: now, producer: { name: 'qa-j7', version: '0' } });
    const rep = await port.ingest(batch, { ringKey: key, signal: new AbortController().signal, progress: () => {} });
    const m = await import('/src/commands/index.ts'); await m.settleCommits();
    return { key, records: batch.records.length, rep: { records: rep.records, samples: rep.samples, days: rep.days } };
  },
  today() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); },
  addDays(s, n) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); const p = (x) => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); },
  /** What the Coach is handed (the same builder an MCP briefing uses) and what an MCP client reads. */
  async coachAndMcp() {
    const m = await import('/src/commands/index.ts');
    const { gatherBriefingData, buildBriefing } = await import('/src/ai/coach/briefing.ts');
    const { addDays } = await import('/src/living/dates.ts');
    const bus = { ...m.commandBus, getCommand: m.getCommand, commandIds: () => m.allCommands().map((d) => d.id) };
    const T = this.today(), Y = this.addDays(T, -1);
    await m.dispatch('bio.daily', { from: Y, to: T });
    const data = await gatherBriefingData(bus, new Date(T + 'T12:00:00'), T, addDays);
    const built = buildBriefing(data, { addDays });
    const text = built.sections.map((s) => s.text).join('\\n');
    const MCP = { kind: 'mcp', id: 'claude-desktop' };
    const daily = (await this.dispatch('bio.daily', { from: Y, to: T }, MCP)).output;
    const scores = (await this.dispatch('bio.scores', {}, MCP)).output;
    const series = (await this.dispatch('bio.series', { metric: 'hr', from: Y, to: T }, MCP)).output;
    const ringLines = text.split('\\n').filter((l) => /ring|J-Style|Colmi|LuckRing|sleep|resting|steps/i.test(l)).slice(0, 12);
    return {
      briefingChars: text.length, ringLines,
      briefingMentionsRing: /J-Style|from your ring|Colmi|LuckRing/i.test(text),
      mcpDailyDays: (daily?.days ?? []).map((d) => ({ date: d.date, keys: Object.keys(d.values ?? {}), sleep: d.sleep ? d.sleep.source : null })),
      mcpDailyHidden: daily?.hidden, mcpScores: (scores?.results ?? []).filter((r) => r.status === 'ok' || r.source).map((r) => r.scoreId + ':' + r.status + ':' + r.source).slice(0, 12), mcpScoresHidden: scores?.hidden,
      mcpSeriesPoints: series?.points?.length ?? null, mcpSeriesHidden: series?.hidden,
    };
  },
};
window.__j7.ready = true;
`;
export async function bootApp(page, route = '/') {
  await page.goto(BASE + route, { waitUntil: 'load' });
  await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('button, a[href]').length > 0, null, { timeout: 90000 }).catch(() => {});
}
export async function install(page) { await page.evaluate(TOOLKIT); }
export const goRoute = async (page, r) => { await page.evaluate((x) => { history.pushState({}, '', x); dispatchEvent(new PopStateEvent('popstate')); }, r); await page.waitForTimeout(1500); };
