// V1h: keyboard paths on the seeded profile: row sheet focus + Escape + focus return; tab-bar fast navigation; kJ shots.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const WT = process.cwd();
const BASE = process.env.BASE || 'http://127.0.0.1:5194';
const PROF = `${WT}/.e6-tmp/v1h-prof-k`;
const out = (...a) => console.log(...a);
for (const theme of ['light', 'dark']) {
  fs.rmSync(PROF, { recursive: true, force: true });
  fs.cpSync('/media/DEV/Hobby/Lumen Health/.e6-tmp/q6-profiles/full', PROF, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROF, { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'], colorScheme: theme, serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = ctx.pages()[0];
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  const active = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}:${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40)}` : 'none'; });
  // switch to kJ
  await page.goto(BASE + '/settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  await page.getByRole('radio', { name: 'kJ', exact: true }).click(); await page.waitForTimeout(600);
  await page.goto(BASE + '/today', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  if (theme === 'light') {
    const more = page.getByRole('button', { name: /^More for / }).first();
    await more.focus(); const opener = await active();
    await page.keyboard.press('Enter'); await page.waitForTimeout(700);
    const inDialog = await page.evaluate(() => !!document.activeElement?.closest('dialog'));
    out('sheet opened; focus in dialog:', inDialog, await active());
    for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
    out('after 25 Tabs focus still in dialog:', await page.evaluate(() => !!document.activeElement?.closest('dialog')));
    await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    out('after Escape dialog open:', await page.evaluate(() => !!document.querySelector('dialog[open]')), 'focus:', await active(), 'opener was', opener);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('nav a[href]')].map((a) => (a.getAttribute('aria-label') || a.textContent).trim()));
    out('nav links', JSON.stringify(tabs));
    for (let k = 0; k < 3; k++) for (const n of ['/food', '/train', '/coach', '/progress', '/today']) { await page.locator(`nav a[href="${n}"]:visible`).first().click({ timeout: 3000 }).catch((e) => errs.push('nav ' + n + ' ' + e.message.slice(0, 60))); await page.waitForTimeout(50); }
    await page.waitForTimeout(2500);
    out('fastnav end', page.url(), await page.evaluate(() => document.querySelector('h1')?.textContent));
  }
  const txt = await page.evaluate(() => document.body.innerText);
  out(theme, 'today kcal lines after kJ:', JSON.stringify(txt.split('\n').filter((l) => /kcal/.test(l)).slice(0, 4)));
  await page.screenshot({ path: `${WT}/qa/screenshots/V1h-today-kj-390-${theme}.png` });
  await page.goto(BASE + '/food', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  const ft = await page.evaluate(() => document.body.innerText);
  out(theme, 'food kcal lines after kJ:', JSON.stringify(ft.split('\n').filter((l) => /kcal/.test(l)).slice(0, 4)));
  await page.screenshot({ path: `${WT}/qa/screenshots/V1h-food-kj-390-${theme}.png` });
  out(theme, 'errors', JSON.stringify(errs));
  await ctx.close();
}
