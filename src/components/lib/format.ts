/**
 * Number formatting in the Vitals voice (DESIGN_DIRECTION §3.1):
 * true minus sign (U+2212), comma-grouped thousands by default, en dash for positive ranges, “to” for signed ranges, units after a
 * thin space.
 */
export const MINUS = '\u2212';
export const THIN_SPACE = '\u2009';
/**
 * Thousands separator: a no-break space, so a number never breaks across lines ("2 / 890", Q6). It is the width of a
 * normal space in Inter.
 */
export const GROUP_SPACE = '\u00a0';
export const EN_DASH = '\u2013';
export const EM_DASH = '\u2014';

export type Grouping = 'thin' | 'comma' | 'none';

export interface FormatOptions {
  /** Thousands separator. `comma` (default) for UI; `thin` preserves the older no-break-space grouping when requested. */
  grouping?: Grouping;
}

/** Format a number with fixed decimals, U+2212 minus and grouped thousands. */
export function formatNumber(value: number, decimals = 0, options: FormatOptions = {}): string {
  if (!Number.isFinite(value)) return EM_DASH;
  const grouping = options.grouping ?? 'comma';
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

/** "18.6–21.0", or "−7 to −6" when either endpoint is negative. */
export function formatRange(lo: number, hi: number, decimals = 0, options: FormatOptions = {}): string {
  return `${formatNumber(lo, decimals, options)}${lo < 0 || hi < 0 ? ' to ' : EN_DASH}${formatNumber(hi, decimals, options)}`;
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
