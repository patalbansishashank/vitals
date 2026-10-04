// The Vitals mark, read from its source of truth (public/brand/mark.svg and the small-size cut mark-small.svg), plus
// the palette every generated asset uses. Everything under scripts/brand builds SVG strings from these values, so a
// change to the source SVGs flows into every icon, splash and component test.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BRAND_DIR = path.join(ROOT, 'public', 'brand');

/** Vitals palette (design/tokens.css): chassis is the page ground, ink the ring, signal the dot. */
export const PALETTE = {
  light: { ground: '#e8eaec', ink: '#191c20', signal: '#f5d336', edge: '#191c20' },
  dark: { ground: '#151618', ink: '#eff0f2', signal: '#f0d03c', edge: null },
};

/** Size of the square viewBox both source SVGs are drawn on (Android's adaptive-icon grid, in dp). */
export const GRID = 108;

const num = (src, re, what) => {
  const m = src.match(re);
  if (!m) throw new Error(`mark source: ${what} not found`);
  return Number(m[1]);
};

/**
 * @param {'mark.svg' | 'mark-small.svg'} file
 * @returns {{ d: string, stroke: number, dot: { cx: number, cy: number, r: number, edge: number } }}
 */
export function readMark(file = 'mark.svg') {
  const src = readFileSync(path.join(BRAND_DIR, file), 'utf8');
  const d = src.match(/<path id="ring"[^>]*\sd="([^"]+)"/)?.[1];
  if (!d) throw new Error(`${file}: <path id="ring"> not found`);
  const circle = src.match(/<circle id="dot"[^>]*\/>/)?.[0];
  if (!circle) throw new Error(`${file}: <circle id="dot"> not found`);
  return {
    d,
    stroke: num(src, /\.ring\s*{[^}]*stroke-width:\s*([\d.]+)/, '.ring stroke-width'),
    dot: {
      cx: num(circle, /cx="([\d.]+)"/, 'dot cx'),
      cy: num(circle, /cy="([\d.]+)"/, 'dot cy'),
      r: num(circle, /\sr="([\d.]+)"/, 'dot r'),
      edge: num(src, /\.dot\s*{[^}]*stroke-width:\s*([\d.]+)/, '.dot stroke-width'),
    },
  };
}

/**
 * The mark's shapes as SVG elements in one fixed colouring, for compositing into tiles.
 * tone: 'light' (ink on a light ground), 'dark' (light ink on a dark ground), 'mono' (one colour, dot included).
 * @param {{ tone?: 'light' | 'dark' | 'mono', mono?: string, small?: boolean }} [opts]
 */
export function markShapes({ tone = 'light', mono = '#ffffff', small = false } = {}) {
  const m = readMark(small ? 'mark-small.svg' : 'mark.svg');
  const p = tone === 'mono' ? null : PALETTE[tone];
  const ink = p ? p.ink : mono;
  const fill = p ? p.signal : mono;
  const edge = p?.edge ? ` stroke="${p.edge}" stroke-width="${m.dot.edge}"` : '';
  return (
    `<path d="${m.d}" fill="none" stroke="${ink}" stroke-width="${m.stroke}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${m.dot.cx}" cy="${m.dot.cy}" r="${m.dot.r}" fill="${fill}"${edge}/>`
  );
}
