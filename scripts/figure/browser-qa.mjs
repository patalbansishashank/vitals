// Reproducible 3D figure smoke, visual, and performance check in isolated headless Chromium.
// Run: node scripts/figure/browser-qa.mjs [--base-url=<existing Vite URL>]
// Without --base-url this starts and stops its own Vite server. Results stay in the git-ignored
// bench-results/C-BODY directory. Requires the repository's playwright-core dependency.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'bench-results/C-BODY');
const PORT = 5193;
let BASE = process.argv.find((arg) => arg.startsWith('--base-url='))?.slice('--base-url='.length);
const ownsServer = !process.argv.some((arg) => arg.startsWith('--base-url='));
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const mode = process.env.BENCH_BROWSER_MODE === 'native' ? 'native' : 'software';
const nativeBackend = process.env.BENCH_NATIVE_GL || 'vulkan';
const quick = process.argv.includes('--quick');
const compareOnly = process.argv.includes('--compare');
const bodyOnly = process.argv.includes('--body');
const cleanupOnly = process.argv.includes('--cleanup');
const probeGlOnly = process.argv.includes('--probe-gl');
const welcomeOnly = process.argv.includes('--welcome');
const offscreenOnly = process.argv.includes('--offscreen');
const runKind = probeGlOnly ? 'probe' : quick ? 'quick' : compareOnly ? 'compare' : bodyOnly ? 'body' : cleanupOnly ? 'cleanup' : welcomeOnly ? 'welcome' : offscreenOnly ? 'offscreen' : 'full';
const report = {
  generatedAt: new Date().toISOString(),
  browser: chromiumPath,
  baseUrl: BASE ?? 'started by harness',
  mode,
  ...(mode === 'native' ? { nativeBackend } : {}),
  viewport: [],
  checks: {},
  performance: {},
  pageErrors: [],
};
let server;
let browser;

function check(condition, message) {
  report.checks[message] = condition ? 'pass' : 'fail';
  if (!condition) console.error(`FAIL: ${message}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(`${BASE}/dev/figure`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* still starting */ }
    await delay(500);
  }
  throw Error(`Vite did not respond at ${BASE}`);
}

async function openFigure(context, suffix = '') {
  const page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.goto(`${BASE}/dev/figure?theme=light${suffix}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.lm-devfig h1').waitFor();
  await page.locator('.lm-fig3d[data-renderer="webgl"]').waitFor({ timeout: 30000 });
  const canvas = page.locator('.lm-fig3d canvas').first();
  await canvas.waitFor({ state: 'visible' });
  await page.waitForFunction(() => Number(document.querySelector('.lm-fig3d canvas')?.dataset.draws ?? 0) > 0);
  return page;
}

async function canvasHash(page) {
  const canvas = page.locator('.lm-fig3d canvas').first();
  return createHash('sha256').update(await canvas.screenshot()).digest('hex');
}

async function glErrors(page) {
  return page.locator('.lm-fig3d canvas').first().evaluate((canvas) => {
    const gl = canvas.getContext('webgl2');
    const errors = [];
    if (gl) for (let i = 0; i < 16; i++) {
      const code = gl.getError();
      if (code === gl.NO_ERROR) break;
      errors.push(code);
    }
    return errors;
  });
}

async function angle(page) {
  const raw = await page.locator('.lm-fig3d canvas').first().getAttribute('data-angle-rad');
  check(raw !== null, 'canvas exposes rotation angle');
  return Number(raw);
}

async function motionCheck(page) {
  const canvas = page.locator('.lm-fig3d canvas').first();
  const start = await angle(page);
  await page.waitForFunction((first) => Number(document.querySelector('.lm-fig3d canvas')?.dataset.angleRad ?? first) > first + 0.012, start, { timeout: 12000 }).catch(() => {});
  const moving = await angle(page);
  check(moving > start + 0.012, 'figure rotates continuously');
  const box = await canvas.boundingBox();
  if (!box) throw Error('Figure canvas has no on-screen box');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const held = await angle(page);
  await delay(350);
  check(Math.abs(await angle(page) - held) < 0.003, 'auto rotation pauses during drag');
  await page.mouse.move(x + Math.min(70, box.width / 4), y, { steps: 4 });
  const dragged = await angle(page);
  check(Math.abs(dragged - held) > 0.05, 'drag turns the figure');
  await page.mouse.up();
  await page.waitForFunction((first) => Math.abs(Number(document.querySelector('.lm-fig3d canvas')?.dataset.angleRad ?? first) - first) > 0.012, dragged, { timeout: 12000 }).catch(() => {});
  check(Math.abs(await angle(page) - dragged) > 0.012, 'auto rotation resumes after drag');
}

async function frameSample(page, durationMs = 3000) {
  return page.evaluate(async (duration) => {
    const times = [];
    const drawTimes = [];
    const canvas = document.querySelector('.lm-fig3d canvas');
    let lastDraw = Number(canvas?.dataset.draws ?? 0);
    const firstDraw = lastDraw;
    const start = performance.now();
    await new Promise((done) => {
      const tick = (time) => {
        times.push(time);
        const draw = Number(canvas?.dataset.draws ?? 0);
        if (draw > lastDraw) {
          const ms = Number(canvas?.dataset.drawMs);
          if (Number.isFinite(ms)) drawTimes.push(ms);
          lastDraw = draw;
        }
        if (time - start < duration) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    const intervals = times.slice(1).map((t, index) => t - times[index]);
    intervals.sort((a, b) => a - b);
    drawTimes.sort((a, b) => a - b);
    const elapsed = times.at(-1) - times[0];
    return {
      frames: intervals.length,
      elapsedMs: Math.round(elapsed),
      fps: Number((intervals.length * 1000 / elapsed).toFixed(1)),
      medianFrameMs: Number((intervals[Math.floor(intervals.length / 2)] ?? 0).toFixed(2)),
      p95FrameMs: Number((intervals[Math.floor(intervals.length * 0.95)] ?? 0).toFixed(2)),
      rendererDraws: lastDraw - firstDraw,
      rendererFps: Number(((lastDraw - firstDraw) * 1000 / elapsed).toFixed(1)),
      medianDrawWorkMs: Number((drawTimes[Math.floor(drawTimes.length / 2)] ?? 0).toFixed(2)),
      p95DrawWorkMs: Number((drawTimes[Math.floor(drawTimes.length * 0.95)] ?? 0).toFixed(2)),
    };
  }, durationMs);
}

async function shot(context, width, theme) {
  const page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.setViewportSize({ width, height: width === 390 ? 1150 : width === 768 ? 1500 : 900 });
  await page.goto(`${BASE}/dev/figure?theme=${theme}`, { waitUntil: 'domcontentloaded' });
  const stage = page.locator('.lm-devfig__fig .lm-fig3d__stage');
  await stage.waitFor();
  const before = await stage.boundingBox();
  await page.locator('.lm-fig3d[data-renderer="webgl"]').waitFor({ timeout: 30000 });
  await page.locator('.lm-fig3d canvas').first().waitFor({ state: 'visible' });
  const after = await stage.boundingBox();
  const figureSizeShiftPx = before && after ? Math.max(Math.abs(after.width - before.width), Math.abs(after.height - before.height)) : null;
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: resolve(OUT, `figure-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
  const stageFile = `figure-stage-${width}-${theme}.png`;
  await stage.screenshot({ path: resolve(OUT, stageFile), animations: 'disabled' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  report.viewport.push({ width, theme, screenshot: `figure-${width}-${theme}.png`, stageScreenshot: stageFile, horizontalOverflow: overflow, figureSizeShiftPx });
  check(!overflow, `${width}px ${theme} has no horizontal overflow`);
  check(figureSizeShiftPx !== null && figureSizeShiftPx <= 1, `${width}px ${theme} figure loads without size shift`);
  await page.close();
}

async function layerShot(context, keep) {
  const page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.setViewportSize({ width: 768, height: 1500 });
  await page.goto(`${BASE}/dev/figure?theme=light`, { waitUntil: 'domcontentloaded' });
  const figure = page.locator('.lm-devfig__fig');
  await page.locator('.lm-devfig__fig[data-renderer="webgl"]').waitFor({ timeout: 30000 });
  await figure.locator('canvas').first().waitFor({ state: 'visible', timeout: 30000 });
  const pause = figure.getByRole('button', { name: 'Pause turning' });
  if (await pause.count()) await pause.click();
  await figure.locator('summary').filter({ hasText: 'Layers' }).click();
  const group = figure.getByRole('group', { name: 'Body layers' });
  const labels = ['Skin', 'Fat under skin', 'Muscles', 'Bones'];
  for (const label of labels) {
    const button = group.getByRole('button', { name: label, exact: true });
    if (await button.getAttribute('aria-pressed') === 'true') await button.click();
  }
  await delay(150);
  const empty = await canvasHash(page);
  await group.getByRole('button', { name: keep, exact: true }).click();
  await delay(250);
  const hasLayer = empty !== await canvasHash(page);
  check(hasLayer, `${keep} alone draws visible geometry`);
  const errors = await glErrors(page);
  check(errors.length === 0, `${keep} draw has no WebGL errors`);
  const file = `figure-layer-${keep.toLowerCase().replace(/[^a-z]+/g, '-')}.png`;
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: resolve(OUT, file), fullPage: true, animations: 'disabled' });
  const stageFile = file.replace('figure-layer-', 'figure-stage-layer-');
  await figure.locator('.lm-fig3d__stage').screenshot({ path: resolve(OUT, stageFile), animations: 'disabled' });
  report.viewport.push({ width: 768, theme: 'light', layer: keep, screenshot: file, stageScreenshot: stageFile, webglErrors: errors });
  await page.close();
}

async function frameShot(context, frame) {
  const page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.setViewportSize({ width: 768, height: 1500 });
  await page.goto(`${BASE}/dev/figure?theme=light`, { waitUntil: 'domcontentloaded' });
  const figure = page.locator('.lm-devfig__fig');
  await page.locator('.lm-devfig__fig[data-renderer="webgl"]').waitFor({ timeout: 30000 });
  await figure.getByRole('button', { name: 'Pause turning' }).click();
  await page.getByLabel(/Frame \(hips-led/i).fill(String(frame));
  await figure.locator('summary').filter({ hasText: 'Layers' }).click();
  const group = figure.getByRole('group', { name: 'Body layers' });
  for (const label of ['Fat under skin', 'Muscles']) {
    const button = group.getByRole('button', { name: label, exact: true });
    if (await button.getAttribute('aria-pressed') === 'true') await button.click();
  }
  await delay(300);
  const file = `figure-stage-frame-${frame}.png`;
  await figure.locator('.lm-fig3d__stage').screenshot({ path: resolve(OUT, file), animations: 'disabled' });
  const errors = await glErrors(page);
  check(errors.length === 0, `frame ${frame} draw has no WebGL errors`);
  report.viewport.push({ width: 768, theme: 'light', frame, layer: 'skin and bones', stageScreenshot: file, webglErrors: errors });
  await page.close();
}

async function welcomeShot(context, width) {
  const page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.setViewportSize({ width, height: width === 390 ? 1150 : 900 });
  await page.goto(`${BASE}/welcome?theme=light`, { waitUntil: 'domcontentloaded' });
  await page.locator('.lm-onb-stage__figure .lm-fig3d[data-renderer="webgl"]').waitFor({ state: 'attached', timeout: 30000 });
  await delay(1500);
  const file = `welcome-${width}-light.png`;
  await page.screenshot({ path: resolve(OUT, file), fullPage: true, animations: 'disabled' });
  const figureVisible = await page.locator('.lm-onb-stage__figure .lm-fig3d').isVisible();
  const box = await page.locator('.lm-onb-stage__figure .lm-fig3d').boundingBox();
  let stageFile;
  if (figureVisible) {
    stageFile = `welcome-stage-${width}-light.png`;
    await page.locator('.lm-onb-stage__figure .lm-fig3d__stage').screenshot({ path: resolve(OUT, stageFile), animations: 'disabled' });
  }
  report.viewport.push({ width, theme: 'light', route: 'welcome', screenshot: file, figureVisible, box: box ? { width: box.width, height: box.height } : null, ...(stageFile ? { stageScreenshot: stageFile } : {}) });
  check(figureVisible, `welcome ${width}px shows 3D example figure`);
  await page.close();
}

async function compareShot(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 768, height: 1500 });
  await page.goto(`${BASE}/dev/figure?theme=light`, { waitUntil: 'domcontentloaded' });
  await page.locator('.lm-devfig__fig[data-renderer="webgl"]').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Pause turning' }).first().click();
  await page.getByLabel(/ghost of start/i).check();
  await page.getByLabel(/Fat change/i).fill('-12');
  await delay(650);
  const file = 'figure-stage-compare.png';
  await page.locator('.lm-devfig__fig .lm-fig3d__stage').screenshot({ path: resolve(OUT, file), animations: 'disabled' });
  report.viewport.push({ width: 768, theme: 'light', mode: 'compare', stageScreenshot: file });
  await page.close();
}

async function bodyShot(browserInstance, width) {
  // This context is fresh and private to the test. The synthetic values never enter an
  // existing browser profile or any other user's session.
  const context = await browserInstance.newContext({ viewport: { width, height: width === 390 ? 1250 : 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.goto(`${BASE}/dev/figure?theme=light`, { waitUntil: 'domcontentloaded' });
  await page.locator('.lm-devfig h1').waitFor();
  await page.evaluate(async () => {
    const [{ seedClearedSafety }, { useProfileStore, flushBodyPersistence }, { useSettingsStore }] = await Promise.all([
      import('/src/features/onboarding/testing.ts'),
      import('/src/state/profileStore.ts'),
      import('/src/state/settingsStore.ts'),
    ]);
    seedClearedSafety();
    const body = useProfileStore.getState();
    body.resetBody();
    body.setSex('male');
    body.setAge(36);
    body.setHeight(178);
    body.setWeight(84.9);
    body.setSetup('done');
    flushBodyPersistence();
    useSettingsStore.getState().set({ units: 'metric', showFigure: true });
  });
  await page.locator('a[href="/body"]:visible').first().click();
  await page.waitForURL(/\/body/);
  await page.getByRole('heading', { name: 'Your body', level: 1 }).waitFor({ timeout: 30000 });
  await page.locator('.lm-body-stage .lm-fig3d[data-renderer="webgl"]').waitFor({ timeout: 30000 });
  const file = `body-${width}-light.png`;
  await page.screenshot({ path: resolve(OUT, file), fullPage: true, animations: 'disabled' });
  const stageFile = `body-stage-${width}-light.png`;
  await page.locator('.lm-body-stage .lm-fig3d__stage').screenshot({ path: resolve(OUT, stageFile), animations: 'disabled' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  report.viewport.push({ width, route: 'body', screenshot: file, stageScreenshot: stageFile, horizontalOverflow: overflow });
  check(!overflow, `body ${width}px has no horizontal overflow`);
  await context.close();
}

async function cleanupCheck(page) {
  await page.locator('a[href="/evidence"]:visible').first().click();
  await page.waitForURL(/\/evidence/);
  await page.locator('.lm-devfig').waitFor({ state: 'detached', timeout: 15000 });
  await delay(200);
  report.performance.resourcesAfterUnmount = await page.evaluate(() => window.__figureWebglResources());
  check(Object.values(report.performance.resourcesAfterUnmount).every((count) => count === 0), 'WebGL resources freed after unmount');
}

async function offscreenCheck(page) {
  const canvas = page.locator('.lm-fig3d canvas').first();
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await delay(300);
  const before = Number(await canvas.getAttribute('data-draws'));
  await delay(700);
  const after = Number(await canvas.getAttribute('data-draws'));
  report.performance.offscreen = { drawsBefore: before, drawsAfter: after };
  check(after === before, 'offscreen figure stops drawing');
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction((n) => Number(document.querySelector('.lm-fig3d canvas')?.dataset.draws ?? 0) > n, after, { timeout: 10000 });
  check(true, 'onscreen figure resumes drawing');
}

async function run() {
  await mkdir(OUT, { recursive: true });
  if (ownsServer) {
    server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true, hmr: false } });
    await server.listen();
    BASE = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
    if (!BASE) throw Error('Vite did not report a local URL');
  }
  report.baseUrl = BASE;
  await waitForServer();
  browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: [
      ...(mode === 'software' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
      ...(mode === 'native' && nativeBackend === 'vulkan' ? ['--enable-gpu', '--use-gl=angle', '--use-angle=vulkan', '--enable-vulkan', '--enable-features=Vulkan'] : []),
      ...(mode === 'native' && nativeBackend === 'gl' ? ['--enable-gpu', '--use-gl=angle', '--use-angle=gl'] : []),
      ...(mode === 'native' && nativeBackend === 'default' ? ['--enable-gpu'] : []),
      '--enable-webgl', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--no-sandbox', '--hide-scrollbars',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  if (probeGlOnly) {
    const probe = await openFigure(context);
    report.performance.gl = await probe.locator('.lm-fig3d canvas').first().evaluate((canvas) => {
      const gl = canvas.getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'none',
        vendor: gl ? gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR) : 'none',
      };
    });
    report.performance.rotation = await frameSample(probe, mode === 'native' ? 10000 : 3000);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (quick) {
    for (const theme of ['light', 'dark']) await shot(context, 390, theme);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (compareOnly) {
    await compareShot(context);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (bodyOnly) {
    for (const width of [390, 1440]) await bodyShot(browser, width);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (welcomeOnly) {
    for (const width of [390, 1440]) await welcomeShot(context, width);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  await context.addInitScript(() => {
    const live = { buffers: new Set(), vaos: new Set(), programs: new Set(), shaders: new Set() };
    const proto = WebGL2RenderingContext.prototype;
    for (const [createName, deleteName, slot] of [
      ['createBuffer', 'deleteBuffer', 'buffers'],
      ['createVertexArray', 'deleteVertexArray', 'vaos'],
      ['createProgram', 'deleteProgram', 'programs'],
      ['createShader', 'deleteShader', 'shaders'],
    ]) {
      const create = proto[createName];
      const remove = proto[deleteName];
      proto[createName] = function (...args) {
        const item = create.apply(this, args);
        if (item) live[slot].add(item);
        return item;
      };
      proto[deleteName] = function (item) {
        live[slot].delete(item);
        return remove.call(this, item);
      };
    }
    window.__figureWebglResources = () => Object.fromEntries(Object.entries(live).map(([name, set]) => [name, set.size]));
  });
  if (cleanupOnly) {
    const cleanupPage = await openFigure(context);
    await cleanupPage.getByRole('button', { name: /Run 3 s outer body morph benchmark/i }).click();
    await cleanupPage.getByTestId('bench').waitFor({ timeout: 15000 });
    await cleanupCheck(cleanupPage);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (offscreenOnly) {
    const offscreenPage = await openFigure(context);
    await offscreenCheck(offscreenPage);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const page = await openFigure(context);
  const glInfo = await page.locator('.lm-fig3d canvas').first().evaluate((canvas) => {
    const gl = canvas.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'none',
      vendor: gl ? gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR) : 'none',
    };
  });
  report.performance.gl = glInfo;
  if (mode === 'software') check(/swiftshader|software/i.test(`${glInfo.renderer} ${glInfo.vendor}`), 'software WebGL renderer active');
  check(await page.locator('.lm-devfig__stats table').count() === 1, 'model fit reported');
  check((await glErrors(page)).length === 0, 'default draw has no WebGL errors');
  await motionCheck(page);
  report.performance.rotation = await frameSample(page, mode === 'native' ? 10000 : 3000);

  // A changed body and a layer switch must reach the rendered image. Wait for the morph to settle.
  const pauseTurning = page.getByRole('button', { name: 'Pause turning' }).first();
  if (await pauseTurning.count()) await pauseTurning.click();
  await delay(150);
  const stableImage = await canvasHash(page);
  const fat = page.getByLabel(/Fat change/i);
  await fat.fill('12');
  await delay(650);
  const changedImage = await canvasHash(page);
  check(stableImage !== changedImage, 'fat control changes rendered figure');
  await page.getByLabel(/lean core/i).check();
  await delay(250);
  check(await page.getByLabel(/lean core/i).isChecked(), 'outer body layer switch responds');

  // The separate benchmark measures morph, upload, draw, and gl.finish(), so a fast rAF
  // alone cannot pass as fast GPU work.
  await page.getByRole('button', { name: /Run 3 s outer body morph benchmark/i }).click();
  await page.getByTestId('bench').waitFor({ timeout: 15000 });
  report.performance.morph = await page.getByTestId('bench').innerText();
  report.performance.benchmarkContext = `outer body only; 640x400 canvas; ${mode} Chromium; 3 seconds; morph + normals + upload + draw + gl.finish`;
  await offscreenCheck(page);

  for (const width of [390, 768, 1440]) {
    for (const theme of ['light', 'dark']) await shot(context, width, theme);
  }
  for (const layer of ['Bones', 'Muscles']) await layerShot(context, layer);
  for (const frame of [0, 1]) await frameShot(context, frame);
  for (const width of [390, 1440]) await welcomeShot(context, width);
  await compareShot(context);
  for (const width of [390, 1440]) await bodyShot(browser, width);
  await cleanupCheck(page);
  await page.close();

  const reduced = await browser.newContext({ viewport: { width: 768, height: 900 }, reducedMotion: 'reduce' });
  const reducedPage = await openFigure(reduced);
  const reducedCanvas = reducedPage.locator('.lm-fig3d canvas').first();
  const drawsBefore = Number(await reducedCanvas.getAttribute('data-draws'));
  const reducedAngleBefore = await angle(reducedPage);
  const reducedHashBefore = await canvasHash(reducedPage);
  await delay(900);
  const drawsAfter = Number(await reducedCanvas.getAttribute('data-draws'));
  const reducedAngleAfter = await angle(reducedPage);
  const reducedHashAfter = await canvasHash(reducedPage);
  report.performance.reducedMotion = { drawsBefore, drawsAfter, angleBefore: reducedAngleBefore, angleAfter: reducedAngleAfter, staticImage: reducedHashBefore === reducedHashAfter };
  check(Math.abs(reducedAngleAfter - reducedAngleBefore) < 0.001, 'reduced motion disables auto rotation');
  check(drawsBefore === drawsAfter, 'reduced motion stops repeated drawing');
  await reduced.close();

  const fallback = await browser.newContext({ viewport: { width: 768, height: 900 } });
  await fallback.addInitScript(() => {
    Object.defineProperty(window, 'WebGL2RenderingContext', { configurable: true, value: undefined });
  });
  const fallbackPage = await fallback.newPage();
  fallbackPage.on('pageerror', (error) => report.pageErrors.push(error.message));
  await fallbackPage.goto(`${BASE}/dev/figure?theme=light`, { waitUntil: 'domcontentloaded' });
  await fallbackPage.locator('.lm-fig3d[data-renderer="svg"]').waitFor({ timeout: 20000 });
  check(await fallbackPage.locator('.lm-fig3d svg').count() > 0, 'WebGL failure shows SVG fallback');
  await fallback.close();

  const lostContext = await browser.newContext({ viewport: { width: 768, height: 900 } });
  const lostPage = await openFigure(lostContext);
  report.checks.contextLossMechanism = await lostPage.locator('.lm-fig3d canvas').first().evaluate((canvas) => {
    const lose = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (lose) { lose.loseContext(); return 'extension'; }
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    return 'event';
  });
  await lostPage.locator('.lm-fig3d[data-renderer="svg"]').waitFor({ timeout: 10000 });
  check(await lostPage.locator('.lm-fig3d svg').count() > 0, 'lost WebGL context shows SVG fallback');
  await lostContext.close();

  check(report.pageErrors.length === 0, 'no uncaught page errors');
  const failures = Object.entries(report.checks).filter(([, result]) => result === 'fail').map(([name]) => name);
  if (failures.length) throw Error(`${failures.length} check(s) failed: ${failures.join(', ')}`);
  console.log(JSON.stringify(report, null, 2));
}

try {
  await run();
} catch (error) {
  report.failed = error instanceof Error ? error.message : String(error);
  console.error(report.failed);
  process.exitCode = 1;
} finally {
  await writeFile(resolve(OUT, `browser-qa-${mode}-${runKind}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  await server?.close();
}
