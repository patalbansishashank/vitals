// Q10 route sweep: every route of the Q6 registry (fresh and full profiles), 1440 px light, HTTP cache off.
// Per route: first paint and first contentful paint (Paint Timing), bytes fetched before first contentful paint,
// console and page errors, the forbidden-text scan (internal names) over the visible text and the title, and an
// accessibility check with axe-core (WCAG 2 A/AA rules) → a score = rules passed / rules applicable × 100 (an
// approximation of Lighthouse's accessibility score, which weights the same axe rules).
//   node qa/scripts/Q10/routes.mjs            (BASE=http://127.0.0.1:5283; axe-core from .e6-tmp/tools)
import fs from 'node:fs';
import { openProfile, sleep, ROOT, BASE } from '../Q6/lib.mjs';
import { SCREENS } from '../Q6/screens.mjs';
import { scanForbidden, scanUrl } from '../Q3/lib.mjs';

const AXE = fs.readFileSync(`${ROOT}/.e6-tmp/tools/node_modules/axe-core/axe.min.js`, 'utf8');
// "Lumen Health" is the ring's own Android app, named on the Devices card on purpose (v0.4)
const forbidden = (t) => scanForbidden(t.replace(/Lumen Health/g, 'Ring app'));
const routes = [];
for (const s of SCREENS) if (!s.prep && ['fresh', 'full'].includes(s.profile) && !routes.some((r) => r.route === s.route && r.profile === s.profile)) routes.push({ route: s.route, profile: s.profile });
const rows = [];
for (const profile of ['fresh', 'full']) {
  const { ctx, page, errors, close } = await openProfile(`q10-routes-${profile}`, { from: profile === 'fresh' ? null : profile });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  for (const { route } of routes.filter((r) => r.profile === profile)) {
    errors.length = 0;
    const u = new URL(route, BASE); u.searchParams.set('qa', '1');
    try {
      await page.goto(u.toString(), { waitUntil: 'networkidle' });
      await sleep(1200);
      const m = await page.evaluate(() => {
        const p = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, Math.round(e.startTime)]));
        const fcp = p['first-contentful-paint'] ?? Infinity;
        const res = performance.getEntriesByType('resource');
        const nav = performance.getEntriesByType('navigation')[0];
        const before = res.filter((r) => r.startTime < fcp);
        const kb = (list, re) => Math.round(list.filter((r) => re.test(r.name)).reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0) / 100) / 10;
        return {
          fp: p['first-paint'] ?? null, fcp: p['first-contentful-paint'] ?? null,
          jsBeforeFcpKB: kb(before, /\.m?js(\?|$)/), cssBeforeFcpKB: kb(before, /\.css(\?|$)/), htmlKB: Math.round((nav?.transferSize ?? 0) / 100) / 10,
          text: `${document.title}\n${document.body.innerText}`, path: location.pathname + location.search,
        };
      });
      await page.evaluate(`${AXE};0`); // CDP evaluation: the production CSP blocks injected script tags
      const axe = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, resultTypes: ['violations'] });
        return { passes: r.passes.length, violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes[0]?.target?.join(' ') })) };
      });
      const score = Math.round((axe.passes / Math.max(1, axe.passes + axe.violations.length)) * 100);
      const forb = [...forbidden(m.text), ...scanUrl(m.path)];
      rows.push({ profile, route, landed: m.path.replace(/[?&]qa=1/, ''), fp: m.fp, fcp: m.fcp, jsBeforeFcpKB: m.jsBeforeFcpKB, cssBeforeFcpKB: m.cssBeforeFcpKB, a11yScore: score, a11yViolations: axe.violations, errors: errors.slice(), forbidden: forb });
      console.log(`${profile.padEnd(5)} ${route.padEnd(34)} fcp=${m.fcp}ms js=${m.jsBeforeFcpKB}kB a11y=${score} viol=${axe.violations.map((v) => v.id).join(',') || '-'} err=${errors.length} forbidden=${forb.length}`);
    } catch (e) {
      rows.push({ profile, route, error: String(e.message).split('\n')[0], errors: errors.slice() });
      console.log(profile, route, 'ERROR', String(e.message).split('\n')[0]);
    }
  }
  await close();
}
fs.writeFileSync(`${ROOT}/qa/results/Q10-routes.json`, JSON.stringify(rows, null, 1));
const bad = rows.filter((r) => r.error || r.errors.length || r.forbidden?.length);
console.log(`routes: ${rows.length}; with errors or forbidden text: ${bad.length}; a11y score min ${Math.min(...rows.filter((r) => r.a11yScore != null).map((r) => r.a11yScore))}`);
process.exit(bad.length ? 1 : 0);
