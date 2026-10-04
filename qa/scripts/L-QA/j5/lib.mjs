// Shared helpers for journey 5 (website downloads block).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.J5_BASE ?? 'http://127.0.0.1:4335';
export const OUT = path.resolve(process.env.J5_OUT ?? 'qa/results/L-QA/j5');
fs.mkdirSync(OUT, { recursive: true });

export const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipados: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  other: 'Mozilla/5.0 (compatible; SomeBot/1.0)',
};

export async function launch() {
  return chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
}

const CLS_INIT = `
window.__cls = 0; window.__clsEntries = [];
try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (!e.hadRecentInput) { window.__cls += e.value; window.__clsEntries.push({ v: e.value, t: Math.round(e.startTime), n: (e.sources||[]).map(s => (s.node && (s.node.className || s.node.nodeName)) || '?').slice(0,3) }); } } }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
`;

/** Open a fresh context + page. opts: viewport, ua, scheme, touch, init (script), routes (fn(page)), url */
export async function open(browser, opts) {
  const ctx = await browser.newContext({
    viewport: opts.viewport,
    userAgent: opts.ua,
    colorScheme: opts.scheme ?? 'light',
    hasTouch: !!opts.touch,
    isMobile: !!opts.mobile,
    deviceScaleFactor: opts.dpr ?? 1,
    serviceWorkers: 'block',
  });
  await ctx.addInitScript(CLS_INIT);
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const reqs = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(BASE).origin && u.protocol.startsWith('http')) reqs.push(r.method() + ' ' + r.url()); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText ?? '')));
  if (opts.routes) await opts.routes(page);
  await page.goto(BASE + (opts.path ?? '/') + (opts.query ?? ''), { waitUntil: 'load' });
  return { ctx, page, errors, reqs };
}

/** Facts about the block, run in the page. */
export function inspectBlock(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.lm-dl');
    if (!el) return { present: false, h1: document.querySelector('h1')?.textContent ?? null, url: location.href };
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const links = [...el.querySelectorAll('a')].map((a) => ({ text: a.textContent.trim(), href: a.href, main: a.classList.contains('lm-dl__key') }));
    const buttons = [...el.querySelectorAll('button')].map((b) => b.textContent.trim());
    const rootEl = document.documentElement;
    return {
      present: true,
      url: location.href,
      h1: document.querySelector('h1')?.textContent ?? null,
      text: el.innerText,
      folded: el.dataset.folded === 'true',
      links, buttons,
      rect: { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), h: Math.round(r.height), w: Math.round(r.width) },
      viewportH: vh,
      fullyInFirstScreen: r.bottom <= vh && r.top >= 0,
      topInFirstScreen: r.top < vh,
      dataTheme: rootEl.getAttribute('data-theme'),
      prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
      uaHint: navigator.userAgentData?.platform ?? null,
      docScrollW: rootEl.scrollWidth, docClientW: rootEl.clientWidth,
    };
  });
}

/** WCAG contrast of every text node's colour against its effective background inside the block. */
export function contrast(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.lm-dl');
    if (!el) return null;
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const rgba = (css) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; // premultiplied loss is small enough
      return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (top, bot) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bot[i] * (1 - a)).concat([1]); };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const bgOf = (node) => { const chain = []; for (let n = node; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) chain.push(c); if (c[3] >= 1) break; } let base = [255, 255, 255, 1]; for (const c of chain.reverse()) base = over(c, base); return base; };
    const out = [];
    const seen = new Set();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode; if (!t.textContent.trim()) continue;
      const p = t.parentElement; if (seen.has(p)) continue; seen.add(p);
      const cs = getComputedStyle(p);
      const fg = over(rgba(cs.color), bgOf(p));
      const bg = bgOf(p);
      const L1 = lum(fg), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      out.push({ text: t.textContent.trim().slice(0, 40), cls: p.className, size, ratio: +ratio.toFixed(2), need: large ? 3 : 4.5, ok: ratio >= (large ? 3 : 4.5) });
    }
    return out;
  });
}

export async function cls(page) {
  return page.evaluate(() => ({ cls: +window.__cls.toFixed(4), entries: window.__clsEntries }));
}

export const FORBIDDEN = [
  { name: 'ring name other than J-Style 2301', re: /\bj-?style(?! 2301)|\bsmart ?ring\b/i },
  { name: 'internal id', re: /\b(R-\d+|R\d{1,2}\b|SUITE_SPEC|PLAN|L-[A-Z]{2,}|§|plan-?04|item \d)/ },
  { name: 'marketing word', re: /seamless|revolutionary|unlock|supercharge|best-in-class|cutting-edge|game-?chang|effortless|powerful|leverage/i },
];

export function scanText(text, hrefs = []) {
  const hits = [];
  for (const f of FORBIDDEN) { const m = text.match(f.re); if (m) hits.push(`${f.name}: ${m[0]}`); }
  for (const h of hrefs) {
    const u = new URL(h);
    if (!['github.com', 'api.github.com'].includes(u.hostname) && !u.hostname.endsWith('creative.desi') && u.hostname !== '127.0.0.1') hits.push('hostname: ' + u.hostname);
  }
  return hits;
}
