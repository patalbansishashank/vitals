import fs from 'node:fs/promises';
import path from 'node:path';

const RING_KEY = 'ble:jstyle2301/2301/serial:QA-DESIGN';
const DAY_MS = 86_400_000;
const STREAMS = ['hr', 'hrv', 'spo2', 'skin_temp', 'steps', 'sleep_sessions', 'daily_summary'];

function dateInZone(now) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function shiftDates(value, days) {
  if (typeof value === 'string') {
    return value.replace(/2026-09-\d{2}/g, (date) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10));
  }
  if (Array.isArray(value)) return value.map((item) => shiftDates(item, days));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shiftDates(item, days)]));
}

async function qaRead(page, id) {
  const result = await page.evaluate((command) => window.__vitals?.read(command, {}), id);
  if (!result?.ok) throw new Error(`${id} unavailable in synthetic ring context`);
  return result.output ?? result.value;
}

async function visit(page, base, route) {
  const url = new URL(route, base);
  url.searchParams.set('qa', '1');
  await page.goto(url.href, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__vitals), null, { timeout: 30_000 });
}

async function exportReady(page, predicate, timeout = 20_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = JSON.parse((await qaRead(page, 'data.export')).text);
    if (predicate(result.collections ?? {})) return result;
    await page.waitForTimeout(300);
  }
  throw new Error('Synthetic documents did not hydrate in time');
}

async function clearSafetyGate(page, base) {
  await visit(page, base, '/ring');
  if (!page.url().includes('/welcome')) return;
  await page.getByRole('radio', { name: '18–64' }).click();
  for (const fieldset of await page.locator('fieldset').all()) {
    const no = fieldset.getByRole('radio', { name: 'no', exact: true });
    if (await no.count()) await no.first().click();
  }
  await page.getByRole('button', { name: 'Save answers' }).click();
  await visit(page, base, '/ring');
  if (page.url().includes('/welcome')) throw new Error('Synthetic ring safety gate remains closed');
}

/** Import rebased fixture readings into a fresh context made from the synthetic profile. */
export async function seedRingState(browser, { base, root, output, fullState }) {
  const origin = new URL(base).origin;
  if (!fullState?.origins?.some((entry) => entry.origin === origin)) throw new Error('Synthetic profile state is missing the preview origin');
  const fixture = JSON.parse(await fs.readFile(path.join(root, 'qa/fixtures/q1b-b/bio14.json'), 'utf8'));
  if (fixture.records?.length !== 42 || !fixture.records.some((record) => record.provenance?.device?.type === 'ring')) {
    throw new Error('Synthetic ring fixture is incomplete');
  }
  const today = dateInZone(new Date());
  const lastFixtureDay = fixture.records.map((record) => record.time.local_date).sort().at(-1);
  const offset = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastFixtureDay}T12:00:00Z`)) / DAY_MS);
  const now = new Date().toISOString();
  const source = {
    _id: RING_KEY,
    sourceKey: RING_KEY,
    label: 'J-Style 2301',
    tier: 'B',
    deviceType: 'ring',
    ble: { driver: 'jstyle2301', lastSyncAt: now },
    policies: STREAMS.map((stream) => ({ stream, imported: true, coach: 'hidden', engine: ['hr', 'hrv', 'steps', 'sleep_sessions', 'daily_summary'].includes(stream), scores: true })),
    baselineEpochs: [],
    createdAt: now,
  };
  const records = fixture.records.map((raw) => {
    const record = shiftDates(raw, offset);
    record.provenance = {
      ...record.provenance,
      channel: RING_KEY,
      source_app: 'Vitals QA',
      ingested_at: now,
      device: { type: 'ring', manufacturer: 'J-Style', model: '2301', tier: 'B' },
    };
    return { ...record, sourceKey: RING_KEY, _id: `${record.record_id}@${record.version}` };
  });
  const sourceCtx = await browser.newContext({ storageState: fullState, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  let exported;
  try {
    const sourcePage = await sourceCtx.newPage();
    await visit(sourcePage, origin, '/settings');
    exported = await exportReady(sourcePage, (collections) => collections.profile?.length && collections.plans?.length);
    if (!exported.collections?.profile?.length || !exported.collections?.plans?.length ||
        exported.collections?.syncState?.length || exported.collections?.providerKeys?.length) {
      throw new Error('Ring seed received a non-synthetic or incomplete profile');
    }
  } finally {
    await sourceCtx.close();
  }
  exported.collections.bioRecords = records;
  exported.collections.bioSources = [...(exported.collections.bioSources ?? []).filter((item) => item.kind === 'personPolicy'), source];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    page.setDefaultTimeout(20_000);
    await visit(page, origin, '/settings');
    const file = page.locator('section:has(h2:text("Your data")) input[type=file], #your-data input[type=file]').first();
    await file.setInputFiles({ name: 'synthetic-ring.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await page.getByRole('radio', { name: 'replace' }).check();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 5000 }).catch(async () => {
      const alert = await page.getByRole('dialog').getByRole('alert').allTextContents();
      throw new Error(`Synthetic ring import stayed open: ${alert.join(' ').slice(0, 180)}`);
    });
    const proof = (await exportReady(page, (collections) => collections.bioRecords?.length === 42 && collections.bioSources?.some((item) => item.sourceKey === RING_KEY))).collections;
    if (proof.bioRecords?.length !== 42 || !proof.bioSources?.some((item) => item.sourceKey === RING_KEY)) {
      throw new Error('Synthetic ring readings or source did not import');
    }
    await clearSafetyGate(page, origin);
    const state = await ctx.storageState({ indexedDB: true });
    const check = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    try {
      const restored = await check.newPage();
      await visit(restored, origin, '/ring');
      await restored.locator('.lm-page').waitFor({ state: 'visible', timeout: 10_000 }).catch(async () => {
        throw new Error(`Restored Ring route unavailable: ${new URL(restored.url()).pathname}`);
      });
      await restored.locator('.rs-today .rs-row').first().waitFor({ state: 'visible', timeout: 20_000 });
      const rowCount = await restored.locator('.rs-today .rs-row').count();
      const missingCount = await restored.locator('.rs-today [data-missing="true"]').count();
      if (rowCount < 5 || missingCount >= rowCount) throw new Error('Restored Ring rows have no measurements');
      await visit(restored, origin, '/signals?tab=sleep&period=day');
      await restored.locator('.lm-page').waitFor({ state: 'visible' });
      const text = await restored.locator('main').innerText();
      if (!text.includes('From J-Style 2301') || !text.includes('asleep')) throw new Error('Restored Signals page has no ring sleep data');
    } finally {
      await check.close();
    }
    if (output) {
      await fs.mkdir(output, { recursive: true });
      await fs.writeFile(path.join(output, 'synthetic-ring-state.json'), JSON.stringify(state));
    }
    return { state, notes: [`${records.length} synthetic ring records rebased to ${today}`] };
  } finally {
    await ctx.close();
  }
}
