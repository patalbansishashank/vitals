/** Real pointer/touch regression smoke for Today card editing.
 * Local: TMPDIR=/tmp pnpm test:browser (uses /usr/bin/chromium when available).
 * CI: pnpm exec playwright-core install --with-deps chromium, then pnpm test:browser.
 * Uses synthetic profiles and isolated browser contexts; never pairs with a real server.
 * BROWSER_SMOKE_SCREENSHOTS=1 records the bounded normal/edit viewport matrix for visual review.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const repo = resolve(import.meta.dirname, '../..');
const output = resolve(repo, '.vitest/browser');
const { version } = JSON.parse(await readFile(resolve(repo, 'package.json'), 'utf8'));
const INITIAL = ['energy:card', 'sleep:card', 'steps:tile', 'weight:tile'];
const checks = [];
const errors = [];
const started = Date.now();
const contexts = [];
let server, browser, page, cdp, deadline, base;
let current = 'startup';
let device = 'startup';
await mkdir(output, { recursive: true });
await rm(resolve(output, 'failure.png'), { force: true });

const settle = () => page.waitForTimeout(250);
const grid = () => page.locator('.lv-today__grid');
const card = (id) => page.locator(`.lv-today__grid > [data-id="${id}"]`);
const ids = (saved) => saved.map((entry) => entry.split(':')[0]);
const sizes = (saved) => Object.fromEntries(saved.map((entry) => entry.split(':')));
async function layout(target = page) {
  return target.evaluate(async () => {
    const { useSettingsStore } = await import('/src/state/settingsStore.ts');
    const grid = document.querySelector('.lv-today__grid');
    const bounds = grid?.getBoundingClientRect();
    return {
      saved: useSettingsStore.getState().todayCards,
      order: [...document.querySelectorAll('.lv-today__grid > [data-id]:not([data-empty])')].map((e) => e.dataset.id),
      editing: grid?.getAttribute('data-rearrange') === 'true',
      scroll: scrollY,
      active: !!document.querySelector('[data-dragging], [data-resizing]'),
      drop: document.querySelector('[data-drop-target]')?.getAttribute('data-id') ?? null,
      viewport: { width: innerWidth, height: innerHeight, root: document.documentElement.scrollWidth },
      grid: bounds ? { left: bounds.left, width: bounds.width } : null,
      cells: [...document.querySelectorAll('.lv-today__grid > [data-id]:not([data-empty])')].map((e) => {
        const r = e.getBoundingClientRect();
        return { id: e.dataset.id, savedSize: e.dataset.size, width: r.width, left: r.left };
      }),
    };
  });
}
async function check(name, run) {
  current = `${device}: ${name}`;
  await page.evaluate(() => { window.__browserSmokeEvents = []; });
  const at = Date.now();
  const detail = await run();
  const row = { device, name, status: 'passed', durationMs: Date.now() - at, ...detail,
    events: await page.evaluate(() => window.__browserSmokeEvents) };
  checks.push(row);
  console.log(JSON.stringify({ device, name, status: row.status, durationMs: row.durationMs }));
}
async function scrollTo(y) {
  await page.evaluate(async (top) => (await import('/src/app/motion.ts')).scrollPageTo(top, { immediate: true }), y);
  await settle();
}
async function pointOn(locator) {
  await locator.scrollIntoViewIfNeeded();
  const initial = await locator.boundingBox();
  assert(initial, 'Gesture source must exist');
  const header = await page.locator('.lm-ctx-slot').boundingBox();
  await scrollTo((await layout()).scroll + initial.y - (header?.height ?? 100) - 28);
  const r = await locator.boundingBox();
  assert(r, 'Gesture source must remain mounted');
  const { height } = page.viewportSize();
  assert(r.y + r.height / 2 > (header?.height ?? 0) && r.y + r.height / 2 < height - 20, 'Gesture source must be on screen below the sticky header');
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
async function touch(type, x, y) {
  const point = (xx, yy) => ({ x: xx, y: yy, radiusX: 8, radiusY: 8, force: 0.5 });
  await cdp.send('Input.dispatchTouchEvent', { type,
    touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [point(x, y)] });
  // A real small drift is essential: stationary synthetic PointerEvents miss implicit child-capture transfers.
  if (type === 'touchStart') await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [point(x + 4, y + 3)],
  });
}
async function moveTouch(x, y, toX, toY) {
  for (let step = 1; step <= 8; step++) {
    await touch('touchMove', x + (toX - x) * step / 8, y + (toY - y) * step / 8);
    await page.waitForTimeout(25);
  }
}
async function hold(x, y, id = 'energy') {
  await touch('touchStart', x, y);
  await page.waitForTimeout(470);
  await page.locator(`.lv-today__grid > [data-id="${id}"][data-dragging]`).waitFor({ state: 'attached' });
}
async function selectMode(editing) {
  assert.equal(await page.getByRole('button', { name: 'Edit cards', exact: true }).count(), 0, 'No separate edit-entry button');
  assert.equal(await page.getByRole('link', { name: 'Edit cards', exact: true }).count(), 0, 'No alternate edit-entry link');
  const menu = page.getByRole('button', { name: 'More', exact: true });
  assert.equal(await menu.count(), 1, 'Use the existing single three-dot menu');
  if (cdp) await menu.tap(); else await menu.click();
  const label = editing ? 'Edit cards' : 'Done editing cards';
  const item = page.getByRole('menuitem', { name: label, exact: true });
  assert.equal(await item.count(), 1, `Exactly one existing ${label} action`);
  if (cdp) await item.tap(); else await item.click();
  await page.waitForFunction((expected) => (document.querySelector('.lv-today__grid')?.getAttribute('data-rearrange') === 'true') === expected, editing);
  await settle();
}
async function modeIs(editing, mobile) {
  const state = await layout();
  assert.equal(state.editing, editing);
  assert.equal(await page.getByRole('button', { name: 'Add a card', exact: true }).count(), editing ? 1 : 0);
  if (!editing || mobile) assert.equal(await page.locator('.lv-today__grid .lm-cardgrid__corner').count(), 0, 'No resize controls in ordinary mode or on a phone');
  assert(!state.active, 'No abandoned gesture');
  assert(state.viewport.root <= state.viewport.width + 1, 'No horizontal page overflow');
  return state;
}
async function phoneWidths(expectedSaved) {
  const state = await layout();
  assert(state.grid && state.cells.length >= 4);
  for (const c of state.cells) {
    assert(Math.abs(c.left - state.grid.left) <= 1 && Math.abs(c.width - state.grid.width) <= 2, `${c.id} must fill the phone card area`);
  }
  assert.deepEqual(state.saved, expectedSaved, 'Viewport changes must not rewrite stored widths or order');
  assert.equal(await page.locator('.lv-today__grid .lm-cardgrid__corner').count(), 0);
  return { viewport: state.viewport, grid: state.grid, cells: state.cells };
}
async function screenshot(label) {
  if (process.env.BROWSER_SMOKE_SCREENSHOTS !== '1') return;
  await scrollTo(0);
  await page.screenshot({ path: resolve(output, `${device}-${label}.png`) });
}
async function ordinaryActions() {
  const before = await layout();
  const info = page.getByRole('button', { name: 'About Energy', exact: true });
  await info.scrollIntoViewIfNeeded();
  if (cdp) await info.tap(); else await info.click();
  const panel = page.locator('dialog[open], aside.lm-sidepanel').filter({ has: page.getByRole('heading', { name: 'Energy', exact: true }) }).first();
  await panel.waitFor();
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert(await info.evaluate((e) => document.activeElement === e), 'Info closes back to its opener');
  const plot = card('energy').locator('.lmz-line__plot[tabindex="0"]').first();
  await plot.scrollIntoViewIfNeeded();
  await plot.focus();
  await page.keyboard.press('End');
  await page.waitForFunction(() => !!document.querySelector('[data-id="energy"] .lmz-line [aria-live]')?.textContent?.trim());
  assert(!((await layout()).active), 'Chart keyboard interaction must not start editing');
  await page.keyboard.press('Escape');
  const link = card('energy').locator('.lm-gcard__open');
  if (cdp) await link.tap(); else await link.click();
  await page.waitForURL(/\/energy(?:[/?#]|$)/);
  await page.goBack();
  await card('weight').waitFor();
  await settle();
  assert.deepEqual((await layout()).saved, before.saved);
  await modeIs(false, false);
  return { info: true, chartReadout: true, ordinaryCardLink: true };
}
async function nativeScroll() {
  const { x, y } = await pointOn(card('energy').locator('.lm-hero__digits').first());
  const before = await layout();
  await touch('touchStart', x, y);
  await moveTouch(x, y, x, Math.max(12, y - 150));
  await touch('touchEnd');
  await page.waitForTimeout(350);
  const after = await layout();
  assert(after.scroll > before.scroll + 40, 'Moving before the hold threshold must scroll natively');
  assert.deepEqual(after.saved, before.saved); assert.deepEqual(after.order, before.order); assert(!after.active);
  return { scrollDelta: after.scroll - before.scroll };
}
async function normalTouchHold() {
  const { x, y } = await pointOn(card('energy').locator('.lm-hero__digits').first());
  const before = await layout();
  await touch('touchStart', x, y); await page.waitForTimeout(470);
  assert(!(await layout()).active, 'Normal phone hold must not begin card editing');
  await moveTouch(x, y, x, Math.max(12, y - 100));
  await touch('touchEnd'); await settle();
  const after = await layout();
  assert.deepEqual(after.saved, before.saved); assert.deepEqual(after.order, before.order); assert(!after.active);
  assert.equal(new URL(page.url()).pathname, '/today');
}
async function phoneReorder() {
  const { x, y } = await pointOn(card('energy').locator('.lm-gcard__open'));
  const source = await card('energy').boundingBox();
  const target = await card('sleep').boundingBox();
  const before = await layout();
  await hold(x, y);
  const desiredY = y + target.y + target.height / 2 - source.y - source.height / 2;
  const endY = Math.max(20, Math.min(page.viewportSize().height - 28, desiredY));
  await moveTouch(x, y, x, endY);
  await page.waitForFunction(() => !!document.querySelector('[data-id="sleep"][data-drop-target]'), null, { timeout: 2500 });
  assert((await layout()).active, 'Drift/capture transfer must keep the held reorder active');
  await touch('touchEnd'); await settle();
  const after = await layout();
  assert.deepEqual(after.order, ['hero', 'sleep', 'energy', 'steps', 'weight']);
  assert.deepEqual(sizes(after.saved), sizes(before.saved), 'Phone reorder never mutates desktop widths');
  assert.equal(new URL(page.url()).pathname, '/today');
  return { saved: after.saved, order: after.order };
}
async function touchCancel() {
  const { x, y } = await pointOn(card('energy').locator('.lm-info'));
  const before = await layout();
  await hold(x, y); await moveTouch(x, y, x, Math.min(page.viewportSize().height - 28, y + 70));
  await touch('touchCancel'); await settle();
  const after = await layout();
  assert(!after.active); assert.deepEqual(after.saved, before.saved); assert.deepEqual(after.order, before.order);
  assert(after.editing, 'Pointer cancellation must not commit a layout or replace the mode action');
  assert.equal(new URL(page.url()).pathname, '/today');
  return { saved: after.saved };
}
async function mouseDrag(sourceSelector, targetId = 'sleep') {
  const locator = card('energy').locator(sourceSelector).first();
  const { x, y } = await pointOn(locator);
  const source = await card('energy').boundingBox();
  const target = await card(targetId).boundingBox();
  assert(source && target);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 12, y + 2);
  await page.locator('[data-id="energy"][data-dragging]').waitFor();
  await page.mouse.move(x + target.x + target.width / 2 - source.x - source.width / 2,
    y + target.y + target.height / 2 - source.y - source.height / 2, { steps: 10 });
  assert((await layout()).active);
  await page.mouse.up(); await settle();
  assert.equal(new URL(page.url()).pathname, '/today', 'Edit drag from content must not navigate');
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Edit drag from an info control must not open it');
}

async function createDevice(name, { mobile, width = 1440, height = 900 }) {
  current = `${name}: startup`;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile,
    deviceScaleFactor: mobile ? 3 : 1, timezoneId: 'UTC', serviceWorkers: 'block', reducedMotion: 'no-preference' });
  contexts.push(context);
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === base || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
  });
  await context.addInitScript(({ mobile, version }) => {
    window.__VITALS_GAUGE_DEMO__ = true;
    window.__browserSmokeEvents = [];
    for (const type of ['pointercancel', 'lostpointercapture', 'touchmove', 'click']) window.addEventListener(type, (event) => {
      const target = event.target;
      window.__browserSmokeEvents.push({ type, target: typeof target?.className === 'string' ? target.className : target?.nodeName,
        cancelable: event.cancelable, prevented: event.defaultPrevented });
      if (window.__browserSmokeEvents.length > 100) window.__browserSmokeEvents.shift();
    }, { passive: true });
    if (!mobile) return;
    const state = {
      mode: 'active', gauge: { installed: false, pendingUploads: null },
      ring: { state: 'connected', name: 'Synthetic ring', address: 'AA:BB:CC:DD:EE:01', battery: 64,
        lastSyncAt: new Date().toISOString(), credentialRequired: false, credentialConfigured: true,
        credentialRejected: false, credentialAuthenticated: true },
      permissions: { bluetooth: 'granted', healthConnect: 'granted', activityRecognition: 'granted', notifications: 'granted',
        shortVideoAccessibility: true, batteryUnrestricted: true },
      upload: { paired: true, pending: 0, lastSentAt: new Date().toISOString() },
      shortVideo: { enabled: true, dailyLimit: 30, today: { instagram: 7, youtube: 4 } },
    };
    const remove = async () => ({ remove() {} });
    const gauge = { getState: async () => structuredClone(state), addListener: remove, configure: async () => undefined,
      syncNow: async () => structuredClone(state), measure: async () => ({ started: true }), scanRings: async () => ({ devices: [] }) };
    const updates = { ready: async () => undefined, addListener: remove,
      status: async () => ({ versionName: version, versionCode: 999999, webVersion: 'smoke', webEmbedded: true,
        webPending: null, apk: null, bad: [], metered: false, canApplyWeb: true }) };
    window.Capacitor = { getPlatform: () => 'android', isNativePlatform: () => true,
      registerPlugin: (name) => name === 'GaugeEngine' ? gauge : name === 'VitalsUpdates' ? updates : undefined };
  }, { mobile, version });
  const target = await context.newPage();
  page = target; cdp = null; device = name;
  target.setDefaultTimeout(12_000); target.setDefaultNavigationTimeout(30_000);
  target.on('pageerror', (error) => errors.push({ device: name, message: error.message }));
  await target.goto(`${base}/settings`);
  await target.evaluate(async (saved) => {
    const { seedClearedSafety } = await import('/src/features/onboarding/testing.ts');
    const { useProfileStore } = await import('/src/state/profileStore.ts');
    const { useSettingsStore } = await import('/src/state/settingsStore.ts');
    const { bootDocuments, settleUnscopedWrites, getDocumentStore } = await import('/src/state/runtime.ts');
    const { settleCommits } = await import('/src/commands/history.ts');
    const { flushAllMirrors } = await import('/src/state/bridge.ts');
    const { useSafetyStore } = await import('/src/state/safetyStore.ts');
    const { gateStatus } = await import('/src/features/onboarding/gate.ts');
    const { ACK_VERSIONS } = await import('/src/features/onboarding/copy.ts');
    await bootDocuments(); seedClearedSafety();
    const profile = useProfileStore.getState();
    profile.setSex('male'); profile.setAge(38); profile.setHeight(178); profile.setWeight(77); profile.setSetup('done');
    useSettingsStore.getState().set({ todayCards: saved });
    // Public store actions use the command commit queue; unscoped migration writes are a separate queue.
    // Await both before replacing this document, especially in a warmed second browser context.
    await settleUnscopedWrites();
    await settleCommits();
    flushAllMirrors();
    const state = useSafetyStore.getState();
    if (gateStatus(state, new Date().toISOString()).status !== 'ready'
      || getDocumentStore().peek('safety', 'me')?.acknowledgements?.disclaimer?.version !== ACK_VERSIONS.disclaimer)
      throw new Error('Synthetic onboarding fixture did not persist a current disclaimer acknowledgement');
  }, INITIAL);
  await target.goto(`${base}/today`);
  await target.locator('[data-id="weight"] .lm-cardhead').waitFor();
  await target.evaluate(() => document.fonts.ready);
  return { context, page: target, cdp: mobile ? await context.newCDPSession(target) : null };
}
async function useDevice(name, d) { device = name; page = d.page; cdp = d.cdp; await page.bringToFront(); }

async function desktopSmoke() {
  const a = await createDevice('desktop', { mobile: false });
  const b = await createDevice('independent-profile', { mobile: false });
  await useDevice('desktop', a);
  await check('ordinary mode hides layout controls and ignores surface/corner drags', async () => {
    const before = await modeIs(false, false);
    const point = await pointOn(card('energy').locator('.lm-hero__digits').first());
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.waitForTimeout(470);
    await page.mouse.move(point.x + 100, point.y + 40, { steps: 8 }); await page.mouse.up(); await settle();
    await pointOn(card('weight'));
    const r = await card('weight').boundingBox();
    await page.mouse.move(r.x + r.width - 8, r.y + r.height - 8); await page.mouse.down();
    await page.mouse.move(r.x + r.width + 72, r.y + r.height - 8, { steps: 8 }); await page.mouse.up(); await settle();
    const after = await modeIs(false, false);
    assert.deepEqual(after.saved, before.saved); assert.deepEqual(after.order, before.order);
    await screenshot('normal');
  });
  await check('ordinary info, chart and card link work', ordinaryActions);
  await check('existing menu enters edit mode; title, info and chart surfaces reorder', async () => {
    await selectMode(true); await modeIs(true, false);
    await mouseDrag('.lm-gcard__open');
    assert.deepEqual((await layout()).order, ['hero', 'sleep', 'energy', 'steps', 'weight']);
    await mouseDrag('.lm-info');
    assert.deepEqual((await layout()).order, ['hero', 'energy', 'sleep', 'steps', 'weight']);
    await mouseDrag('.lmz-line__plot');
    assert.deepEqual((await layout()).order, ['hero', 'sleep', 'energy', 'steps', 'weight']);
    await screenshot('editing');
  });
  await check('edit corner resizing persists a non-default desktop width', async () => {
    const corner = page.getByRole('slider', { name: 'Width of Weight', exact: true });
    const { x, y } = await pointOn(corner);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 80, y, { steps: 8 }); await page.mouse.up(); await settle();
    const after = await layout();
    assert.equal(sizes(after.saved).weight, 'card');
    return { saved: after.saved };
  });
  await check('Escape abandons a resize without consuming the next ordinary interaction', async () => {
    const before = await layout();
    const { x, y } = await pointOn(page.getByRole('slider', { name: 'Width of Weight', exact: true }));
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 80, y, { steps: 8 });
    assert((await layout()).active);
    await page.keyboard.press('Escape'); await page.mouse.up(); await settle();
    assert(!(await layout()).active); assert.deepEqual((await layout()).saved, before.saved);
    assert.equal(new URL(page.url()).pathname, '/today');
    assert(!(await layout()).editing, 'An unconsumed Escape also leaves page editing');
    await ordinaryActions(); // The first genuine info tap must work after the abandoned release.
    await selectMode(true); // The separate Done check still exits through the existing menu.
  });
  await check('Done in the existing menu restores ordinary interactions', async () => {
    await selectMode(false); await modeIs(false, false);
    return ordinaryActions();
  });
  await check('reload persists edits while another isolated profile keeps its own layout', async () => {
    const before = await layout();
    assert.equal(sizes(before.saved).weight, 'card');
    await page.reload(); await card('weight').waitFor(); await settle();
    const after = await modeIs(false, false);
    assert.deepEqual(after.saved, before.saved); assert.deepEqual(after.order, ['hero', ...ids(before.saved)]);
    assert.deepEqual((await layout(b.page)).saved, INITIAL);
    await b.page.reload(); await b.page.locator('[data-id="weight"]').waitFor();
    const independent = await layout(b.page);
    assert.deepEqual(independent.saved, INITIAL); assert.deepEqual(independent.order, ['hero', ...ids(INITIAL)]);
    return { saved: after.saved, independentSaved: independent.saved,
      boundary: 'Browser-profile persistence only; actual shared-sync exclusion is covered by device-settings integration tests.' };
  });
}
async function phoneSmoke(width) {
  const d = await createDevice(`phone-${width}`, { mobile: true, width });
  await useDevice(`phone-${width}`, d);
  await check('ordinary portrait is full width with no edit gestures or Add action', async () => {
    await modeIs(false, true); await phoneWidths(INITIAL); await nativeScroll(); await normalTouchHold();
    await screenshot('normal');
  });
  if (width === 390) await check('ordinary phone info, chart and link remain interactive', ordinaryActions);
  await check('existing menu enables reorder only; pre-hold movement still scrolls', async () => {
    await selectMode(true); await modeIs(true, true); await nativeScroll();
    return phoneWidths(INITIAL);
  });
  await check('real touch drift hold reorders and cancellation preserves saved widths', async () => {
    const detail = await phoneReorder(); await touchCancel(); await phoneWidths(detail.saved);
    await screenshot('editing'); return detail;
  });
  await check('Done restores portrait interactions and reload keeps local order', async () => {
    const before = await layout(); await selectMode(false); await modeIs(false, true);
    await page.reload(); await card('weight').waitFor(); await settle();
    assert.deepEqual((await layout()).saved, before.saved); await phoneWidths(before.saved);
    if (width === 390) await ordinaryActions();
    return { saved: before.saved };
  });
  await check('phone landscape stays full width in both modes without saved width mutations', async () => {
    const before = await layout();
    await page.setViewportSize({ width: 900, height: width }); await settle();
    const normal = await modeIs(false, true); await phoneWidths(before.saved); await screenshot('landscape-normal');
    await selectMode(true); await modeIs(true, true); await phoneWidths(before.saved);
    await nativeScroll(); await touchCancel(); await phoneWidths(before.saved); await screenshot('landscape-editing');
    await selectMode(false); await modeIs(false, true);
    await page.setViewportSize({ width, height: 900 }); await settle(); await phoneWidths(before.saved);
    return { landscape: normal.viewport, saved: before.saved };
  });
}
async function smoke() {
  server = await createServer({ root: repo, configFile: resolve(repo, 'vite.config.ts'), cacheDir: resolve(output, 'vite-cache'),
    server: { host: '127.0.0.1', port: 0, strictPort: true, watch: null, hmr: false } });
  await server.listen();
  const address = server.httpServer.address(); assert(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}`;
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH || (!process.env.CI && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  await desktopSmoke();
  await phoneSmoke(390);
  await phoneSmoke(360);
  assert.deepEqual(errors, [], 'Browser page errors');
}

let failure = null;
try {
  await Promise.race([smoke(), new Promise((_, reject) => {
    deadline = setTimeout(() => reject(new Error(`Browser smoke exceeded 150s during ${current}`)), 150_000);
  })]);
} catch (error) {
  failure = { name: current, message: String(error), stack: error.stack };
  if (page && !page.isClosed()) {
    failure.url = page.url();
    failure.title = await page.locator('h1').first().textContent({ timeout: 1000 }).catch(() => null);
    failure.events = await page.evaluate(() => window.__browserSmokeEvents ?? []).catch(() => []);
    failure.layout = await layout().catch(() => null);
    await page.screenshot({ path: resolve(output, 'failure.png'), timeout: 5000 }).catch(() => undefined);
  }
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  const report = { status: failure ? 'failed' : 'passed', durationMs: Date.now() - started,
    browser: browser?.version() ?? null, synthetic: true, isolatedContexts: contexts.length, cases: ['desktop-1440x900', 'phone-390x900', 'phone-360x900', 'native-phone-landscape-900x390', 'native-phone-landscape-900x360'],
    checks, errors, failure };
  await writeFile(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, checks: checks.length, durationMs: report.durationMs, failure }));
  await browser?.close(); await server?.close();
}
