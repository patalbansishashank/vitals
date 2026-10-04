/** Lighthouse on the production preview, in a disposable profile with synthetic onboarding answers. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const BASE = process.env.BASE;
if (!BASE) throw new Error('Set BASE to the production audit server');
const { default: lighthouse, desktopConfig } = await import(pathToFileURL(resolve('.e6-tmp/a11y-tools/node_modules/lighthouse/core/index.js')).href);
const { firstRun } = await import('../set/lib.mjs');
const port = Number(process.env.DEBUG_PORT || 9374);
const reducedMotion = process.env.REDUCED === '1';
const label = process.env.LABEL || 'final';
const rows = [];
mkdirSync('qa/results/C-A11Y', { recursive: true });
for (const device of ['mobile', 'desktop']) {
  const context = await chromium.launchPersistentContext(resolve(`.e6-tmp/lighthouse-${device}-${Date.now()}`), { executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true, reducedMotion: reducedMotion ? 'reduce' : 'no-preference', args: ['--no-sandbox', `--remote-debugging-port=${port}`] });
  try {
    const page = context.pages()[0];
    for (const route of (process.env.ROUTES || '/welcome,/ring,/signals,/body').split(',')) {
      if (route === '/ring' || (route !== '/welcome' && rows.filter((r) => r.device === device).length === 0)) await firstRun(page);
      const run = await lighthouse(BASE + route, { port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices'], disableStorageReset: true }, device === 'desktop' ? desktopConfig : undefined);
      const { lhr } = run;
      const metrics = Object.fromEntries(['first-contentful-paint','largest-contentful-paint','speed-index','total-blocking-time','cumulative-layout-shift','interactive'].filter((id) => lhr.audits[id]).map((id) => [id, { value: lhr.audits[id].numericValue, unit: lhr.audits[id].numericUnit }]));
      const row = { device, route, actualRoute: new URL(lhr.finalDisplayedUrl || lhr.finalUrl).pathname, lighthouseVersion: lhr.lighthouseVersion, scores: Object.fromEntries(Object.entries(lhr.categories).map(([k,v]) => [k,v.score])), metrics, warnings: lhr.runWarnings?.map((w) => String(w).replace(/https?:\/\/[^\s]+/g, '[audit origin]')), failedAudits: Object.entries(lhr.audits).filter(([,a]) => a.score !== null && a.score < 1).map(([id,a]) => ({ id, score:a.score, title:a.title, value:a.numericValue, display:a.displayValue })) };
      rows.push(row);
      writeFileSync(`qa/results/C-A11Y/lighthouse-${label}.json`, JSON.stringify({ note: 'Single-run lab measurements on shared host; built app, synthetic onboarding, no ring data or server, default simulated mobile/desktop throttling. Fresh Welcome; returning profile for other routes. Headless GPU differs from real devices.', reducedMotion, rows }, null, 2) + '\n');
      console.log(`${device} ${route} -> ${row.actualRoute}: ${JSON.stringify(row.scores)} TBT=${metrics['total-blocking-time'].value}ms`);
    }
  } finally { await context.close(); }
}
