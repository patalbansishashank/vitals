/** Fresh synthetic browser audit. BASE must name a local audit server. Tools are installed outside the lockfile. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const BASE = process.env.BASE;
if (!BASE) throw new Error('Set BASE to the audit server');
const { default: AxeBuilder } = await import(pathToFileURL(resolve('.e6-tmp/a11y-tools/node_modules/@axe-core/playwright/dist/index.mjs')).href);
const { firstRun } = await import('../set/lib.mjs');
const fixture = process.env.FIXTURE === '1';
const label = process.env.LABEL || (fixture ? 'fixture' : 'production');
const OUT = 'qa/results/C-A11Y';
mkdirSync(OUT, { recursive: true });
mkdirSync('.e6-tmp/a11y-shots', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
const rows = [];
const routes = fixture ? [
  '/ring', '/signals?tab=sleep&period=day', '/signals?tab=sleep&period=year',
  '/signals?tab=heart&period=day', '/signals?tab=heart&period=year',
  '/signals?tab=activity&period=day', '/signals?tab=activity&period=year',
] : ['/ring', '/signals?tab=sleep', '/signals?tab=heart', '/signals?tab=activity', '/body', '/settings/devices', '/settings/agents'];
try {
  for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block', bypassCSP: true });
    if (fixture) await context.addInitScript(() => { window.__VITALS_PAGES_FIXTURE__ = { ring: 'connected', signals: 'full' }; });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    async function audit(route, fresh = false) {
      if (!fresh) await page.goto(BASE + route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      const actual = new URL(page.url()).pathname;
      if (actual !== route.split('?')[0]) throw new Error(`Route changed: ${route} to ${actual}`);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const compact = (v) => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })) });
      const ui = await page.evaluate(() => {
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
        const targets = [...document.querySelectorAll('main button,main a,main input,main select,main summary,main [tabindex="0"]')].filter(visible).map((el) => {
          const r = el.getBoundingClientRect();
          return { name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('type') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 80), width: Math.round(r.width), height: Math.round(r.height) };
        });
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, smallTargets: targets.filter((r) => r.width < 44 || r.height < 44), activeAnimations: document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().duration > 1).length, fixtureLoaded: Boolean(window.__VITALS_PAGES_FIXTURE_LOADED__) };
      });
      const row = { route, width, theme, violations: results.violations.map(compact), incomplete: results.incomplete.map((v) => ({ ...compact(v), nodeCount: v.nodes.length, nodes: compact(v).nodes.slice(0, 5) })), ...ui };
      rows.push(row);
      writeFileSync(`${OUT}/axe-${label}.json`, JSON.stringify({ label, axeVersion: results.testEngine.version, reducedMotion: true, incompleteNote: 'Incomplete rules list up to five example nodes plus the total count; these need manual review, not automatic failure classification.', rows }, null, 2) + '\n');
      console.log(`${label} ${width} ${theme} ${route}: ${row.violations.map((v) => v.id + '(' + v.nodes.length + ')').join(', ') || 'no violations'}; overflow=${ui.overflow}`);
      if (width === 390 && theme === 'dark') await page.screenshot({ path: `.e6-tmp/a11y-shots/${label}-${route.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: true });
    }
    if (!fixture) { await page.goto(BASE + '/welcome', { waitUntil: 'networkidle' }); await audit('/welcome', true); }
    await firstRun(page);
    for (const route of routes) await audit(route);
    await context.close();
  }
} finally { await browser.close(); }
console.log(`${label}: ${rows.length} states audited`);
