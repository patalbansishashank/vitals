/** Real WebGL keyboard and motion checks in a fresh context with synthetic setup. Requires BASE. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { firstRun } from '../set/lib.mjs';

if (!process.env.BASE) throw new Error('Set BASE to the audit server');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const checks = [];
let pageErrors = 0;
let failure = null;
const check = (name, passed, evidence) => {
  checks.push({ name, passed, ...evidence });
  if (!passed) throw new Error(name);
};
try {
  const context = await browser.newContext({
    viewport: { width: 960, height: 720 }, deviceScaleFactor: 1,
    reducedMotion: 'no-preference', serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', () => pageErrors++);
  await firstRun(page);
  const figure = page.locator('.lm-fig3d').first();
  await page.waitForFunction(() => document.querySelector('.lm-fig3d')?.dataset.renderer === 'webgl');
  const canvas = figure.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const angle = () => canvas.evaluate((el) => Number(el.dataset.angleRad));
  const renderer = await figure.getAttribute('data-renderer');
  check('Real WebGL canvas is keyboard reachable', renderer === 'webgl' && await canvas.getAttribute('tabindex') === '0', { renderer });
  await page.getByRole('heading', { name: /your body/i }).first().evaluate((el) => {
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
  });
  await page.waitForTimeout(250);
  let before = await angle();
  await page.waitForTimeout(350);
  let after = await angle();
  check('Auto turning runs without canvas focus', after !== before, { before, after });
  await canvas.focus();
  before = await angle();
  await page.waitForTimeout(400);
  after = await angle();
  check('Canvas focus pauses auto turning', after === before, { before, after });
  await canvas.press('ArrowLeft');
  let left = await angle();
  check('ArrowLeft rotates by one keyboard step', Math.abs((left - after) + Math.PI / 24) < 0.00003, { before: after, after: left });
  await canvas.press('ArrowRight');
  let right = await angle();
  check('ArrowRight rotates by one keyboard step', Math.abs((right - left) - Math.PI / 24) < 0.00003, { before: left, after: right });
  const pause = figure.getByRole('button', { name: 'Pause turning', exact: true });
  await pause.focus();
  before = await angle();
  await page.waitForTimeout(2600);
  after = await angle();
  check('Blur resumes auto turning after its hold', after !== before, { before, after, sampleMs: 2600 });
  await pause.press('Space');
  const resume = figure.getByRole('button', { name: 'Resume turning', exact: true });
  await resume.waitFor();
  before = await angle();
  await page.waitForTimeout(400);
  after = await angle();
  check('Space activates Pause turning', after === before && await resume.getAttribute('aria-pressed') === 'false', { before, after });
  await resume.press('Enter');
  await pause.waitFor();
  before = await angle();
  await page.waitForTimeout(400);
  after = await angle();
  check('Enter activates Resume turning', after !== before && await pause.getAttribute('aria-pressed') === 'true', { before, after });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const off = figure.getByRole('button', { name: 'Motion off', exact: true });
  await off.waitFor();
  before = await angle();
  await page.waitForTimeout(600);
  after = await angle();
  check('Reduced motion stops turning and disables its toggle', after === before && await off.isDisabled(), { before, after, sampleMs: 600 });
  check('Renderer stays WebGL throughout checks', await figure.getAttribute('data-renderer') === 'webgl', {});
  await context.close();
} catch (error) {
  failure = checks.at(-1)?.passed === false ? error.message : 'Probe could not complete';
} finally {
  await browser.close();
}
mkdirSync('qa/results/C-A11Y', { recursive: true });
writeFileSync('qa/results/C-A11Y/figure-keyboard.json', JSON.stringify({
  method: 'Fresh headless Chromium context; synthetic firstRun; server supplied by BASE; SwiftShader WebGL. Existing canvas data-angle-rad instrumentation records actual draw angles. Real keyboard events activate native buttons. Reduced motion uses browser media emulation. No screenshots or personal data.',
  serverMode: process.env.AUDIT_MODE || 'production-preview',
  checks, pageErrors, failure,
  limits: 'Short controlled samples on software rendering; no hardware, screen-reader or GPU memory measurement.',
}, null, 2) + '\n');
console.log(JSON.stringify({ passed: checks.filter((c) => c.passed).length, total: checks.length, pageErrors, failure }));
if (failure) process.exitCode = 1;
