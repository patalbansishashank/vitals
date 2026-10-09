// Synthetic slider benchmark in isolated Chromium; output stays in the ignored QA directory.
// Run: node scripts/figure/slider-drag-bench.mjs --phase=before|after [--seed=7] [--modes=skin,all]
// --built measures an ignored production build; the default runs Vite dev.
// --screenshots=capture records 12 compositor frames separately; --profile=true records CPU samples.
// --motion=normal keeps tweens and pauses turning so shape updates can settle.
// The baseline loads fixed git sources even while the working tree changes.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { build, createServer, preview } from 'vite';

const option = (name, fallback) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const phase = option('phase', 'after');
if (!['before', 'after'].includes(phase)) throw new Error('phase must be before or after');
const seed = Number(option('seed', '7'));
const motion = option('motion', 'reduce');
const built = process.argv.includes('--built') || option('built', 'false') === 'true';
const profileCpu = option('profile', 'false') === 'true';
const captureScreenshots = option('screenshots', 'none') === 'capture';
const root = resolve(import.meta.dirname, '../..');
const output = resolve(
  root,
  option(
    'output-dir',
    `.e6-tmp/C-SLIDER/${phase}/${built ? 'built-' : ''}${captureScreenshots ? 'visual' : 'timing'}${motion === 'normal' ? '-normal' : ''}`,
  ),
);
const prefix = 'src/features/body/figure3d/';
const baselineRef = option('baseline-ref', 'b43ee3cf');
const baselineFiles = ['Figure3DCanvas.tsx', 'anatomyClient.ts', 'anatomy.worker.ts'];
const baselineSources = new Map(
  baselineFiles.map((file) => [
    resolve(root, prefix, file),
    execFileSync('git', ['show', `${baselineRef}:${prefix}${file}`], { cwd: root, encoding: 'utf8' }),
  ]),
);
const instrumentation = `
const qaOriginalUpload = FigureRenderer.prototype.uploadMesh;
FigureRenderer.prototype.uploadMesh = function(mesh, positions, indices, revision) {
  const changed = mesh.source !== positions || mesh.revision !== revision;
  qaOriginalUpload.call(this, mesh, positions, indices, revision);
  if (changed) mesh.qaUploaded = positions.slice();
};
const qaOriginalDraw = FigureRenderer.prototype.draw;
FigureRenderer.prototype.draw = function(frame) {
  qaOriginalDraw.call(this, frame);
  if (!this.canvas.closest('.lm-devfig__fig')) return;
  const hash = (array) => {
    if (!array) return null;
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  const q = window.__sliderQA ??= { draws: [], inputs: [], latest: null };
  const record = { time: performance.now(), skin: hash(this.meshes[0].qaUploaded), anatomy: hash(frame.anatomy?.positions ? this.anatomy?.buffers.qaUploaded : null),
    core: hash(frame.core ? this.meshes[1].qaUploaded : null), revision: frame.geometryRevision, layers: frame.anatomy?.layers ?? null,
    weight: this.canvas.dataset.weight, pending: this.canvas.dataset.anatomyPending,
    input: document.querySelector('.lm-devfig__controls input[max="15"]')?.value };
  q.latest = record;
  q.latestPositions = this.meshes[0].qaUploaded.slice();
  q.latestAnatomy = frame.anatomy?.positions ? this.anatomy?.buffers.qaUploaded?.slice() : null;
  q.draws.push(record);
  queueMicrotask(() => {
    record.fitMs = Number(this.canvas.dataset.fitMs ?? NaN);
    record.devFitMs = parseFloat(this.canvas.closest('main')?.querySelector('.lm-devfig__stats tbody tr:last-child td')?.textContent ?? 'NaN');
    record.drawMs = Number(this.canvas.dataset.drawMs ?? 0);
    record.submitMs = Number(this.canvas.dataset.anatomySubmitMs ?? 0);
    record.commitMs = Number(this.canvas.dataset.anatomyCommitMs ?? 0);
    record.workerMs = Number(this.canvas.dataset.anatomyWorkerMs ?? 0);
  });
};
`;
const qaPlugin = () => ({
  name: 'slider-qa-fixed-baseline',
  enforce: 'pre',
  load(id) {
    if (phase === 'before') return baselineSources.get(id.split('?')[0]);
  },
  transform(code, id) {
    if (id.split('?')[0] === resolve(root, prefix, 'renderer.ts')) return `${code}\n${instrumentation}`;
  },
});
const buildDir = resolve(root, '.e6-tmp/C-SLIDER', `${phase}-build`);
let server;
let browser;
const sourceHashes = async () =>
  Object.fromEntries(
    await Promise.all(
      baselineFiles.map(async (file) => [
        prefix + file,
        createHash('sha256')
          .update(
            phase === 'before'
              ? baselineSources.get(resolve(root, prefix, file))
              : await readFile(resolve(root, prefix, file)),
          )
          .digest('hex'),
      ]),
    ),
  );
const report = {
  phase,
  runtime: built ? 'production build/preview' : 'Vite dev',
  seed,
  baselineRef,
  sourceHashes: await sourceHashes(),
  baselineSourceHashes: Object.fromEntries(
    [...baselineSources].map(([path, source]) => [
      path.slice(root.length + 1),
      createHash('sha256').update(source).digest('hex'),
    ]),
  ),
  measurement:
    'FNV1a over exact rendered skin/anatomy Float32 bytes after FigureRenderer.draw; screenshots observe the compositor independently',
  motion,
  screenshotMode: captureScreenshots ? 'separate visual capture' : 'none (clean timing)',
  durationMs: 2000,
  rows: [],
  errors: [],
  consoleErrors: [],
};
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function setup(mode) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 1000 },
    reducedMotion: motion === 'normal' ? 'no-preference' : 'reduce',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  await page.goto(
    new URL('dev/figure?theme=light&h=176&w=86&bf=28&frame=1', server.resolvedUrls.local[0]).href,
  );
  await page.locator('.lm-devfig__fig[data-renderer="webgl"]').waitFor({ timeout: 60000 });
  await page.waitForFunction(
    () =>
      window.__sliderQA?.latest &&
      document.querySelector('.lm-devfig__fig canvas')?.dataset.anatomyPending !== 'true',
    null,
    { timeout: 60000 },
  );
  report.renderer ??= await page.locator('.lm-devfig__fig canvas').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2');
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  });
  if (motion === 'normal')
    await page.locator('.lm-devfig__fig').getByRole('button', { name: 'Pause turning', exact: true }).click();
  if (mode === 'skin')
    for (const name of ['Fat under skin', 'Muscles', 'Bones'])
      await page.locator('.lm-devfig__fig').getByRole('button', { name, exact: true }).click();
  await pause(1000);
  await page.evaluate(() => {
    const input = document.querySelector('.lm-devfig__controls input[max="15"]');
    input.addEventListener('input', () =>
      window.__sliderQA.inputs.push({ time: performance.now(), value: input.value }),
    );
    window.__sliderQA.draws = [];
    window.__sliderQA.inputs = [];
  });
  return { context, page };
}
async function setValue(page, value) {
  await page.evaluate((value) => {
    const input = document.querySelector('.lm-devfig__controls input[max="15"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function settled(page) {
  await page.waitForFunction(
    () => {
      const q = window.__sliderQA,
        canvas = document.querySelector('.lm-devfig__fig canvas');
      return (
        q?.latest &&
        canvas &&
        document.querySelector('.lm-devfig__fig')?.dataset.renderer === 'webgl' &&
        canvas.dataset.anatomyPending !== 'true' &&
        performance.now() - q.latest.time > 700
      );
    },
    null,
    { timeout: 30000 },
  );
}
try {
  await mkdir(output, { recursive: true });
  if (built) {
    await build({
      root,
      logLevel: 'error',
      plugins: [qaPlugin()],
      worker: { plugins: () => [qaPlugin()] },
      build: { outDir: buildDir, emptyOutDir: true },
    });
    server = await preview({ root, build: { outDir: buildDir }, preview: { port: 5360, strictPort: true } });
  } else {
    server = await createServer({
      root,
      server: { port: 5360, strictPort: true, hmr: false },
      plugins: [qaPlugin()],
    });
    await server.listen();
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-webgl',
      '--disable-gpu-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--no-sandbox',
    ],
  });
  for (const mode of option('modes', 'skin,all').split(',')) {
    const direct = await setup(mode);
    await setValue(direct.page, 15);
    await settled(direct.page);
    if (captureScreenshots)
      await direct.page.screenshot({ path: resolve(output, `${mode}-direct-settled.png`) });
    const directState = await direct.page.evaluate(() => ({
      skin: window.__sliderQA.latest.skin,
      anatomy: window.__sliderQA.latest.anatomy,
      core: window.__sliderQA.latest.core,
      positions: Array.from(window.__sliderQA.latestPositions),
    }));
    await direct.context.close();
    for (const intervalMs of option('intervals', '50,100,200,400').split(',').map(Number)) {
      const { context, page } = await setup(mode);
      await setValue(page, -15);
      await settled(page);
      await page.evaluate(() => {
        window.__sliderQA.draws = [];
        window.__sliderQA.inputs = [];
        window.__sliderQA.start = performance.now();
        window.__sliderQA.wallStart = Date.now();
        window.__sliderQA.initial = window.__sliderQA.latest.skin;
        window.__sliderQA.initialValue = document.querySelector('.lm-devfig__controls input[max="15"]').value;
      });
      const screenshotRows = [],
        capturedFrames = [];
      const captureSession = captureScreenshots ? await context.newCDPSession(page) : null;
      if (captureSession) {
        captureSession.on('Page.screencastFrame', (frame) => {
          capturedFrames.push(frame);
          void captureSession.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
        });
        await captureSession.send('Page.startScreencast', {
          format: 'png',
          maxWidth: 1200,
          maxHeight: 1000,
          everyNthFrame: 1,
        });
      }
      const profileSession = profileCpu ? await context.newCDPSession(page) : null;
      if (profileSession) {
        await profileSession.send('Profiler.enable');
        await profileSession.send('Profiler.setSamplingInterval', { interval: 2000 });
        await profileSession.send('Profiler.start');
      }
      // Dispatch inside the page to avoid automation round-trip cadence changing the input rate.
      await page.evaluate(
        async ({ intervalMs, seed }) => {
          const input = document.querySelector('.lm-devfig__controls input[max="15"]');
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
          const start = performance.now();
          let i = 0;
          while (performance.now() - start < 2000) {
            const t = (performance.now() - start) / 2000;
            // A repeatable zigzag catches stale responses as well as monotonic drag behavior.
            const value = i === 0 ? -14 : Math.round(-15 + 30 * t + Math.sin((i + seed) * 0.9) * 3);
            setter.call(input, String(Math.max(-15, Math.min(15, value))));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            i++;
            await new Promise((done) =>
              setTimeout(done, Math.max(0, start + i * intervalMs - performance.now())),
            );
          }
          setter.call(input, '15');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          window.__sliderQA.release = performance.now();
          window.__sliderQA.wallRelease = Date.now();
          input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
        },
        { intervalMs, seed },
      );
      if (captureSession) await captureSession.send('Page.stopScreencast');
      if (profileSession) {
        const { profile } = await profileSession.send('Profiler.stop');
        await writeFile(resolve(output, `${mode}-${intervalMs}-cpu-profile.json`), JSON.stringify(profile));
      }
      await settled(page);
      if (captureScreenshots)
        await page.screenshot({ path: resolve(output, `${mode}-${intervalMs}-drag-settled.png`) });
      const data = await page.evaluate((expected) => {
        const q = window.__sliderQA;
        const unique = [],
          seen = new Set([q.initial]);
        let previous = q.initial;
        for (const draw of q.draws) {
          if (draw.skin !== previous) unique.push(draw);
          previous = draw.skin;
          seen.add(draw.skin);
        }
        const during = unique.filter((draw) => draw.time <= q.release);
        const visible = q.draws.filter(
          (draw) => draw.layers && (draw.layers.muscles || draw.layers.skeleton) && draw.anatomy,
        );
        const stalePairs = visible
          .slice(1)
          .filter((draw, i) => draw.skin !== visible[i].skin && draw.anatomy === visible[i].anatomy);
        const firstChangedInput = q.inputs.find((input) => input.value !== q.initialValue);
        const cadence = q.inputs.slice(1).map((input, i) => input.time - q.inputs[i].time);
        const finalMatches = (draw) =>
          draw.skin === q.latest.skin &&
          draw.core === q.latest.core &&
          draw.anatomy === q.latest.anatomy &&
          JSON.stringify(draw.layers) === JSON.stringify(q.latest.layers);
        const finalDraw =
          q.draws.find((draw) => finalMatches(draw) && draw.time >= q.release) ?? q.draws.find(finalMatches);
        let maxDelta = 0;
        for (let i = 0; i < expected.positions.length; i++)
          maxDelta = Math.max(maxDelta, Math.abs(expected.positions[i] - q.latestPositions[i]));
        return {
          start: q.start,
          wallStart: q.wallStart,
          wallRelease: q.wallRelease,
          initialSkin: q.initial,
          initialValue: q.initialValue,
          release: q.release,
          inputs: q.inputs,
          actualInputCadenceMs: cadence,
          inputCount: q.inputs.length,
          draws: q.draws,
          distinctDuringDrag: during.length,
          globallyUniqueSkinHashes: seen.size,
          changesPerSecond: during.length / ((q.release - q.start) / 1000),
          firstUpdateMs: unique[0] ? unique[0].time - (firstChangedInput?.time ?? q.start) : null,
          firstUpdateFromPointerDownMs: unique[0] ? unique[0].time - q.start : null,
          releaseToSettleMs: finalDraw ? Math.max(0, finalDraw.time - q.release) : null,
          visibleAnatomyDraws: visible.length,
          reusedAnatomyUnderChangedSkin: stalePairs,
          finalSkin: q.latest.skin,
          finalAnatomy: q.latest.anatomy,
          finalCore: q.latest.core,
          directSkin: expected.skin,
          directAnatomy: expected.anatomy,
          directCore: expected.core,
          maxDeltaCm: maxDelta,
          missingAnatomyDraws: q.draws.filter(
            (d) => d.layers && (d.layers.muscles || d.layers.skeleton) && !d.anatomy,
          ).length,
        };
      }, directState);
      const duringFrames = capturedFrames.filter(
        (frame) =>
          frame.metadata.timestamp * 1000 >= data.wallStart &&
          frame.metadata.timestamp * 1000 <= data.wallRelease,
      );
      const selectedFrames =
        duringFrames.length <= 12
          ? duringFrames
          : Array.from(
              { length: 12 },
              (_, i) => duringFrames[Math.floor((i * (duringFrames.length - 1)) / 11)],
            );
      for (let i = 0; i < selectedFrames.length; i++) {
        const frame = selectedFrames[i],
          pixels = Buffer.from(frame.data, 'base64');
        await writeFile(
          resolve(output, `${mode}-${intervalMs}-drag-${String(i).padStart(2, '0')}.png`),
          pixels,
        );
        screenshotRows.push({
          index: i,
          elapsedMs: frame.metadata.timestamp * 1000 - data.wallStart,
          bytesHash: createHash('sha256').update(pixels).digest('hex'),
        });
      }
      for (const screenshot of screenshotRows)
        screenshot.latestCompletedDraw =
          [...data.draws].reverse().find((draw) => draw.time <= data.start + screenshot.elapsedMs) ?? null;
      const row = {
        mode,
        intervalMs,
        ...data,
        screenshots: screenshotRows,
        compositorFramesDuringDrag: duringFrames.length,
      };
      row.targets = {
        changesPerSecond: intervalMs <= 100 ? 6 : null,
        maximumInputRate: 1000 / intervalMs,
        firstUpdateMs: 300,
        releaseToSettleMs: 500,
        maxDeltaCm: 0,
      };
      row.targetFailures = [
        ...(row.targets.changesPerSecond !== null && row.changesPerSecond < row.targets.changesPerSecond
          ? ['rendered shape cadence']
          : []),
        ...(row.firstUpdateMs === null || row.firstUpdateMs >= 300 ? ['first rendered shape latency'] : []),
        ...(row.releaseToSettleMs === null || row.releaseToSettleMs >= 500
          ? ['release-to-settle latency']
          : []),
        ...(row.maxDeltaCm !== 0 ? ['exact direct-set determinism'] : []),
        ...(row.finalAnatomy !== row.directAnatomy ? ['exact direct-set anatomy determinism'] : []),
        ...(row.finalCore !== row.directCore ? ['exact direct-set inner-shell determinism'] : []),
      ];
      report.rows.push(row);
      await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      console.log(
        JSON.stringify({
          phase,
          mode,
          intervalMs,
          changesPerSecond: row.changesPerSecond,
          firstUpdateMs: row.firstUpdateMs,
          releaseToSettleMs: row.releaseToSettleMs,
          maxDeltaCm: row.maxDeltaCm,
          missingAnatomyDraws: row.missingAnatomyDraws,
        }),
      );
      await context.close();
    }
  }
} catch (error) {
  report.errors.push(error.stack);
  process.exitCode = 1;
} finally {
  report.finalSourceHashes = await sourceHashes();
  await browser?.close();
  if (built && server) await new Promise((done) => server.httpServer.close(done));
  else await server?.close();
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
let comparison;
if (phase === 'after') {
  const beforePath = resolve(
    root,
    option(
      'before-report',
      `.e6-tmp/C-SLIDER/before/${built ? 'built-' : ''}timing${motion === 'normal' ? '-normal' : ''}/report.json`,
    ),
  );
  try {
    const before = JSON.parse(await readFile(beforePath, 'utf8'));
    comparison = report.rows.map((row) => {
      const old = before.rows.find(
        (candidate) => candidate.mode === row.mode && candidate.intervalMs === row.intervalMs,
      );
      return {
        mode: row.mode,
        intervalMs: row.intervalMs,
        beforeHz: old?.changesPerSecond ?? null,
        afterHz: row.changesPerSecond,
        beforeFirstMs: old?.firstUpdateMs ?? null,
        afterFirstMs: row.firstUpdateMs,
        beforeSettleMs: old?.releaseToSettleMs ?? null,
        afterSettleMs: row.releaseToSettleMs,
        beforeDeltaCm: old?.maxDeltaCm ?? null,
        afterDeltaCm: row.maxDeltaCm,
        failures: row.targetFailures,
      };
    });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
console.log(
  JSON.stringify({
    phase,
    runtime: report.runtime,
    rows: report.rows.length,
    errors: report.errors,
    consoleErrors: report.consoleErrors,
    comparison,
  }),
);
