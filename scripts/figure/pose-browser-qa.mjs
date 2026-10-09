// Capture every shared 3D figure mount at fixed angles in isolated headless Chromium.
// Run: node scripts/figure/pose-browser-qa.mjs --phase=before|after
// Optional: --only=welcome --width=390 --theme=light --motion=normal --probe-ms=10000.
// Decorative mounts rotate through a QA-only renderer override; product controls are unchanged.
// Screenshots and reports stay in the git-ignored .e6-tmp/C-POSE/screenshots folder.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer, preview } from 'vite';

const root = resolve(import.meta.dirname, '../..');
const phase = process.argv.find((arg) => arg.startsWith('--phase='))?.slice(8) ?? 'before';
if (!['before', 'after'].includes(phase)) throw Error('Use --phase=before or --phase=after');
const workerError = process.argv.includes('--worker-error');
const fallback = process.argv.includes('--fallback') || workerError;
const reducedMotion = !process.argv.includes('--motion=normal');
const stressFirst60 = process.argv.includes('--stress-first60');
const frontOnly = process.argv.includes('--views=front');
const frontSide = process.argv.includes('--views=front,side');
const head = process.argv.includes('--head');
const built = process.argv.includes('--built');
const headViews = process.argv.includes('--views=front,side,oblique45');
const headModes = process.argv.find((arg) => arg.startsWith('--head-modes='))?.slice(13).split(',') ?? ['context', 'skin'];
if (headModes.some((mode) => !['context', 'skin'].includes(mode))) throw Error('Unsupported head layer mode');
const vatModes = process.argv.includes('--vat-only') ? ['solo'] : process.argv.includes('--layer=visceralFat') ? ['context', 'solo'] : [];
const expectVatRemoved = process.argv.includes('--expect-vat-removed');
const assetDir = process.argv.find((arg) => arg.startsWith('--asset-dir='))?.slice(12);
const sourceDir = process.argv.find((arg) => arg.startsWith('--source-dir='))?.slice(13);
const samples = process.argv.find((arg) => arg.startsWith('--samples='))?.slice(10).split(',') ?? ['neutral'];
if (samples.some((sample) => !['neutral', 'fat', 'muscle'].includes(sample))) throw Error('Unsupported body sample');
const probeMs = Number(process.argv.find((arg) => arg.startsWith('--probe-ms='))?.slice(11) ?? 1500);
if (!Number.isFinite(probeMs) || probeMs < 0 || probeMs > 30000) throw Error('Unsupported probe duration');
const out = resolve(process.argv.find((arg) => arg.startsWith('--output-dir='))?.slice(13) ?? resolve(root, '.e6-tmp/C-POSE/screenshots', phase, ...(fallback ? ['fallback'] : []), ...(!reducedMotion ? ['normal-motion'] : [])));
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);
if (built && (only !== 'dev' || sourceDir)) throw Error('Built QA supports --only=dev without source overrides');
const requestedWidth = process.argv.find((arg) => arg.startsWith('--width='))?.slice(8);
const requestedTheme = process.argv.find((arg) => arg.startsWith('--theme='))?.slice(8);
const widths = requestedWidth ? [Number(requestedWidth)] : [390, 768, 1440];
const themes = requestedTheme ? [requestedTheme] : ['light', 'dark'];
if (widths.some((width) => ![390, 768, 1440].includes(width)) || themes.some((theme) => !['light', 'dark'].includes(theme))) throw Error('Unsupported width or theme');
const report = { phase, fallback, workerError, reducedMotion, assets: {}, motion: [], captures: [], skipped: [], errors: [] };
let server;
let browser;

async function ready(page, selector) {
  const figure = page.locator(selector);
  const renderer = fallback ? 'svg' : 'webgl';
  await page.locator(`${selector}.lm-fig3d[data-renderer="${renderer}"], ${selector} .lm-fig3d[data-renderer="${renderer}"]`).first().waitFor({ timeout: 30000 });
  if (fallback) return { figure, canvas: null };
  const canvas = figure.locator('canvas').first();
  await canvas.waitFor({ state: 'visible' });
  await page.waitForFunction((sel) => Number(document.querySelector(`${sel} canvas`)?.dataset.draws ?? 0) > 0, selector);
  await page.waitForFunction((sel) => document.querySelector(`${sel} canvas`)?.dataset.anatomyPending !== 'true', selector);
  return { figure, canvas };
}

async function capture(page, mount, width, theme, view, selector) {
  const { figure, canvas } = await ready(page, selector);
  const stage = figure.locator('.lm-fig3d__stage').first();
  const file = `${mount}-${width}-${theme}-${view}.png`;
  const box = await stage.boundingBox();
  const clip = head && box ? { x: box.x + box.width * 0.28, y: box.y + box.height * 0.01, width: box.width * 0.44, height: box.height * 0.37 } : null;
  const shot = clip
    ? await page.screenshot({ path: resolve(out, file), clip, animations: 'disabled' })
    : await stage.screenshot({ path: resolve(out, file), animations: 'disabled' });
  const glErrors = canvas ? await canvas.evaluate((element) => {
    const gl = element.getContext('webgl2');
    const errors = [];
    if (!gl) return errors;
    for (let n = 0; n < 16; n++) {
      const error = gl.getError();
      if (error === gl.NO_ERROR) break;
      errors.push(error);
    }
    return errors;
  }) : [];
  if (glErrors.length) report.errors.push(`${mount} ${width} ${theme} ${view}: WebGL errors ${glErrors.join(', ')}`);
  report.captures.push({ mount, width, theme, view, file, sha256: createHash('sha256').update(shot).digest('hex'), stage: box && { width: box.width, height: box.height }, ...(clip ? { headCrop: clip } : {}), angleRad: canvas ? await canvas.getAttribute('data-angle-rad') : null, glErrors, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2) });
}

async function captureDecorativeAngles(page, mount, width, theme, selector) {
  const { canvas } = await ready(page, selector);
  if (!canvas) return capture(page, mount, width, theme, 'front', selector);
  if (frontOnly) return capture(page, mount, width, theme, 'front', selector);
  if (reducedMotion) {
    const first = Number(await canvas.getAttribute('data-angle-rad'));
    await page.waitForTimeout(220);
    const second = Number(await canvas.getAttribute('data-angle-rad'));
    if (Math.abs(second - first) > 0.0001) report.errors.push(`${mount} ${width} ${theme}: reduced-motion decorative figure rotated`);
  } else {
    const first = Number(await canvas.getAttribute('data-draws'));
    await page.waitForTimeout(probeMs);
    const second = Number(await canvas.getAttribute('data-draws'));
    const figure = page.locator(`${selector}.lm-fig3d, ${selector} .lm-fig3d`).first();
    const result = { mount, width, theme, probeMs, drawsDuringProbe: second - first, drawsTotal: second, renderer: await figure.getAttribute('data-renderer') };
    if (mount === 'welcome' && stressFirst60 && result.renderer === 'webgl' && second < 60) {
      const advanced = await page.evaluate(async (sel) => {
        const canvas = document.querySelector(`${sel} canvas`);
        const root = document.documentElement;
        for (let attempt = 0; attempt < 65 && Number(canvas?.dataset.draws ?? 0) < 60; attempt++) {
          root.setAttribute('data-theme', root.getAttribute('data-theme') ?? 'light');
          await new Promise((done) => requestAnimationFrame(done));
        }
        return Number(canvas?.dataset.draws ?? 0);
      }, selector);
      result.drawsAfter60Probe = advanced;
      await page.waitForTimeout(300);
      result.rendererAfter60Probe = await figure.getAttribute('data-renderer');
    }
    report.motion.push(result);
    if (result.renderer !== 'webgl' || (result.drawsAfter60Probe && result.rendererAfter60Probe !== 'webgl')) {
      report.errors.push(`${mount} ${width} ${theme}: WebGL fell back during normal motion probe`);
      return;
    }
  }
  await page.evaluate(async () => {
    const { FigureRenderer } = await import('/src/features/body/figure3d/renderer.ts');
    const prototype = FigureRenderer.prototype;
    if (prototype.__poseQaOriginalDraw) return;
    prototype.__poseQaOriginalDraw = prototype.draw;
    prototype.draw = function (frame) {
      frame.angleRad = window.__poseQaAngle;
      return prototype.__poseQaOriginalDraw.call(this, frame);
    };
  });
  const hashes = [];
  for (const [view, angle] of (headViews ? [['front', 0], ['oblique45', Math.PI / 4], ['side', Math.PI / 2]] : frontSide ? [['front', 0], ['side', Math.PI / 2]] : [['front', 0], ['side', Math.PI / 2], ['back', Math.PI]])) {
    const before = await page.evaluate(({ selector, angle }) => {
      const canvas = document.querySelector(`${selector} canvas`);
      const count = Number(canvas.dataset.draws ?? 0);
      window.__poseQaAngle = angle;
      const root = document.documentElement;
      root.setAttribute('data-theme', root.getAttribute('data-theme') ?? 'light');
      return count;
    }, { selector, angle });
    await page.waitForFunction(({ selector, before }) => Number(document.querySelector(`${selector} canvas`)?.dataset.draws ?? 0) > before, { selector, before });
    await capture(page, mount, width, theme, view, selector);
    hashes.push(report.captures.at(-1).sha256);
  }
  if (new Set(hashes).size !== 3) report.errors.push(`${mount} ${width} ${theme}: QA-only view override did not change all three images`);
}

async function captureAngles(page, mount, width, theme, selector) {
  const { canvas, figure } = await ready(page, selector);
  if (!canvas) return capture(page, mount, width, theme, 'front', selector);
  if (frontOnly) return capture(page, mount, width, theme, 'front', selector);
  if (reducedMotion) {
    const first = Number(await canvas.getAttribute('data-angle-rad'));
    await page.waitForTimeout(220);
    const second = Number(await canvas.getAttribute('data-angle-rad'));
    if (Math.abs(second - first) > 0.0001) report.errors.push(`${mount} ${width} ${theme}: reduced-motion figure rotated`);
  } else {
    const first = Number(await canvas.getAttribute('data-draws'));
    const angleBefore = Number(await canvas.getAttribute('data-angle-rad'));
    await page.waitForTimeout(probeMs);
    const second = Number(await canvas.getAttribute('data-draws'));
    const angleAfter = Number(await canvas.getAttribute('data-angle-rad'));
    report.motion.push({ mount, width, theme, probeMs, drawsDuringProbe: second - first, angleChangeRad: angleAfter - angleBefore, renderer: await page.locator(`${selector}.lm-fig3d, ${selector} .lm-fig3d`).first().getAttribute('data-renderer') });
  }
  const pause = figure.getByRole('button', { name: 'Pause turning' });
  if (await pause.count()) await pause.click();
  await canvas.focus();
  for (const [view, turns] of (headViews ? [['front', 0], ['oblique45', 6], ['side', 6]] : frontSide ? [['front', 0], ['side', 12]] : [['front', 0], ['side', 12], ['back', 12]])) {
    for (let n = 0; n < turns; n++) await canvas.press('ArrowRight');
    await capture(page, mount, width, theme, view, selector);
  }
}

async function dev(page, width, theme, base) {
  await page.goto(`${base}/dev/figure?theme=${theme}`);
  const selector = '.lm-devfig__fig';
  for (const sample of samples) {
    await page.locator('.lm-devfig__controls select').selectOption({ neutral: 'c', fat: 'd', muscle: 'b' }[sample]);
    if (head) {
      await ready(page, selector);
      const figure = page.locator(selector);
      const setLayer = async (name, enabled) => {
        const button = figure.locator('.lm-fig3d__layers button').filter({ hasText: name }).first();
        if ((await button.getAttribute('aria-pressed')) === String(enabled)) return;
        await button.evaluate((element) => element.click());
        await page.waitForFunction(({ name, enabled }) =>
          [...document.querySelectorAll('.lm-devfig__fig .lm-fig3d__layers button')].some((button) => button.textContent.trim() === name && button.getAttribute('aria-pressed') === String(enabled)),
        { name, enabled });
      };
      for (const mode of headModes) {
        await setLayer('Skin', true);
        await setLayer('Fat under skin', mode === 'context');
        await setLayer('Muscles', mode === 'context');
        await setLayer('Bones', mode === 'context');
        await captureAngles(page, `head-${mode}-${sample}`, width, theme, selector);
        const canvas = figure.locator('canvas').first();
        await canvas.focus();
        for (let n = 0; n < 12; n++) await canvas.press('ArrowLeft');
      }
    } else if (expectVatRemoved) {
      await ready(page, selector);
      const figure = page.locator(selector);
      const labels = (await figure.locator('.lm-fig3d__layers button').allTextContents()).map((label) => label.trim());
      const expected = ['Skin', 'Fat under skin', 'Muscles', 'Bones'];
      if (JSON.stringify(labels) !== JSON.stringify(expected)) report.errors.push(`3D VAT layer was not removed: ${JSON.stringify(labels)}`);
      const explanatory = figure.locator('.lm-fig3d__visceral');
      if (!(await explanatory.isVisible()) || !/fat around the organs|visceral fat/i.test(await explanatory.textContent())) {
        report.errors.push('Numeric and 2D VAT explanation is missing');
      }
      if (sample === 'neutral' && width === 1440 && theme === 'light') {
        await figure.locator('details').first().evaluate((details) => { details.open = true; });
        await page.screenshot({ path: resolve(out, 'vat-removed-controls-1440-light.png'), fullPage: true, animations: 'disabled' });
      }
      await captureAngles(page, `vat-removed-${sample}`, width, theme, selector);
      if (frontSide) {
        const canvas = figure.locator('canvas').first();
        await canvas.focus();
        for (let n = 0; n < 12; n++) await canvas.press('ArrowLeft');
      }
    } else if (vatModes.length) {
      await ready(page, selector);
      const figure = page.locator(selector);
      const setLayer = async (name, enabled) => {
        const button = figure.locator('.lm-fig3d__layers button').filter({ hasText: name }).first();
        if ((await button.getAttribute('aria-pressed')) === String(enabled)) return;
        await button.evaluate((element) => element.click());
        await page.waitForFunction(({ name, enabled }) =>
          [...document.querySelectorAll('.lm-devfig__fig .lm-fig3d__layers button')].some((button) => button.textContent.trim() === name && button.getAttribute('aria-pressed') === String(enabled)),
        { name, enabled });
      };
      await setLayer('Fat under skin', false);
      await setLayer('Muscles', false);
      await setLayer('Bones', false);
      await setLayer('Fat around organs (estimate)', true);
      for (const mode of vatModes) {
        await setLayer('Skin', mode === 'context');
        await page.waitForTimeout(120);
        await captureAngles(page, `vat-${mode}-${sample}`, width, theme, selector);
        if (frontSide) {
          const canvas = figure.locator('canvas').first();
          await canvas.focus();
          for (let n = 0; n < 12; n++) await canvas.press('ArrowLeft');
        }
      }
    } else {
      await captureAngles(page, sample === 'neutral' ? 'dev' : `dev-${sample}`, width, theme, selector);
    }
  }
}

async function welcome(page, width, theme, base) {
  await page.goto(`${base}/welcome?theme=${theme}`);
  await captureDecorativeAngles(page, 'welcome', width, theme, '.lm-onb-stage__figure');
}

async function seedBody(page) {
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
}

async function body(page, width, theme, base) {
  await page.goto(`${base}/dev/figure?theme=${theme}`);
  await page.locator('.lm-devfig h1').waitFor();
  await seedBody(page);
  await page.goto(`${base}/body?theme=${theme}`);
  await captureAngles(page, 'body', width, theme, '.lm-body-stage');
}

async function componentMount(page, mount, width, theme, base) {
  await page.goto(`${base}/dev/figure?theme=${theme}`);
  await page.locator('.lm-devfig h1').waitFor();
  await seedBody(page);
  await page.evaluate(async (kind) => {
    const reactModule = await import('/node_modules/.vite/deps/react.js');
    const React = reactModule.default ?? reactModule;
    const domModule = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createRoot = domModule.createRoot ?? domModule.default.createRoot;
    const host = document.createElement('div');
    host.id = 'pose-mount';
    host.style.cssText = 'position:fixed;z-index:10000;inset:0;display:flex;align-items:center;justify-content:center;background:var(--lm-chassis);overflow:auto';
    document.body.append(host);
    let component;
    if (kind === 'plan') {
      const [{ PlanFigure }, { fixtureSimulation, PROFILE }, { resolveProfile }] = await Promise.all([
        import('/src/features/planner/components/PlanFigure.tsx'),
        import('/src/features/planner/__tests__/fixtures.ts'),
        import('/src/engine/index.ts'),
      ]);
      component = React.createElement(PlanFigure, { start: resolveProfile(PROFILE).body, sim: fixtureSimulation(22), planTitle: 'Sample', size: 'sm' });
    } else if (kind === 'simulator') {
      const [{ FigureOverTime }, { buildResultsData }, { bodyTimeline }, { DAYS, SCHEDULE, engineResult, resolved }, { ChartController }] = await Promise.all([
        import('/src/features/simulator/results/components/FigureOverTime.tsx'),
        import('/src/features/simulator/results/lib/adapt.ts'),
        import('/src/features/simulator/results/lib/bodyState.ts'),
        import('/src/features/simulator/results/__tests__/fixture.ts'),
        import('/src/features/charts/index.ts'),
      ]);
      await import('/src/features/simulator/results/results.css');
      const result = engineResult();
      const { rp, compiled } = resolved();
      const adapted = buildResultsData({ result, bands: null, schedule: SCHEDULE, compiled }, { units: 'metric', energyUnit: 'kcal', glucoseUnit: 'mmol' });
      const controller = new ChartController(DAYS);
      component = React.createElement(FigureOverTime, { timeline: bodyTimeline(result, rp.body), data: adapted.data, controller, showFigure: true, units: 'metric' });
      host.style.padding = '20px';
    } else if (kind === 'mini') {
      const [{ MiniFigure }, { resolveProfile }, { PROFILE }, { stateToAvatarParams }] = await Promise.all([
        import('/src/features/body/components/Setup.tsx'),
        import('/src/engine/index.ts'),
        import('/src/features/planner/__tests__/fixtures.ts'),
        import('/src/engine/body/index.ts'),
      ]);
      await import('/src/features/body/body.css');
      component = React.createElement(MiniFigure, { params: stateToAvatarParams(resolveProfile(PROFILE).body), frame: 0.5, visible: true, onReturn: () => {} });
    }
    createRoot(host).render(component);
  }, mount);
  const selector = mount === 'plan' ? '#pose-mount .lp-card__figure' : mount === 'simulator' ? '#pose-mount .rs-figure__stage' : '#pose-mount .lm-body-mini__fig';
  if (mount === 'mini') await captureDecorativeAngles(page, mount, width, theme, selector);
  else await captureAngles(page, mount, width, theme, selector);
}

async function run() {
  await mkdir(out, { recursive: true });
  for (const name of ['figure-v2.bin', 'anatomy-v1.bin']) {
    report.assets[name] = createHash('sha256').update(await readFile(resolve(assetDir ?? resolve(root, 'public/figure'), name))).digest('hex');
  }
  server = built ? await preview({ root, preview: { port: 0 } }) : await createServer({ root, server: { port: 0, hmr: false }, plugins: sourceDir ? [{
    name: 'figure-qa-baseline', enforce: 'pre',
    async load(id) {
      for (const file of ['Figure3DCanvas.tsx', 'anatomyPose.ts'])
        if (id.split('?')[0] === resolve(root, 'src/features/body/figure3d', file))
          return readFile(resolve(sourceDir, file), 'utf8');
    },
  }] : [] });
  if (!built) await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--no-sandbox'],
  });
  for (const width of widths) for (const theme of themes) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 1150 : width === 768 ? 1500 : 900 }, deviceScaleFactor: head ? 2 : 1, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.message));
    if (assetDir) for (const name of ['figure-v2.bin', 'anatomy-v1.bin']) {
      await page.route(`**/figure/${name}`, (route) => route.fulfill({ path: resolve(assetDir, name), contentType: 'application/octet-stream' }));
    }
    if (workerError) await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        postMessage(message, transfer) {
          if (message?.type === 'place') throw new DOMException('Synthetic anatomy transfer failure', 'DataCloneError');
          super.postMessage(message, transfer);
        }
      };
    });
    else if (fallback) await page.addInitScript(() => Object.defineProperty(window, 'WebGL2RenderingContext', { value: undefined, configurable: true }));
    for (const [mount, fn] of [['dev', dev], ['welcome', welcome], ['body', body], ['plan', componentMount], ['simulator', componentMount], ['mini', componentMount]]) {
      if (only && only !== mount) continue;
      if (mount === 'mini' && width === 1440) {
        report.skipped.push({ mount, width, theme, reason: 'phone mini is hidden by the desktop breakpoint' });
        continue;
      }
      try { await (fn === componentMount ? fn(page, mount, width, theme, base) : fn(page, width, theme, base)); }
      catch (error) {
        const debug = `debug-${mount}-${width}-${theme}.png`;
        await page.screenshot({ path: resolve(out, debug), fullPage: true }).catch(() => {});
        const heading = await page.locator('h1').first().textContent().catch(() => null);
        report.errors.push(`${mount} ${width} ${theme}: ${error.message}; route=${new URL(page.url()).pathname}; heading=${heading}`);
      }
    }
    await context.close();
  }
  await writeFile(resolve(out, `${only ?? 'all'}-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Captured ${report.captures.length} views; ${report.errors.length} errors; ${out}`);
  if (report.errors.length) { console.error(report.errors.join('\n')); process.exitCode = 1; }
}

try { await run(); }
finally {
  await browser?.close();
  if (built && server) await new Promise((resolve) => server.httpServer.close(resolve));
  else await server?.close();
}
