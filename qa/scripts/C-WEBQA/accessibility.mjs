import fs from 'node:fs';
import path from 'node:path';
import { launch, options, output, widths, themes, go, shot, stubRelease } from './lib.mjs';

const profile = process.env.C_WEBQA_PROFILE || 'fresh';
const currentSignals = path.join(output, 'seeded-signals-state.json');
const stateFile = process.env.C_WEBQA_STATE_PATH || (fs.existsSync(currentSignals) ? currentSignals : path.join(output, 'seeded-state.json'));
const state = profile === 'seeded' ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : undefined;
const routes = profile === 'fresh' ? ['/welcome', '/welcome?step=screening', '/safety', '/settings', '/evidence'] : ['/body', '/ring', '/signals', '/signals?date=2026-09-30', '/signals?tab=heart&date=2026-09-30', '/signals?tab=activity&period=week&date=2026-09-30', '/plan/goals', '/today', '/food', '/train', '/progress', '/coach', '/onboarding/activity'];
const selectedRoutes = process.env.C_WEBQA_ROUTE_FILTER ? routes.filter((route) => process.env.C_WEBQA_ROUTE_FILTER.split(',').includes(route)) : routes;
const reportName = process.env.C_WEBQA_REPORT_NAME || profile;
const browser = await launch();
const report = [];
try {
  for (const width of widths) for (const theme of themes) {
    const context = await browser.newContext({ ...options(width, theme), ...(state ? { storageState: state } : {}) });
    await stubRelease(context);
    const page = await context.newPage();
    for (const route of selectedRoutes) {
      await go(page, route, theme);
      await page.waitForTimeout(500);
      const row = { profile, width, theme, route, focus: [] };
      // Probe keyboard focus rather than script focus, which does not reliably trigger :focus-visible.
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100);
        row.focus.push(await page.evaluate(() => {
          const el = document.activeElement, s = getComputedStyle(el), r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.x + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.y + r.height / 2)));
          const wrapper = el.closest('.lm-numfield, .lm-switch, .lm-runkey');
          const delegatedOutline = wrapper && [wrapper, ...wrapper.querySelectorAll('*')].some((node) => { const style = getComputedStyle(node); return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0; });
          return { tag: el.tagName, name: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 75), rect: { x: r.x, y: r.y, width: r.width, height: r.height }, visible: r.width > 0 && r.height > 0, focusVisible: el.matches(':focus-visible'), outline: Boolean(delegatedOutline) || s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0, shadow: s.boxShadow !== 'none', covered: Boolean(hit && !el.contains(hit) && !hit.contains(el)), class: el.getAttribute('class') };
        }));
      }
      row.contrast = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const colors = new Map();
        const rgba = (color) => {
          if (!colors.has(color)) { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); colors.set(color, [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v)); }
          return colors.get(color);
        };
        const over = (a, b) => [0, 1, 2].map((i) => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
        const lum = (c) => c.slice(0, 3).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const failures = [], seen = new Set(); let measured = 0, skippedImages = 0;
        for (const el of document.querySelectorAll('main *')) {
          if (el.closest('svg, [aria-hidden=true], [disabled], [aria-disabled=true], .lm-sr') || !el.getClientRects().length) continue;
          if (![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) continue;
          const s = getComputedStyle(el), rect = el.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2 || s.visibility !== 'visible' || Number(s.opacity) === 0) continue;
          const chain = []; let unsupported = false;
          for (let p = el; p; p = p.parentElement) { const ps = getComputedStyle(p); if (ps.backgroundImage !== 'none' || Number(ps.opacity) !== 1) unsupported = true; chain.push(ps.backgroundColor); }
          if (unsupported) { skippedImages++; continue; }
          let background = [255, 255, 255, 1];
          for (const color of chain.reverse()) background = over(rgba(color), background);
          const foreground = over(rgba(s.color), background);
          const l1 = lum(foreground), l2 = lum(background), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          const threshold = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && parseInt(s.fontWeight) >= 700) ? 3 : 4.5;
          measured++;
          const key = [s.color, background.join(','), el.className].join('|');
          if (ratio + 0.02 < threshold && !seen.has(key)) { seen.add(key); failures.push({ text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 90), class: el.className, foreground: s.color, background: background.slice(0, 3), fontSize: s.fontSize, ratio: Number(ratio.toFixed(2)), threshold }); }
        }
        return { measured, skippedImages, candidates: failures };
      });
      row.hitTargets = await page.evaluate(async () => {
        const targets = [...document.querySelectorAll('main button, main a[href], main input, main select, main textarea, main summary')].filter((el) => {
          const s = getComputedStyle(el), r = el.getBoundingClientRect();
          const closed = el.closest('details:not([open])');
          const inClosedContent = closed && !closed.querySelector(':scope > summary')?.contains(el);
          const closedOverlay = el.closest('dialog:not([open]), [popover]:not(:popover-open)');
          return !inClosedContent && !closedOverlay && r.width > 2 && r.height > 2 && s.visibility === 'visible' && Number(s.opacity) > 0 && !el.disabled && el.tabIndex >= 0 && !el.closest('[aria-hidden=true], [hidden], .lm-sr');
        });
        const candidates = [];
        for (const el of targets) {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          await new Promise((resolve) => requestAnimationFrame(resolve));
          // Wrapped inline links have separate line boxes; their union's center may be empty space.
          const rects = [...el.getClientRects()];
          const hits = rects.map((r) => document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          const r = el.getBoundingClientRect();
          if (!hits.some((hit) => hit && el.contains(hit))) candidates.push({ name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 90), class: el.getAttribute('class'), interceptor: hits[0]?.getAttribute('class'), rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
        }
        return { checked: targets.length, candidates };
      });
      report.push(row);
      fs.writeFileSync(path.join(output, `accessibility-${reportName}.json`), JSON.stringify(report, null, 2));
      if (row.contrast.candidates.length || row.focus.some((f) => f.focusVisible && !f.outline && !f.shadow)) console.log(JSON.stringify({ route, width, theme, contrast: row.contrast.candidates.length, focus: row.focus.filter((f) => f.focusVisible && !f.outline && !f.shadow) }));
      await shot(page, `focus-${profile}-${width}-${theme}-${route.replace(/[^a-z0-9]+/gi, '-')}`);
    }
    await context.close();
  }
} finally { await browser.close(); }
console.log(`Measured ${report.length} page states. Contrast candidates require visual confirmation; gradient/opacity backgrounds are excluded.`);
