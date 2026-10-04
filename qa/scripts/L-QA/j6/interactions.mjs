// J6 A: period navigation + Check now + forget dialog against dev fixtures (390x844 light by default; SCHEME=dark).
//   node qa/scripts/L-QA/j6/interactions.mjs
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
const BASE = process.env.BASE || 'http://127.0.0.1:4317';
process.env.BASE = BASE;
const { firstRun } = await import('../../set/lib.mjs');
const OUT = fileURLToPath(new URL('../../../results/L-QA/j6/', import.meta.url));
const scheme = process.env.SCHEME || 'light';
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, isMobile: true, hasTouch: true, timezoneId: 'Europe/Berlin', locale: 'en-GB' });
await ctx.clock.setFixedTime(new Date('2026-10-04T14:30:00+02:00'));
const first = await ctx.newPage(); await firstRun(first); await first.close();
const p = await ctx.newPage();
const errs = []; p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); p.on('pageerror', (e) => errs.push('pageerror ' + e.message.slice(0, 200)));
await p.addInitScript((f) => { window.__VITALS_PAGES_FIXTURE__ = f; }, { ring: 'connected', signals: 'full' });
const log = [];
const state = async (label) => { const u = new URL(p.url()); const nav = await p.evaluate(() => { const l = [...document.querySelectorAll('button,a')].filter((e) => /previous|next|today|‹|›/i.test(e.getAttribute('aria-label') || e.innerText || '')).map((e) => `${(e.getAttribute('aria-label') || e.innerText).trim()}${e.disabled || e.getAttribute('aria-disabled') === 'true' ? '(disabled)' : ''}`); const label = document.querySelector('[data-period-label], .sg-period-label') ; return { l, main: (document.querySelector('main')?.innerText || '').slice(0, 0) }; }); log.push(`${label}: ${u.pathname}${u.search} ${JSON.stringify(nav.l)}`); };
await p.goto(BASE + '/signals?tab=sleep&period=day&date=2026-10-02', { waitUntil: 'networkidle' });
await p.waitForSelector('main'); await p.waitForTimeout(1500);
await state('start day 2 Oct');
const periodKeys = async () => (await p.locator('[role=radio]').allInnerTexts()).join('|');
log.push('radios: ' + await periodKeys());
await p.getByRole('radio', { name: 'week' }).click(); await p.waitForTimeout(800); await state('-> week');
await p.screenshot({ path: OUT + 'nav-week.png' });
await p.getByRole('radio', { name: 'day' }).click(); await p.waitForTimeout(800); await state('-> day again (expect 2 Oct)');
await p.getByRole('radio', { name: 'month' }).click(); await p.waitForTimeout(800); await state('-> month');
await p.getByRole('radio', { name: 'year' }).click(); await p.waitForTimeout(800); await state('-> year');
// next disabled on current period?
await p.getByRole('radio', { name: 'week' }).click(); await p.waitForTimeout(600);
const btns = await p.evaluate(() => [...document.querySelectorAll('button, a')].map((e) => ({ t: (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 40), d: e.disabled || e.getAttribute('aria-disabled') === 'true' })).filter((x) => /previous|next|earlier|later|today|back|forward/i.test(x.t)));
log.push('nav buttons on week-of-2-Oct: ' + JSON.stringify(btns));
const prev = p.getByRole('button', { name: /previous|earlier/i }).first();
if (await prev.count()) { await prev.click(); await p.waitForTimeout(700); await state('prev week'); await p.screenshot({ path: OUT + 'nav-prevweek.png' }); }
// today key visible when away
log.push('today key count: ' + await p.getByRole('button', { name: /^today$/i }).count());
// calendar popover
const lab = p.getByRole('button', { name: /sep|oct|week|202/i }).filter({ hasText: /–|Sep|Oct/ }).first();
await lab.click().catch(() => {}); await p.waitForTimeout(700);
await p.screenshot({ path: OUT + 'nav-calendar.png' });
await p.keyboard.press('Escape');
// drill down: week -> tap a column
await p.goto(BASE + '/signals?tab=sleep&period=week&date=2026-10-02', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
const cols = await p.locator('svg [data-slot], svg [role=button], svg a').count();
log.push('week chart tappable slots: ' + cols);
// browser Back walks through the states
await p.goBack(); await p.waitForTimeout(600); await state('after Back');
// Heart: no age state / Activity tab switching via URL keeps period
await p.goto(BASE + '/signals?tab=heart&period=month&date=2026-09-15', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
await p.getByRole('tab', { name: 'activity' }).click(); await p.waitForTimeout(800); await state('tab -> activity');
// first record bound: go back until prev disabled
await p.goto(BASE + '/signals?tab=activity&period=year&date=2026-10-04', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
for (let i = 0; i < 4; i++) { const pv = p.getByRole('button', { name: /previous|earlier/i }).first(); if (await pv.count() && !(await pv.isDisabled())) { await pv.click(); await p.waitForTimeout(500); } }
await state('year back x4'); await p.screenshot({ path: OUT + 'nav-yearback.png' });
// Check now
await p.goto(BASE + '/ring', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(1200);
await p.screenshot({ path: OUT + 'checknow-measuring.png' });
log.push('check-now measuring text: ' + (await p.locator('main').innerText()).split('\n').filter((l) => /measur|stop|bpm|—|saved/i.test(l)).slice(0, 8).join(' / '));
await p.waitForTimeout(6000);
await p.screenshot({ path: OUT + 'checknow-after.png' });
log.push('check-now after: ' + (await p.locator('main').innerText()).split('\n').filter((l) => /measur|stop|bpm|saved|no steady/i.test(l)).slice(0, 8).join(' / '));
// Forget dialog
await p.getByRole('button', { name: /Forget this ring/ }).click().catch(() => {}); await p.waitForTimeout(700);
await p.screenshot({ path: OUT + 'forget-dialog.png' });
log.push('forget dialog: ' + (await p.locator('[role=dialog],[role=alertdialog]').first().innerText().catch(() => 'none')).replace(/\s+/g, ' ').slice(0, 300));
log.push('console/page errors: ' + JSON.stringify(errs));
await b.close();
console.log(log.join('\n'));
