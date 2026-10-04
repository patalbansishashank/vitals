/** Repeatable synthetic year-data and 3D cleanup probe. Requires DEV_BASE and PREVIEW_BASE. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const devBase = process.env.DEV_BASE;
const previewBase = process.env.PREVIEW_BASE;
if (!devBase || !previewBase) throw new Error('Set DEV_BASE and PREVIEW_BASE');
const output = process.env.OUTPUT || fileURLToPath(new URL('../../results/C-A11Y/performance.json', import.meta.url));
const now = new Date('2026-10-04T14:30:00+02:00');
const fixture = { ring: 'connected', signals: 'full' };
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--enable-precise-memory-info', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const records = [];

async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'Europe/Berlin', locale: 'en-GB', serviceWorkers: 'block' });
  await ctx.clock.setFixedTime(now);
  return ctx;
}

async function setup(page, base) {
  page.setDefaultTimeout(15000);
  console.log('setup: welcome');
  await page.goto(base + '/welcome');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Get started' }).click();
  console.log('setup: consent');
  await page.waitForTimeout(500);
  await page.getByRole('radio', { name: '18–64' }).click();
  const no = page.getByRole('radio', { name: 'no', exact: true });
  for (let i = 0; i < await no.count(); i++) await no.nth(i).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(500);
  await page.getByLabel('I understand').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/body/);
  console.log('setup: body');
  await page.getByRole('radio', { name: 'male', exact: true }).click();
  const inputs = page.getByRole('spinbutton');
  for (const [i, value] of [[0, '40'], [1, '178'], [2, '95']]) {
    await inputs.nth(i).fill(value);
    await inputs.nth(i).press('Tab');
  }
  console.log('setup: done');
}

async function longTaskProbe(route, run) {
  const ctx = await context();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 180)));
  await setup(page, devBase);
  console.log('probe:', route, run);
  await page.addInitScript((f) => {
    window.__VITALS_PAGES_FIXTURE__ = f;
    window.__perfLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__perfLongTasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration) });
    }).observe({ type: 'longtask', buffered: true });
  }, fixture);
  const begin = performance.now();
  await page.goto(devBase + route, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => Boolean(window.__VITALS_PAGES_FIXTURE_LOADED__), null, { timeout: 120000 });
  await page.waitForTimeout(1000);
  const interactiveMs = Math.round(performance.now() - begin);
  const initial = await page.evaluate(() => ({ loaded: window.__VITALS_PAGES_FIXTURE_LOADED__, title: document.querySelector('h1')?.textContent?.slice(0, 80) ?? null }));
  const tabTasks = [];
  if (route.startsWith('/signals')) {
    for (const name of ['heart and recovery', 'activity', 'sleep']) {
      const start = await page.evaluate(() => window.__perfLongTasks.length);
      await page.getByRole('tab', { name }).click();
      await page.waitForTimeout(500);
      tabTasks.push({ tab: name, tasks: await page.evaluate((from) => window.__perfLongTasks.slice(from), start) });
    }
  }
  const data = await page.evaluate(() => ({
    tasks: window.__perfLongTasks,
  }));
  await ctx.close();
  const durations = data.tasks.map((task) => task.duration);
  return {
    kind: 'synthetic-dev', route, run, interactiveMs, fixtureLoaded: Boolean(initial.loaded), title: initial.title, tabTasks,
    longTasks: durations.length, longTaskTotalMs: durations.reduce((a, b) => a + b, 0),
    longestTaskMs: Math.max(0, ...durations), durationsMs: durations, errors,
  };
}

async function heap(page, cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(500);
  return (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? null;
}

async function bodyProbe(run) {
  const ctx = await context();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 180)));
  await setup(page, previewBase);
  console.log('body probe:', run);
  await page.evaluate(() => {
    window.__perfLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__perfLongTasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration) });
    }).observe({ type: 'longtask', buffered: true });
  });
  const navigate = async (path) => {
    console.log('navigate:', path);
    const link = page.locator(`a[href="${path}"]:visible`).first();
    console.log('links:', await page.locator(`a[href="${path}"]`).count());
    await link.click({ timeout: 20000 });
    await page.waitForURL(new RegExp(`${path}$`));
    console.log('arrived:', path);
  };
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await navigate('/settings');
  await page.waitForTimeout(500);
  const before = await heap(page, cdp);
  const cycles = [];
  for (let i = 0; i < Number(process.env.BODY_CYCLES || 3); i++) {
    const taskStart = await page.evaluate(() => window.__perfLongTasks.length);
    const begin = performance.now();
    await navigate('/body');
    await page.waitForTimeout(1400);
    const mounted = await page.locator('.lm-fig3d').first().getAttribute('data-renderer').catch(() => null);
    console.log('mounted:', mounted);
    const during = await heap(page, cdp);
    const bodyTasks = await page.evaluate((from) => window.__perfLongTasks.slice(from), taskStart);
    await navigate('/settings');
    await page.waitForTimeout(700);
    const after = await heap(page, cdp);
    const leaveTasks = await page.evaluate((from) => window.__perfLongTasks.slice(from), taskStart + bodyTasks.length);
    const canvasAfterLeave = await page.locator('.lm-fig3d canvas').count();
    const domAfterLeave = await cdp.send('Memory.getDOMCounters');
    console.log('cycle:', i, during, after);
    cycles.push({ mounted, entryMs: Math.round(performance.now() - begin), duringBytes: during, afterBytes: after,
      bodyTaskDurationsMs: bodyTasks.map((task) => task.duration), leaveTaskDurationsMs: leaveTasks.map((task) => task.duration),
      canvasAfterLeave, domAfterLeave });
  }
  await ctx.close();
  return { kind: 'production-body', run, beforeBytes: before, cycles, errors };
}

try {
  for (let run = 1; run <= Number(process.env.RUNS || 2); run++) {
    if (!process.env.ONLY_SYNTHETIC) records.push(await bodyProbe(run));
    if (!process.env.ONLY_BODY) {
      records.push(await longTaskProbe('/ring', run));
      records.push(await longTaskProbe('/signals?tab=sleep&period=year&date=2026-10-04', run));
    }
  }
} finally {
  await browser.close();
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({
  method: 'Fresh Chromium contexts; synthetic 400-day fixture in dev for Ring and Body signals; production build for Body. Long tasks via PerformanceObserver; heap via CDP after forced GC. Entry timings include document navigation and a settling pause. Heap values exclude GPU memory.',
  records,
}, null, 2) + '\n');
console.log(JSON.stringify(records.map(({ kind, route, run, interactiveMs, longTasks, longestTaskMs, beforeBytes, cycles, errors }) => ({ kind, route, run, interactiveMs, longTasks, longestTaskMs, beforeBytes, cycles, errors }))));
