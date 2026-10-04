/**
 * Ports of the `markers.*` executors (E20, SUITE_SPEC §13.5.6). Commands never import `src/ai`: the Coach installs the
 * vision port (`aiPorts().markerVision`, see `@/commands/aiPorts`) when a vision-capable provider is configured; the
 * extraction pipeline (`@/markers/extract`) is loaded on demand. Tests replace either with `setMarkerExtractor`.
 */
import type { ExtractDeps, ExtractResult } from '@/markers/extract';
import type { LocalDate } from '@/store';

export type { VisionPort as MarkerVisionPort, VisionRequest as MarkerVisionRequest } from '@/markers/extract';
export type { ExtractDeps, ExtractProgress, ExtractResult } from '@/markers/extract';

/** The extraction entry point (`extractFromFile` of `@/markers/extract`). */
export type ExtractFn = (input: { bytes: Uint8Array; mime: string; name?: string }, deps: ExtractDeps) => Promise<ExtractResult>;

let override: ExtractFn | null = null;

/** Tests: replace the pipeline (null restores the real one). */
export function setMarkerExtractor(fn: ExtractFn | null): void {
  override = fn;
}

/** The extraction pipeline (loaded on demand: pdf.js and the synonym tables stay out of the main chunk). */
export async function markerExtractor(): Promise<ExtractFn> {
  if (override) return override;
  return (await import('@/markers/extract')).extractFromFile;
}

/** Mime type from the first bytes (PDF, JPEG, PNG, WebP, HEIC); null when unknown. */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = (i: number) => bytes[i] ?? -1;
  const ascii = (from: number, n: number) => String.fromCharCode(...bytes.slice(from, from + n));
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (b(0) === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(4, 4) === 'ftyp' && /^(heic|heix|mif1|msf1)$/.test(ascii(8, 4))) return 'image/heic';
  return null;
}

/** Parse a printed range ("40 - 60", "< 200", "> 40") into a `LabRange` in the row's unit. */
export function labRangeOf(text: string | undefined, unit: string): { low?: number; high?: number; text: string; unit: string } | undefined {
  if (!text?.trim()) return undefined;
  const t = text.trim();
  const n = (s: string) => Number.parseFloat(s.replace(',', '.'));
  const between = /(-?\d+(?:[.,]\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:[.,]\d+)?)/i.exec(t);
  if (between) return { low: n(between[1]!), high: n(between[2]!), text: t, unit };
  const below = /^(?:<|≤|<=|up to|less than)\s*(\d+(?:[.,]\d+)?)/i.exec(t);
  if (below) return { high: n(below[1]!), text: t, unit };
  const above = /^(?:>|≥|>=|more than|greater than)\s*(\d+(?:[.,]\d+)?)/i.exec(t);
  if (above) return { low: n(above[1]!), text: t, unit };
  return { text: t, unit };
}

/** A sample date may not lie after the person's today. */
export const notInFuture = (date: LocalDate, today: LocalDate): boolean => date <= today;
