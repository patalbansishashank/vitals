/**
 * Focused browser checks for the Ring, Body signals, and Body figure pages.
 * BASE points at a Vite dev server for FIXTURES=1, or at a production preview
 * for the real browser state. STORAGE_STATE loads an ignored seeded profile;
 * DATA_DATE names a date in its synthetic ring import. EXTRAS=1 runs rare
 * fixture states and the delayed 3D, focus, and bottom-control checks. WIDTHS,
 * SCHEMES, ONLY, and OUT can narrow a run. OPERATIONAL=1 checks Ring actions.
 * Screenshots and JSON stay in .e6-tmp.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
if (!process.env.BASE) throw new Error('Set BASE to the local preview origin');
const BASE = process.env.BASE.replace(/\/$/, '');
process.env.BASE = BASE;
process.env.C_WEBQA_BASE_URL = BASE;
const { firstRun } = await import('../set/lib.mjs');
const { stubRelease } = await import('./lib.mjs');
const OUT = process.env.OUT || join(ROOT, '.e6-tmp/C-WEBQA/ring-signals');
const FIXTURES = process.env.FIXTURES === '1';
const EXTRAS = process.env.EXTRAS === '1';
const OPERATIONAL = process.env.OPERATIONAL === '1';
const ONLY = process.env.ONLY || '';
const STORAGE_STATE = process.env.STORAGE_STATE;
const widths = (process.env.WIDTHS || '390,768,1440').split(',').map(Number);
const schemes = (process.env.SCHEMES || 'light,dark').split(',');
const heights = { 390: 844, 768: 1024, 1440: 900 };
const today = '2026-10-04';
const DATA_DATE = process.env.DATA_DATE || today;
const ringStates = ['unsupported', 'none', 'bluetooth_off', 'permission_needed', 'idle', 'searching', 'connecting', 'connected', 'syncing', 'elsewhere', 'stale', 'error', 'low_battery', 'sync_failed', 'two_rings'];
const tabs = ['sleep', 'heart', 'activity'];
const periods = ['day', 'week', 'month', 'year'];
const results = [];
mkdirSync(OUT, { recursive: true });

async function capture(context, tag, name, path, fixture) {
  if (ONLY && !name.includes(ONLY)) return;
  console.log(`${tag} ${name}`);
  const page = await context.newPage();
  const rec = { tag, name, path, issues: [], fixture: fixture || null };
  const requests = [];
  if (fixture) await page.addInitScript((value) => { window.__VITALS_PAGES_FIXTURE__ = value; }, fixture);
  page.on('pageerror', (e) => rec.issues.push(`page error: ${e.message.slice(0, 180)}`));
  page.on('console', (m) => { if (m.type() === 'error') rec.issues.push(`console: ${m.text().slice(0, 180)}`); });
  page.on('requestfailed', (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}: ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400 && new URL(r.url()).origin === BASE) requests.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  try {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator('main').waitFor({ state: 'visible', timeout: 20_000 });
    if (fixture) await page.waitForFunction(() => !!window.__VITALS_PAGES_FIXTURE_LOADED__, null, { timeout: 20_000 });
    await page.waitForFunction(() => (document.querySelector('main')?.textContent?.trim().length || 0) > 30, null, { timeout: 20_000 });
    if (STORAGE_STATE && name.startsWith('signals-')) {
      await page.getByRole('tab', { name: /heart and recovery/i }).waitFor({ state: 'visible', timeout: 20_000 });
    }
    if (name.startsWith('signals-')) {
      await page.waitForFunction(() => !/reading\.{3}|reading…/.test(document.querySelector('main')?.textContent || ''), null, { timeout: 10_000 });
    }
    await page.waitForTimeout(200);
    const snap = await page.evaluate(() => {
      const main = document.querySelector('main');
      const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const controls = [...main.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[role="tab"]')].filter(visible);
      const clipped = controls.filter((e) => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).slice(0, 4).map((e) => ({ text: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 50), rect: e.getBoundingClientRect().toJSON() }));
      return { path: location.pathname, text: main.textContent.trim(), width: document.documentElement.scrollWidth, viewport: innerWidth, clipped, loaded: window.__VITALS_PAGES_FIXTURE_LOADED__ || null, headings: [...main.querySelectorAll('h1,h2,h3')].map((e) => e.textContent.trim()).slice(0, 12) };
    });
    rec.headings = snap.headings;
    if (snap.path !== path.split('?')[0]) rec.issues.push(`redirected to ${snap.path}`);
    if (snap.text.length < 30) rec.issues.push('main is nearly blank');
    if (snap.width > snap.viewport + 1) rec.issues.push(`horizontal overflow ${snap.width - snap.viewport}px`);
    if (snap.clipped.length) rec.issues.push(`controls beyond viewport: ${snap.clipped.map((c) => c.text).join(', ')}`);
    if (fixture && (!snap.loaded || snap.loaded.ring !== fixture.ring || snap.loaded.signals !== fixture.signals)) rec.issues.push('fixture did not load');
    if (name.startsWith('signals-') && fixture?.signals !== 'empty' && !snap.text.includes('Body signals')) rec.issues.push('Body signals title missing');
    if (name.startsWith('ring-') && !snap.text.includes('ring')) rec.issues.push('Ring content missing');
    if (name.startsWith('signals-') && fixture?.signals !== 'empty') {
      const button = page.getByRole('tab', { name: 'Heart and recovery' });
      if (!(await button.count())) rec.issues.push('signals tabs missing');
    }
    if (name.startsWith('signals-seeded-') && path.includes('period=day') && !snap.text.includes('From ')) rec.issues.push('imported day has no source or readings');
    if (requests.length) rec.issues.push(...requests.map((x) => `request: ${x}`));
    if (rec.issues.length || name === 'ring-connected' || name === 'ring-production' || name === 'signals-production' || name === 'signals-sleep-day' || name === 'signals-heart-day' || name === 'signals-seeded-sleep-day' || name === 'signals-seeded-heart-day' || name === 'body-figure') {
      const shot = join(OUT, `${tag}-${name}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      rec.screenshot = shot;
    }
  } catch (e) {
    rec.issues.push(`check failed: ${String(e?.message || e).split('\n')[0].slice(0, 180)}`);
  } finally {
    await page.close().catch(() => {});
  }
  results.push(rec);
}

async function figureCheck(context, tag) {
  const page = await context.newPage();
  const rec = { tag, name: 'body-figure', path: STORAGE_STATE ? '/body' : '/body?setup=shape', issues: [] };
  try {
    await page.goto(BASE + rec.path, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (document.querySelector('main')?.textContent?.trim().length || 0) > 30, null, { timeout: 20_000 });
    const figure = page.locator('.lm-fig3d').first();
    if (!(await figure.count())) {
      rec.issues.push('3D figure absent from Body page state');
      rec.note = (await page.locator('main').innerText()).slice(0, 250);
    } else {
      const stage = page.locator('.lm-fig3d__stage').first();
      const before = await stage.boundingBox();
      const initial = await figure.getAttribute('data-renderer');
      await page.waitForTimeout(1600);
      const after = await stage.boundingBox();
      const final = await figure.getAttribute('data-renderer');
      rec.renderer = { initial, final };
      rec.stage = { before, after };
      if (before && after && (Math.abs(before.width - after.width) > 2 || Math.abs(before.height - after.height) > 2)) rec.issues.push('figure stage shifts after lazy load');
      if (final === 'loading') rec.issues.push('figure remains loading');
      if (final === 'svg' && !(await figure.locator('svg').count())) rec.issues.push('SVG fallback absent');
    }
    const shot = join(OUT, `${tag}-body-figure.png`);
    await page.screenshot({ path: shot, fullPage: true });
    rec.screenshot = shot;
  } catch (e) { rec.issues.push(`check failed: ${String(e?.message || e).split('\n')[0].slice(0, 180)}`); }
  finally { await page.close().catch(() => {}); results.push(rec); }
}

async function figureFallbackCheck(context, tag) {
  const page = await context.newPage();
  const rec = { tag, name: 'body-figure-fallback', path: STORAGE_STATE ? '/body' : '/body?setup=shape', issues: [] };
  try {
    await page.addInitScript(() => Object.defineProperty(window, 'WebGL2RenderingContext', { value: undefined, configurable: true }));
    await page.goto(BASE + rec.path, { waitUntil: 'domcontentloaded' });
    const figure = page.locator('.lm-fig3d').first();
    await figure.waitFor({ state: 'visible', timeout: 20_000 });
    rec.renderer = await figure.getAttribute('data-renderer');
    if (rec.renderer !== 'svg') rec.issues.push(`expected SVG fallback, got ${rec.renderer}`);
    if (!(await figure.locator('svg').count())) rec.issues.push('SVG fallback drawing absent');
    const shot = join(OUT, `${tag}-body-figure-fallback.png`);
    await page.screenshot({ path: shot, fullPage: true });
    rec.screenshot = shot;
  } catch (e) { rec.issues.push(`check failed: ${String(e?.message || e).split('\n')[0].slice(0, 180)}`); }
  finally { await page.close().catch(() => {}); results.push(rec); }
}

async function figureLazyCheck(context, tag) {
  if (!FIXTURES) return;
  const page = await context.newPage();
  const rec = { tag, name: 'body-figure-lazy', issues: [] };
  let delayed = 0;
  try {
    await page.route('**/Figure3DCanvas.tsx*', async (route) => {
      delayed += 1;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.goto(BASE + '/body?setup=shape', { waitUntil: 'domcontentloaded' });
    const figure = page.locator('.lm-fig3d').first();
    await figure.waitFor({ state: 'visible', timeout: 20_000 });
    const stage = figure.locator('.lm-fig3d__stage');
    const before = await stage.boundingBox();
    rec.initial = await figure.getAttribute('data-renderer');
    await page.waitForFunction(() => document.querySelector('.lm-fig3d')?.getAttribute('data-renderer') !== 'loading', null, { timeout: 20_000 });
    const after = await stage.boundingBox();
    rec.final = await figure.getAttribute('data-renderer');
    rec.delayedChunkRequests = delayed;
    if (!delayed) rec.issues.push('lazy renderer chunk was not requested');
    if (rec.initial !== 'loading') rec.issues.push(`lazy figure skipped placeholder: ${rec.initial}`);
    if (before && after && (Math.abs(before.width - after.width) > 2 || Math.abs(before.height - after.height) > 2)) rec.issues.push('figure stage shifted when lazy renderer arrived');
  } catch (e) { rec.issues.push(`check failed: ${String(e?.message || e).split('\n')[0].slice(0, 180)}`); }
  finally { await page.close().catch(() => {}); results.push(rec); }
}

async function signalsNavigationCheck(context, tag) {
  const page = await context.newPage();
  const rec = { tag, name: 'signals-navigation', issues: [] };
  if (FIXTURES) await page.addInitScript(() => { window.__VITALS_PAGES_FIXTURE__ = { ring: 'connected', signals: 'full' }; });
  try {
    await page.goto(BASE + `/signals?tab=sleep&period=day&date=${FIXTURES ? today : DATA_DATE}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('radio', { name: 'week', exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByRole('radio', { name: 'week', exact: true }).click();
    await page.waitForURL(/period=week/);
    await page.goBack();
    await page.waitForURL(/period=day/);
    await page.getByRole('tab', { name: /heart and recovery/i }).click();
    await page.waitForURL(/tab=heart/);
    await page.locator('.sp-period__label').click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      const rect = el?.getBoundingClientRect();
      const css = el ? getComputedStyle(el) : null;
      return { name: el?.getAttribute('aria-label') || el?.textContent?.trim().slice(0, 50), visible: !!rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth, focusVisible: !!el?.matches(':focus-visible'), outline: css ? `${css.outlineStyle} ${css.outlineWidth}` : null };
    });
    rec.focus = focus;
    if (!focus.visible) rec.issues.push('calendar close did not restore a visible focus target');
    if (!focus.focusVisible || focus.outline?.startsWith('none')) rec.issues.push('calendar focus has no visible outline');
  } catch (e) { rec.issues.push(`check failed: ${String(e?.message || e).split('\n')[0].slice(0, 180)}`); }
  finally { await page.close().catch(() => {}); results.push(rec); }
}

async function ringBottomCheck(context, tag) {
  if (!FIXTURES) return;
  const page = await context.newPage();
  const rec = { tag, name: 'ring-bottom-control', issues: [] };
  await page.addInitScript(() => { window.__VITALS_PAGES_FIXTURE__ = { ring: 'connected', signals: 'full' }; });
  try {
    await page.goto(BASE + '/ring', { waitUntil: 'domcontentloaded' });
    const button = page.getByRole('button', { name: 'Add another ring' });
    await button.waitFor({ state: 'visible', timeout: 20_000 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const bounds = await page.evaluate(() => {
      const control = [...document.querySelectorAll('button')].find((e) => e.textContent?.trim() === 'Add another ring');
      const nav = document.querySelector('.lm-tabbar');
      const navVisible = nav && getComputedStyle(nav).display !== 'none' && nav.getBoundingClientRect().height > 0;
      return { controlBottom: control?.getBoundingClientRect().bottom ?? null, navTop: navVisible ? nav.getBoundingClientRect().top : innerHeight, viewportBottom: innerHeight };
    });
    rec.bounds = bounds;
    if (bounds.controlBottom !== null && bounds.controlBottom > bounds.navTop - 2) rec.issues.push('last Ring button is hidden beneath the bottom bar');
    await button.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const focus = await page.evaluate(() => {
      const e = document.activeElement;
      const css = e ? getComputedStyle(e) : null;
      return { name: e?.textContent?.trim(), focusVisible: !!e?.matches(':focus-visible'), outline: css ? `${css.outlineStyle} ${css.outlineWidth}` : null };
    });
    rec.focus = focus;
    if (focus.name !== 'Add another ring' || !focus.focusVisible || focus.outline?.startsWith('none')) rec.issues.push('Ring button lacks visible keyboard focus');
  } catch (e) { rec.issues.push(`check failed: ${String(e?.message || e).split('\n')[0].slice(0, 180)}`); }
  finally { await page.close().catch(() => {}); results.push(rec); }
}

async function ringOperationalCheck(context, tag) {
  const rec = { tag, name: 'ring-operational', issues: [] };
  const connected = await context.newPage();
  let step = 'open';
  try {
    await connected.addInitScript(() => { window.__VITALS_PAGES_FIXTURE__ = { ring: 'connected', signals: 'full' }; });
    await connected.goto(BASE + '/ring', { waitUntil: 'domcontentloaded' });
    const sharing = connected.getByRole('switch', { name: 'Use my ring data in my plan and Coach' });
    const sharingLabel = connected.locator('label.lm-switch').filter({ hasText: 'Use my ring data in my plan and Coach' });
    step = 'find sharing switch';
    await sharing.waitFor({ state: 'visible', timeout: 20_000 });
    if (await sharing.getAttribute('aria-checked') !== 'true') rec.issues.push('Ring sharing does not start on');
    step = 'turn sharing off';
    await sharingLabel.click();
    await connected.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false');
    step = 'turn sharing on';
    await sharingLabel.click();
    await connected.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true');
    step = 'sync now';
    await connected.getByRole('button', { name: 'Sync now' }).click();
    await connected.locator('.rg-card').getByText('connected', { exact: true }).waitFor({ state: 'visible' });
  } catch (e) { rec.issues.push(`connected ${step} failed: ${String(e?.message || e).split('\n')[0].slice(0, 180)}`); }
  finally { await connected.close().catch(() => {}); }
  const error = await context.newPage();
  try {
    await error.addInitScript(() => { window.__VITALS_PAGES_FIXTURE__ = { ring: 'error', signals: 'full' }; });
    await error.goto(BASE + '/ring', { waitUntil: 'domcontentloaded' });
    await error.getByRole('button', { name: 'Try again' }).first().click();
    await error.locator('.rg-card').getByText('connected', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
  } catch (e) { rec.issues.push(`error recovery failed: ${String(e?.message || e).split('\n')[0].slice(0, 180)}`); }
  finally { await error.close().catch(() => {}); results.push(rec); }
}

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  for (const width of widths) for (const scheme of schemes) {
    const tag = `${width}-${scheme}`;
    const context = await browser.newContext({ viewport: { width, height: heights[width] || 900 }, colorScheme: scheme, timezoneId: 'Europe/Berlin', locale: 'en-GB', ...(width === 390 ? { isMobile: true, hasTouch: true } : {}), ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {}) });
    await stubRelease(context);
    await context.clock.setFixedTime(new Date('2026-10-04T14:30:00+02:00'));
    try {
      if (!STORAGE_STATE) {
        const first = await context.newPage();
        try { await firstRun(first); } catch (e) { results.push({ tag, name: 'first-run', issues: [`setup failed: ${String(e?.message || e).split('\n')[0].slice(0, 180)}`] }); }
        await first.close();
      }
      if (FIXTURES) {
        if (OPERATIONAL) {
          await capture(context, tag, 'ring-connected', '/ring', { ring: 'connected', signals: 'full' });
          await capture(context, tag, 'ring-error', '/ring', { ring: 'error', signals: 'full' });
          await ringOperationalCheck(context, tag);
        } else if (EXTRAS) {
          await capture(context, tag, 'ring-none-empty', '/ring', { ring: 'none', signals: 'empty' });
          await capture(context, tag, 'signals-heart-no-age', `/signals?tab=heart&period=day&date=${today}`, { ring: 'connected', signals: 'noAge' });
          await capture(context, tag, 'signals-heart-vendor', `/signals?tab=heart&period=day&date=${today}`, { ring: 'connected', signals: 'vendor' });
          await capture(context, tag, 'signals-sleep-unknown', '/signals?tab=sleep&period=day&date=2026-09-28', { ring: 'connected', signals: 'full' });
          await capture(context, tag, 'signals-activity-charge-gap', '/signals?tab=activity&period=day&date=2026-10-02', { ring: 'connected', signals: 'full' });
        } else {
          for (const ring of ringStates) await capture(context, tag, `ring-${ring}`, '/ring', { ring, signals: 'full' });
          for (const tab of tabs) for (const period of periods) await capture(context, tag, `signals-${tab}-${period}`, `/signals?tab=${tab}&period=${period}&date=${today}`, { ring: 'connected', signals: 'full' });
          for (const tab of tabs) await capture(context, tag, `signals-${tab}-empty`, `/signals?tab=${tab}`, { ring: 'none', signals: 'empty' });
          for (const tab of tabs) await capture(context, tag, `signals-${tab}-sparse`, `/signals?tab=${tab}&period=week`, { ring: 'stale', signals: 'sparse' });
        }
      } else {
        await capture(context, tag, 'ring-production', '/ring');
        await capture(context, tag, 'signals-production', '/signals');
        if (STORAGE_STATE) for (const tab of tabs) for (const period of periods) {
          await capture(context, tag, `signals-seeded-${tab}-${period}`, `/signals?tab=${tab}&period=${period}&date=${DATA_DATE}`);
        }
      }
      if (!OPERATIONAL) {
        await figureCheck(context, tag);
        await figureFallbackCheck(context, tag);
        await figureLazyCheck(context, tag);
        await signalsNavigationCheck(context, tag);
        await ringBottomCheck(context, tag);
      }
    } finally { await context.close(); }
    const own = results.filter((r) => r.tag === tag);
    console.log(`${tag}: ${own.length} checks, ${own.reduce((n, r) => n + r.issues.length, 0)} issues`);
  }
} finally { await browser.close(); }
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ base: BASE, fixtures: FIXTURES, results }, null, 2));
console.log(`report: ${join(OUT, 'report.json')}`);
process.exitCode = results.some((r) => r.issues.length) ? 1 : 0;
