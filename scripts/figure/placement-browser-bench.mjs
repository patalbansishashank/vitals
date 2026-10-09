// Exact placement and main-thread responsiveness at native/4x CPU in isolated Chromium.
// Run: node scripts/figure/placement-browser-bench.mjs [--source-dir=<ignored baseline>]
// Outputs only synthetic reference-body measurements into the ignored QA folder.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '../..');
const sourceDir = process.argv.find((arg) => arg.startsWith('--source-dir='))?.slice(13);
const output = resolve(process.argv.find((arg) => arg.startsWith('--output-dir='))?.slice(13) ?? '.e6-tmp/C-POSE/performance');
const server = await createServer({ root, server: { port: 0, hmr: false }, plugins: sourceDir ? [{
  name: 'figure-bench-baseline', enforce: 'pre',
  async load(id) {
    for (const file of ['Figure3DCanvas.tsx', 'anatomyPose.ts'])
      if (id.split('?')[0] === resolve(root, 'src/features/body/figure3d', file))
        return readFile(resolve(sourceDir, file), 'utf8');
  },
}] : [] });
let browser;
const report = { mode: sourceDir ? 'baseline' : 'worker', cpuThrottleScope: 'page main thread; dedicated worker is unthrottled', rates: [], errors: [] };
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor((sorted.length - 1) * 0.95)], max: sorted.at(-1), samples: values };
};
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--no-sandbox'] });
  for (const rate of [1, 4]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.goto(`${server.resolvedUrls.local[0]}dev/figure?theme=light`);
    await page.locator('.lm-devfig__fig[data-renderer="webgl"]').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.lm-devfig__fig canvas')?.dataset.anatomyPending !== 'true');
    const placement = await page.evaluate(async (baseline) => {
      const [{ loadAnatomy }, { AnatomyClient }, { placeAnatomy }, { loadScene }, { compositionFromParams }, { estimateInitialState, stateToAvatarParams }] = await Promise.all([
        import('/src/features/body/figure3d/anatomyAsset.ts'), import('/src/features/body/figure3d/anatomyClient.ts'),
        import('/src/features/body/figure3d/anatomyPose.ts'), import('/src/features/body/figure3d/Figure3DCanvas.tsx'),
        import('/src/features/body/figure3d/composition.ts'), import('/src/engine/body/index.ts'),
      ]);
      const asset = await loadAnatomy(), scene = await loadScene();
      const inputs = [0, 0.5, 1].map((frame) => {
        const params = stateToAvatarParams(estimateInitialState({ sex: 'male', ageYears: 40, heightCm: 178, weightKg: 82 }), { frame });
        const fitted = scene.fit(params, frame);
        return { skin: scene.place(fitted.state, params.heightCm).positions, heightCm: params.heightCm, frame, composition: compositionFromParams(params, frame) };
      });
      // Independent synchronous reference coordinates are outside measured worker/submit time.
      const expected = inputs.map((input) => placeAnatomy(asset, input.skin, input.heightCm, input.frame, input.composition));
      const rows = [], gaps = [];
      let last = performance.now();
      const heartbeat = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; }, 8);
      let failure;
      const client = baseline ? null : new AnatomyClient(asset, inputs[0].skin.length, (message) => { failure = message; });
      try {
        for (let i = 0; i < 15; i++) {
          const index = i % inputs.length, input = inputs[index];
          if (baseline) {
            const start = performance.now();
            placeAnatomy(asset, input.skin, input.heightCm, input.frame, input.composition);
            rows.push({ synchronousMs: performance.now() - start });
            await new Promise((resolve) => setTimeout(resolve, 0));
          } else {
            let submitMs;
            const start = performance.now();
            const reply = await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error(failure ?? 'Anatomy worker timed out')), 15000);
              client.place(input, (result) => { clearTimeout(timeout); resolve(result); });
              submitMs = performance.now() - start;
            });
            const roundTripMs = performance.now() - start;
            let maxDelta = 0;
            for (let k = 0; k < reply.positions.length; k++) maxDelta = Math.max(maxDelta, Math.abs(reply.positions[k] - expected[index][k]));
            rows.push({ submitMs, processingMs: reply.processingMs, roundTripMs, maxDeltaCm: maxDelta });
          }
        }
      } finally { client?.dispose(); clearInterval(heartbeat); }
      return { rows: rows.slice(3), heartbeatGapsMs: gaps }; // omit first-JIT/BVH warmup
    }, !!sourceDir);
    const commits = [];
    const slider = page.locator('.lm-devfig__controls input[type="range"]').first();
    for (const key of ['Home', 'End', 'Home', 'End', 'Home', 'End', 'Home', 'End']) {
      const before = await page.locator('.lm-devfig__fig canvas').getAttribute('data-draws');
      await slider.press(key);
      await page.waitForFunction((count) => {
        const canvas = document.querySelector('.lm-devfig__fig canvas');
        return Number(canvas?.dataset.draws ?? 0) > Number(count) && canvas?.dataset.anatomyPending !== 'true';
      }, before);
      commits.push(await page.locator('.lm-devfig__fig canvas').evaluate((canvas) => ({
        submitMs: Number(canvas.dataset.anatomySubmitMs ?? 0), commitMs: Number(canvas.dataset.anatomyCommitMs ?? 0),
        drawMs: Number(canvas.dataset.drawMs), workerMs: Number(canvas.dataset.anatomyWorkerMs ?? 0),
      })));
    }
    const main = commits.slice(2).map((row) => sourceDir ? row.drawMs : row.submitMs + row.commitMs);
    const summary = { rate, mainPlacementAndCommitMs: stats(main), standalone: placement,
      submitMs: sourceDir ? null : stats(placement.rows.map((row) => row.submitMs)),
      workerMs: sourceDir ? null : stats(placement.rows.map((row) => row.processingMs)),
      synchronousMs: sourceDir ? stats(placement.rows.map((row) => row.synchronousMs)) : null, commits };
    report.rates.push(summary);
    if (!sourceDir) {
      if (summary.mainPlacementAndCommitMs.p95 >= (rate === 1 ? 16 : 50)) report.errors.push(`${rate}x main placement/commit exceeds budget`);
      if (placement.rows.some((row) => row.maxDeltaCm !== 0)) report.errors.push(`${rate}x worker coordinates differ from exact placement`);
    }
    await context.close();
  }
} finally {
  await browser?.close(); await server.close();
  await writeFile(resolve(output, `${report.mode}-browser-bench.json`), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ mode: report.mode, rates: report.rates.map(({ rate, mainPlacementAndCommitMs, submitMs, workerMs, synchronousMs }) => ({ rate, mainPlacementAndCommitMs, submitMs, workerMs, synchronousMs })), errors: report.errors }, null, 2));
if (report.errors.length) process.exitCode = 1;
