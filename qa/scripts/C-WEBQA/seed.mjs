// A synthetic production profile for the web route sweep. Import and plan actions use the shipped UI.
// Run with C_WEBQA_BASE_URL=<preview-url> node qa/scripts/C-WEBQA/seed.mjs, then rerun with --signals
// to make seeded-signals-state.json from the original snapshot and current-dated canonical ring records.
// Both snapshots and the shifted input are ignored under .e6-tmp/C-WEBQA/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = path.join(root, '.e6-tmp/C-WEBQA/seeded-state.json');
const metaOutput = path.join(root, '.e6-tmp/C-WEBQA/seed-meta.json');
const profile = path.join(root, 'qa/fixtures/q1b/export-m-veg.json');
const readings = path.join(root, 'qa/fixtures/q1b-b/bio14.json');
const currentReadings = path.join(root, '.e6-tmp/C-WEBQA/bio14-current.json');
const signalsOutput = path.join(root, '.e6-tmp/C-WEBQA/seeded-signals-state.json');

function makeCurrentReadings() {
  const fixture = fs.readFileSync(readings, 'utf8');
  const dates = [...fixture.matchAll(/"local_date":"(20\d\d-\d\d-\d\d)"/g)].map((match) => match[1]);
  const latest = dates.sort().at(-1);
  if (!latest) throw new Error('Canonical readings have no dated records');
  const today = new Date().toLocaleDateString('en-CA');
  const shift = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${latest}T12:00:00Z`)) / 864e5);
  const shifted = fixture.replace(/\b20\d\d-\d\d-\d\d(?:T[\d:.]+Z)?/g, (stamp) => {
    const instant = new Date(stamp.length === 10 ? `${stamp}T12:00:00Z` : stamp);
    instant.setUTCDate(instant.getUTCDate() + shift);
    return stamp.length === 10 ? instant.toISOString().slice(0, 10) : instant.toISOString().replace('.000Z', 'Z');
  });
  fs.mkdirSync(path.dirname(currentReadings), { recursive: true });
  fs.writeFileSync(currentReadings, shifted);
  return { today, latest, shift };
}

async function go(page, base, route) {
  const url = new URL(route, base);
  url.searchParams.set('qa', '1');
  await page.goto(url.href, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__vitals), null, { timeout: 30000 });
}

async function read(page, command) {
  const result = await page.evaluate((id) => window.__vitals.read(id, {}), command);
  if (!result?.ok) throw new Error(`${command} failed: ${result?.error?.code ?? 'unknown'}`);
  return result.output ?? result.value;
}

/** Seed a fresh Playwright page and return a storageState path usable by new isolated contexts. */
export async function seed(page, base = process.env.C_WEBQA_BASE_URL) {
  if (!base) throw new Error('C_WEBQA_BASE_URL or a base argument is required');
  await go(page, base, '/settings/data');
  await page.locator('#your-data input[type=file], section:has(h2:text("Your data")) input[type=file]').first().setInputFiles(profile);
  await page.getByRole('radio', { name: 'replace', exact: false }).check();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30000 });
  await page.waitForTimeout(1000);
  const body = await read(page, 'profile.get');
  if (!body?.profile?.weightKg && !body?.weightKg) throw new Error('Synthetic body profile was not imported');

  // The older export needs the current screening questions confirmed before planning.
  await go(page, base, '/plan/goals');
  if (new URL(page.url()).pathname === '/welcome') {
    await page.getByRole('radio', { name: '18–64' }).click();
    const groups = page.locator('fieldset');
    for (let i = 1; i < await groups.count(); i++) {
      const no = groups.nth(i).getByRole('radio', { name: 'no', exact: true });
      if (await no.count()) await no.first().click();
    }
    await page.getByRole('button', { name: 'Save answers' }).click();
    await go(page, base, '/plan/goals');
  }
  const find = page.getByRole('button', { name: /Find plans/ });
  if (await find.getAttribute('aria-disabled')) {
    await page.getByRole('button', { name: 'Fat mass ↓' }).click();
    await page.getByRole('button', { name: 'Strength index ↑' }).click();
  }
  await find.click();
  const start = page.getByRole('button', { name: /^(Start this plan|Replace active plan…)$/ }).first();
  await start.waitFor({ timeout: 180000 });
  await start.click();
  await page.getByRole('radio', { name: /^today/ }).last().click();
  await page.getByRole('button', { name: /^(Start plan|Replace active plan…)$/ }).last().click();
  await page.waitForTimeout(1800);
  const running = await read(page, 'plan.get');

  await go(page, base, '/today');
  const weight = page.getByLabel('weight');
  if (await weight.count()) {
    await weight.fill('87.5');
    await weight.press('Enter');
  }
  await go(page, base, '/food');
  await page.getByRole('button', { name: /^I ate this:/ }).first().click();
  const foodLog = await page.evaluate((date) => window.__vitals.read('log.get', { from: date, to: date }), running.plan.startDate);
  if (!foodLog.ok || !foodLog.output?.some((entry) => entry.kind === 'meal')) throw new Error('Synthetic meal was not logged');

  await go(page, base, '/settings/devices');
  await page.locator('input[type=file][aria-label]').last().setInputFiles(readings);
  await page.waitForTimeout(4500);
  const sources = await read(page, 'bio.sources');
  if (!JSON.stringify(sources).includes('ring')) throw new Error('Synthetic ring readings did not import');

  await page.waitForTimeout(1200);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await page.context().storageState({ path: output, indexedDB: true });
  const scenarios = await read(page, 'scenario.list');
  fs.writeFileSync(metaOutput, JSON.stringify({
    scenarioId: scenarios[0]?.id ?? null,
    planId: running.plan?.id ?? null,
    planStatus: running.plan?.status ?? null,
    date: running.plan?.startDate ?? null,
    ringSourceCount: sources.sources?.filter((source) => source.kind === 'ring').length ?? 0,
    foodLogCount: foodLog.output?.filter((entry) => entry.kind === 'meal').length ?? 0,
  }, null, 2));
  return output;
}

/** Add current synthetic body signals to a copy of the seeded profile. */
export async function seedSignals(page, base = process.env.C_WEBQA_BASE_URL) {
  if (!base) throw new Error('C_WEBQA_BASE_URL or a base argument is required');
  const dates = makeCurrentReadings();
  await go(page, base, '/settings/devices');
  await page.locator('input[type=file][aria-label]').last().setInputFiles(currentReadings);
  await page.waitForTimeout(4500);
  const daily = await page.evaluate((date) => window.__vitals.read('bio.daily', { from: date, to: date }), dates.today);
  const values = daily.output?.days?.[0]?.values ?? {};
  if (!daily.ok || Object.keys(values).length === 0) throw new Error('Current synthetic ring signals did not import');
  await page.waitForTimeout(1200);
  await page.context().storageState({ path: signalsOutput, indexedDB: true });
  fs.writeFileSync(path.join(root, '.e6-tmp/C-WEBQA/signals-meta.json'), JSON.stringify({ date: dates.today,
    streams: Object.keys(values), shiftedDays: dates.shift }, null, 2));
  return signalsOutput;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const signals = process.argv.includes('--signals');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block',
    ...(signals ? { storageState: output } : {}) });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    try {
      const result = signals ? await seedSignals(page) : await seed(page);
      console.log(`Seed saved: ${path.relative(root, result)}`);
    } catch (error) {
      console.error('Seed failed at', new URL(page.url()).pathname, (await page.locator('h1,h2').allInnerTexts()).slice(0, 8));
      throw error;
    }
  } finally {
    await browser.close();
  }
}
