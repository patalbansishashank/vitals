// Fresh-browser onboarding journey at each release viewport and theme.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const base = process.env.C_WEBQA_BASE_URL;
if (!base) throw new Error('C_WEBQA_BASE_URL is required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.join(root, '.e6-tmp/C-WEBQA/onboarding');
fs.mkdirSync(out, { recursive: true });
const rows = [];
const widths = process.env.C_WEBQA_WIDTHS ? process.env.C_WEBQA_WIDTHS.split(',').map(Number) : [390, 768, 1440];
const themes = process.env.C_WEBQA_THEMES ? process.env.C_WEBQA_THEMES.split(',') : ['light', 'dark'];

async function visit(page, route) {
  const url = new URL(route, base);
  url.searchParams.set('qa', '1');
  await page.goto(url.href, { waitUntil: 'load' });
  await page.locator('h1').first().waitFor({ timeout: 20000 });
}

async function check(page, label, width, theme) {
  await page.waitForTimeout(200);
  const found = await page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    const footer = document.querySelector('.lm-onb-foot');
    const action = footer?.querySelector('button:not([aria-disabled="true"])') ?? footer?.querySelector('button');
    const r = action?.getBoundingClientRect();
    const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    const bar = document.querySelector('.lm-bottom-bar, .lm-shell-bottom, nav[aria-label="Main navigation"]');
    const b = bar?.getBoundingClientRect();
    return {
      path: location.pathname + location.search,
      heading: main.querySelector('h1')?.textContent?.trim() ?? null,
      overflow: document.documentElement.scrollWidth - innerWidth,
      footerAction: action?.textContent?.trim() ?? null,
      footerVisible: r && r.width > 0 && r.height > 0 ? r.top >= 0 && r.bottom <= innerHeight : null,
      footerClickable: r && r.width > 0 && r.height > 0 ? action === hit || action?.contains(hit) : null,
      overlap: r && b ? Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top)) : 0,
      ringMark: !!document.querySelector('.lm-ringmark'),
    };
  });
  const name = `${width}-${theme}-${label}`;
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false });
  rows.push({ name, ...found });
  if (found.overflow > 1 || found.overlap > 1 || found.footerVisible === false || found.footerClickable === false) {
    console.log('LAYOUT', name, JSON.stringify(found));
  }
}

async function keyboardCheck(page, label, width, theme, limit) {
  await page.locator('h1').first().focus();
  const failures = [];
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2)));
      return { name: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 70) || el.tagName,
        visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight,
        clickable: el === hit || el.contains(hit), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    if (!state) break;
    if (!state.visible || !state.clickable) failures.push(state);
    if (i > 0 && state.name === 'See what a plan does before you live it.') break;
  }
  rows.push({ name: `${width}-${theme}-${label}-keyboard`, failures });
  if (failures.length) console.log('KEYBOARD', width, theme, label, failures.length);
}

async function answerScreening(page) {
  await page.getByRole('radio', { name: '18–64' }).click();
  for (let pass = 0; pass < 6; pass++) {
    let changed = 0;
    const no = page.getByRole('radio', { name: 'no', exact: true });
    for (let i = 0; i < await no.count(); i++) {
      if (await no.nth(i).getAttribute('aria-checked') !== 'true') {
        await no.nth(i).click();
        changed++;
      }
    }
    if (!changed) break;
  }
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  if (await next.getAttribute('aria-disabled') === 'true') throw new Error('Screening stayed incomplete');
  await next.click();
}

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  for (const width of widths) for (const theme of themes) {
    const errors = [];
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 }, colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await ctx.route('**/releases/latest', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"tag_name":"v0.5.0","assets":[]}' }));
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(`page: ${error.message.slice(0, 200)}`));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 200)}`); });
    try {
      await visit(page, '/welcome');
      await check(page, 'welcome', width, theme);
      await keyboardCheck(page, 'welcome', width, theme, 35);
      const downloads = page.locator('.lm-dl');
      if (await downloads.count()) {
        const keep = downloads.locator('.lm-dl__keep');
        if (await keep.count()) {
          await keep.click();
          await check(page, 'downloads-folded', width, theme);
          await page.reload({ waitUntil: 'load' });
          await page.locator('.lm-dl[data-folded="true"]').waitFor({ timeout: 10000 });
          await page.locator('.lm-dl__fold').click();
        }
      }
      await page.getByRole('button', { name: 'Get started' }).first().click();
      await check(page, 'screening-empty', width, theme);
      await keyboardCheck(page, 'screening', width, theme, 110);
      await page.getByRole('radio', { name: 'under 18' }).click();
      await check(page, 'screening-under18', width, theme);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await check(page, 'under18-stop', width, theme);
      await page.getByRole('button', { name: 'I entered my age by mistake' }).click();
      await answerScreening(page);
      await check(page, 'consent', width, theme);
      await keyboardCheck(page, 'consent', width, theme, 35);
      await page.getByRole('checkbox', { name: 'I understand' }).check();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await check(page, 'body-basics', width, theme);

      // A previous acknowledgement must be renewed when its version changes.
      await page.evaluate(() => {
        const key = 'vitals.safety';
        const saved = JSON.parse(localStorage.getItem(key));
        saved.state.acknowledgements.disclaimer.version = 0;
        localStorage.setItem(key, JSON.stringify(saved));
      });
      await visit(page, '/body');
      if (!page.url().includes('step=consent&review=updated')) throw new Error('Outdated consent did not reopen');
      await check(page, 'reconsent', width, theme);
      await page.getByRole('checkbox', { name: 'I understand' }).check();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await visit(page, '/body?setup=basics');
      await page.getByRole('radio', { name: 'male', exact: true }).or(page.getByRole('button', { name: 'male', exact: true })).first().click();
      const basics = page.locator('main input[type=text]:visible');
      for (const [index, value] of [[0, '35'], [1, '175'], [2, '88']]) {
        await basics.nth(index).click();
        await page.keyboard.press('Control+a');
        await page.keyboard.type(value, { delay: 30 });
        await page.keyboard.press('Tab');
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: 'Next: shape' }).first().click();
      await check(page, 'body-shape', width, theme);
      await page.getByRole('button', { name: 'Skip for now' }).first().click();
      await check(page, 'body-complete', width, theme);

      // The first setup controls lead into the intake chapters. Each chapter is also checked directly
      // after consent, since people may return to any chapter while setup is in progress.
      for (const section of ['activity', 'training', 'diet', 'kitchen', 'supplements', 'markers', 'devices', 'summary']) {
        await visit(page, `/onboarding/${section}`);
        await check(page, `intake-${section}`, width, theme);
      }
    } catch (error) {
      rows.push({ name: `${width}-${theme}-journey`, error: String(error.message).split('\n')[0], at: new URL(page.url()).pathname,
        stack: String(error.stack).split('\n').slice(0, 6),
        detail: (await page.locator('main button, main [role=radio]').allTextContents()).map((x) => x.trim()).filter(Boolean).slice(0, 20) });
      console.log('JOURNEY', width, theme, String(error.message).split('\n')[0], new URL(page.url()).pathname);
    } finally {
      rows.push({ name: `${width}-${theme}-errors`, errors });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(rows, null, 2));
}
console.log(`Onboarding states: ${rows.filter((row) => row.heading).length}; journeys with errors: ${rows.filter((row) => row.error).length}`);
