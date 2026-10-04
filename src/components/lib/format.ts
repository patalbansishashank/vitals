/**
 * Number formatting in the Vitals voice (DESIGN_DIRECTION §3.1):
 * true minus sign (U+2212), no-break-space thousands (U+00A0, as narrow as a thin space in Archivo) in metric locales,
 * en dash for ranges, units after a thin space.
 */
export const MINUS = '\u2212';
export const THIN_SPACE = '\u2009';
/**
 * Thousands separator: a no-break space, so a number never breaks across lines ("2 / 890", Q6). In Archivo it is as
 * narrow as the thin space it replaces (3.3 vs 3.2 px at 16 px); U+202F was tried first but Archivo draws it 1.6 px wide.
 */
export const GROUP_SPACE = '\u00a0';
export const EN_DASH = '\u2013';
export const EM_DASH = '\u2014';

export type Grouping = 'thin' | 'comma' | 'none';

export interface FormatOptions {
  /** Thousands separator. `thin` (default) for metric locales, `comma` for en-US. */
  grouping?: Grouping;
}

/** Format a number with fixed decimals, U+2212 minus and grouped thousands. */
export function formatNumber(value: number, decimals = 0, options: FormatOptions = {}): string {
  if (!Number.isFinite(value)) return EM_DASH;
  const grouping = options.grouping ?? 'thin';
  const fixed = Math.abs(value).toFixed(Math.max(0, decimals));
  const negative = value < 0 && Number(fixed) !== 0;
  const [int = '0', frac] = fixed.split('.');
  let grouped = int;
  if (grouping !== 'none' && int.length > 3) {
    const sep = grouping === 'comma' ? ',' : GROUP_SPACE;
    grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }
  return `${negative ? MINUS : ''}${grouped}${frac !== undefined ? `.${frac}` : ''}`;
}

/** Signed change: "+1.2", "−0.4", "±0.0". */
export function formatSigned(value: number, decimals = 1, options: FormatOptions = {}): string {
  if (!Number.isFinite(value)) return EM_DASH;
  const body = formatNumber(Math.abs(value), decimals, options);
  if (Number(Math.abs(value).toFixed(decimals)) === 0) return `\u00b1${body}`;
  return `${value > 0 ? '+' : MINUS}${body}`;
}

/** "18.6–21.0" (en dash, no spaces). */
export function formatRange(lo: number, hi: number, decimals = 0, options: FormatOptions = {}): string {
  return `${formatNumber(lo, decimals, options)}${EN_DASH}${formatNumber(hi, decimals, options)}`;
}

/** Parse user-typed numbers: accepts U+2212, thin/normal spaces, comma decimals. */
export function parseNumber(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(/[\u2212\u2013]/g, '-')
    .replace(/[\s\u2009\u202f]/g, '')
    .replace(/,(?=\d{1,2}$)/, '.')
    .replace(/,/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Bytes as "1.8 MB" / "640 kB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${Math.round(bytes)}${THIN_SPACE}B`;
  if (bytes < 1_000_000) return `${formatNumber(bytes / 1000, bytes < 10_000 ? 1 : 0)}${THIN_SPACE}kB`;
  return `${formatNumber(bytes / 1_000_000, 1)}${THIN_SPACE}MB`;
}
