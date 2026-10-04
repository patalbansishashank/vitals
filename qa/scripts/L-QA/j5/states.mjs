// J5 check 1 (OS choice) + 2 (release data states, links) + folding + CLS attribution. Uses mocked GitHub API responses
// (no release exists yet in the public repo), plus the live API response (404 at the time of writing).
import fs from 'node:fs';
import path from 'node:path';
import { launch, open, inspectBlock, contrast, cls, scanText, UA, OUT } from './lib.mjs';

const REPO = 'patalbansishashank/vitals';
const SIZES = { 'Vitals-android.apk': 61_234_567, 'Vitals-linux-x86_64.AppImage': 123_456_789, 'Vitals-linux-amd64.deb': 98_765_432, 'Vitals-windows-x64-setup.exe': 110_000_000, 'Vitals-macos-universal.dmg': 140_500_000 };
const fakeRelease = (names = Object.keys(SIZES)) => ({
  tag_name: 'v0.5.0',
  assets: names.map((n) => ({ name: n, size: SIZES[n], browser_download_url: `https://github.com/${REPO}/releases/download/v0.5.0/${n}` })),
});
const mock = (status, body) => async (page) => {
  await page.route('https://api.github.com/**', (r) => (body === 'abort' ? r.abort('internetdisconnected') : r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body ?? {}) })));
};

const browser = await launch();
const out = [];
const D = { viewport: { width: 1440, height: 900 } };
const M = { viewport: { width: 390, height: 844 }, touch: true, mobile: true, dpr: 2 };

async function run(label, opts, shot) {
  const { ctx, page, errors, reqs } = await open(browser, opts);
  await page.waitForSelector('.lm-dl', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const info = await inspectBlock(page);
  const con = await contrast(page);
  const c = await cls(page);
  if (shot) await page.screenshot({ path: path.join(OUT, shot) });
  const rec = { label, shot, info, conFail: (con ?? []).filter((x) => !x.ok), cls: c.cls, errors: errors.filter((e) => !/GL Driver|Permissions-Policy|Service Worker/.test(e)), reqs, scan: info.present ? scanText(info.text, info.links.map((l) => l.href)) : [] };
  out.push(rec);
  await ctx.close();
  return rec;
}

// 1. OS choice with a full release (1440 light, desktop UAs; 390 for phones)
const OS = [
  ['android', UA.android, M, 'Android'], ['linux', UA.linux, D, 'Linux (AppImage)'], ['windows', UA.windows, D, 'Windows'], ['macos', UA.macos, D, 'Mac'],
  ['iphone', UA.iphone, M, null], ['chromeos', UA.chromeos, D, null], ['other', UA.other, D, null],
];
for (const [name, ua, vp, want] of OS) {
  const r = await run(`os-${name}`, { ...vp, ua, routes: mock(200, fakeRelease()) }, `os-${name}.png`);
  r.expectMain = want; out.at(-1).mainText = r.info.links.find((l) => l.main)?.text ?? null;
}
// iPadOS asking for the desktop site: Macintosh UA + touch points
out.push(await run('os-ipados-desktopsite', { ...D, ua: UA.ipados, touch: true, routes: mock(200, fakeRelease()), init: `Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5})` }, 'os-ipados.png'));
// UA with no OS words, only userAgentData.platform says Windows
out.push(await run('os-hint-only-windows', { ...D, ua: UA.other, routes: mock(200, fakeRelease()), init: `Object.defineProperty(navigator,'userAgentData',{get:()=>({platform:'Windows',mobile:false,brands:[]})})` }, null));
// Real Chromium UA says Windows but this really is Linux (UA override only): what does userAgentData say?
// 2. Release-data states
out.push(await run('state-release-all-390', { ...M, ua: UA.android, routes: mock(200, fakeRelease()) }, 'state-release-390-light.png'));
out.push(await run('state-release-all-390-dark', { ...M, ua: UA.android, scheme: 'dark', routes: mock(200, fakeRelease()) }, 'state-release-390-dark.png'));
out.push(await run('state-release-all-1440-dark', { ...D, ua: UA.linux, scheme: 'dark', routes: mock(200, fakeRelease()) }, 'state-release-1440-dark.png'));
out.push(await run('state-release-all-768-linux', { viewport: { width: 768, height: 1024 }, ua: UA.linux, routes: mock(200, fakeRelease()) }, 'state-release-768-light.png'));
out.push(await run('state-release-partial-linux', { ...D, ua: UA.linux, routes: mock(200, fakeRelease(['Vitals-android.apk', 'Vitals-windows-x64-setup.exe'])) }, 'state-release-partial.png'));
out.push(await run('state-release-unsigned-apk-android', { ...M, ua: UA.android, routes: mock(200, fakeRelease(['Vitals-android-unsigned.apk'].map((n) => { SIZES[n] = 50_000_000; return n; }))) }, 'state-release-unsigned-apk.png'));
out.push(await run('state-api-500-linux', { ...D, ua: UA.linux, routes: mock(500, {}) }, 'state-api-500.png'));
out.push(await run('state-api-403-ratelimit-android', { ...M, ua: UA.android, routes: mock(403, { message: 'rate limit exceeded' }) }, 'state-api-403-390.png'));
out.push(await run('state-offline-windows', { ...D, ua: UA.windows, routes: mock(0, 'abort') }, 'state-offline.png'));
out.push(await run('state-live-none-linux', { ...D, ua: UA.linux }, null)); // real api.github.com
// slow API (3 s): CLS across the arrival
out.push(await run('state-slow-api-1440', { ...D, ua: UA.linux, routes: async (p) => { await p.route('https://api.github.com/**', async (r) => { await new Promise((s) => setTimeout(s, 2500)); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeRelease()) }); }); } }, 'state-slow-1440.png'));
out.push(await run('state-slow-api-390', { ...M, ua: UA.android, routes: async (p) => { await p.route('https://api.github.com/**', async (r) => { await new Promise((s) => setTimeout(s, 2500)); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeRelease()) }); }); } }, 'state-slow-390.png'));

// CLS attribution: same page with the block hidden (standalone => block not rendered)
out.push(await run('cls-baseline-block-hidden-1440', { ...D, ua: UA.linux, init: `const o=matchMedia.bind(window);window.matchMedia=(q)=>/display-mode: standalone/.test(q)?{matches:true,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}:o(q)` }, 'standalone-1440.png'));
out.push(await run('cls-baseline-block-hidden-768', { viewport: { width: 768, height: 1024 }, ua: UA.linux, init: `const o=matchMedia.bind(window);window.matchMedia=(q)=>/display-mode: standalone/.test(q)?{matches:true,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}:o(q)` }, null));

fs.writeFileSync(path.join(OUT, 'states.json'), JSON.stringify(out, null, 1));
for (const r of out) {
  console.log('\n##', r.label, '| present', r.info.present, '| cls', r.cls, '| errs', JSON.stringify(r.errors), '| ext reqs', r.reqs.length, '| contrastFail', r.conFail.length, '| scan', r.scan.join(';'));
  if (r.info.present) {
    console.log('  main:', r.info.links.find((l) => l.main)?.text ?? '(none)', '| text:', JSON.stringify(r.info.text));
    console.log('  hrefs:', r.info.links.map((l) => l.href.replace('https://github.com/' + REPO, '')).join(' , '));
    console.log('  rect', JSON.stringify(r.info.rect), 'vh', r.info.viewportH);
  }
}
await browser.close();
