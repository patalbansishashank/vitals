/** Keyboard focus across synthetic pairing, without Bluetooth. Requires dev BASE. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { firstRun } from '../set/lib.mjs';

const base = process.env.BASE;
if (!base) throw new Error('Set BASE to the development audit server');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
const checks = [];
let pageErrors = 0;
let failure = null;
const check = (name, passed) => {
  checks.push({ name, passed });
  if (!passed) throw new Error(name);
};
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.__VITALS_PAGES_FIXTURE__ = { ring: 'none', signals: 'empty' };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', () => pageErrors++);
  await firstRun(page);
  await page.goto(base + '/ring', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__VITALS_PAGES_FIXTURE_LOADED__));
  const flow = page.locator('.rg-pair');
  const look = page.getByRole('button', { name: 'Look for rings', exact: true });
  const inFlow = () => page.evaluate(() => Boolean(document.activeElement?.closest('.rg-pair')));
  const atConnectedHeading = () => page.evaluate(() => {
    const active = document.activeElement;
    const card = active?.closest('.rg-card[data-state="connected"]');
    const box = active?.getBoundingClientRect();
    return Boolean(card && active.matches('.rg-card__label') && box?.width && box?.height);
  });
  const pair = async () => {
    await look.focus();
    await look.press('Enter');
    const candidate = page.getByRole('button', { name: /J-Style 2301.*ending 4F2A/ }).first();
    await candidate.waitFor();
    check('Scan transition keeps focus inside pairing flow', await inFlow());
    await candidate.focus();
    await candidate.press('Enter');
    await flow.waitFor({ state: 'hidden' });
  };
  await pair();
  check('First completion focuses visible connected card heading', await atConnectedHeading());
  const add = page.getByRole('button', { name: 'Add another ring', exact: true }).first();
  await add.focus();
  await add.press('Enter');
  await look.waitFor();
  check('Add enters the newly opened pairing flow', await look.evaluate((el) => el === document.activeElement));
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await cancel.focus();
  await cancel.press('Enter');
  await flow.waitFor({ state: 'hidden' });
  check('Cancel restores the original Add trigger', await add.evaluate((el) => el === document.activeElement));
  await add.press('Enter');
  await look.waitFor();
  await pair();
  check('Added-ring completion focuses visible connected card heading', await atConnectedHeading());
  await context.close();
} catch (error) {
  failure = checks.at(-1)?.passed === false ? error.message : 'Probe could not complete';
} finally {
  await browser.close();
}
mkdirSync('qa/results/C-A11Y', { recursive: true });
writeFileSync('qa/results/C-A11Y/pairing-focus.json', JSON.stringify({
  method: 'Fresh headless Chromium dev context; synthetic firstRun and none/empty fixture set before load. Real keyboard focus and Enter events drive scan, synthetic candidate pairing, Add and Cancel. DevFixtureGate installs the in-memory fake service; no hardware or screenshots.',
  checks, pageErrors, failure,
  limits: 'The fake service updates one synthetic ring; multiple-ring ordering and screen-reader speech are covered only by source review or unit tests.',
}, null, 2) + '\n');
console.log(JSON.stringify({ passed: checks.filter((c) => c.passed).length, total: checks.length, pageErrors, failure }));
if (failure) process.exitCode = 1;
