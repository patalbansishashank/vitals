// Independent production-browser checks for the fixed footer and release-download regressions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { base, launch, options, output, widths, themes, go } from './lib.mjs';

const selectedCase = process.env.C_WEBQA_CASE ? new RegExp(process.env.C_WEBQA_CASE) : null;
const resultFile = path.join(output, selectedCase ? 'regressions-selected.json' : 'regressions.json');
const previous = process.env.C_WEBQA_RETEST === 'failed' ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : [];
const key = (name, width, theme) => `${name}|${width}|${theme}`;
const retest = new Set(previous.filter((r) => !r.passed).map((r) => key(r.name, r.width, r.theme)));
const report = previous.filter((r) => r.passed);
const state = JSON.parse(fs.readFileSync(path.join(output, 'seeded-state.json'), 'utf8'));
const shellRoutes = ['/body', '/ring', '/signals', '/plan/goals', '/today', '/food', '/food/pantry', '/train', '/progress', '/settings/data', '/settings/install'];
const focusable = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]';
const browser = await launch();
const runtime = { pageErrors: [], consoleErrors: [], failedRequests: [] };
const sameOrigin = (url) => new URL(url).origin === new URL(base).origin;
function observe(page) {
  page.on('pageerror', (error) => runtime.pageErrors.push(error.message.slice(0, 250)));
  page.on('console', (message) => { if (message.type() === 'error') runtime.consoleErrors.push(message.text().slice(0, 250)); });
  page.on('response', (response) => {
    if (response.status() >= 400 && sameOrigin(response.url())) runtime.failedRequests.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText || 'request failed';
    if (sameOrigin(request.url()) && !error.includes('ERR_ABORTED')) runtime.failedRequests.push({ path: new URL(request.url()).pathname, error });
  });
}
const runtimeSnapshot = () => ({ pageErrors: [...runtime.pageErrors], consoleErrors: [...runtime.consoleErrors], failedRequests: [...runtime.failedRequests] });

async function record(name, width, theme, run) {
  if (selectedCase && !selectedCase.test(name)) return;
  if (previous.length && !retest.has(key(name, width, theme))) return;
  for (const entries of Object.values(runtime)) entries.length = 0;
  try {
    const evidence = await run();
    assert.equal(runtime.pageErrors.length, 0, 'Page runtime errors');
    assert.equal(runtime.consoleErrors.length, 0, 'Console errors');
    assert.equal(runtime.failedRequests.length, 0, 'Failed same-origin requests');
    report.push({ name, width, theme, passed: true, evidence, runtime: runtimeSnapshot() });
  } catch (error) {
    report.push({ name, width, theme, passed: false, error: error.message.split('\n')[0], runtime: runtimeSnapshot() });
    console.error('FAIL', name, width, theme, error.message.split('\n')[0]);
  }
  fs.writeFileSync(resultFile, JSON.stringify(report, null, 2));
}

async function mockRelease(context, mode) {
  await context.route((url) => /\/repos\/[^/]+\/[^/]+\/releases\/latest$/.test(url.pathname), async (route) => {
    const signed = mode === 'signed';
    const supplied = new URL('/metadata-supplied.apk', base);
    supplied.protocol = 'https:';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      tag_name: 'v0.5.0', assets: [{ name: signed ? 'Vitals-android.apk' : 'Vitals-android-unsigned.apk', size: 1024, browser_download_url: supplied.href }],
    }) });
  });
}

async function focusedGeometry(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    const r = element.getBoundingClientRect();
    const bars = [...document.querySelectorAll('.lm-onb-foot,.lm-tabbar,.lm-actionbar')]
      .filter((e) => e.getClientRects().length && !e.contains(element))
      .map((e) => e.getBoundingClientRect());
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      name: (element.getAttribute('aria-label') || element.textContent || element.tagName).trim().replace(/\s+/g, ' ').slice(0, 100),
      tag: element.tagName, top: r.top, bottom: r.bottom,
      visible: r.width > 0 && r.height > 0 && r.top >= -1 && r.bottom <= innerHeight + 1,
      hit: Boolean(hit && (element === hit || element.contains(hit))),
      covered: bars.some((b) => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top),
      footerTop: bars.length ? Math.min(...bars.map((b) => b.top)) : null,
    };
  });
}

function assertClear(geometry) {
  assert.ok(geometry.visible, `${geometry.name}: outside viewport ${JSON.stringify(geometry)}`);
  assert.ok(geometry.hit, `${geometry.name}: center intercepted ${JSON.stringify(geometry)}`);
  assert.equal(geometry.covered, false, `${geometry.name}: behind footer ${JSON.stringify(geometry)}`);
}

async function keyboardWalk(page, max) {
  await page.locator('h1').first().focus();
  const geometries = [];
  const seen = new Set();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(40);
    const identity = await page.evaluate(() => {
      const e = document.activeElement;
      if (e === document.body || !(e instanceof HTMLElement)) return null;
      const all = [...document.querySelectorAll('*')];
      return all.indexOf(e);
    });
    if (identity === null || seen.has(identity)) break;
    seen.add(identity);
    const geometry = await focusedGeometry(page);
    // The skip link belongs to the shell. It is only displayed while focused and may overlay the header.
    if (await page.evaluate(() => document.activeElement.closest('main,.lm-onb-foot') !== null)) {
      assertClear(geometry);
      geometries.push(geometry);
    }
  }
  return geometries;
}

async function finalShellControl(page) {
  await page.evaluate((selector) => {
    const shown = (e) => {
      const closed = e.closest('details:not([open])');
      return e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.disabled && e.tabIndex >= 0
        && (!closed || closed.querySelector(':scope > summary')?.contains(e));
    };
    const all = [...document.querySelectorAll(selector)].filter(shown);
    const target = all.filter((e) => e.closest('main') && !e.closest('.lm-ctx-slot')).at(-1);
    if (!target) throw new Error('No final main control');
    const previous = all[all.indexOf(target) - 1];
    if (!previous) throw new Error('No preceding keyboard control');
    window.__qaFinalControl = target;
    window.scrollTo(0, 0);
    previous.focus({ preventScroll: true });
  }, focusable);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  const reached = await page.evaluate(() => ({ reached: document.activeElement === window.__qaFinalControl,
    expected: window.__qaFinalControl.outerHTML.slice(0, 300), actual: document.activeElement.outerHTML.slice(0, 300) }));
  assert.ok(reached.reached, `Tab did not reach final control ${JSON.stringify(reached)}`);
  const focused = await focusedGeometry(page);
  assertClear(focused);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(100);
  const bottom = await focusedGeometry(page);
  assert.equal(bottom.covered, false, `${bottom.name}: behind footer at document bottom ${JSON.stringify(bottom)}`);
  // Some final controls precede long explanatory text; at maximum scroll they can be above the viewport.
  if (bottom.visible) assertClear(bottom);
  return { focused, bottom };
}

try {
  for (const width of widths) for (const theme of themes) {
    const fresh = await browser.newContext(options(width, theme));
    await mockRelease(fresh, 'unsigned');
    const page = await fresh.newPage();
    observe(page);
    await record('built-css-layer-order', width, theme, async () => {
      await go(page, '/welcome', theme);
      const info = await page.evaluate(() => {
        const nodes = [...document.head.children];
        const layer = nodes.findIndex((e) => e.tagName === 'STYLE' && /@layer\s+properties,\s*theme,\s*base,\s*components,\s*utilities/.test(e.textContent));
        const links = nodes.map((e, i) => ({ e, i })).filter(({ e }) => e.matches('link[rel=stylesheet]')).map(({ i }) => i);
        return { layer, links, theme: document.documentElement.dataset.theme,
          scrollPaddingBottom: getComputedStyle(document.documentElement).scrollPaddingBottom };
      });
      assert.ok(info.layer >= 0 && info.links.length > 0, 'Built CSS layer declaration or stylesheet missing');
      assert.ok(info.links.every((i) => i > info.layer), 'Stylesheet precedes layer order');
      assert.equal(info.theme, theme, 'Requested theme was not applied');
      return info;
    });
    await record('welcome-keyboard-links', width, theme, async () => {
      await go(page, '/welcome', theme);
      await page.locator('.lm-dl[aria-busy=false]').waitFor();
      const controls = await keyboardWalk(page, 60);
      assert.ok(controls.some((g) => g.name === 'All releases'), 'Release link was not reached');
      assert.ok(controls.some((g) => /keep using the website/i.test(g.name)), 'Website button was not reached');
      return { checked: controls.length, controls };
    });
    await record('screening-keyboard-questions', width, theme, async () => {
      await go(page, '/welcome?step=screening', theme);
      const controls = await keyboardWalk(page, 120);
      assert.ok(controls.filter((g) => g.tag === 'BUTTON' || g.tag === 'INPUT').length >= 5, 'Questions were not reached');
      return { checked: controls.length, controls };
    });
    await fresh.close();

    const seeded = await browser.newContext({ ...options(width, theme), storageState: state });
    await mockRelease(seeded, 'unsigned');
    const shell = await seeded.newPage();
    observe(shell);
    for (const route of shellRoutes) {
      await record(`shell-final-control:${route}`, width, theme, async () => {
        await go(shell, route, theme);
        assert.equal(new URL(shell.url()).pathname, route, 'Seeded route redirected');
        return finalShellControl(shell);
      });
    }
    await seeded.close();

    let signedHref = previous.find((r) => r.name === 'android-download:signed' && r.width === width && r.theme === theme)?.evidence?.downloadHref;
    for (const mode of ['unsigned', 'signed', 'legacy-cache', 'legacy-url', 'current-cache', 'cache-url']) {
      const android = await browser.newContext({ ...options(width, theme), userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
      await mockRelease(android, mode === 'signed' ? 'signed' : 'unsigned');
      if (['legacy-cache', 'legacy-url', 'current-cache', 'cache-url'].includes(mode)) {
        await android.addInitScript(({ origin, mode }) => {
          const name = mode.endsWith('url') ? 'Vitals-android.apk' : 'Vitals-android-unsigned.apk';
          const url = new URL(`/${name}`, origin);
          url.protocol = 'https:';
          const cacheKey = mode.startsWith('legacy') ? 'vitals.release.v1' : 'vitals.release.v2';
          sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), state: { kind: 'release', version: '0.5.0', assets: [{ key: 'android', name, url: url.href }] } }));
        }, { origin: base, mode });
      }
      const downloadPage = await android.newPage();
      observe(downloadPage);
      await record(`android-download:${mode}`, width, theme, async () => {
        await go(downloadPage, '/welcome', theme);
        await downloadPage.locator('.lm-dl[aria-busy=false]').waitFor();
        const link = downloadPage.getByRole('link', { name: 'Download for Android', exact: true });
        const apks = await downloadPage.locator('.lm-dl a[href]').evaluateAll((elements) => elements.filter((e) => /\.apk(?:[?#]|$)/i.test(e.getAttribute('href'))).map((e) => e.getAttribute('href').split('/').at(-1)));
        if (mode === 'signed' || mode === 'cache-url') {
          assert.equal(await link.count(), 1, 'Signed Android download absent');
          assert.deepEqual(apks, ['Vitals-android.apk']);
          const href = await link.getAttribute('href');
          if (mode === 'signed') {
            signedHref = href;
            assert.match(new URL(href).pathname, /\/releases\/latest\/download\/Vitals-android\.apk$/);
          } else {
            assert.equal(href, signedHref, 'Current cache bypassed pinned download URL');
          }
        } else {
          assert.equal(await link.count(), 0, 'Unsigned Android still offered');
          assert.deepEqual(apks, []);
          assert.match(await downloadPage.locator('.lm-dl').innerText(), /not ready|keep using the website/i);
        }
        return { apkLinks: apks, androidDownloads: await link.count(), downloadHref: await link.count() ? await link.getAttribute('href') : null };
      });
      await android.close();
    }
  }
} finally {
  await browser.close();
}
const failed = report.filter((r) => !r.passed);
console.log(JSON.stringify({ cases: report.length, passed: report.length - failed.length, failed: failed.length,
  keyboardControls: report.reduce((n, r) => n + (r.evidence?.checked || 0) + Number(Boolean(r.evidence?.focused)), 0),
  pageErrors: report.reduce((n, r) => n + (r.runtime?.pageErrors.length || 0), 0),
  consoleErrors: report.reduce((n, r) => n + (r.runtime?.consoleErrors.length || 0), 0),
  failedSameOriginRequests: report.reduce((n, r) => n + (r.runtime?.failedRequests.length || 0), 0) }));
process.exitCode = failed.length ? 1 : 0;
