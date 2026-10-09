// Screenshots of exact slider states for the shape-smoothness work: skin only, fat only and all layers, at several
// angles, both themes, with a belly close-up crop. Pass --base for this task's dev server.
// Run: node scripts/figure/morph-shots.mjs --base=<dev-url> --out=<folder> [--quick] [--baseline=<commit>]
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = resolve(arg('out', '.e6-tmp/C-FIX/shots/before'));
const base = arg('base', process.env.FIGURE_BASE);
if (!base) throw new Error('Pass --base for the task dev server');
const quick = process.argv.includes('--quick');
const only = arg('only', null);
const baseline = arg('baseline', null);
const stressOnly = process.argv.includes('--stress-only');
const zoomClicks = Number(arg('zoom', '2'));
const stagePx = Number(arg('stage', '1000'));
await mkdir(out, { recursive: true });

// The owner's report: male frame, body fat 57.4 %, upper muscle "as expected", lower "much less than expected".
const OWNER = { sex: 'male', h: 176, w: 86, bf: 57.4, mu: 0.42, ml: 0.05, frame: 1 };
const states = [
  { id: 'owner', ...OWNER },
  ...(quick
    ? []
    : [45, 50, 57.4, 65, 75].flatMap((bf) =>
        [-1, 1].flatMap((belly) => [
          { id: `male-bf${bf}-belly${belly}`, sex: 'male', h: 176, w: 86, bf, belly, stress: 1, frame: 1 },
          {
            id: `female-bf${bf}-belly${belly}`,
            sex: 'female',
            h: 164,
            w: 70,
            bf,
            belly,
            stress: 1,
            frame: 0,
          },
        ]),
      )),
].filter((s) => (!only || s.id === only) && (!stressOnly || s.bf > 60));
const layerSets = quick ? [['skin'], ['fat']] : [['skin'], ['fat'], ['skin', 'fat', 'muscles', 'bones']];
const LAYER_NAMES = { skin: 'Skin', fat: 'Fat under skin', muscles: 'Muscles', bones: 'Bones' };
const views = quick
  ? [['side', Math.PI / 2]]
  : [
      ['front', 0],
      ['oblique45', Math.PI / 4],
      ['side', Math.PI / 2],
      ['back', Math.PI],
    ];
const themesFor = () => (quick ? ['dark'] : ['dark', 'light']);

const browser = await chromium.launch({
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
const report = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1400 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  // Compare against a committed evaluator and pack without changing files or touching another worktree/server.
  if (baseline) {
    const revision = execFileSync('git', ['rev-parse', '--verify', `${baseline}^{commit}`], {
      encoding: 'utf8',
    }).trim();
    const files = ['model.ts', 'fit.ts', 'subcutaneousShell.ts'];
    await page.route('**/*', async (route) => {
      const path = new URL(route.request().url()).pathname.slice(1);
      if (path === 'figure/figure-v2.bin') {
        const body = execFileSync('git', ['show', `${revision}:public/${path}`], { maxBuffer: 10_000_000 });
        return route.fulfill({ contentType: 'application/octet-stream', body });
      }
      if (!files.some((f) => path === `src/features/body/figure3d/${f}`)) return route.continue();
      const source = execFileSync('git', ['show', `${revision}:${path}`], { encoding: 'utf8' });
      let body = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
      body = body.replace(/from (['"])([.@][^'"]+)\1/g, (_match, quote, specifier) => {
        const target = specifier.startsWith('@/')
          ? resolve('src', specifier.slice(2))
          : resolve(dirname(path), specifier);
        const file = [target, `${target}.ts`, `${target}/index.ts`].find(existsSync);
        if (!file) throw new Error(`Unresolved baseline import ${specifier}`);
        return `from ${quote}/${file.slice(resolve('.').length + 1)}${quote}`;
      });
      return route.fulfill({ contentType: 'text/javascript', body });
    });
  }
  page.on('pageerror', (e) => report.push({ error: String(e) }));
  for (const state of states) {
    for (const theme of themesFor()) {
      const q = new URLSearchParams({ theme });
      for (const [k, v] of Object.entries(state)) if (k !== 'id') q.set(k, String(v));
      await page.goto(`${base}/dev/figure?${q}`);
      await page.addStyleTag({
        content: `.lm-devfig__stage { grid-template-columns: minmax(0, 1fr) !important; } .lm-devfig__svg { display: none !important; } .lm-devfig__fig .lm-fig3d__stage { aspect-ratio: auto !important; height: ${stagePx}px !important; }`,
      });
      const selector = '.lm-devfig__fig';
      const figure = page.locator(selector);
      await page
        .locator(`${selector} .lm-fig3d[data-renderer="webgl"], ${selector}.lm-fig3d[data-renderer="webgl"]`)
        .first()
        .waitFor({ timeout: 60000 });
      const canvas = figure.locator('canvas').first();
      await canvas.waitFor({ state: 'visible' });
      await page.waitForFunction(
        (sel) => Number(document.querySelector(`${sel} canvas`)?.dataset.draws ?? 0) > 0,
        selector,
      );
      const pause = figure.getByRole('button', { name: 'Pause turning' });
      if (await pause.count()) await pause.click();
      for (let n = 0; n < zoomClicks; n++) await figure.getByRole('button', { name: 'Zoom in' }).click();
      // QA-only: pin the camera angle through the renderer, as pose-browser-qa.mjs does.
      await page.evaluate(async () => {
        const { FigureRenderer } = await import('/src/features/body/figure3d/renderer.ts');
        const prototype = FigureRenderer.prototype;
        if (prototype.__qaDraw) return;
        prototype.__qaDraw = prototype.draw;
        prototype.draw = function (frame) {
          if (window.__qaAngle !== undefined) frame.angleRad = window.__qaAngle;
          return prototype.__qaDraw.call(this, frame);
        };
      });
      const setLayer = async (name, enabled) => {
        const button = figure.locator('.lm-fig3d__layers button').filter({ hasText: name }).first();
        if ((await button.getAttribute('aria-pressed')) === String(enabled)) return;
        await button.evaluate((element) => element.click());
        await page.waitForFunction(
          ({ sel, name, enabled }) =>
            [...document.querySelectorAll(`${sel} .lm-fig3d__layers button`)].some(
              (b) => b.textContent.trim() === name && b.getAttribute('aria-pressed') === String(enabled),
            ),
          { sel: selector, name, enabled },
        );
      };
      for (const layers of layerSets) {
        for (const [key, name] of Object.entries(LAYER_NAMES)) await setLayer(name, layers.includes(key));
        for (const [view, angle] of views) {
          const before = await page.evaluate(
            ({ sel, angle }) => {
              window.__qaAngle = angle;
              const c = document.querySelector(`${sel} canvas`);
              const n = Number(c.dataset.draws ?? 0);
              document.documentElement.setAttribute(
                'data-theme',
                document.documentElement.getAttribute('data-theme') ?? 'light',
              );
              return n;
            },
            { sel: selector, angle },
          );
          await page.waitForFunction(
            ({ sel, before }) => Number(document.querySelector(`${sel} canvas`)?.dataset.draws ?? 0) > before,
            { sel: selector, before },
          );
          await page.waitForFunction(
            (sel) => document.querySelector(`${sel} canvas`)?.dataset.anatomyPending !== 'true',
            selector,
          );
          await page.waitForTimeout(150);
          const stage = figure.locator('.lm-fig3d__stage').first();
          const file = `${state.id}-${theme}-${layers.join('+')}-${view}.png`;
          const shot = await stage.screenshot({ path: resolve(out, file), animations: 'disabled' });
          // Crop the same captured frame, including the full belly outline.
          const { width, height } = await sharp(shot).metadata();
          await sharp(shot)
            .extract({
              left: Math.floor(width * 0.15),
              top: Math.floor(height * 0.22),
              width: Math.floor(width * 0.8),
              height: Math.floor(height * 0.5),
            })
            .toFile(resolve(out, file.replace('.png', '-belly.png')));
          report.push({
            state: state.id,
            theme,
            layers,
            view,
            file,
            weight: await canvas.getAttribute('data-weight'),
          });
        }
      }
    }
  }
} finally {
  await browser.close();
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ out, shots: report.length, errors: report.filter((r) => r.error) }));
}
