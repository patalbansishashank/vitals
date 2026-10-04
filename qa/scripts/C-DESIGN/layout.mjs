// Production-preview visual matrix. All profile data is synthetic and browser-local.
// BASE=<preview URL> node qa/scripts/C-DESIGN/layout.mjs before
// BASE=<preview URL> node qa/scripts/C-DESIGN/layout.mjs after
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { seedSynthetic } from './seed.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const base = process.env.BASE;
const phase = process.argv[2];
if (!base || !['before', 'after'].includes(phase)) {
  console.error('Usage: BASE=<preview URL> node qa/scripts/C-DESIGN/layout.mjs before|after');
  process.exit(2);
}
const origin = new URL(base).origin;
const output = path.join(root, '.e6-tmp/c-design');
const phaseDir = path.join(output, phase);
const stateFile = path.join(output, 'synthetic-state.json');
const forOrigin = (state) => ({ ...state, origins: (state.origins || []).map((entry) => ({ ...entry, origin })) });
fs.mkdirSync(phaseDir, { recursive: true });

const widths = process.env.DESIGN_WIDTHS ? process.env.DESIGN_WIDTHS.split(',').map(Number).filter(Number.isFinite) : [390, 768, 1024, 1280, 1440];
const schemes = process.env.DESIGN_SCHEMES ? process.env.DESIGN_SCHEMES.split(',').map((s) => s.trim()).filter((s) => s === 'light' || s === 'dark') : ['light', 'dark'];
const routeGroups = {
  public: ['/safety', '/evidence', '/evidence/validation', '/settings'],
  profile: [
    '/body', '/body?setup=basics', '/body?setup=shape', '/body?setup=habits', '/body?setup=start',
    '/onboarding/activity', '/onboarding/training', '/onboarding/diet', '/onboarding/kitchen',
    '/onboarding/supplements', '/onboarding/markers',
    '/onboarding/devices', '/onboarding/summary', '/simulate', '/plan', '/plan/goals', '/plan/run',
    '/plan/results', '/ring', '/signals',
    '/signals?tab=sleep&period=day', '/signals?tab=sleep&period=week',
    '/signals?tab=heart&period=day', '/signals?tab=heart&period=week',
    '/signals?tab=activity&period=day', '/signals?tab=activity&period=week',
    '/coach', '/progress', '/progress#activity',
    '/progress/sleep.tst', '/progress/hr.rhr_night',
  ],
  living: ['/today', '/food', '/food/pantry', '/train', '/plan/active'],
  settings: [
    'units', 'appearance', 'kitchen', 'supplements', 'data', 'server', 'sync',
    'devices', 'coach', 'agents', 'install', 'safety', 'about',
  ].map((section) => `/settings/${section}`),
};
const rows = [];
const failures = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });

async function go(page, route) {
  const url = new URL(route, origin);
  url.searchParams.set('qa', '1');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('main, [role="main"]').first().waitFor({ timeout: 15000 }).catch(() => undefined);
  if (!route.startsWith('/welcome')) {
    await page.locator('main .lm-page').first().waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForFunction(() => {
      const p = document.querySelector('main .lm-page');
      const h = document.querySelector('.lm-ctx__title .lm-title, main h1');
      return !!p && !!h && (p.innerText?.trim().length ?? 0) > 10;
    }, null, { timeout: 20000 });
  }
  if (route.startsWith('/body')) {
    await page.waitForFunction(() => !document.querySelector('.lm-fig3d[data-renderer="loading"]'), null, { timeout: 30000 });
  }
  await page.waitForFunction(() => [...document.querySelectorAll('.lmc-tl')].every((root) => {
    const svg = root.querySelector('.lmc-tl__plot > svg.lmc-lv-svg');
    return !svg || Number(svg.getAttribute('width')) <= root.getBoundingClientRect().width + 1;
  }), null, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForTimeout(route.startsWith('/body') ? 600 : 350);
}

async function seed() {
  if ((phase === 'after' || process.env.DESIGN_REUSE_STATE === '1') && fs.existsSync(stateFile) && process.env.DESIGN_RESEED !== '1') {
    return { state: forOrigin(JSON.parse(fs.readFileSync(stateFile, 'utf8'))), plan: true };
  }
  const seeded = await seedSynthetic(browser, { base: origin, root, output });
  if (!seeded.plan) throw new Error('Synthetic active plan is required for full route coverage');
  fs.writeFileSync(stateFile, JSON.stringify(seeded.state));
  if (seeded.beforeBiometricsState) fs.writeFileSync(path.join(output, 'synthetic-empty-state.json'), JSON.stringify(seeded.beforeBiometricsState));
  fs.writeFileSync(path.join(output, 'seed-notes.json'), JSON.stringify(seeded.notes ?? [], null, 2));
  return seeded;
}

function slug(route) {
  return route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-') || 'root';
}

async function metrics(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const visible = (el) => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const context = document.querySelector('.lm-ctx');
    const title = context?.querySelector('.lm-ctx__title');
    const progress = [...document.querySelectorAll('.lm-ik-progress, .lm-body-steps')].find(visible);
    const main = document.querySelector('main');
    const page = main?.querySelector('.lm-page');
    const faces = [...(main?.querySelectorAll('.lm-face, section, article') || [])].filter(visible).slice(0, 8);
    const nav = [...document.querySelectorAll('.lm-tabbar')].find(visible);
    const action = [...document.querySelectorAll('.lm-actionbar')].find(visible);
    const b = { context: box(context), title: box(title), progress: box(progress), main: box(main), page: box(page), nav: box(nav), action: box(action), faces: faces.map(box) };
    const style = (el) => el ? getComputedStyle(el) : null;
    const px = (value) => Number.parseFloat(value || '0') || 0;
    const pageStyle = style(page);
    const mainStyle = style(main);
    const navStyle = style(nav);
    const unitFonts = [...document.querySelectorAll('.lm-unit')].filter(visible).map((el) => px(style(el)?.fontSize));
    const foodTargetFragments = [...document.querySelectorAll('.lv-food-line__eaten > .lv-food-note.lm-num')]
      .filter(visible).map((el) => {
        const node = el.firstChild;
        if (!node || node.nodeType !== Node.TEXT_NODE) return { lines: 0, fragments: 0 };
        const raw = node.textContent || '';
        const start = raw.search(/\S/);
        if (start < 0) return { lines: 0, fragments: 0 };
        const range = document.createRange();
        range.setStart(node, start); range.setEnd(node, raw.length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0.5);
        return { lines: new Set(rects.map((r) => Math.round(r.top))).size, fragments: rects.length };
      });
    const foodLine = (() => {
      const node = document.querySelector('.lv-food-targets__rx')?.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) return null;
      const raw = node.textContent || '';
      const unitAt = raw.indexOf('kcal');
      if (unitAt < 0) return null;
      let digitAt = unitAt - 1;
      while (digitAt >= 0 && !/\d/.test(raw[digitAt])) digitAt--;
      if (digitAt < 0) return null;
      const topAt = (at) => {
        const range = document.createRange();
        range.setStart(node, at); range.setEnd(node, at + 1);
        return range.getBoundingClientRect().top;
      };
      return { numberTop: topAt(digitAt), unitTop: topAt(unitAt), sameLine: Math.abs(topAt(digitAt) - topAt(unitAt)) < 2 };
    })();
    const overflowElements = [...document.querySelectorAll('main *')].filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.right > document.documentElement.clientWidth + 2 || r.left < -2)
      .sort((a, b) => b.r.right - a.r.right).slice(0, 8)
      .map(({ el, r }) => ({ tag: el.tagName.toLowerCase(), className: String(el.className?.baseVal ?? el.className ?? '').slice(0, 90), left: r.left, right: r.right, width: r.width }));
    const progressGap = b.progress && b.title ?
      (b.progress.top >= b.title.bottom - 1 ? b.progress.top - b.title.bottom : b.progress.left - b.title.right) : null;
    const progressOwnRow = !!(b.progress && b.title && b.progress.top >= b.title.bottom - 1);
    const contentLeft = b.page ? b.page.left + px(pageStyle.paddingLeft) : null;
    const contentRight = b.page ? b.page.right - px(pageStyle.paddingRight) : null;
    const contextStyle = style(context);
    const progressRightGap = b.progress && b.context ? b.context.right - px(contextStyle?.paddingRight) - b.progress.right : null;
    const progressCenterOffset = b.progress && b.context ?
      (b.progress.left + b.progress.right) / 2 - (b.context.left + px(contextStyle?.paddingLeft) + b.context.right - px(contextStyle?.paddingRight)) / 2 : null;
    const bottomSafeGap = b.nav ? innerHeight - b.nav.bottom : null;
    return {
      url: location.pathname + location.search,
      title: title?.textContent?.trim() || main?.querySelector('h1')?.textContent?.trim() || null,
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      boxes: b,
      theme: document.documentElement.dataset.theme || 'system',
      preferredDark: matchMedia('(prefers-color-scheme: dark)').matches,
      chassis: getComputedStyle(document.documentElement).getPropertyValue('--lm-chassis').trim(),
      background: getComputedStyle(document.body).backgroundColor,
      progressClass: progress?.className || null,
      progressGap, progressOwnRow, progressRightGap, progressCenterOffset,
      gutters: contentLeft == null ? null : { left: contentLeft, right: innerWidth - contentRight },
      bottomSafeGap,
      pagePadding: pageStyle ? { left: px(pageStyle.paddingLeft), right: px(pageStyle.paddingRight), top: px(pageStyle.paddingTop), bottom: px(pageStyle.paddingBottom) } : null,
      mainBottomPadding: px(mainStyle?.paddingBottom),
      navHeight: b.nav?.height || 0,
      actionHeight: b.action?.height || 0,
      navBottomPadding: px(navStyle?.paddingBottom),
      unitFonts: { count: unitFonts.length, min: unitFonts.length ? Math.min(...unitFonts) : null, unique: [...new Set(unitFonts)].sort((a, b) => a - b) },
      overflowElements,
      foodEnergyUnit: foodLine,
      foodTargetFragments,
      navVisible: !!nav,
      actionVisible: !!action,
      pageTextLength: (page?.innerText?.trim().length ?? 0),
      figureRenderer: document.querySelector('.lm-fig3d')?.getAttribute('data-renderer') || null,
    };
  });
}

function check(row, requested) {
  const m = row.metrics;
  const issues = [];
  if (m.overflow > 2) issues.push(`horizontal overflow ${m.overflow}px`);
  if (m.pageTextLength <= 10) issues.push('page content did not finish loading');
  if (m.figureRenderer === 'loading') issues.push('body figure is still loading');
  if (m.progressClass && m.boxes.progress && m.boxes.title) {
    if (m.progressGap < 12) issues.push(`progress/title gap ${m.progressGap.toFixed(1)}px`);
    if (m.viewport >= 768 && !m.progressOwnRow && Math.abs(m.progressRightGap) > 2 && (m.boxes.context?.width ?? 0) >= 400)
      issues.push(`progress misses title-row content edge by ${m.progressRightGap.toFixed(1)}px`);
    if (m.viewport === 390) {
      if (!m.progressOwnRow) issues.push('mobile progress is crowded into the title row');
      else if (Math.abs(m.progressCenterOffset) > 4 && m.progressRightGap > 4)
        issues.push(`mobile progress is unbalanced by ${m.progressCenterOffset.toFixed(1)}px`);
    }
  }
  if (m.pagePadding && Math.abs(m.pagePadding.left - m.pagePadding.right) > 3)
    issues.push(`uneven page padding ${m.pagePadding.left.toFixed(1)}/${m.pagePadding.right.toFixed(1)}px`);
  if (['/today', '/food', '/train'].includes(row.route) && m.pagePadding) {
    const top = m.viewport >= 1024 ? 20 : 16;
    if (Math.abs(m.pagePadding.top - top) > 1)
      issues.push(`page top spacing ${m.pagePadding.top.toFixed(1)}px; shared spacing is ${top}px`);
  }
  if (m.unitFonts?.min !== null && m.unitFonts?.min < 10.9)
    issues.push(`visible unit text is ${m.unitFonts.min.toFixed(1)}px`);
  if (row.route === '/food' && m.viewport === 390 && m.foodEnergyUnit?.sameLine === false)
    issues.push('Food energy unit wraps away from its value');
  if (row.route === '/food' && m.viewport === 390 && m.foodTargetFragments.some((row) => row.lines > 1))
    issues.push(`Food target value and unit split across lines (${m.foodTargetFragments.map((row) => row.lines).join(',')} lines)`);
  if (m.viewport === 390 && m.navVisible) {
    if (Math.abs(m.bottomSafeGap) > 2) issues.push(`mobile bottom bar misses viewport edge by ${m.bottomSafeGap.toFixed(1)}px`);
    if (m.mainBottomPadding < m.navHeight + m.actionHeight + 12)
      issues.push(`content bottom padding ${m.mainBottomPadding.toFixed(1)}px does not clear bars ${m.navHeight + m.actionHeight}px`);
  }
  const actual = new URL(row.url, origin).pathname;
  const entryAlias = (requested === '/simulate' && /^\/simulate\/[^/]+\/schedule$/.test(actual)) ||
    (['/plan', '/plan/run', '/plan/results'].includes(requested) && actual === '/plan/goals') ||
    (row.route === '/body?setup=habits' && actual === '/onboarding/activity');
  if (requested !== actual && !entryAlias) issues.push(`route redirected to ${actual}`);
  if (m.preferredDark !== (row.scheme === 'dark')) issues.push('OS color scheme emulation did not apply');
  return issues;
}

let result;
let expectedCount = 0;
try {
  result = await seed();
  const allRoutes = [...routeGroups.public, ...routeGroups.profile, ...(result.plan ? routeGroups.living : []), ...routeGroups.settings];
  const filter = process.env.DESIGN_ROUTES?.split(',').map((s) => s.trim()).filter(Boolean);
  const routes = filter ? allRoutes.filter((route) => filter.some((prefix) => route.startsWith(prefix))) : allRoutes;
  expectedCount = routes.length * widths.length * schemes.length;
  for (const scheme of schemes) {
    for (const width of widths) {
      const height = width === 390 ? 844 : width === 768 ? 1024 : 900;
      const ctx = await browser.newContext({
        viewport: { width, height }, colorScheme: scheme, isMobile: width === 390, hasTouch: width === 390,
        deviceScaleFactor: 1, serviceWorkers: 'block', storageState: result.state,
      });
      const page = await ctx.newPage();
      for (const route of routes) {
        try {
          await go(page, route);
          const shot = `${slug(route)}-${width}-${scheme}.png`;
          const actualPath = new URL(page.url()).pathname;
          const measure = await metrics(page);
          await page.screenshot({ path: path.join(phaseDir, shot), fullPage: true, animations: 'disabled' });
          const row = { route, url: page.url(), width, height, scheme, shot, renderedPath: actualPath, exactRoute: actualPath === new URL(route, origin).pathname, metrics: measure };
          row.issues = check(row, new URL(route, origin).pathname);
          if (new URL(row.url).pathname === '/welcome') row.issues.push('route returned to welcome');
          rows.push(row);
          if (phase === 'after' && row.issues.length) failures.push(`${route} ${width} ${scheme}: ${row.issues.join('; ')}`);
          console.log(`${phase} ${width} ${scheme} ${route} ${row.issues.length ? row.issues.join('; ') : 'ok'}`);
        } catch (error) {
          const message = `${route} ${width} ${scheme}: ${String(error.message).split('\n')[0]}`;
          rows.push({ route, width, height, scheme, error: message });
          if (phase === 'after') failures.push(message);
          console.error(message);
        }
      }
      await ctx.close().catch(() => undefined);
    }
  }
} finally {
  await browser.close().catch(() => undefined);
  const metricsFile = path.join(output, `${phase}-metrics.json`);
  if ((process.env.DESIGN_ROUTES || process.env.DESIGN_WIDTHS || process.env.DESIGN_SCHEMES || rows.length < expectedCount) && fs.existsSync(metricsFile)) {
    const previous = JSON.parse(fs.readFileSync(metricsFile, 'utf8')).rows || [];
    const fresh = new Set(rows.filter((row) => !row.error).map((row) => `${row.route}|${row.width}|${row.scheme}`));
    if (phase === 'before') rows.splice(0, rows.length, ...rows.filter((row) => !row.error));
    rows.unshift(...previous.filter((row) => !row.route.startsWith('/welcome') && !fresh.has(`${row.route}|${row.width}|${row.scheme}`)));
  }
  const allFailures = phase === 'after' ? rows.flatMap((row) => row.error ? [row.error] : (row.issues ?? []).map((issue) => `${row.route} ${row.width} ${row.scheme}: ${issue}`)) : [];
  if (phase === 'after' && rows.length < expectedCount) allFailures.push(`matrix incomplete: ${rows.length}/${expectedCount} requested screenshots`);
  if (phase === 'after') {
    const light = new Map(rows.filter((row) => row.scheme === 'light' && row.metrics).map((row) => [`${row.route}|${row.width}`, row.metrics.chassis]));
    for (const row of rows.filter((r) => r.scheme === 'dark' && r.metrics)) {
      const key = `${row.route}|${row.width}`;
      if (light.has(key) && light.get(key) === row.metrics.chassis) allFailures.push(`${row.route} ${row.width}: light and dark chassis tokens are identical`);
    }
  }
  fs.writeFileSync(metricsFile, JSON.stringify({ phase, base: origin, seededPlan: result?.plan ?? false, rows, failures: allFailures }, null, 2));
  failures.splice(0, failures.length, ...allFailures);
}
console.log(`${phase}: ${rows.length} screens, ${failures.length} strict failures; see .e6-tmp/c-design/${phase}-metrics.json`);
if (failures.length) process.exitCode = 1;
