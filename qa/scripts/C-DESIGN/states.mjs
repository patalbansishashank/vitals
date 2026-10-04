// Supplemental first-run and interactive states for the layout matrix.
// BASE=<preview URL> node qa/scripts/C-DESIGN/states.mjs before|after
import { chromium, devices } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { seedSynthetic } from './seed.mjs';
import { seedRingState } from './ring-seed.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const phase = process.argv[2];
const base = process.env.BASE;
if (!base || !['before', 'after'].includes(phase)) {
  console.error('Usage: BASE=<preview URL> node qa/scripts/C-DESIGN/states.mjs before|after');
  process.exit(2);
}
const origin = new URL(base).origin;
const output = path.join(root, '.e6-tmp/c-design');
const folder = path.join(output, phase);
fs.mkdirSync(folder, { recursive: true });
const fullStateFile = path.join(output, 'synthetic-state.json');
const emptyStateFile = path.join(output, 'synthetic-empty-state.json');
const simStateFile = path.join(output, 'synthetic-sim-results.json');
const ringStateFile = path.join(output, 'synthetic-ring-state.json');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
const forOrigin = (state) => ({ ...state, origins: (state.origins || []).map((entry) => ({ ...entry, origin })) });
const rows = [];
const failures = [];

async function navigate(page, route, pageSelector) {
  const url = new URL(route, origin);
  url.searchParams.set('qa', '1');
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  if (pageSelector) await page.locator(pageSelector).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
}

async function capture(page, name, width, scheme, fullPage = true) {
  const filename = `${name}-${width}-${scheme}.png`;
  await page.screenshot({ path: path.join(folder, filename), fullPage, animations: 'disabled' });
  const detail = await page.evaluate(() => ({
    url: location.pathname + location.search,
    stage: document.querySelector('.lm-onb')?.getAttribute('data-step') || null,
    title: document.querySelector('h1')?.textContent?.trim() || null,
    overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    navHeight: document.querySelector('.lm-tabbar')?.getBoundingClientRect().height || 0,
    navBottom: document.querySelector('.lm-tabbar')?.getBoundingClientRect().bottom || 0,
    navPaddingBottom: Number.parseFloat(getComputedStyle(document.querySelector('.lm-tabbar') || document.body).paddingBottom) || 0,
    mainPaddingBottom: Number.parseFloat(getComputedStyle(document.querySelector('.lm-main') || document.body).paddingBottom) || 0,
    populatedRingReadings: [...document.querySelectorAll('.rs-row__readout:not([data-missing])')].length,
  }));
  const row = { name, width, scheme, filename, ...detail };
  rows.push(row);
  if (phase === 'after' && detail.overflow > 2) failures.push(`${name} ${width} ${scheme}: overflow ${detail.overflow}px`);
  if (phase === 'after' && name === 'ring-populated' && detail.populatedRingReadings < 1)
    failures.push(`${name} ${width} ${scheme}: no populated synthetic readings`);
  if (phase === 'after' && name === 'today-safe-inset' &&
      (detail.navHeight < 87 || detail.navPaddingBottom < 23 || Math.abs(detail.navBottom - page.viewportSize().height) > 2 || detail.mainPaddingBottom < detail.navHeight + 12)) {
    failures.push(`${name} ${width} ${scheme}: 24px safe inset does not clear bottom navigation`);
  }
  console.log(`${phase} ${name} ${width} ${scheme}: ${detail.overflow ? `overflow ${detail.overflow}px` : 'ok'}`);
}

try {
  if (!fs.existsSync(fullStateFile) || !fs.existsSync(emptyStateFile)) {
    const seeded = await seedSynthetic(browser, { base: origin, root, output });
    fs.writeFileSync(fullStateFile, JSON.stringify(seeded.state));
    fs.writeFileSync(emptyStateFile, JSON.stringify(seeded.beforeBiometricsState));
  }
  const fullState = forOrigin(JSON.parse(fs.readFileSync(fullStateFile, 'utf8')));
  const emptyState = forOrigin(JSON.parse(fs.readFileSync(emptyStateFile, 'utf8')));
  if (!fs.existsSync(ringStateFile)) await seedRingState(browser, { base: origin, root, output, fullState });
  const ringState = forOrigin(JSON.parse(fs.readFileSync(ringStateFile, 'utf8')));
  let simResult = fs.existsSync(simStateFile) ? JSON.parse(fs.readFileSync(simStateFile, 'utf8')) : null;
  if (simResult) simResult = { ...simResult, state: forOrigin(simResult.state) };
  if (!simResult) {
    const simulation = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: fullState, serviceWorkers: 'block' });
    try {
      const page = await simulation.newPage();
      await navigate(page, '/simulate', 'main .lm-page');
      await page.locator('.sim-runkey:visible').first().click({ timeout: 10000 });
      await page.waitForURL(/\/simulate\/[^/]+\/results/, { timeout: 90000 });
      await page.locator('main .lm-page').first().waitFor({ state: 'visible' });
      await page.waitForTimeout(1500);
      simResult = { route: new URL(page.url()).pathname, state: await simulation.storageState({ indexedDB: true }) };
      fs.writeFileSync(simStateFile, JSON.stringify(simResult));
    } catch (error) {
      const message = `simulator results seed: ${String(error.message).split('\n')[0]}`;
      console.error(message);
      if (phase === 'after') failures.push(message);
    } finally { await simulation.close(); }
  }
  const schemes = process.env.DESIGN_STATE_SCHEMES ? process.env.DESIGN_STATE_SCHEMES.split(',').map((s) => s.trim()) : ['light', 'dark'];
  for (const scheme of schemes) {
    for (const width of (process.env.DESIGN_STATE_WIDTHS ? process.env.DESIGN_STATE_WIDTHS.split(',').map(Number) : [390, 768, 1024, 1280, 1440])) {
      const height = width === 390 ? 844 : width === 768 ? 1024 : 900;
      const opts = { viewport: { width, height }, colorScheme: scheme, isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: 1, serviceWorkers: 'block' };
      const fresh = await browser.newContext({ ...opts, ...(width === 390 ? { userAgent: devices['Pixel 7'].userAgent } : {}) });
      const first = await fresh.newPage();
      try {
        await navigate(first, '/welcome', '.lm-onb[data-step="intro"]');
        await capture(first, 'welcome-intro', width, scheme);
        const downloads = first.locator('section.lm-dl');
        if (await downloads.count()) {
          await downloads.scrollIntoViewIfNeeded();
          await first.waitForTimeout(200);
          await capture(first, 'welcome-downloads', width, scheme, false);
        }
        await first.getByRole('button', { name: 'Get started' }).click();
        await first.locator('.lm-onb[data-step="screening"]').waitFor();
        await capture(first, 'welcome-screening', width, scheme);
        const continueKey = first.getByRole('button', { name: 'Continue', exact: true });
        for (let round = 0; round < 20 && !(await continueKey.isEnabled()); round++) {
          const fields = first.locator('fieldset');
          for (let i = 0, n = await fields.count(); i < n; i++) {
            const field = fields.nth(i);
            if (await field.locator('[aria-checked="true"]').count()) continue;
            const choice = field.getByRole('radio', { name: /^(18–64|no)$/ });
            if (await choice.count()) await choice.first().click();
          }
          await first.waitForTimeout(150);
        }
        await continueKey.click({ timeout: 5000 });
        await first.locator('.lm-onb[data-step="consent"]').waitFor();
        await capture(first, 'welcome-consent', width, scheme);
      } catch (error) {
        const message = `welcome states ${width} ${scheme}: ${String(error.message).split('\n')[0]}`;
        console.error(message);
        if (phase === 'after') failures.push(message);
      } finally { await fresh.close(); }

      const empty = await browser.newContext({ ...opts, storageState: emptyState });
      try {
        const page = await empty.newPage();
        await navigate(page, '/ring', 'main .lm-page');
        await capture(page, 'ring-empty', width, scheme);
        await navigate(page, '/signals', 'main .lm-page');
        await capture(page, 'signals-empty', width, scheme);
      } catch (error) {
        const message = `empty states ${width} ${scheme}: ${String(error.message).split('\n')[0]}`;
        console.error(message);
        if (phase === 'after') failures.push(message);
      } finally { await empty.close(); }

      const seeded = await browser.newContext({ ...opts, storageState: fullState });
      try {
        const page = await seeded.newPage();
        await navigate(page, '/food', 'main .lv-food');
        const log = page.getByRole('button', { name: 'Log other food' }).first();
        if (await log.count()) {
          await log.click();
          await page.waitForTimeout(200);
          await capture(page, 'food-manual-log', width, scheme);
        } else rows.push({ name: 'food-manual-log', width, scheme, skipped: 'log action unavailable on seeded date' });
        await navigate(page, '/train', 'main .lv-train');
        const week = page.locator('.lm-ctx button').filter({ hasText: /^week$/ }).first();
        if (await week.count()) {
          await week.click();
          await page.waitForTimeout(200);
          await capture(page, 'train-week', width, scheme);
        } else rows.push({ name: 'train-week', width, scheme, skipped: 'week control unavailable' });
        if (width === 390) {
          await navigate(page, '/today', 'main .lv-today');
          await page.addStyleTag({ content: ':root { --lm-safe-bottom: 24px !important; }' });
          await capture(page, 'today-safe-inset', width, scheme);
        }
      } catch (error) {
        const message = `interactive states ${width} ${scheme}: ${String(error.message).split('\n')[0]}`;
        console.error(message);
        if (phase === 'after') failures.push(message);
      } finally { await seeded.close(); }
      const populated = await browser.newContext({ ...opts, storageState: ringState });
      try {
        const page = await populated.newPage();
        for (const [route, name, ready] of [
          ['/ring', 'ring-populated', 'main .rs-row'],
          ['/signals?tab=sleep&period=day', 'signals-sleep-populated', 'main .lm-page'],
          ['/signals?tab=heart&period=day', 'signals-heart-populated', 'main .lm-page'],
          ['/signals?tab=activity&period=day', 'signals-activity-populated', 'main .lm-page'],
          ['/progress', 'progress-populated', 'main .lm-page'],
        ]) {
          await navigate(page, route, ready);
          await capture(page, name, width, scheme);
        }
      } catch (error) {
        const message = `populated ring states ${width} ${scheme}: ${String(error.message).split('\n')[0]}`;
        console.error(message);
        if (phase === 'after') failures.push(message);
      } finally { await populated.close(); }
      if (simResult) {
        const sim = await browser.newContext({ ...opts, storageState: simResult.state });
        try {
          const page = await sim.newPage();
          await navigate(page, simResult.route, 'main .lm-page');
          await capture(page, 'simulator-results', width, scheme);
        } catch (error) {
          const message = `simulator results ${width} ${scheme}: ${String(error.message).split('\n')[0]}`;
          console.error(message);
          if (phase === 'after') failures.push(message);
        } finally { await sim.close(); }
      }
    }
  }
} finally {
  await browser.close();
  const resultFile = path.join(output, `${phase}-states.json`);
  if (process.env.DESIGN_STATE_WIDTHS && fs.existsSync(resultFile)) {
    const old = JSON.parse(fs.readFileSync(resultFile, 'utf8')).rows || [];
    const fresh = new Set(rows.map((row) => `${row.name}|${row.width}|${row.scheme}`));
    rows.unshift(...old.filter((row) => !fresh.has(`${row.name}|${row.width}|${row.scheme}`)));
  }
  if (phase === 'after') {
    for (const row of rows) {
      if (row.overflow > 2) failures.push(`${row.name} ${row.width} ${row.scheme}: overflow ${row.overflow}px`);
      if (row.name === 'today-safe-inset' &&
          (row.navHeight < 87 || row.navPaddingBottom < 23 || Math.abs(row.navBottom - (row.width === 390 ? 844 : 900)) > 2 || row.mainPaddingBottom < row.navHeight + 12))
        failures.push(`${row.name} ${row.width} ${row.scheme}: 24px safe inset does not clear bottom navigation`);
    }
  }
  const uniqueFailures = [...new Set(failures)];
  fs.writeFileSync(resultFile, JSON.stringify({ phase, rows, failures: uniqueFailures }, null, 2));
  failures.splice(0, failures.length, ...uniqueFailures);
}
if (failures.length) process.exitCode = 1;
