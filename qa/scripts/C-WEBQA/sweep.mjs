import fs from 'node:fs';
import path from 'node:path';
import { launch, options, output, widths, themes, go, shot, measure, stubRelease } from './lib.mjs';
import { scanVisibleCopy, scanInternalLinks, scanCrossRouteAnchors } from './visible-copy.mjs';

const settings = ['units', 'appearance', 'kitchen', 'supplements', 'data', 'server', 'sync', 'devices', 'coach', 'agents', 'install', 'safety', 'about', 'ai', 'data-sources'];
const intake = ['activity', 'training', 'diet', 'kitchen', 'supplements', 'markers', 'devices', 'summary'];
export const routes = [
  '/', '/welcome', ...['intro', 'screening', 'consent', 'stop'].map((s) => `/welcome?step=${s}`),
  '/body', '/ring', '/signals', '/simulate', '/simulate/qa-missing', '/simulate/qa-missing/schedule', '/simulate/qa-missing/results',
  '/plan', '/plan/goals', '/plan/run', '/plan/results', '/onboarding', ...intake.map((s) => `/onboarding/${s}`),
  '/today', '/today/2026-10-03', '/food', '/food/pantry', '/food/2026-10-03', '/train', '/train/2026-10-03',
  '/plan/active', '/plan/active/versions/1', '/progress', '/progress/weight', '/progress/sleep.tst', '/progress/hrv.status', '/progress/hr.rhr_night', '/coach', '/coach/qa-missing',
  '/safety', '/evidence', '/evidence/validation', '/evidence/01-macronutrient-flux-model', '/evidence/qa-missing', '/evidence/topics', '/evidence/topics/body-weight-models', '/evidence/topics/qa-missing',
  '/settings', ...settings.map((s) => `/settings/${s}`), ...settings.slice(0, 13).map((s) => `/settings#${s}`),
  '/profile', '/simulator', '/planner', '/library',
  ...['components', 'picker', 'safety', 'avatar', 'figure', 'error', 'charts'].map((s) => `/dev/${s}`), '/qa-missing-route',
];
const profile = process.env.C_WEBQA_PROFILE || 'fresh';
const currentSignals = path.join(output, 'seeded-signals-state.json');
const stateFile = process.env.C_WEBQA_STATE_PATH || (fs.existsSync(currentSignals) ? currentSignals : path.join(output, 'seeded-state.json'));
const state = profile === 'seeded' ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : undefined;
const metaFile = path.join(output, 'seed-meta.json');
if (profile === 'seeded' && fs.existsSync(metaFile)) {
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  if (meta.scenarioId) routes.push(`/simulate/${encodeURIComponent(meta.scenarioId)}`, `/simulate/${encodeURIComponent(meta.scenarioId)}/schedule`, `/simulate/${encodeURIComponent(meta.scenarioId)}/results`);
}
const browser = await launch();
const selectedRoutes = process.env.C_WEBQA_ROUTE_FILTER ? routes.filter((route) => route === process.env.C_WEBQA_ROUTE_FILTER) : routes;
const reportName = process.env.C_WEBQA_REPORT_NAME || profile;
const resultFile = path.join(output, `sweep-${reportName}.json`);
const resume = process.env.C_WEBQA_RETEST === 'unfinished';
const report = resume && fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : [];
const rowKey = (row) => [row.profile, row.width, row.theme, row.route].join('|');
try {
  for (const width of widths) for (const theme of themes) {
    const context = await browser.newContext({ ...options(width, theme), ...(state ? { storageState: state } : {}) });
    await stubRelease(context);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    let errors = [], failedRequests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) failedRequests.push({ path: new URL(r.url()).pathname, status: r.status() }); });
    page.on('requestfailed', (r) => { if (!r.failure()?.errorText.includes('ERR_ABORTED')) failedRequests.push({ path: new URL(r.url()).pathname, error: r.failure()?.errorText }); });
    for (const route of selectedRoutes) {
      const existing = report.find((row) => rowKey(row) === [profile, width, theme, route].join('|'));
      if (resume && existing && !existing.failure && existing.copy && !existing.copy.forbiddenTextRules && !existing.copy.forbiddenUrlRules) continue;
      errors = []; failedRequests = [];
      const row = { profile, width, theme, route };
      try {
        await go(page, route, theme);
        const shotName = `${profile}-${width}-${theme}-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root'}`;
        await shot(page, `${shotName}-top`);
        row.layout = await measure(page);
        row.copy = scanVisibleCopy(await page.locator('main').first().innerText(), new URL(page.url()).pathname);
        const ids = await page.locator('[id]').evaluateAll((elements) => elements.map((el) => el.id));
        row.ids = ids;
        row.links = scanInternalLinks(row.layout.links, row.layout.path, ids);
        await shot(page, shotName);
        row.errors = [...new Set(errors)]; row.failedRequests = failedRequests;
        row.expectedError = route === '/dev/error';
      } catch (e) { row.failure = e.message.split('\n')[0]; }
      const previous = report.findIndex((item) => rowKey(item) === rowKey(row));
      if (previous < 0) report.push(row);
      else report[previous] = row;
      fs.writeFileSync(resultFile, JSON.stringify(report, null, 2));
      if (row.failure || row.layout?.horizontalOverflow || row.layout?.finalControl?.covered || (row.errors?.length && !row.expectedError)) console.log(JSON.stringify({ route, width, theme, failure: row.failure, overflow: row.layout?.horizontalOverflow, final: row.layout?.finalControl?.covered, errors: row.errors?.length }));
    }
    await context.close();
    console.log(`${profile} ${width} ${theme}: ${selectedRoutes.length} route states inspected`);
  }
} finally { await browser.close(); }
const anchors = scanCrossRouteAnchors(report.filter((row) => row.layout).map((row) => ({ route: row.layout.path, links: row.layout.links, ids: row.ids })));
fs.writeFileSync(path.join(output, `anchors-${reportName}.json`), JSON.stringify(anchors, null, 2));
console.log(JSON.stringify({ visits: report.length, failures: report.filter((r) => r.failure).length, overflow: report.filter((r) => r.layout?.horizontalOverflow > 1).length, covered: report.filter((r) => r.layout?.finalControl?.covered).length, errors: report.filter((r) => r.errors?.length && !r.expectedError).length }));
