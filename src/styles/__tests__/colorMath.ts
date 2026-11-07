/**
 * Colour maths for the token tests (jsdom computes no styles, so the stylesheets are read as text and the hex values are
 * measured here): WCAG contrast, OKLab / OKLCH, the dataviz validator's ΔE (OKLab × 100) plain and under Machado (2009)
 * protan / deutan simulation. The same formulas the r071 palette script used (r071/proto/color/palette.mjs).
 */
export type Rgb = readonly [number, number, number];

/** `#RRGGBB` to sRGB 0–1. */
export const toRgb = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as unknown as Rgb;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linRgb = (h: string): Rgb => toRgb(h).map(lin) as unknown as Rgb;

/** WCAG relative luminance. */
export function luminance(h: string): number {
  const [r, g, b] = linRgb(h);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two `#RRGGBB` colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

function oklabOf(rgb: Rgb): readonly [number, number, number] {
  const [r, g, b] = rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLCH of a `#RRGGBB` colour: lightness 0–1, chroma, hue in degrees. */
export function oklch(h: string): { L: number; C: number; H: number } {
  const [L, A, B] = oklabOf(linRgb(h));
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

const CVD = [
  [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
] as const;
const sim = (rgb: Rgb, m: (typeof CVD)[number]): Rgb => m.map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]))) as unknown as Rgb;
const dist = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!) * 100;

/** ΔE in OKLab × 100 (the validator's measure) for full colour vision. */
export const deltaE = (a: string, b: string): number => dist(oklabOf(linRgb(a)), oklabOf(linRgb(b)));

/** The smaller of the protan and deutan ΔE (Machado 2009, full severity). */
export const deltaECvd = (a: string, b: string): number => Math.min(...CVD.map((m) => dist(oklabOf(sim(linRgb(a), m)), oklabOf(sim(linRgb(b), m)))));

/** What the browser paints for `deep` at `alpha` over `base` (sRGB-space alpha compositing, as Chromium does). */
export function blend(deep: string, alpha: number, base: string): string {
  const d = toRgb(deep);
  const b = toRgb(base);
  return '#' + [0, 1, 2].map((i) => Math.round((d[i]! * alpha + b[i]! * (1 - alpha)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
