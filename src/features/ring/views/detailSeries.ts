/** Raw signal series with explicit gaps, shared by the picture and its table. Smoothing stays display-only. */
import type { LinePoint } from '@/components';
import { medianSpacing } from '@/components/viz/smooth';

export function signalLine(points: readonly LinePoint[]): LinePoint[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const spacing = medianSpacing(sorted.map((p) => p.t));
  const gap = Math.max(15 * 60_000, 3 * spacing);
  const out: LinePoint[] = [];
  for (const p of sorted) {
    const prev = out.at(-1);
    if (prev && prev.v !== null && p.v !== null && p.t - prev.t > gap)
      out.push({ t: prev.t + Math.min(spacing || 60_000, (p.t - prev.t) / 2), v: null });
    out.push(p);
  }
  return out;
}
