// Fresh synthetic browser state only. BASE points to the fixing worktree's server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.BASE;
const stateFile = process.env.SYNTHETIC_STATE;
assert(base && stateFile, 'BASE and SYNTHETIC_STATE are required');
const root = path.resolve(import.meta.dirname, '../../..');
const output = path.join(root, '.e6-tmp/c-mobileui/fix1');
fs.mkdirSync(output, { recursive: true });
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
state.origins = state.origins.map((entry) => ({ ...entry, origin: new URL(base).origin }));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
const rows = [];

async function visit(page, route, theme, selector) {
  const url = new URL(route, base);
  url.searchParams.set('qa', '1');
  url.searchParams.set('theme', theme);
  await page.goto(url.href);
  await page.locator(selector).first().waitFor({ timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function geometry(page, selector) {
  return page.evaluate((selector) => {
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const visible = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const targets = [...document.querySelectorAll(selector)].filter(visible);
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    const boxes = targets.map(rect);
    const overlaps = [];
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b, j) => { if (overlap(a, b)) overlaps.push([i, i + j + 1]); }));
    const banks = [...document.querySelectorAll('.lm-bank')].filter(visible).map((bank) => {
      const box = rect(bank);
      return { box, keys: [...bank.querySelectorAll('.lm-bank__key')].map(rect) };
    });
    const dots = targets.filter((e) => e.matches('[data-selected="true"], [aria-current]:not([aria-current="false"])')).map((e) => {
      const dot = getComputedStyle(e, '::after');
      return { width: dot.width, height: dot.height };
    });
    return { boxes, overlaps, banks, dots, overflow: document.documentElement.scrollWidth - innerWidth };
  }, selector);
}

function checkBanks(result, touch) {
  assert(result.boxes.length, 'key banks must render');
  assert(result.overflow <= 0, 'page must stay inside the viewport');
  assert.deepEqual(result.overlaps, [], 'key targets must not overlap');
  for (const box of result.boxes) if (touch) assert(box.height >= 44 && box.width >= 44, 'actual key target must be at least 44px');
  for (const { box, keys } of result.banks) for (const key of keys) {
    assert(key.left >= box.left - 0.5 && key.right <= box.right + 0.5, 'keys must stay within their bank');
    assert(key.top >= box.top - 0.5 && key.bottom <= box.bottom + 0.5, 'bank must contain key rows');
  }
  assert(result.dots.length, 'selected indicators must render');
  for (const dot of result.dots) assert.deepEqual(dot, { width: '6px', height: '6px' }, 'selected dots must remain 6px');
}

try {
  for (const width of [360, 390]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: width === 360 ? 800 : 844 }, isMobile: true, hasTouch: true, colorScheme: theme, storageState: state, serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await visit(page, '/settings', theme, '#units .lm-bank__key');
      const settings = await geometry(page, '#units .lm-bank__key, #appearance .lm-bank__key');
      checkBanks(settings, true);
      await page.screenshot({ path: path.join(output, `settings-${width}-${theme}.png`), animations: 'disabled' });
      await visit(page, '/evidence', theme, '.ev-chiprail button.lm-chip');
      // Render deferred result rows before comparing their descendant geometry.
      await page.evaluate(() => document.querySelectorAll('.ev-row').forEach((row) => { row.style.contentVisibility = 'visible'; }));
      const chips = await geometry(page, 'button.lm-chip, a.lm-chip:not([href^="#"])');
      assert(chips.boxes.length, 'interactive chips must render');
      assert.equal(chips.overflow, 0, 'chip rail must not overflow the page');
      assert.deepEqual(chips.overlaps, [], 'interactive chip targets must not overlap');
      for (const box of chips.boxes) assert(box.height >= 44 && box.width >= 44, 'actual interactive chip target must be at least 44px');
      for (const end of ['first', 'last']) {
        const rail = page.locator('.ev-chiprail');
        await rail.scrollIntoViewIfNeeded();
        await rail.evaluate((e, end) => { e.style.scrollSnapType = 'none'; e.style.scrollBehavior = 'auto'; e.scrollLeft = end === 'first' ? 0 : e.scrollWidth; }, end);
        await page.waitForTimeout(100);
        const hit = await rail.evaluate((e, end) => {
          const target = end === 'first' ? e.firstElementChild : e.lastElementChild;
          const r = target.getBoundingClientRect();
          const rail = e.getBoundingClientRect();
          const at = (y) => document.elementFromPoint(r.left + r.width / 2, y)?.closest('.lm-chip') === target;
          return { contained: r.left >= rail.left && r.right <= rail.right && r.top >= rail.top && r.bottom <= rail.bottom, top: at(r.top + 1), bottom: at(r.bottom - 1) };
        }, end);
        assert.deepEqual(hit, { contained: true, top: true, bottom: true }, 'rail must contain and expose the whole 44px target');
      }
      await page.screenshot({ path: path.join(output, `evidence-${width}-${theme}.png`), animations: 'disabled' });
      await visit(page, '/welcome?step=screening&review=settings', theme, '.lm-bank__key');
      const screening = await geometry(page, '.lm-bank__key');
      checkBanks(screening, true);
      await page.screenshot({ path: path.join(output, `screening-${width}-${theme}.png`), animations: 'disabled' });
      await page.locator('.lm-bank__key').last().scrollIntoViewIfNeeded();
      const footer = await page.evaluate(() => {
        const foot = document.querySelector('.lm-onb-foot').getBoundingClientRect();
        const keys = [...document.querySelectorAll('.lm-bank__key')];
        const key = keys.at(-1).getBoundingClientRect();
        return { inside: foot.left >= 0 && foot.right <= innerWidth && foot.bottom <= innerHeight, keyClear: key.bottom <= foot.top };
      });
      assert.deepEqual(footer, { inside: true, keyClear: true }, 'last answer must remain reachable above the sticky footer');
      await visit(page, '/body', theme, '.lm-body-habits-face button[aria-haspopup="dialog"]');
      await page.locator('.lm-body-habits-face button[aria-haspopup="dialog"]').click();
      await page.locator('.lm-sheet[open] .lm-bank__key').first().waitFor();
      checkBanks(await geometry(page, '.lm-sheet[open] .lm-bank__key'), true);
      await page.locator('.lm-sheet[open] .lm-bank__key').last().scrollIntoViewIfNeeded();
      const sheet = await page.evaluate(() => {
        const dialog = document.querySelector('.lm-sheet[open]');
        const body = dialog.querySelector('.lm-panel__body').getBoundingClientRect();
        const foot = dialog.querySelector('.lm-panel__foot').getBoundingClientRect();
        const keys = [...dialog.querySelectorAll('.lm-bank__key')];
        const last = keys.at(-1).getBoundingClientRect();
        return { footerClear: body.bottom <= foot.top && foot.bottom <= innerHeight, targetClear: last.bottom <= body.bottom && last.top >= body.top };
      });
      assert.deepEqual(sheet, { footerClear: true, targetClear: true }, 'sheet scrolling must keep the final bank clear of its footer');
      await page.screenshot({ path: path.join(output, `habits-sheet-${width}-${theme}.png`), animations: 'disabled' });
      rows.push({ width, theme, settingsKeys: settings.boxes.length, screeningKeys: screening.boxes.length, interactiveChips: chips.boxes.length });
      console.log(`PASS ${width} ${theme}: actual 44px targets, no overlap or horizontal overflow, 6px indicators`);
    } finally { await context.close(); }
  }
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: false, colorScheme: theme, storageState: state, serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await visit(page, '/settings', theme, '#units .lm-bank__key');
      const desktop = await geometry(page, '#units .lm-bank__key, #appearance .lm-bank__key');
      checkBanks(desktop, false);
      for (const box of desktop.boxes) assert.equal(box.height, 32, 'desktop KeyBank remains compact');
      await visit(page, '/evidence', theme, 'button.lm-chip');
      for (const box of (await geometry(page, 'button.lm-chip')).boxes) assert.equal(box.height, 24, 'desktop chips remain compact');
      console.log(`PASS desktop ${theme}: compact keys and chips`);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(output, 'layout-results.json'), JSON.stringify(rows, null, 2));
}
