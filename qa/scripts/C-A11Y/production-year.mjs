/** Seed synthetic 400-day records in an isolated browser store, then profile the built app. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const devBase = process.env.DEV_BASE;
const previewBase = process.env.PREVIEW_BASE;
if (!devBase || !previewBase) throw new Error('Set DEV_BASE and PREVIEW_BASE');
const raw = process.env.RAW === '1';
const output = process.env.OUTPUT || fileURLToPath(new URL(raw ? '../../results/C-A11Y/production-year-raw.json' : '../../results/C-A11Y/production-year.json', import.meta.url));
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const results = [];

async function fresh(state) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 }, timezoneId: 'Europe/Berlin', locale: 'en-GB', serviceWorkers: 'block',
    ...(state ? { storageState: state } : {}),
  });
  if (raw) await ctx.addInitScript(() => {
    // Keep synthetic blob bytes in IndexedDB so Playwright can transfer them with storageState.
    Object.defineProperty(navigator.storage, 'getDirectory', { value: undefined, configurable: true });
  });
  await ctx.clock.setFixedTime(new Date('2026-10-04T14:30:00+02:00'));
  return ctx;
}

async function onboard(page, base) {
  page.setDefaultTimeout(30000);
  await page.goto(base + '/welcome');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('radio', { name: '18–64' }).click();
  const no = page.getByRole('radio', { name: 'no', exact: true });
  for (let i = 0; i < await no.count(); i++) await no.nth(i).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('I understand').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/body/);
  await fillBasics(page);
}

async function fillBasics(page) {
  await page.getByRole('radio', { name: 'male', exact: true }).click();
  const inputs = page.getByRole('spinbutton');
  for (const [i, value] of [[0, '40'], [1, '178'], [2, '95']]) {
    await inputs.nth(i).click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(value, { delay: 30 });
    await page.keyboard.press('Enter');
    await inputs.nth(i).press('Tab');
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(800);
}

async function seededState() {
  if (process.env.STATE_FILE && existsSync(process.env.STATE_FILE)) return JSON.parse(readFileSync(process.env.STATE_FILE, 'utf8'));
  const ctx = await fresh();
  const page = await ctx.newPage();
  await onboard(page, devBase);
  const age = await page.evaluate(async () => (await import('/src/state/profileStore.ts')).useProfileStore.getState().ageYears);
  if (age !== 40) throw new Error('Synthetic age was not saved before seeding');
  const counts = await page.evaluate(async (withRaw) => {
    const [{ createFixtureSignalsSource }, { getDocumentStore }, { mintWriteToken }] = await Promise.all([
      import('/src/features/signals/fixtures.ts'), import('/src/state/runtime.ts'), import('/src/store/index.ts'),
    ]);
    const source = createFixtureSignalsSource('full');
    const records = source.days('2025-08-31', '2026-10-04').flatMap((day) => [
      ...(day.daily ? [day.daily] : []), ...day.sleeps, ...day.workouts, ...day.spots,
    ]);
    const unique = [...new Map(records.map((record) => [`${record.record_id}@${record.version}`, record])).values()];
    const store = getDocumentStore();
    await store.ready;
    const token = mintWriteToken('migration', { label: 'isolated synthetic QA' });
    const key = 'file:canonical:qa';
    await store.transact(token, async (tx) => {
      await tx.put('bioSources', { _id: key, sourceKey: key, label: 'QA synthetic year', tier: 'C', policies: [], baselineEpochs: [] });
      for (const record of unique) await tx.put('bioRecords', { _id: `${record.record_id}@${record.version}`, ...record, sourceKey: key });
    });
    let rawSamples = 0;
    let rawDays = 0;
    if (withRaw) {
      const { openBioStore, deriveWriter } = await import('/src/commands/bio/store.ts');
      const { browserTzOffsetS } = await import('/src/features/signals/fixtures.ts');
      const bio = await openBioStore({ store, writer: deriveWriter(store, 'isolated synthetic QA') });
      for (const date of source.datesWithData()) {
        const from = new Date(`${date}T00:00:00`).getTime();
        const to = new Date(`${date}T23:59:59.999`).getTime();
        const points = await source.series('hr', from, to, [date]);
        if (!points.length) continue;
        const samples = points.map((p) => ({ t: p.t, value: p.v, origin: date === '2026-10-04' ? 'live' : 'history' }));
        await bio.putSamples({ sourceKey: key, stream: 'hr', local_date: date }, samples, {
          tz_offset_s: browserTzOffsetS(date), createdAt: new Date().toISOString(),
        });
        rawSamples += samples.length;
        rawDays++;
      }
      await bio.flush();
    }
    return { days: source.datesWithData().length, records: unique.length, rawDays, rawSamples };
  }, raw);
  console.log('seeded:', counts);
  const state = await ctx.storageState({ indexedDB: true });
  const devOrigin = new URL(devBase).origin;
  const previewOrigin = new URL(previewBase).origin;
  for (const origin of state.origins) if (origin.origin === devOrigin) origin.origin = previewOrigin;
  if (raw && !state.origins.some((origin) => origin.origin === previewOrigin && origin.indexedDB?.some((db) => db.name === 'vitals-blobs'))) {
    throw new Error('Synthetic blob IndexedDB was not exported');
  }
  await ctx.close();
  if (process.env.STATE_FILE) writeFileSync(process.env.STATE_FILE, JSON.stringify({ state, counts }));
  return { state, counts };
}

try {
  for (let run = 1; run <= Number(process.env.RUNS || 2); run++) {
    console.log('seed:', run);
    const { state, counts } = await seededState();
    const ctx = await fresh(state);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message.slice(0, 180)));
    await page.addInitScript(() => {
      window.__perfLongTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__perfLongTasks.push(Math.round(entry.duration));
      }).observe({ type: 'longtask', buffered: true });
    });
    const routes = ['/ring', '/signals?tab=sleep&period=year&date=2026-10-04'];
    for (const route of routes) {
      const begin = performance.now();
      await page.goto(previewBase + route, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.getByRole('heading', { name: route === '/ring' ? 'Ring' : 'Body signals', exact: true }).waitFor({ state: 'visible', timeout: 60000 });
      if (route === '/ring') await page.locator('.rs-row').first().waitFor({ state: 'visible', timeout: 60000 });
      else await page.waitForFunction(() => document.querySelector('main')?.textContent?.includes('QA synthetic year'), null, { timeout: 60000 });
      await page.waitForTimeout(1000);
      const data = await page.evaluate(() => ({
        heading: document.querySelector('h1')?.textContent ?? null,
        longTasks: window.__perfLongTasks ?? [],
        textLength: document.querySelector('main')?.textContent?.length ?? 0,
        syntheticSourceVisible: document.querySelector('main')?.textContent?.includes('QA synthetic year') ?? false,
        ringReadingRows: document.querySelectorAll('.rs-row').length,
        ringKnownReadouts: document.querySelectorAll('.rs-row__readout:not([data-missing])').length,
      }));
      const tabs = [];
      if (route.startsWith('/signals')) {
        for (const name of ['heart and recovery', 'activity', 'sleep']) {
          const start = await page.evaluate(() => window.__perfLongTasks.length);
          const tabBegin = performance.now();
          await page.getByRole('tab', { name }).click();
          await page.waitForTimeout(350);
          tabs.push({
            name, elapsedMs: Math.round(performance.now() - tabBegin),
            ...await page.evaluate((from) => ({
              longTasks: window.__perfLongTasks.slice(from),
              syntheticSourceVisible: document.querySelector('main')?.textContent?.includes('QA synthetic year') ?? false,
              periodYear: document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.trim().toLowerCase() === 'year',
            }), start),
          });
        }
      }
      results.push({ run, route, seeded: counts, elapsedMs: Math.round(performance.now() - begin), ...data, tabs, errors: [...errors] });
      errors.length = 0;
    }
    if (raw) {
      await page.goto(previewBase + '/body', { waitUntil: 'domcontentloaded', timeout: 120000 });
      await fillBasics(page);
      const route = '/signals?tab=heart&period=day&date=2026-10-04';
      const begin = performance.now();
      await page.goto(previewBase + route, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForFunction(() => document.querySelectorAll('.hr-tab[data-period="day"] polyline.hr-line').length > 0, null, { timeout: 60000 }).catch(() => {});
      const data = await page.evaluate(() => ({
        heading: document.querySelector('h1')?.textContent ?? null,
        longTasks: window.__perfLongTasks ?? [],
        heartDayMounted: Boolean(document.querySelector('.hr-tab[data-period="day"]')),
        heartLineSegments: document.querySelectorAll('.hr-tab[data-period="day"] polyline.hr-line').length,
        zonedLineSegments: document.querySelectorAll('.hr-tab[data-period="day"] polyline.hr-line:not([data-zone="plain"])').length,
        textLength: document.querySelector('main')?.textContent?.length ?? 0,
        chartState: document.querySelector('.hr-chart')?.getAttribute('data-state') ?? null,
        mainExcerpt: document.querySelector('main')?.textContent?.trim().slice(0, 280) ?? '',
      }));
      if (!data.heartDayMounted || !data.heartLineSegments || !data.zonedLineSegments) {
        console.log('heart-check:', data);
        throw new Error('Heart day did not render synthetic HR readings with zones');
      }
      delete data.mainExcerpt;
      results.push({ run, route, seeded: counts, elapsedMs: Math.round(performance.now() - begin), ...data, errors: [...errors] });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ method: `Fresh Chromium contexts with 400-day synthetic daily/sleep/workout/spot records seeded into IndexedDB${raw ? ' plus 5-minute HR samples in real bio chunks' : '; no raw series chunks'}. Built app uses the real document store reader. Timing includes navigation and a 1s settle.`, results }, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ run, route, seeded, elapsedMs, heading, longTasks, textLength, syntheticSourceVisible, ringReadingRows, ringKnownReadouts, tabs, errors }) => ({ run, route, seeded, elapsedMs, heading, longTasks, textLength, syntheticSourceVisible, ringReadingRows, ringKnownReadouts, tabs, errors }))));
