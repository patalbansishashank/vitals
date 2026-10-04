import fs from 'node:fs/promises';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function read(page, command) {
  const result = await page.evaluate((id) => window.__vitals?.read(id, {}), command);
  if (!result?.ok) throw new Error(`${command} failed after synthetic import`);
  return result.output ?? result.value;
}

async function visit(page, base, route) {
  const url = new URL(route, base);
  url.searchParams.set('qa', '1');
  await page.goto(url.href, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__vitals), null, { timeout: 30_000 });
}

async function importProfile(page, base, payload) {
  await visit(page, base, '/settings');
  const file = page.locator('section:has(h2:text("Your data")) input[type=file], #your-data input[type=file]').first();
  await file.setInputFiles({ name: 'synthetic-design.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
  await page.getByRole('radio', { name: 'replace' }).check();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await visit(page, base, '/plan/goals');
  if (page.url().includes('/welcome')) {
    await page.getByRole('radio', { name: '18–64' }).click();
    for (const fieldset of await page.locator('fieldset').all()) {
      const no = fieldset.getByRole('radio', { name: 'no', exact: true });
      if (await no.count()) await no.first().click();
    }
    await page.getByRole('button', { name: 'Save answers' }).click();
    await visit(page, base, '/plan/goals');
  }
}

/** Build a disposable, fixture-only state for screenshot contexts. */
export async function seedSynthetic(browser, { base, root, output }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    page.setDefaultTimeout(20_000);
    const source = JSON.parse(await fs.readFile(path.join(root, 'qa/fixtures/q1b/export-m-veg.json'), 'utf8'));
    const rung = JSON.parse(await fs.readFile(path.join(root, 'src/commands/living/__tests__/fixtures/q4b-rungs.json'), 'utf8')).medium;
    const bio = JSON.parse(await fs.readFile(path.join(root, 'qa/fixtures/q1b-b/bio14.json'), 'utf8'));
    if (!source.collections?.profile?.length || !source.collections?.safety?.length ||
        source.collections?.deviceSettings?.[0]?.theme !== 'system' ||
        source.collections?.syncState?.length || source.collections?.providerKeys?.length ||
        !rung.plans?.length || !rung.planVersions?.length || !rung.activePlan?.length ||
        !bio.records?.length || !bio.records.some((record) => record.provenance?.device?.type === 'ring')) {
      throw new Error('Synthetic source fixtures are incomplete');
    }

    const profileOnly = structuredClone(source);

    // The export format accepts unbound collections as documents. Keep every value
    // in memory; the only saved storage state belongs under the caller's ignored output.
    source.collections.plans = rung.plans;
    source.collections.planVersions = rung.planVersions;
    source.collections.activePlan = rung.activePlan;
    source.collections.bioRecords = bio.records.map((record) => ({
      ...record,
      sourceKey: 'qa-design-ring',
      _id: `${record.record_id}@${record.version}`,
    }));
    const dates = ['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-04'];
    source.collections.measurements = dates.map((date, index) => ({
      _id: `01K0000000000000000000000${index}`,
      date,
      at: `${date}T08:00:00.000Z`,
      metric: 'weightKg',
      value: [88.6, 88.3, 88.1, 87.9][index],
      kind: 'record',
      source: { by: 'user' },
    }));
    source.collections.dailyLogs = [{
      _id: '01K00000000000000000000010',
      date: '2026-10-04',
      at: '2026-10-04T08:15:00.000Z',
      tz: 'Asia/Kolkata',
      source: { by: 'user', method: 'typed' },
      kind: 'meal',
      clockH: 8.25,
      slot: 'breakfast',
      text: 'Oats, yogurt and fruit',
      components: [],
      totals: {
        energyKcal: { value: 410, sd: 45 },
        proteinG: { value: 23, sd: 4 },
        carbG: { value: 54, sd: 7 },
        fatG: { value: 12, sd: 2 },
        fibreG: { value: 8, sd: 2 },
      },
    }];

    await importProfile(page, base, source);
    const plan = await read(page, 'plan.get');
    if (!plan?.active && !plan?.plan && !plan?.doc) throw new Error('Synthetic plan did not become active');
    const exported = await read(page, 'data.export');
    const collections = JSON.parse(exported.text).collections;
    const counts = Object.fromEntries(['profile', 'safety', 'plans', 'activePlan', 'dailyLogs', 'measurements', 'bioRecords']
      .map((key) => [key, collections[key]?.length ?? 0]));
    if (Object.values(counts).some((count) => count < 1)) throw new Error(`Synthetic import incomplete: ${JSON.stringify(counts)}`);
    await visit(page, base, '/today');
    if (page.url().includes('/welcome')) throw new Error('Safety gate still blocks populated routes');
    await sleep(500);
    if (await page.locator('html').getAttribute('data-theme')) throw new Error('Synthetic profile forces a theme');
    const state = await ctx.storageState({ indexedDB: true });
    if (output) await fs.mkdir(output, { recursive: true });
    const beforeCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    let beforeBiometricsState;
    try {
      const beforePage = await beforeCtx.newPage();
      beforePage.setDefaultTimeout(20_000);
      await importProfile(beforePage, base, profileOnly);
      const beforeExport = await read(beforePage, 'data.export');
      const beforeCollections = JSON.parse(beforeExport.text).collections;
      if (!beforeCollections.profile?.length || beforeCollections.bioRecords?.length || beforeCollections.plans?.length) {
        throw new Error('Profile-only state is not empty of plan and biometrics');
      }
      beforeBiometricsState = await beforeCtx.storageState({ indexedDB: true });
    } finally {
      await beforeCtx.close();
    }
    return { state, beforeBiometricsState, plan: true, counts, notes: [] };
  } finally {
    await ctx.close();
  }
}
