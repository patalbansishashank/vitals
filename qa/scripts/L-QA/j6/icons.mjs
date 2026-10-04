/**
 * J6 part C: icon contact sheet.
 *
 *   node qa/scripts/L-QA/j6/icons.mjs
 *
 * Lists every icon asset (public/brand, public/icons, favicon, manifest icons, desktop build icons incl. frames inside
 * .ico/.icns, Android adaptive/notification/splash vectors, Play Store icon, launcher previews), reads real pixel sizes
 * (PNG IHDR / ICO / ICNS directories), checks the manifest's declared sizes, and writes
 *   qa/scripts/L-QA/j6/icons.html           the contact sheet (relative file links + data URIs for container frames)
 *   qa/scripts/L-QA/j6/icons-report.json    sizes, manifest check, pixel checks (run in the page)
 * then screenshots the sheet into qa/results/L-QA/j6/icons-s<n>-*.png (per-section) (synthetic brand art only).
 * Needs only node + playwright-core (+ /usr/bin/chromium).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const HERE = join(ROOT, 'qa/scripts/L-QA/j6');
const OUT = join(ROOT, 'qa/results/L-QA/j6');
mkdirSync(OUT, { recursive: true });
const rel = (p) => relative(HERE, p).split('\\').join('/');

const SIZES = [16, 32, 48, 64, 128, 256];
const GROUNDS = [['#ffffff', 'white'], ['#f4f1ea', 'paper'], ['#000000', 'black'], ['#15171a', 'charcoal']];

/* ---------------------------------------------------------------- file readers */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngInfo(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), depth: buf[24], colorType: buf[25] };
}
const dataUri = (buf, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;

function icoFrames(buf) {
  const n = buf.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 16;
    const w = buf[o] || 256, h = buf[o + 1] || 256, size = buf.readUInt32LE(o + 8), off = buf.readUInt32LE(o + 12);
    const data = buf.subarray(off, off + size);
    const png = pngInfo(data);
    out.push({ w, h, png: !!png, realW: png?.w, realH: png?.h, uri: png ? dataUri(data) : null });
  }
  return out;
}
const ICNS_TYPES = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 };
function icnsFrames(buf) {
  const out = [];
  let o = 8;
  while (o + 8 <= buf.length) {
    const type = buf.toString('ascii', o, o + 4), len = buf.readUInt32BE(o + 4);
    const data = buf.subarray(o + 8, o + len);
    const png = pngInfo(data);
    if (png) out.push({ type, label: ICNS_TYPES[type] ? `${ICNS_TYPES[type]}${/1[1-4]/.test(type.slice(2)) ? '@2x-ish' : ''}` : type, w: png.w, h: png.h, uri: dataUri(data) });
    else out.push({ type, nonPng: true, bytes: len });
    o += len;
  }
  return out;
}

/* ---------------------------------------------------------------- Android vector drawable -> svg */
function parseColors(file) {
  const m = {};
  const s = readFileSync(file, 'utf8');
  for (const x of s.matchAll(/<color name="([^"]+)">([^<]+)<\/color>/g)) m[x[1]] = x[2].trim();
  return m;
}
function androidSvg(xmlFile, colors, { dotScale = 1 } = {}) {
  const s = readFileSync(xmlFile, 'utf8');
  const vw = Number(/viewportWidth="([\d.]+)"/.exec(s)[1]), vh = Number(/viewportHeight="([\d.]+)"/.exec(s)[1]);
  const col = (v) => {
    if (!v) return 'none';
    if (v === '@android:color/transparent') return 'none';
    const r = /^@color\/(.+)$/.exec(v);
    if (r) return colors[r[1]] || 'magenta';
    if (/^#[0-9a-f]{8}$/i.test(v)) return `#${v.slice(3)}`; // #AARRGGBB (night edge is #00000000: alpha 0)
    return v;
  };
  const attr = (tag, name) => { const m = new RegExp(`android:${name}="([^"]*)"`).exec(tag); return m ? m[1] : null; };
  let body = '';
  const colorsUsed = new Set();
  for (const t of s.matchAll(/<(group|path)\b([\s\S]*?)(\/?)>|<\/group>/g)) {
    if (t[0] === '</group>') { body += '</g>'; continue; }
    const kind = t[1], tag = t[2];
    if (kind === 'group') {
      const px = attr(tag, 'pivotX') || 0, py = attr(tag, 'pivotY') || 0;
      let sx = attr(tag, 'scaleX') ?? 1, sy = attr(tag, 'scaleY') ?? 1;
      if (attr(tag, 'name') === 'dot') { sx = dotScale; sy = dotScale; }
      body += `<g transform="translate(${px} ${py}) scale(${sx} ${sy}) translate(${-px} ${-py})">`;
    } else {
      const fill = col(attr(tag, 'fillColor')), stroke = col(attr(tag, 'strokeColor'));
      const edge8 = /^#00000000$/i.test(attr(tag, 'strokeColor') || '') || colors[(/^@color\/(.+)$/.exec(attr(tag, 'strokeColor') || '') || [])[1]] === '#00000000';
      const sc = edge8 ? 'none' : stroke;
      if (fill !== 'none') colorsUsed.add(fill);
      if (sc !== 'none') colorsUsed.add(sc);
      body += `<path d="${attr(tag, 'pathData')}" fill="${fill}" stroke="${sc}" stroke-width="${attr(tag, 'strokeWidth') || 0}" stroke-linecap="${attr(tag, 'strokeLineCap') || 'butt'}" stroke-linejoin="${attr(tag, 'strokeLineJoin') || 'miter'}"/>`;
    }
  }
  return { vw, vh, inner: body, colors: [...colorsUsed] };
}

/* ---------------------------------------------------------------- asset inventory */
const assets = []; // { id, group, path (abs) | uri, kind: 'raster'|'svg', w, h, note, maskable?, declared? }
function addFile(group, abs, extra = {}) {
  const buf = readFileSync(abs);
  const id = relative(ROOT, abs);
  if (abs.endsWith('.png')) {
    const i = pngInfo(buf);
    assets.push({ id, group, src: rel(abs), kind: 'raster', w: i?.w, h: i?.h, bytes: buf.length, ...extra });
  } else if (abs.endsWith('.svg')) {
    const s = buf.toString('utf8');
    const vb = /viewBox="([\d.\s-]+)"/.exec(s);
    const [, , w, h] = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 0, 0];
    assets.push({ id, group, src: rel(abs), kind: 'svg', w, h, bytes: buf.length, ...extra });
  } else if (abs.endsWith('.ico')) {
    const frames = icoFrames(buf);
    frames.forEach((f, i) => assets.push({ id: `${id} [frame ${i}: ${f.w}x${f.h}${f.png ? ' png' : ' BMP'}]`, group, src: f.uri, kind: 'raster', w: f.realW ?? f.w, h: f.realH ?? f.h, bytes: 0, declaredW: f.w, ...extra }));
  } else if (abs.endsWith('.icns')) {
    for (const f of icnsFrames(buf)) {
      if (f.nonPng) { assets.push({ id: `${id} [${f.type} non-PNG ${f.bytes} B]`, group, src: null, kind: 'raster', w: 0, h: 0, bytes: f.bytes, ...extra }); continue; }
      assets.push({ id: `${id} [${f.type}]`, group, src: f.uri, kind: 'raster', w: f.w, h: f.h, bytes: 0, ...extra });
    }
  }
}
const walk = (dir, filter = () => true) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name), filter) : filter(d.name) ? [join(dir, d.name)] : [])) : []);
const MASKABLE = (p) => /maskable/.test(p);

for (const f of ['public/favicon.svg', 'public/favicon.ico']) addFile('Web favicon', join(ROOT, f));
for (const f of walk(join(ROOT, 'public/icons'), (n) => n.endsWith('.png'))) addFile('Web icons (public/icons)', f, { maskable: MASKABLE(f), mono: /monochrome/.test(f), badge: /badge/.test(f) });
for (const f of walk(join(ROOT, 'public/brand'), (n) => /\.(svg|png)$/.test(n))) addFile('Brand (public/brand)', f);
for (const f of walk(join(ROOT, 'apps/desktop/build'), (n) => /\.(png|ico|icns|svg)$/.test(n))) addFile('Desktop build icons', f, { tray: /tray/i.test(f), template: /Template/.test(f) });
addFile('Android store/previews', join(ROOT, 'apps/android/brand/playstore-512.png'));
for (const f of walk(join(ROOT, 'apps/android/brand/preview'), (n) => n.endsWith('.png'))) addFile('Android store/previews', f);
for (const dir of ['apps/android/android/app/src/main/res']) for (const f of walk(join(ROOT, dir), (n) => /\.(png|webp)$/.test(n))) addFile('Android app res PNG', f);

/* manifest check */
const manifest = JSON.parse(readFileSync(join(ROOT, 'public/manifest.webmanifest'), 'utf8'));
const manifestCheck = [];
for (const ic of manifest.icons) {
  const abs = join(ROOT, 'public', ic.src.replace(/^\//, ''));
  const present = existsSync(abs);
  let real = null;
  if (present && abs.endsWith('.png')) { const i = pngInfo(readFileSync(abs)); real = i ? `${i.w}x${i.h}` : 'not a png'; }
  if (present && abs.endsWith('.svg')) real = 'svg';
  manifestCheck.push({ src: ic.src, declared: ic.sizes, purpose: ic.purpose, type: ic.type, present, real, ok: present && (ic.sizes === 'any' ? real === 'svg' : real === ic.sizes) });
}
// index.html link check
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const linkCheck = [...indexHtml.matchAll(/<link rel="([^"]*icon[^"]*)"[^>]*href="([^"]+)"[^>]*?(?:sizes="([^"]+)")?[^>]*>/g)].map((m) => {
  const abs = join(ROOT, 'public', m[2].replace(/^\//, ''));
  let real = null;
  if (existsSync(abs) && abs.endsWith('.png')) { const i = pngInfo(readFileSync(abs)); real = i ? `${i.w}x${i.h}` : null; }
  return { rel: m[1], href: m[2], declared: m[3] || null, present: existsSync(abs), real };
});

/* Android vector layers */
const RES = join(ROOT, 'apps/android/brand/res');
const lightColors = parseColors(join(RES, 'values/vitals_brand_colors.xml'));
const nightColors = parseColors(join(RES, 'values-night/vitals_brand_colors.xml'));
const layer = (name, c, o) => androidSvg(join(RES, 'drawable', name), c, o);
const android = {
  light: { bg: layer('vitals_launcher_background.xml', lightColors), fg: layer('vitals_launcher_foreground.xml', lightColors), mono: layer('vitals_launcher_monochrome.xml', lightColors), stat: layer('ic_stat_vitals.xml', lightColors), splash: layer('vitals_splash_mark.xml', lightColors) },
  night: { bg: layer('vitals_launcher_background.xml', nightColors), fg: layer('vitals_launcher_foreground.xml', nightColors), mono: layer('vitals_launcher_monochrome.xml', nightColors), stat: layer('ic_stat_vitals.xml', nightColors), splash: layer('vitals_splash_mark.xml', nightColors) },
};
const androidColors = { fg: android.light.fg.colors, mono: android.light.mono.colors, stat: android.light.stat.colors };

/* ---------------------------------------------------------------- HTML */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const imgTag = (a, px, extra = '') => (a.src ? `<img src="${a.src}" width="${px}" height="${px}" ${extra} alt="">` : '<span class="na">n/a</span>');
function sizesRow(a) {
  return GROUNDS.map(([g, gn]) => {
    const cells = SIZES.map((s) => {
      const up = a.kind === 'raster' && a.w && s > a.w;
      return `<div class="cell ${up ? 'up' : ''}" title="${s}px${up ? ' (upscaled from ' + a.w + ')' : ''}">${imgTag(a, s)}<span class="lbl">${s}${up ? '↑' : ''}</span></div>`;
    }).join('');
    return `<div class="ground" data-ground="${gn}" style="background:${g}">${cells}</div>`;
  }).join('');
}
function squirclePath(size) {
  // superellipse |x|^n + |y|^n = r^n with n = 5, as a polygon clip-path
  const r = size / 2, n = 5, pts = [];
  for (let i = 0; i < 120; i++) { const t = (i / 120) * 2 * Math.PI; const c = Math.cos(t), s = Math.sin(t); pts.push(`${(r + r * Math.sign(c) * Math.abs(c) ** (2 / n)).toFixed(2)}px ${(r + r * Math.sign(s) * Math.abs(s) ** (2 / n)).toFixed(2)}px`); }
  return `polygon(${pts.join(',')})`;
}
function maskTile(a, px, shape) {
  const clip = shape === 'circle' ? 'circle(50%)' : squirclePath(px);
  return `<div class="mask" style="width:${px}px;height:${px}px"><div class="clip" style="clip-path:${clip}"><img src="${a.src}" width="${px}" height="${px}" alt=""></div><div class="safe" style="width:${px * 0.8}px;height:${px * 0.8}px"></div></div>`;
}
function adaptiveTile(set, px, shape, { mono = false, bgColor = null } = {}) {
  // 108 dp canvas; the launcher shows a 72 dp window (66 dp safe); mask diameter 72/108 of the canvas
  const L = android[set];
  const vb = `0 0 108 108`;
  const clipId = `c${Math.random().toString(36).slice(2, 8)}`;
  const win = 72;
  const shapeEl = shape === 'circle' ? `<circle cx="54" cy="54" r="${win / 2}"/>` : `<rect x="${54 - win / 2}" y="${54 - win / 2}" width="${win}" height="${win}" rx="${win * 0.28}"/>`;
  const layers = mono ? `<rect width="108" height="108" fill="${bgColor || '#335'}"/>${L.mono.inner.replace(/#ffffff/gi, '#ffd9a0')}` : `${L.bg.inner}${L.fg.inner}`;
  return `<svg class="ad" width="${px}" height="${px}" viewBox="${vb}"><defs><clipPath id="${clipId}">${shapeEl}</clipPath></defs><g clip-path="url(#${clipId})">${layers}</g><circle cx="54" cy="54" r="33" fill="none" stroke="#e0245e" stroke-width="0.6" stroke-dasharray="2 1.5"/><circle cx="54" cy="54" r="36" fill="none" stroke="#999" stroke-width="0.3"/></svg>`;
}
function plainSvg(layerObj, px, bg) {
  return `<svg width="${px}" height="${px}" viewBox="0 0 ${layerObj.vw} ${layerObj.vh}" style="background:${bg}">${layerObj.inner}</svg>`;
}

const groupsOrder = ['Web favicon', 'Web icons (public/icons)', 'Brand (public/brand)', 'Desktop build icons', 'Android store/previews', 'Android app res PNG'];
let html = `<!doctype html><meta charset="utf-8"><title>Vitals icon contact sheet (J6)</title>
<style>
body{font:13px/1.35 system-ui,sans-serif;margin:16px;background:#e8e6e1;color:#111}
h1{font-size:18px} h2{font-size:15px;margin:28px 0 8px;border-bottom:2px solid #111} h3{font-size:12px;margin:12px 0 4px}
.row{display:flex;gap:8px;align-items:flex-start;margin:6px 0;padding:6px;background:#fff6;border:1px solid #0002}
.meta{width:300px;flex:none;font-size:11px;word-break:break-all}
.meta b{display:block}
.native{display:flex;flex-direction:column;gap:4px;flex:none}
.native .nat{border:1px dashed #0004;display:inline-block;line-height:0;background:conic-gradient(#ccc 25%,#eee 0 50%,#ccc 0 75%,#eee 0) 0 0/8px 8px}
.native .zoom{line-height:0;border:1px dashed #0004}
.native .zoom img{image-rendering:pixelated}
.grounds{display:flex;gap:6px;flex-wrap:wrap}
.ground{display:flex;gap:6px;align-items:flex-end;padding:6px;border:1px solid #0003}
.cell{display:flex;flex-direction:column;align-items:center;line-height:0}
.cell .lbl{font-size:9px;line-height:1.2;color:#888;margin-top:2px}
.cell.up img{outline:1px dotted #e0245e}
.na{color:#c00;font-weight:bold}
.mask{position:relative;display:inline-block;background:conic-gradient(#bbb 25%,#ddd 0 50%,#bbb 0 75%,#ddd 0) 0 0/10px 10px}
.mask .clip{width:100%;height:100%}
.mask .safe{position:absolute;left:10%;top:10%;border:1.5px dashed #e0245e;border-radius:50%;box-sizing:border-box;pointer-events:none}
.tiles{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
.tile{display:flex;flex-direction:column;gap:4px;align-items:center;font-size:11px}
.panel{padding:10px;border:1px solid #0003}
.bar{font-size:11px;color:#444}
.px{background:#fff;padding:4px;margin:2px 0;font-size:11px}
</style>
<h1>Vitals icon contact sheet</h1>
<p class="bar">Dotted red outline on a size cell = upscaled beyond the file's native size. Grounds: #fff, #f4f1ea, #000, #15171a. Native tile is on a checkerboard; the zoomed tile is 4x nearest-neighbour (up to 128 px) to expose blur.</p>
`;
for (const g of groupsOrder) {
  const list = assets.filter((a) => a.group === g);
  if (!list.length) continue;
  html += `<h2>${esc(g)} (${list.length})</h2>`;
  for (const a of list) {
    const nat = a.w || 64;
    const natPx = Math.min(nat, 512);
    html += `<div class="row" data-id="${esc(a.id)}"><div class="meta"><b>${esc(a.id)}</b>${a.kind} · ${a.w}x${a.h}${a.bytes ? ' · ' + a.bytes + ' B' : ''}${a.maskable ? ' · maskable' : ''}${a.mono ? ' · monochrome' : ''}</div>
<div class="native"><div class="nat">${a.src ? `<img src="${a.src}" ${a.kind === 'raster' ? `width="${a.w}" height="${a.h}"` : `width="${natPx || 64}" height="${natPx || 64}"`} alt="">` : '<span class="na">n/a</span>'}</div>${a.kind === 'raster' && a.w && a.w <= 128 && a.src ? `<div class="zoom"><img src="${a.src}" width="${a.w * 4}" height="${a.h * 4}" alt=""></div>` : ''}</div>
<div class="grounds">${a.kind === 'raster' && a.w !== a.h ? '<span class="bar">non-square, shown at native only</span>' : sizesRow(a)}</div></div>`;
  }
}
// maskable
html += `<h2>Maskable icons under a circle and a squircle mask (red dashed = 80% safe-area circle)</h2><div class="tiles">`;
for (const a of assets.filter((x) => x.maskable)) for (const shape of ['circle', 'squircle']) html += `<div class="tile">${maskTile(a, 192, shape)}<span>${esc(a.id.split('/').pop())} · ${shape}</span></div>`;
for (const a of assets.filter((x) => /public\/icons\/icon-(192|512)\.png$/.test(x.id))) for (const shape of ['circle']) html += `<div class="tile">${maskTile(a, 192, shape)}<span>${esc(a.id.split('/').pop())} (purpose any) under ${shape}: NOT meant for masking, for reference</span></div>`;
html += `</div>`;
// android adaptive
html += `<h2>Android adaptive icon layers (108 dp canvas, 72 dp visible window, red dashed = 66 dp safe circle)</h2>`;
for (const set of ['light', 'night']) {
  html += `<h3>${set} resources (values${set === 'night' ? '-night' : ''})</h3><div class="tiles">`;
  for (const shape of ['circle', 'squircle']) html += `<div class="tile">${adaptiveTile(set, 216, shape)}<span>${set} adaptive · ${shape}</span></div>`;
  html += `<div class="tile">${plainSvg(android[set].bg, 108, '#888')}<span>background layer</span></div>`;
  html += `<div class="tile">${plainSvg(android[set].fg, 108, '#888')}<span>foreground layer on grey</span></div>`;
  html += `<div class="tile">${adaptiveTile(set, 216, 'circle', { mono: true, bgColor: '#3b4a6b' })}<span>monochrome (themed) on blue</span></div>`;
  html += `<div class="tile">${adaptiveTile(set, 216, 'circle', { mono: true, bgColor: '#1d1d1d' })}<span>monochrome on dark</span></div>`;
  html += `</div>`;
}
html += `<h3>Notification icon (white only; Android tints) and monochrome layer, at 24 / 48 px on three grounds</h3><div class="tiles">`;
for (const [bg, nm] of [['#444', 'dark grey'], ['#9aa', 'teal'], ['#000', 'black']]) for (const px of [24, 48]) html += `<div class="tile">${plainSvg(android.light.stat, px, bg)}<span>ic_stat ${px}px ${nm}</span></div>`;
html += `</div><h3>Splash mark (final frame, dot at scale 1) on its light and night grounds</h3><div class="tiles">`;
html += `<div class="tile">${plainSvg(android.light.splash, 160, lightColors.vitals_splash_background)}<span>light splash</span></div><div class="tile">${plainSvg(android.night.splash, 160, nightColors.vitals_splash_background)}<span>night splash</span></div>`;
html += `<div class="tile">${plainSvg(layer('vitals_splash_mark.xml', lightColors, { dotScale: 0 }), 160, lightColors.vitals_splash_background)}<span>light splash, XML initial state (dot scale 0)</span></div>`;
html += `</div>`;
// text report
html += `<h2>Manifest and html link check</h2><pre>${esc(JSON.stringify({ manifestCheck, linkCheck, androidColors }, null, 1))}</pre>`;
writeFileSync(join(HERE, 'icons.html'), html);

/* ---------------------------------------------------------------- pixel checks and screenshots */
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.goto(`file://${join(HERE, 'icons.html')}`);
await page.waitForTimeout(800);
const pixel = await page.evaluate(async (grounds) => {
  const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const out = [];
  for (const row of document.querySelectorAll('.row')) {
    const img = row.querySelector('.nat img');
    if (!img || !img.naturalWidth) { out.push({ id: row.dataset.id, error: 'not loaded' }); continue; }
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let transparent = 0, opaque = 0, n = c.width * c.height;
    const hist = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a < 10) transparent++; else if (a > 245) { opaque++; const k = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3); hist.set(k, (hist.get(k) || 0) + 1); }
    }
    const corner = [d[3], d[(c.width - 1) * 4 + 3], d[(c.height - 1) * c.width * 4 + 3], d[(n - 1) * 4 + 3]];
    const fullBleed = corner.every((a) => a > 245);
    // distinct colours (5-bit) and the two most common
    const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => ({ rgb: [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3], share: +(v / n).toFixed(3) }));
    // ink pixels = opaque pixels; luminance of the dominant opaque colour(s)
    const res = { id: row.dataset.id, w: c.width, h: c.height, transparentShare: +(transparent / n).toFixed(3), fullBleed, top };
    if (!fullBleed && top.length) {
      res.contrast = {};
      for (const [g, gn] of grounds) {
        const gl = lum(...hex(g));
        // worst contrast among the opaque colours that cover >= 3% of the image
        const cols = top.filter((t) => t.share >= 0.03);
        const rs = cols.map((t) => { const l = lum(...t.rgb); return (Math.max(l, gl) + 0.05) / (Math.min(l, gl) + 0.05); });
        res.contrast[gn] = rs.length ? +Math.min(...rs).toFixed(2) : null;
      }
    }
    out.push(res);
  }
  return out;
}, GROUNDS);
writeFileSync(join(HERE, 'icons-report.json'), JSON.stringify({ assets: assets.map(({ src, ...r }) => ({ ...r, src: src && src.startsWith('data:') ? '(data)' : src })), manifestCheck, linkCheck, androidColors, pixel, consoleErrors: errs }, null, 1));

// per-section shots
const sections = await page.$$('h2');
let i = 0;
for (const h of sections) {
  const box = await h.boundingBox();
  const next = sections[i + 1] ? await sections[i + 1].boundingBox() : null;
  const top = box.y + (await page.evaluate(() => window.scrollY));
  const bottom = next ? next.y + (await page.evaluate(() => window.scrollY)) : (await page.evaluate(() => document.body.scrollHeight));
  const name = (await h.innerText()).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  await page.screenshot({ path: join(OUT, `icons-s${i}-${name}.png`), fullPage: true, clip: { x: 0, y: top, width: 1500, height: Math.min(bottom - top, 6000) } });
  i++;
}
await browser.close();
console.log(`assets ${assets.length}; manifest ${manifestCheck.filter((m) => m.ok).length}/${manifestCheck.length} ok; console errors ${errs.length}; report ${join(HERE, 'icons-report.json')}`);
for (const m of manifestCheck) if (!m.ok) console.log('MANIFEST MISMATCH', JSON.stringify(m));
