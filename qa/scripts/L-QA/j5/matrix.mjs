// J5 check 1 + 4: first screen at 3 widths x 2 themes (OS scheme and the app's own ?theme=), CLS, console, keyboard, contrast, scan.
import fs from 'node:fs';
import path from 'node:path';
import { launch, open, inspectBlock, contrast, cls, scanText, UA, OUT, BASE } from './lib.mjs';

const browser = await launch();
const MODE = process.env.J5_RELEASE ?? 'live'; // live | none | release (mocked GitHub API)
const SIZES = { 'Vitals-android.apk': 61_234_567, 'Vitals-linux-x86_64.AppImage': 123_456_789, 'Vitals-linux-amd64.deb': 98_765_432, 'Vitals-windows-x64-setup.exe': 110_000_000, 'Vitals-macos-universal.dmg': 140_500_000 };
const REPO = 'patalbansishashank/vitals';
const routes = MODE === 'live' ? undefined : async (p) => p.route('https://api.github.com/**', (r) => MODE === 'none' ? r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' }) : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tag_name: 'v0.5.0', assets: Object.entries(SIZES).map(([name, size]) => ({ name, size, browser_download_url: `https://github.com/${REPO}/releases/download/v0.5.0/${name}` })) }) }));
const VP = [
  { name: '390', viewport: { width: 390, height: 844 }, ua: UA.android, touch: true, mobile: true, dpr: 2 },
  { name: '768', viewport: { width: 768, height: 1024 }, ua: UA.linux, touch: true, mobile: false },
  { name: '1440', viewport: { width: 1440, height: 900 }, ua: UA.linux },
];
const results = [];
for (const vp of VP) {
  for (const mode of ['os', 'app']) {
    for (const scheme of ['light', 'dark']) {
      // 'os': prefers-color-scheme only. 'app': OS says the opposite, the app's own setting (?theme=) must win.
      const osScheme = mode === 'os' ? scheme : scheme === 'light' ? 'dark' : 'light';
      const { ctx, page, errors, reqs } = await open(browser, { ...vp, scheme: osScheme, query: mode === 'app' ? `?theme=${scheme}` : '', routes });
      await page.waitForSelector('.lm-dl', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(3500); // release read settles
      const info = await inspectBlock(page);
      const con = await contrast(page);
      const c = await cls(page);
      const file = `welcome-${MODE}-${vp.name}-${scheme}-${mode}.png`;
      await page.screenshot({ path: path.join(OUT, file) });
      await page.evaluate(() => { const el = document.querySelector('.lm-dl'); el?.scrollIntoView({ block: 'end' }); window.scrollTo(0, document.documentElement.scrollHeight); });
      await page.waitForTimeout(300);
      const bottom = await page.evaluate(() => { const el = document.querySelector('.lm-dl'); const keep = el?.querySelector('.lm-dl__keep'); const foot = document.querySelector('.lm-onb-intro__foot, [class*=foot]'); const kr = keep?.getBoundingClientRect(); const fr = foot?.getBoundingClientRect(); return { keepBottom: kr && Math.round(kr.bottom), footTop: fr && Math.round(fr.top), vh: innerHeight, keepVisible: !!kr && kr.bottom <= innerHeight && (!fr || fr.height === 0 || fr.top >= innerHeight || kr.bottom <= fr.top) }; });
      if (vp.name === '390') await page.screenshot({ path: path.join(OUT, file.replace('.png', '-scrolled.png')) });
      await page.evaluate(() => window.scrollTo(0, 0));
      // keyboard: tab through, note which block controls get focus and whether a focus indicator is drawn
      const kb = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        const f = await page.evaluate(() => {
          const a = document.activeElement; if (!a || a === document.body) return null;
          const inBlock = !!a.closest('.lm-dl');
          const cs = getComputedStyle(a);
          return { inBlock, text: (a.textContent || '').trim().slice(0, 30), outline: cs.outlineStyle + ' ' + cs.outlineWidth, shadow: cs.boxShadow !== 'none', focusVisible: a.matches(':focus-visible') };
        });
        if (f?.inBlock) kb.push(f);
      }
      const bad = await page.evaluate(() => ({ scheme: getComputedStyle(document.documentElement).colorScheme }));
      results.push({ bottom, vp: vp.name, mode, scheme, osScheme, file, info, con, cls: c, kb, errors, reqs, bad, scan: info.present ? scanText(info.text, info.links.map((l) => l.href)) : [] });
      await ctx.close();
    }
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, `matrix-${MODE}.json`), JSON.stringify(results, null, 1));
for (const r of results) {
  console.log(r.vp, r.mode, r.scheme, 'present', r.info.present, 'folded', r.info.folded, 'cls', r.cls.cls, 'bottom', JSON.stringify(r.bottom), 'inFirstScreen', r.info.fullyInFirstScreen, 'top<vh', r.info.topInFirstScreen, 'rect', JSON.stringify(r.info.rect), 'vh', r.info.viewportH, 'dataTheme', r.info.dataTheme, 'dark?', r.info.prefersDark, 'errs', r.errors.length, 'contrastFail', (r.con ?? []).filter((x) => !x.ok).length, 'kb', r.kb.length, 'scan', r.scan.join('|'), 'hscroll', r.info.docScrollW > r.info.docClientW);
}
