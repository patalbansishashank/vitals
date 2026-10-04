import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

export const root = path.resolve(import.meta.dirname, '../../..');
export const output = path.join(root, '.e6-tmp/C-WEBQA');
fs.mkdirSync(output, { recursive: true });
process.env.TMPDIR = path.join(root, '.e6-tmp');
export const base = process.env.C_WEBQA_BASE_URL;
if (!base) throw new Error('Set C_WEBQA_BASE_URL to the local production preview origin.');
export const widths = [390, 768, 1440];
export const themes = ['light', 'dark'];
export const launch = () => chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
export const options = (width, theme) => ({ viewport: { width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 }, colorScheme: theme, serviceWorkers: 'block', reducedMotion: 'reduce' });
// Live release links are probed once separately. Repeated layout visits use the known pre-release state.
export const stubRelease = (context) => context.route('**/repos/**/releases/latest', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tag_name: 'v0.5.0', assets: [] }) }));
export async function go(page, route, theme) {
  const url = new URL(route, base);
  url.searchParams.set('qa', '1');
  if (theme) url.searchParams.set('theme', theme);
  await page.goto(url.href, { waitUntil: 'networkidle' });
  await page.locator('main').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}
export async function shot(page, name) {
  await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
}

// Measures actual hit targets after scrolling, so a fixed bar cannot hide the final action unnoticed.
export async function measure(page) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
    if (await page.evaluate(() => innerHeight + scrollY >= document.documentElement.scrollHeight - 2)) break;
  }
  return page.evaluate(() => {
    const shown = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
    const controls = [...document.querySelectorAll('main button, main a[href], main input:not([type=hidden]), main select, main textarea, main [role=switch], main [role=tab]')].filter(shown);
    const name = (e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('placeholder') || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 90);
    const final = controls.filter((e) => !e.closest('.lm-ctx-slot')).at(-1);
    const bar = document.querySelector('.lm-tabbar');
    const finalRect = final?.getBoundingClientRect();
    const barRect = bar && shown(bar) ? bar.getBoundingClientRect() : null;
    const main = document.querySelector('main');
    const overflow = [...document.querySelectorAll('main *')].filter((e) => {
      if (!shown(e) || e.closest('svg, .lm-sr, [role=tooltip]')) return false;
      const r = e.getBoundingClientRect();
      if (r.width <= 1 || (r.left >= -1 && r.right <= innerWidth + 1)) return false;
      for (let p = e.parentElement; p; p = p.parentElement) {
        if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(p).overflowX)) return false;
      }
      return true;
    }).slice(0, 8).map((e) => ({ tag: e.tagName, class: e.getAttribute('class'), name: name(e), width: e.getBoundingClientRect().width }));
    return {
      path: location.pathname + location.search.replace(/([?&])qa=1&?/, '$1').replace(/[?&]$/, ''),
      theme: document.documentElement.dataset.theme,
      title: document.title,
      headings: [...document.querySelectorAll('main h1, main h2')].slice(0, 5).map(name),
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      overflow,
      mainBottomPadding: main ? getComputedStyle(main).paddingBottom : null,
      finalControl: final ? { name: name(final), top: finalRect.top, bottom: finalRect.bottom, tabbarTop: barRect?.top, covered: Boolean(barRect && finalRect.bottom > barRect.top && finalRect.top < barRect.bottom) } : null,
      brokenImages: [...document.images].filter((e) => shown(e) && e.complete && !e.naturalWidth).map((e) => e.getAttribute('src')),
      links: [...document.querySelectorAll('main a[href]')].map((e) => ({ name: name(e), href: e.getAttribute('href') })).filter((e) => /^[/#?]/.test(e.href)),
    };
  });
}
