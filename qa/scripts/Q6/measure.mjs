// In-page layout checks for the Q6 visual pass. measure(page) → { overflowX, offscreen, overlaps, lowContrast,
// unlabeled, groups, faces, rails }. Colours are resolved through a canvas so color-mix / oklab / oklch all work.
export async function measure(page, { scope = null, vw = null } = {}) {
  return page.evaluate(([scope, vw]) => {
    const root = (scope && document.querySelector(scope)) || document.body;
    // a phone zooms out when the page is wider than the screen, so innerWidth grows with it: compare with the device width
    const W = vw ?? innerWidth, H = innerHeight;
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const rgba = (s) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const bgOf = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const st = getComputedStyle(e);
        if (st.backgroundImage && st.backgroundImage !== 'none' && !/gradient/.test(st.backgroundImage)) return null; // image: skip
        const c = rgba(st.backgroundColor);
        if (c[3] > 0) { layers.push(c); if (c[3] >= 0.99) break; }
      }
      let bg = rgba(getComputedStyle(document.documentElement).backgroundColor); if (bg[3] < 1) bg = [255, 255, 255, 1];
      for (const l of layers.reverse()) bg = over(l, bg);
      return bg;
    };
    const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const st = getComputedStyle(e); return st.visibility !== 'hidden' && st.display !== 'none' && +st.opacity > 0.05; };
    const inRail = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return p; } return null; };
    const name = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
    const txt = (e) => (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const se = document.scrollingElement;
    const widest = Math.max(se.scrollWidth, innerWidth);
    const out = { w: W, overflowX: widest > W + 1 ? widest - W : 0, offscreen: [], overlaps: [], lowContrast: [], unlabeled: [], groups: [], faces: [], clipped: [] };
    // text leaves
    const all = [...root.querySelectorAll('*')].filter((e) => !e.closest('svg, canvas, [aria-hidden=true], .lm-sr, .lm-sr-only, .sr-only'));
    const pinned = (e) => { for (let p = e; p; p = p.parentElement) { const ps = getComputedStyle(p).position; if (ps === 'fixed' || ps === 'sticky') return p; } return null; };
    const leaves = all.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0) && vis(e));
    for (const e of leaves) {
      const r = e.getBoundingClientRect();
      if (r.bottom < 0 || r.top > H) continue; // contrast only for what is on screen
      const rail = inRail(e);
      if ((r.right > W + 1 || r.left < -1) && !rail) out.offscreen.push(`${name(e)} "${txt(e)}" ${Math.round(r.left)}–${Math.round(r.right)}`);
      const st = getComputedStyle(e);
      if (e.closest('[disabled],[aria-disabled=true]')) continue;
      const bg = bgOf(e); if (!bg) continue;
      const fg = over(rgba(st.color), bg);
      const size = parseFloat(st.fontSize), bold = +st.fontWeight >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      const cr = ratio(fg, bg);
      if (cr < need - 0.05) out.lowContrast.push(`${cr.toFixed(2)} ${name(e)} "${txt(e)}" ${st.color} on rgb(${bg.slice(0, 3).map(Math.round)})`);
      // clipped text (overflow hidden, no ellipsis, content wider than box)
      if (e.scrollWidth > e.clientWidth + 2 && /hidden|clip/.test(st.overflowX) && st.textOverflow !== 'ellipsis') out.clipped.push(`${name(e)} "${txt(e)}" ${e.scrollWidth}>${e.clientWidth}`);
    }
    // overlapping controls (siblings, not nested), on screen
    const ctl = [...root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=switch], [role=checkbox], [role=radio]')]
      .filter((e) => vis(e) && !e.closest('[inert], .lm-sr')).map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.bottom > 0 && r.top < H);
    for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
      const [a, ra] = ctl[i], [b, rb] = ctl[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (pinned(a) !== pinned(b)) continue; // a sticky/fixed bar over scrolled content is not a layout overlap
      if (a.labels && [...a.labels].some((l) => l.contains(b))) continue;
      const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ix > 2 && iy > 2) {
        const sa = getComputedStyle(a), sb = getComputedStyle(b);
        if (sa.opacity === '0' || sb.opacity === '0' || (a.type === 'range' && b.type === 'range')) continue;
        out.overlaps.push(`${name(a)} "${txt(a)}" × ${name(b)} "${txt(b)}" (${Math.round(ix)}×${Math.round(iy)})`);
      }
    }
    // a11y: inputs need a name
    for (const e of root.querySelectorAll('input:not([type=hidden]), select, textarea')) {
      if (!vis(e) && e.type !== 'checkbox' && e.type !== 'radio' && e.type !== 'file') continue;
      const named = e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.labels && e.labels.length) || e.title || e.closest('label');
      if (!named) out.unlabeled.push(`${name(e)}[${e.type}] ${e.placeholder || ''}`);
    }
    for (const e of root.querySelectorAll('.lm-bank')) {
      if (!vis(e)) continue;
      const role = e.getAttribute('role'); const label = e.getAttribute('aria-label') || e.getAttribute('aria-labelledby');
      if (!/radiogroup|group|tablist|toolbar/.test(role || '') || !label) out.groups.push(`${name(e)} role=${role} label=${!!label} "${txt(e)}"`);
    }
    // faceplate paddings: the inset of the first and last visible content from the face edge
    for (const f of root.querySelectorAll('.lm-face')) {
      if (!vis(f)) continue;
      const fr = f.getBoundingClientRect(); if (fr.bottom < 0 || fr.top > H) continue;
      const kids = [...f.querySelectorAll('h2,h3,p,button,input,li,label,span')].filter(vis).filter((k) => { const r = inRail(k); return !r || !f.contains(r) || r === f; }).map((k) => k.getBoundingClientRect()).filter((r) => r.width < fr.width - 1);
      if (!kids.length) continue;
      const l = Math.min(...kids.map((r) => r.left)) - fr.left, rr = fr.right - Math.max(...kids.map((r) => r.right));
      const t = Math.min(...kids.map((r) => r.top)) - fr.top, b = fr.bottom - Math.max(...kids.map((r) => r.bottom));
      out.faces.push({ face: `${name(f)} "${txt(f.querySelector('h2,h3') || f)}"`, l: Math.round(l), r: Math.round(rr), t: Math.round(t), b: Math.round(b), pad: getComputedStyle(f).padding, variant: f.dataset.variant || '' });
    }
    return out;
  }, [scope, vw]);
}
