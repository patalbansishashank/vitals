/* ==========================================================================
   Adherence dial geometry (COMPONENTS §13.9): a composition dial, not a
   progress ring. The circle is always the whole day's prescription, divided
   into arcs by each item's weight, clockwise from 12 in prescription order,
   with fixed pixel gaps between arcs. Each arc shows what happened to its
   item: done (solid ink), partial (ink for the credit share, then hollow),
   missed (hollow outline), unknown (dashed hairline, not counted). Pure.
   Angles: radians, 0 at 12 o'clock, increasing clockwise.
   ========================================================================== */
import type { DialArcState, DialItem } from './types';

export const TAU = Math.PI * 2;

export interface DialArc {
  id: string;
  label: string;
  state: DialArcState;
  /** Normalised share of the day (sums to 1 over the arcs). */
  share: number;
  credit: number | null;
  start: number;
  end: number;
  /** Partial arcs: where the inked credit share ends (start ≤ split ≤ end). */
  split?: number;
  detail?: string;
}

export function arcState(item: Pick<DialItem, 'credit' | 'status'>): DialArcState {
  if (item.credit === null || item.status === 'unknown') return 'unknown';
  if (item.status === 'skipped' || item.credit <= 0) return 'missed';
  if (item.credit >= 0.999) return 'done';
  return 'partial';
}

/**
 * Arcs for a dial of radius `r` px with `gapPx` between neighbouring arcs (2 px by spec). Items with zero weight get
 * no arc. A single item fills the circle less one gap so its two ends stay visible.
 */
export function dialArcs(items: readonly DialItem[], r: number, gapPx = 2): DialArc[] {
  const live = items.filter((i) => Number.isFinite(i.weight) && i.weight > 0);
  const total = live.reduce((s, i) => s + i.weight, 0);
  if (total <= 0 || live.length === 0) return [];
  const gap = Math.min(gapPx / Math.max(1, r), TAU / (live.length * 4));
  const usable = TAU - gap * live.length;
  let a = gap / 2;
  return live.map((it) => {
    const share = it.weight / total;
    const span = share * usable;
    const start = a;
    const end = a + span;
    a = end + gap;
    const state = arcState(it);
    const arc: DialArc = { id: it.id, label: it.label, state, share, credit: it.credit, start, end, ...(it.detail ? { detail: it.detail } : {}) };
    if (state === 'partial') arc.split = start + Math.max(0, Math.min(1, it.credit ?? 0)) * span;
    return arc;
  });
}

/** Point on the circle at angle `a` (0 = 12 o'clock, clockwise; SVG y grows down). */
export function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/** SVG path of a circular arc from a0 to a1 (clockwise). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  if (a1 - a0 <= 1e-6) return '';
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/** Closed outline of a ring segment (outer arc, end cap, inner arc back, start cap): the "hollow" arc. */
export function bandOutline(cx: number, cy: number, r: number, width: number, a0: number, a1: number): string {
  if (a1 - a0 <= 1e-6) return '';
  const ro = r + width / 2;
  const ri = r - width / 2;
  const [ox0, oy0] = polar(cx, cy, ro, a0);
  const [ox1, oy1] = polar(cx, cy, ro, a1);
  const [ix1, iy1] = polar(cx, cy, ri, a1);
  const [ix0, iy0] = polar(cx, cy, ri, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const f = (n: number) => n.toFixed(2);
  return `M${f(ox0)},${f(oy0)}A${ro},${ro} 0 ${large} 1 ${f(ox1)},${f(oy1)}L${f(ix1)},${f(iy1)}A${ri},${ri} 0 ${large} 0 ${f(ix0)},${f(iy0)}Z`;
}

const STATE_WORD: Record<DialArcState, string> = { done: 'done', partial: 'partly', missed: 'missed', unknown: 'not logged' };

/** The dial's full sentence for screen readers ("Adherence so far 62 of 100, based on 4 of 6 items: lunch done, …"). */
export function dialSentence(items: readonly DialItem[], score: number | null, opts: { final: boolean; quietWord?: string }): string {
  const known = items.filter((i) => i.credit !== null).length;
  const head =
    opts.quietWord !== undefined
      ? `Adherence ${opts.final ? '' : 'so far '}: ${opts.quietWord}`
      : score === null
        ? 'Adherence: not enough logged yet'
        : `Adherence ${opts.final ? '' : 'so far '}${Math.round(score)} of 100`;
  const parts = items.map((i) => {
    const s = arcState(i);
    return s === 'partial' ? `${i.label} ${Math.round((i.credit ?? 0) * 100)} percent` : `${i.label} ${STATE_WORD[s]}`;
  });
  return `${head.replace(/\s+:/, ':')}, based on ${known} of ${items.length} items${parts.length ? `: ${parts.join(', ')}` : ''}.`;
}
