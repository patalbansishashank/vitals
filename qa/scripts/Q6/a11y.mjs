// Q6 a11y quick checks: (1) every input/select/textarea that can take focus has an accessible name, (2) segmented
// controls (KeyBank) are radiogroups/groups with a label and radio keys, (3) focus order through the open question card
// follows the visual order (prompt → answers → Back → Ask me later → Next) with a visible 2 px focus ring.
// Writes qa/results/Q6/a11y.json and prints a pass/fail table; exit 1 on failure.
import fs from 'node:fs';
import { openProfile, go, sleep, ROOT } from './lib.mjs';
const rows = [];
const check = (name, ok, detail = '') => { rows.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) }); };
const ROUTES = { full: ['/today', '/food', '/food/pantry', '/train', '/coach', '/progress', '/plan/goals', '/body', '/simulate', '/evidence', '/settings', '/onboarding/markers', '/onboarding/supplements'], intake: ['/onboarding/activity'] };
for (const [profile, routes] of Object.entries(ROUTES)) {
  const { page, errors, close } = await openProfile(`a11y-${profile}`, { from: profile });
  for (const r of routes) {
    await go(page, r, { wait: 1500 });
    const res = await page.evaluate(() => {
      const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
      const focusable = (e) => e.tabIndex >= 0 && !e.disabled && !e.closest('[inert],[aria-hidden=true]');
      const unl = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(focusable)
        .filter((e) => !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.labels && e.labels.length) || e.title))
        .map((e) => `${e.tagName.toLowerCase()}[${e.type}].${e.className} vis=${vis(e)} ${e.placeholder || ''}`);
      const banks = [...document.querySelectorAll('.lm-bank')].filter(vis).map((b) => ({ role: b.getAttribute('role'), label: !!(b.getAttribute('aria-label') || b.getAttribute('aria-labelledby')), keys: [...b.querySelectorAll('button')].map((k) => k.getAttribute('role') || 'button+' + (k.hasAttribute('aria-pressed') ? 'pressed' : 'none')), text: b.innerText.replace(/\s+/g, ' ').slice(0, 40), multi: b.getAttribute('aria-multiselectable'), navLinks: b.querySelectorAll('a').length > 0 && !b.querySelector('button') && !!b.closest('nav[aria-label], nav[aria-labelledby]') }));
      return { unl, banks };
    });
    check(`${r}: focusable inputs have a name`, res.unl.length === 0, res.unl.join(' | '));
    // a bank of links inside a labelled <nav> is navigation (aria-current marks the page), not a segmented control
    const badBanks = res.banks.filter((b) => !b.navLinks).filter((b) => !b.label || !/radiogroup|group|tablist|toolbar/.test(b.role ?? '') || (b.role === 'radiogroup' && b.keys.some((k) => k !== 'radio')) || (b.role === 'group' && b.keys.some((k) => k === 'button+none')));
    check(`${r}: ${res.banks.length} segmented controls carry a role, a label and key states`, badBanks.length === 0, badBanks.map((b) => JSON.stringify(b)).join(' | '));
  }
  if (profile === 'intake') {
    await go(page, '/onboarding/activity', { wait: 2000 });
    const card = page.locator('fieldset').first();
    await card.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    // start just before the card: focus the last "Change" key above it, then Tab
    await page.evaluate(() => { const ch = [...document.querySelectorAll('button')].filter((b) => /^Change/.test(b.getAttribute('aria-label') || b.innerText)); (ch.at(-1) || document.body).focus(); });
    const seq = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab'); await sleep(120);
      const f = await page.evaluate(() => {
        const a = document.activeElement; if (!a) return null;
        const st = getComputedStyle(a); const r = a.getBoundingClientRect();
        const card = document.querySelector('fieldset');
        return { name: (a.getAttribute('aria-label') || a.innerText || a.value || a.tagName).replace(/\s+/g, ' ').trim().slice(0, 40), inCard: !!card && card.closest('.lm-ik-q, [class*=question], li, div')?.contains(a), y: Math.round(r.top), x: Math.round(r.left), outline: `${st.outlineStyle} ${st.outlineWidth}`, ring: st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) >= 2 || /0px 0px 0px [2-9]/.test(st.boxShadow) };
      });
      seq.push(f);
    }
    const inCard = seq.filter((s) => s && s.inCard);
    const names = inCard.map((s) => s.name);
    check('question card: focus visits the answers, then Back, Ask me later, Next', names.length >= 3 && names.indexOf('Back') < names.indexOf('Ask me later') && names.indexOf('Ask me later') < names.indexOf('Next'), names.join(' → '));
    let mono = true; for (let i = 1; i < inCard.length; i++) if (inCard[i].y < inCard[i - 1].y - 4) mono = false;
    check('question card: focus order follows the visual order (top to bottom)', mono, inCard.map((s) => `${s.name}@${s.y}`).join(' '));
    check('question card: every focused control shows a ≥ 2 px focus ring', inCard.every((s) => s.ring), inCard.filter((s) => !s.ring).map((s) => `${s.name} ${s.outline}`).join(' | '));
    fs.writeFileSync(`${ROOT}/qa/results/Q6/a11y-focus.json`, JSON.stringify(seq, null, 1));
  }
  check(`${profile}: no console or page errors`, errors.filter((e) => !/ERR_CONNECTION_REFUSED/.test(e)).length === 0, errors.join(' | '));
  await close();
}
// focus rings on the first 15 tab stops, and hover on interactive rows keeps text contrast (both themes)
const contrastJs = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (t, b) => [0, 1, 2].map((i) => t[i] * t[3] + b[i] * (1 - t[3]));
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  window.__q6contrast = (el) => {
    let bg = [255, 255, 255]; const layers = [];
    for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 0.99) break; } }
    for (const l of layers.reverse()) bg = over(l, bg);
    const fg = over(rgba(getComputedStyle(el).color), bg);
    const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
};
for (const theme of ['light', 'dark']) {
  const { page, errors, close } = await openProfile(`a11y-hover-${theme}`, { from: 'full', theme });
  for (const r of ['/today', '/food', '/settings']) {
    await go(page, r, { wait: 1500 });
    await page.evaluate(() => document.activeElement?.blur());
    const bad = [];
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab'); await sleep(80);
      const f = await page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; const st = getComputedStyle(a); const ring = (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) >= 2) || /(\d+(\.\d+)?px )?0px 0px 0px [2-9]/.test(st.boxShadow); return { n: (a.getAttribute('aria-label') || a.innerText || a.tagName).replace(/\s+/g, ' ').slice(0, 30), ring, o: `${st.outlineStyle} ${st.outlineWidth}` }; });
      if (f && !f.ring) bad.push(`${f.n} (${f.o})`);
    }
    check(`${theme} ${r}: the first 15 tab stops show a ≥ 2 px focus ring`, bad.length === 0, bad.join(' | '));
  }
  for (const [r, sel] of [['/evidence', '.ev-row'], ['/train', '.lv-train-weekrow'], ['/progress', 'a.lv-prog-cal__key']]) {
    await go(page, r, { wait: 1500 });
    if (r === '/train') { const wk = page.getByRole('radio', { name: 'week', exact: true }); if (await wk.count()) { await wk.first().click(); await sleep(800); } }
    await page.evaluate(contrastJs);
    const row = page.locator(sel).locator('visible=true').first();
    if (!(await row.count())) { check(`${theme} ${r}: hover row ${sel} found`, false); continue; }
    await row.scrollIntoViewIfNeeded(); await row.hover(); await sleep(250);
    const res = await row.evaluate((el) => { const t = [...el.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())); return (t.length ? t : [el]).map((e) => window.__q6contrast(e)); });
    const min = Math.min(...res);
    check(`${theme} ${r}: text on a hovered ${sel} keeps ≥ 4.5:1 (min ${min.toFixed(2)})`, min >= 4.5, res.map((x) => x.toFixed(2)).join(' '));
  }
  check(`${theme} hover/focus pages: no page errors`, errors.filter((e) => /pageerror/.test(e)).length === 0, errors.join(' | '));
  await close();
}
fs.mkdirSync(`${ROOT}/qa/results/Q6`, { recursive: true });
fs.writeFileSync(`${ROOT}/qa/results/Q6/a11y.json`, JSON.stringify(rows, null, 1));
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  — ' + r.detail}`);
const fail = rows.filter((r) => !r.ok).length;
console.log(`a11y: ${rows.length - fail} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
