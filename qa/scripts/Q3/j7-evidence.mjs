// J7 Evidence + forbidden-text scan over every screen of the app.
import { startLiving, fresh, seed, read, go, closeAll, results, scanForbidden, scanUrl, mainText, bodyText, shot } from './lib.mjs';
const R = results('J7');
const { check } = R;
const { page, errors } = await fresh('desktop');
await seed(page);

// ---- Evidence topics
await go(page, '/evidence');
await page.waitForTimeout(2000);
await page.getByText('by topic', { exact: true }).first().click();
await page.waitForTimeout(1500);
for (let i = 0; i < 60; i++) { const more = page.getByRole('button', { name: /^Show \d+ more/ }); if (!(await more.count())) break; await more.first().click(); await page.waitForTimeout(150); }
const topicLinks = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="/evidence/topics/"]')].map((a) => a.getAttribute('href')))]);
check('topic list shows topics', topicLinks.length >= 20, topicLinks.length);
const names = await page.evaluate(() => [...document.querySelectorAll('a[href^="/evidence/topics/"]')].map((a) => a.innerText.trim()).filter(Boolean));
const blood = topicLinks.find((h) => /blood-markers/.test(h));
check('topic "Blood markers and diet" present', !!blood, topicLinks.filter((h) => /marker|blood|diet/.test(h)).join(','));
check('topic title text mentions blood markers', names.some((n) => /blood markers/i.test(n)), names.filter((n) => /blood|kitchen|pantry/i.test(n)).join('|'));
const kitchenTopic = topicLinks.find((h) => /kitchen|pantry/.test(h));
check('topic "Kitchen, pantry and recipes" present (Q3-J7-03)', !!kitchenTopic, topicLinks.length + ' topics');
const sr = await read(page, 'evidence.search', { q: 'blood markers' }, { raw: true });
check('evidence.search finds blood-marker content', sr.ok && JSON.stringify(sr.output).length > 50, JSON.stringify(sr).slice(0, 120));
const seenRoutes = [];
let visited = 0;
for (const href of topicLinks) {
  await page.goto(new URL(href + '?qa=1', page.url()).toString(), { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const h1 = await page.evaluate(() => document.querySelector('h1')?.innerText ?? '');
  const t = await mainText(page);
  const hits = scanForbidden(t.replace(/doi:\S+/g, ''));
  visited++;
  check(`topic ${href}: renders heading and body`, h1.length > 2 && t.length > 400, `${h1} len=${t.length}`);
  check(`topic ${href}: no forbidden text`, hits.length === 0, hits.join(' ; '));
  if (/blood-markers/.test(href)) { await shot(page, 'J7', 'blood-markers'); check('blood markers topic has references', /\b(PubMed|doi|et al|[0-9]{4})\b/.test(t)); }
}
check('every topic page visited', visited === topicLinks.length);

// ---- Walk all routes (desktop) + main at mobile
const ROUTES = ['/', '/body', '/simulate', '/simulate/starter/schedule', '/simulate/starter/results', '/plan', '/plan/goals', '/plan/run', '/plan/results',
  '/onboarding/activity', '/onboarding/training', '/onboarding/diet', '/onboarding/kitchen', '/onboarding/supplements', '/onboarding/markers', '/onboarding/devices', '/onboarding/summary',
  '/today', '/food', '/food/pantry', '/train', '/plan/active', '/progress', '/coach',
  '/safety', '/evidence', '/evidence/validation', '/evidence/01-macronutrient-flux-model', '/evidence/topics',
  '/settings', ...['units', 'appearance', 'kitchen', 'supplements', 'data', 'sync', 'devices', 'coach', 'agents', 'install', 'safety', 'about'].map((s) => '/settings/' + s),
  '/welcome', '/no-such-page', '/profile', '/library', '/planner', '/simulator'];
const scan = async (pg, route, tag) => {
  await go(pg, route);
  await pg.waitForTimeout(1800);
  const t = await bodyText(pg);
  const hits = scanForbidden(t.replace(/doi:\S+/g, ''));
  const path = await pg.evaluate(() => location.pathname + location.search.replace(/[?&]qa=1/, ''));
  check(`${tag} ${route} → ${path}: renders, no forbidden text`, t.trim().length > 80 && hits.length === 0, hits.join(' ; ') || `len=${t.length}`);
  const uh = scanUrl(path);
  check(`${tag} ${route} → ${path}: no internal name in the URL`, uh.length === 0, uh.join(' ; '));
  seenRoutes.push(`${tag} ${route} -> ${path}`);
  return t;
};
for (const r of ROUTES) await scan(page, r, 'desktop');

// start a plan (goal, Find plans, Start) so Living-mode screens are scanned in their real state
let livingPath = '';
try { livingPath = await startLiving(page); } catch (e) { check('plan started via the planner UI', false, e.message.split('\n')[0]); }
check('Start lands in Living mode (Today)', /\/today/.test(livingPath), livingPath);
for (const r of ['/today', '/food', '/food/pantry', '/train', '/plan/active', '/progress', '/progress/weight', '/coach']) await scan(page, r, 'desktop-living');
const m = await page.evaluate(() => location.pathname);
check('living screens stay in Living mode after Start (no redirect to goals)', !/plan\/goals/.test(m), 'ended at ' + m);

// mobile: main screens
const mob = await fresh('mobile');
await seed(mob.page);
try { await startLiving(mob.page); } catch (e) { check('mobile: plan started via the planner UI', false, e.message.split('\n')[0]); }
for (const r of ['/body', '/simulate', '/plan', '/evidence', '/evidence/topics/blood-markers-and-diet', '/settings', '/today', '/food', '/train', '/progress', '/coach', '/safety', '/welcome']) await scan(mob.page, r, 'mobile');
await shot(mob.page, 'J7', 'mobile-last');
check('no uncaught errors (desktop)', errors.length === 0, errors.slice(0, 5).join(' || '));
check('no uncaught errors (mobile)', mob.errors.length === 0, mob.errors.slice(0, 5).join(' || '));
console.log(seenRoutes.join('\n'));
R.save();
await closeAll();
const bad = R.rows.filter((r) => !r.ok);
console.log(`J7: ${R.rows.length - bad.length}/${R.rows.length} passed`);
process.exit(bad.length ? 1 : 0);
