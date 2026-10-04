// Delay only release metadata so loading-to-signed layout changes can be measured after fonts settle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { base, launch, options, output, widths, themes } from './lib.mjs';

const assets = ['Vitals-android.apk', 'Vitals-windows-x64-setup.exe', 'Vitals-macos-universal.dmg', 'Vitals-linux-x86_64.AppImage', 'Vitals-linux-amd64.deb'];
const userAgents = {
  android: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
  macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
};
const labels = { android: 'Android', linux: 'Linux (AppImage)', windows: 'Windows', macos: 'Mac' };
const selectedSystems = process.env.C_WEBQA_DOWNLOAD_OS?.split(',') || Object.keys(userAgents);
const report = [];
const browser = await launch();

async function geometry(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const e = document.querySelector(selector);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return { top: r.top, documentTop: r.top + scrollY, bottom: r.bottom, documentBottom: r.bottom + scrollY,
        height: r.height, width: r.width, minHeight: s.minHeight, gap: s.gap };
    };
    return { busy: document.querySelector('.lm-dl')?.getAttribute('aria-busy'), scrollY,
      block: rect('.lm-dl'), body: rect('.lm-dl__body'), keep: rect('.lm-dl__keep'),
      main: rect('.lm-dl__main'), others: rect('.lm-dl__others'), note: rect('.lm-dl__note'),
      documentHeight: document.documentElement.scrollHeight };
  });
}

async function settledGeometry(page) {
  let previous;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(100);
    const current = await geometry(page);
    if (previous && JSON.stringify(current) === JSON.stringify(previous)) return current;
    previous = current;
  }
  throw new Error('Download geometry did not settle');
}

try {
  for (const os of selectedSystems) for (const width of widths) for (const theme of themes) {
    const userAgent = userAgents[os];
    assert.ok(userAgent, `Unknown download system: ${os}`);
    const context = await browser.newContext({ ...options(width, theme), userAgent });
    let release;
    let requested;
    const pending = new Promise((resolve) => { release = resolve; });
    const requestStarted = new Promise((resolve) => { requested = resolve; });
    await context.route((url) => /\/repos\/[^/]+\/[^/]+\/releases\/latest$/.test(url.pathname), async (route) => {
      requested();
      await pending;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        tag_name: 'v0.5.0', assets: assets.map((name) => ({ name, size: 1024 * 1024 })),
      }) });
    });
    const page = await context.newPage();
    const url = new URL('/welcome', base);
    url.searchParams.set('qa', '1');
    url.searchParams.set('theme', theme);
    try {
      await page.goto(url.href, { waitUntil: 'load' });
      await requestStarted;
      await page.locator('.lm-dl[aria-busy=true]').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.scrollTo(0, 0));
      const before = await settledGeometry(page);
      assert.equal(before.busy, 'true');
      assert.equal(await page.locator('.lm-dl a[href]').evaluateAll((links) => links.filter((a) => /\.apk(?:[?#]|$)/i.test(a.getAttribute('href'))).length), 0,
        'Loading state offered an unconfirmed Android APK');
      await page.evaluate(() => {
        window.__qaDownloadShifts = [];
        window.__qaDownloadObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__qaDownloadShifts.push({ value: entry.value, recentInput: entry.hadRecentInput });
        });
        window.__qaDownloadObserver.observe({ type: 'layout-shift' });
      });
      await page.screenshot({ path: path.join(output, `download-layout-${os}-${width}-${theme}-loading.png`) });
      release();
      await page.locator('.lm-dl[aria-busy=false]').waitFor();
      await page.getByRole('link', { name: `Download for ${labels[os]}`, exact: true }).waitFor();
      const after = await settledGeometry(page);
      await page.screenshot({ path: path.join(output, `download-layout-${os}-${width}-${theme}-signed.png`) });
      const shifts = await page.evaluate(() => {
        window.__qaDownloadObserver.disconnect();
        return window.__qaDownloadShifts;
      });
      const delta = {
        blockHeight: after.block.height - before.block.height,
        bodyHeight: after.body.height - before.body.height,
        keepDocumentTop: after.keep.documentTop - before.keep.documentTop,
        documentHeight: after.documentHeight - before.documentHeight,
        layoutShift: shifts.filter((s) => !s.recentInput).reduce((n, s) => n + s.value, 0),
      };
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        [...document.querySelectorAll('.lm-dl__others a[href]')].at(-1).focus({ preventScroll: true });
      });
      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);
      const focusedKeep = await page.evaluate(() => {
        const keep = document.querySelector('.lm-dl__keep');
        const r = keep.getBoundingClientRect();
        const footer = document.querySelector('.lm-onb-foot');
        const f = footer?.getClientRects().length ? footer.getBoundingClientRect() : null;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { active: document.activeElement === keep, top: r.top, bottom: r.bottom,
          visible: r.top >= 0 && r.bottom <= innerHeight,
          clear: !f || r.bottom <= f.top || r.top >= f.bottom,
          hit: keep === hit || keep.contains(hit), footerTop: f?.top ?? null };
      });
      assert.ok(focusedKeep.active && focusedKeep.visible && focusedKeep.clear && focusedKeep.hit,
        `Website button not clear when reached by Tab: ${JSON.stringify(focusedKeep)}`);
      const row = { os, width, theme, before, after, delta, focusedKeep };
      report.push(row);
      console.log(JSON.stringify({ os, width, theme, delta }));
    } finally {
      release();
      await context.close();
      fs.writeFileSync(path.join(output, 'download-layout.json'), JSON.stringify(report, null, 2));
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ cases: report.length, growingBlocks: report.filter((r) => r.delta.blockHeight > 1).length,
  largestGrowth: Math.max(...report.map((r) => r.delta.blockHeight)),
  largestButtonMovement: Math.max(...report.map((r) => r.delta.keepDocumentTop)) }));
if (process.env.C_WEBQA_EXPECT_STABLE === '1') {
  const unstable = report.filter((r) => ['blockHeight', 'bodyHeight', 'keepDocumentTop'].some((key) => Math.abs(r.delta[key]) > 1));
  console.log(JSON.stringify({ stableCases: report.length - unstable.length, unstableCases: unstable.length }));
  process.exitCode = unstable.length ? 1 : 0;
}
