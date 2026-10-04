// J2 driver: talks to the Vitals WebView on the phone over Chrome DevTools (adb forward done by phone.sh).
// node drive.mjs <cmd> [args]   cmd: state | goto <url> | nav <path> | text [selector] | buttons | click <regex> | connect | eval <js>
// Output may hold health values: phone.sh writes it under qa/results/L-QA/private/ only.
import { createRequire } from 'node:module';
const require = createRequire('/media/DEV/Hobby/vitals-wt/L-QA/package.json');
const { chromium } = require('playwright-core');

const PORT = process.env.J2_CDP_PORT ?? '9334';
const [cmd, ...args] = process.argv.slice(2);
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
// a BLE address or a long hex run never reaches a log
const scrub = (s) => String(s).replace(/([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/g, '<addr>').replace(/[0-9a-fA-F]{16,}/g, '<hex>');

const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 });
const pages = b.contexts().flatMap((c) => c.pages());
const page = pages.find((p) => p.url().startsWith('https://localhost')) ?? pages[0];
if (!page) { console.log('no page'); process.exit(2); }

async function nav(path) {
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, path);
  await page.waitForTimeout(2500);
  return page.url();
}
const mainText = () => page.evaluate(() => (document.querySelector('main') ?? document.body).innerText);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('[role=status],[role=alert],.toast,[data-toast]')].map((e) => e.textContent.trim()).filter(Boolean).join(' | '));

try {
  switch (cmd) {
    case 'state': {
      const r = await page.evaluate(() => ({ url: location.href, visibility: document.visibilityState, title: document.title,
        h1: [...document.querySelectorAll('h1,h2')].map((h) => h.textContent.trim()).slice(0, 12),
        sw: navigator.serviceWorker?.controller ? 'controlled' : 'none', testHook: !!window.__ringTest }));
      console.log(JSON.stringify(r, null, 1));
      break;
    }
    case 'nav': console.log(await nav(args[0])); console.log(scrub(await mainText())); break;
    case 'text': console.log(scrub(await page.evaluate((s) => document.querySelector(s)?.innerText ?? '(none)', args[0] ?? 'body'))); break;
    case 'buttons': console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button,a[role=button],[role=switch]')].map((x) => x.textContent.trim() || x.getAttribute('aria-label')).filter(Boolean)))); break;
    case 'click': {
      const el = page.getByRole('button', { name: new RegExp(args[0], 'i') }).first();
      await el.waitFor({ timeout: 10000 });
      log('click', await el.textContent(), 'disabled', await el.isDisabled());
      await el.click();
      await page.waitForTimeout(Number(args[1] ?? 2000));
      log('toasts', scrub(await toasts()));
      break;
    }
    case 'connect': {
      // the person's path: Settings › Devices › "Connect J-Style 2301 ring", nothing typed; wait for the import toast
      log('url', await nav('/settings?section=devices'));
      const key = page.getByRole('button', { name: /^Connect J-Style/ }).first();
      await key.waitFor({ timeout: 15000 });
      log('button', await key.textContent(), 'disabled', await key.isDisabled());
      page.on('console', (m) => { const t = m.text(); if (/error|fail|disconnect/i.test(t)) log('console', scrub(t).slice(0, 200)); });
      await key.click();
      log('clicked');
      let seen = '';
      let done = false;
      for (let i = 0; i < 100 && !done; i++) {
        await page.waitForTimeout(2000);
        const txt = await toasts();
        if (txt !== seen) { seen = txt; log('toast', scrub(txt).slice(0, 400)); }
        // any password / passcode / key prompt is a blocker finding
        const ask = await page.evaluate(() => [...document.querySelectorAll('input')].filter((i) => i.offsetParent && /pass|key|code|pin/i.test(`${i.type} ${i.name} ${i.placeholder} ${i.getAttribute('aria-label')}`)).length);
        if (ask) log('PASSWORD-LIKE INPUT VISIBLE', ask);
        if (/readings|records|failed|could not|no ring|not found|error/i.test(txt) && !/reading the ring|connecting/i.test(txt)) done = true;
      }
      log('done', done);
      log('devices section:\n' + scrub(await page.evaluate(() => document.querySelector('#devices')?.innerText ?? '(no #devices)')));
      break;
    }
    case 'goto': await page.goto(args[0], { waitUntil: 'load' }); await page.waitForTimeout(Number(args[1] ?? 5000)); console.log(page.url()); break;
    case 'eval': console.log(scrub(JSON.stringify(await page.evaluate(`(async () => { ${args[0]} })()`), null, 1))); break;
    default: console.log('unknown cmd', cmd);
  }
} catch (e) {
  console.log('ERR', scrub(String(e)).slice(0, 600));
}
await b.close().catch(() => {});
process.exit(0);
