// Capture real transient Planner and Simulator states in one live browser context per run.
// BASE=<production preview URL> node qa/scripts/C-DESIGN/results.mjs before|after
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const phase = process.argv[2];
const base = process.env.BASE;
if (!base || !['before', 'after'].includes(phase)) {
  throw new Error('Usage: BASE=<preview URL> node qa/scripts/C-DESIGN/results.mjs before|after');
}

const root = path.resolve(import.meta.dirname, '../../..');
const output = path.join(root, '.e6-tmp/c-design');
const folder = path.join(output, phase);
const origin = new URL(base).origin;
const forOrigin = (state) => ({ ...state, origins: (state.origins || []).map((entry) => ({ ...entry, origin })) });
const widths = [390, 768, 1024, 1280, 1440];
const schemes = ['light', 'dark'];
const rows = [];
const failures = [];
await fs.mkdir(folder, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  args: ['--no-sandbox'],
});

async function visit(page, route) {
  const url = new URL(route, base);
  url.searchParams.set('qa', '1');
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.locator('main .lm-page').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function captureMatrix(page, name) {
  for (const width of widths) {
    const height = width === 390 ? 844 : width === 768 ? 1024 : 900;
    await page.setViewportSize({ width, height });
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(100);
      const filename = `${name}-${width}-${scheme}.png`;
      await page.screenshot({ path: path.join(folder, filename), fullPage: true, animations: 'disabled' });
      const metrics = await page.evaluate(() => ({
        path: location.pathname,
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        title: document.querySelector('main h1')?.textContent?.trim() || null,
        plannerProgress: Boolean(document.querySelector('[role="progressbar"][aria-label="Optimiser progress"]')),
        ladder: Boolean(document.querySelector('.lp-ladder')),
        simulatorChart: Boolean(document.querySelector('.rs-chart canvas, .rs-chart svg, .rs-chart .lmc-frame')),
      }));
      rows.push({ name, width, scheme, filename, ...metrics });
      const expectedPath = name === 'plan-run-live' ? '/plan/run'
        : name === 'plan-results-live' ? '/plan/results'
          : '/simulate/starter/results';
      const expectedContent = name === 'plan-run-live' ? metrics.plannerProgress
        : name === 'plan-results-live' ? metrics.ladder
          : metrics.simulatorChart;
      if (metrics.path !== expectedPath || !expectedContent) {
        failures.push(`${name} ${width} ${scheme}: expected live route/content missing`);
      }
      if (phase === 'after' && metrics.overflow > 2) {
        failures.push(`${name} ${width} ${scheme}: ${metrics.overflow}px document overflow`);
      }
      console.log(`${phase} ${name} ${width} ${scheme}: ${metrics.path}, overflow ${metrics.overflow}px`);
    }
  }
}

async function planner() {
  const state = forOrigin(JSON.parse(await fs.readFile(path.join(output, 'synthetic-empty-state.json'), 'utf8')));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await visit(page, '/plan/goals');
    const find = page.getByRole('button', { name: /Find plans/ }).first();
    if (await find.getAttribute('aria-disabled') === 'true') {
      await page.getByRole('button', { name: /Fat mass ↓/ }).first().click();
      await page.getByRole('button', { name: /Strength index ↑/ }).first().click();
    }
    if (await find.getAttribute('aria-disabled') === 'true') throw new Error('Planner run key remains disabled with synthetic profile');
    await find.click();
    await page.waitForURL(/\/plan\/run/, { timeout: 10_000 });
    await page.locator('[role="progressbar"][aria-label="Optimiser progress"]').waitFor({ timeout: 15_000 });
    await captureMatrix(page, 'plan-run-live');
    await page.getByRole('button', { name: 'Start this plan' }).first().waitFor({ state: 'visible', timeout: 240_000 });
    if (!new URL(page.url()).pathname.endsWith('/plan/results')) throw new Error('Planner did not reach results route');
    if (!(await page.locator('.lp-ladder').count())) throw new Error('Planner result ladder missing');
    await captureMatrix(page, 'plan-results-live');
  } finally {
    await context.close();
  }
}

async function simulator() {
  const state = forOrigin(JSON.parse(await fs.readFile(path.join(output, 'synthetic-state.json'), 'utf8')));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await visit(page, '/simulate');
    const run = page.locator('.sim-runkey:visible').first();
    if (await run.getAttribute('aria-disabled') === 'true') throw new Error('Simulator run key disabled with synthetic profile');
    await run.click();
    await page.waitForURL(/\/simulate\/[^/]+\/results/, { timeout: 30_000 });
    await page.locator('.rs-chart').waitFor({ state: 'visible', timeout: 90_000 });
    await page.waitForFunction(() => Boolean(document.querySelector('.rs-chart canvas, .rs-chart svg, .rs-chart .lmc-frame')), null, { timeout: 90_000 });
    await captureMatrix(page, 'simulator-results-live');
  } finally {
    await context.close();
  }
}

try {
  for (const [name, run] of [['planner', planner], ['simulator', simulator]]) {
    try {
      await run();
    } catch (error) {
      const message = `${name}: ${String(error.message).split('\n')[0]}`;
      failures.push(message);
      console.error(message);
    }
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(output, `${phase}-results-live.json`), JSON.stringify({ phase, rows, failures }, null, 2));
}
if (failures.length) process.exitCode = 1;
