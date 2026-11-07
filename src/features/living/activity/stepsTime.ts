/**
 * (r069 D3) Steps in time, from the day's fused minute timeline (S2 `timeline`, `steps-fuse/1`). Pure: the screens draw
 * these and the tests read them.
 *
 *  - `stepsBins`: the day's counted steps in bins (15 min by default): the minutes the fusion placed plus each unplaced
 *    coarse unit's parts in the bin they ended, so the bins add up to the located total (as `stepsHours` does by hour).
 *    A bin no source covered is null (unknown), never 0.
 *  - `lastCountedAt`: the end of the last minute any source covered: what "Updated hh:mm" means for the steps, so the
 *    card's time and the chart's last bar agree.
 *  - `windowSteps`: an activity's window with a margin either side, minute by minute, and what each source counted inside
 *    it (the counted steps, the ring's and the phone's own). One model for every activity sheet: a detected one, an
 *    approved one and one logged by hand. A window with observed zeros stays a steps chart with zero bars (a treadmill
 *    desk where neither the ring nor the phone saw a step); heart rate stands in only where no source covered any minute.
 */
import type { GaugeTimeline } from '@/net/gauge';
import { coarseAt } from './model';

const MIN = 60_000;

/** The first minute of a timeline (UTC ms). */
export const timelineStart = (t: Pick<GaugeTimeline, 'date' | 'start'>): number => (t.start ? Date.parse(t.start) : Date.parse(`${t.date}T00:00:00`));

export interface StepsBin {
  start: number;
  /** Counted steps of the bin; null = no source covered any of its minutes. */
  steps: number | null;
}

/** The day's counted steps in `binMin`-minute bins (the whole day; bins after the last reading are null). */
export function stepsBins(t: Pick<GaugeTimeline, 'date' | 'start' | 'minutes' | 'steps'>, binMin = 15): StepsBin[] {
  const first = timelineStart(t);
  const n = Math.ceil(t.minutes / binMin);
  const out: StepsBin[] = Array.from({ length: n }, (_, i) => ({ start: first + i * binMin * MIN, steps: null }));
  const add = (i: number, v: number) => {
    if (i < 0 || i >= n) return;
    out[i]!.steps = (out[i]!.steps ?? 0) + v;
  };
  t.steps.selected.forEach((v, k) => {
    if (v !== null && Number.isFinite(v)) add(Math.floor(k / binMin), v);
  });
  for (const u of t.steps.coarse ?? []) {
    if (typeof u !== 'object' || u === null || (u as { placed?: unknown }).placed === true) continue;
    const parts = (u as { parts?: unknown }).parts;
    for (const p of Array.isArray(parts) ? parts : []) {
      const c = coarseAt(p, 'at');
      if (c) add(Math.floor((c.ms - first) / (binMin * MIN)), c.steps);
    }
  }
  return out;
}

/** Σ of the known bins; null when none is known. */
export function binsTotal(bins: readonly StepsBin[]): number | null {
  let s = 0;
  let any = false;
  for (const b of bins) {
    if (b.steps === null) continue;
    s += b.steps;
    any = true;
  }
  return any ? s : null;
}

/** The end of the last minute any source covered (UTC ms), or null on a day without a reading. */
export function lastCountedAt(t: Pick<GaugeTimeline, 'date' | 'start' | 'steps'>): number | null {
  const sel = t.steps.selected;
  for (let k = sel.length - 1; k >= 0; k--) if (sel[k] !== null && sel[k] !== undefined) return timelineStart(t) + (k + 1) * MIN;
  return null;
}

/** Minute lanes of a span: the counted steps and, from a timeline, each source's own and the minute's source. */
export interface StepLanes {
  /** UTC ms of minute 0. */
  first: number;
  selected: ReadonlyArray<number | null>;
  ring?: ReadonlyArray<number | null>;
  phone?: ReadonlyArray<number | null>;
  source?: ReadonlyArray<string | null>;
  hr?: ReadonlyArray<number | null>;
}

/** A timeline's lanes. */
export function lanesOfTimeline(t: GaugeTimeline): StepLanes {
  return { first: timelineStart(t), selected: t.steps.selected, ring: t.steps.ring, phone: t.steps.phone, source: t.steps.source, hr: t.hr.bpm };
}

/** A candidate's stored minute evidence as lanes (the counted steps and heart rate only). */
export function lanesOfEvidence(e: { first: number; steps: ReadonlyArray<number | null>; hr?: { bpm: ReadonlyArray<number | null> } }): StepLanes {
  return { first: e.first, selected: e.steps, ...(e.hr ? { hr: e.hr.bpm } : {}) };
}

export interface WindowSteps {
  /** The span drawn (the window and its margin), UTC ms. */
  from: number;
  to: number;
  /** One bar per minute: the counted steps, or the heart rate where `kind` is 'hr'; null = no reading. */
  bars: Array<{ t: number; v: number | null }>;
  max: number;
  /** 'steps' when any minute of the span has a step reading (zeros count), 'hr' when only heart rate does. */
  kind: 'steps' | 'hr' | 'none';
  /** Inside the window: the counted steps, each source's own (null = no reading) and the source that counted them. */
  inside: { counted: number | null; ring: number | null; phone: number | null; from: 'ring' | 'phone' | 'both' | null; coveredMin: number; minutes: number };
}

const at = (xs: ReadonlyArray<number | null> | undefined, k: number): number | null => {
  if (!xs || k < 0 || k >= xs.length) return null;
  const v = xs[k];
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
};

/**
 * The window's minutes with `marginMin` either side, and what was counted inside `inside` (default the window itself; the
 * activity sheet passes the scrubbed window, so the span stays still while the counts follow the thumbs).
 */
export function windowSteps(window: { start: number; end: number }, lanes: StepLanes | null, marginMin = 15, inside: { start: number; end: number } = window): WindowSteps {
  const from = window.start - marginMin * MIN;
  const to = window.end + marginMin * MIN;
  const idx = (t: number) => (lanes ? Math.floor((t - lanes.first) / MIN) : -1);
  let anySteps = false;
  let anyHr = false;
  for (let t = from; t < to; t += MIN) {
    if (at(lanes?.selected, idx(t)) !== null) anySteps = true;
    if (at(lanes?.hr, idx(t)) !== null) anyHr = true;
  }
  const kind: WindowSteps['kind'] = anySteps ? 'steps' : anyHr ? 'hr' : 'none';
  const bars: WindowSteps['bars'] = [];
  for (let t = from; t < to; t += MIN) bars.push({ t, v: kind === 'none' ? null : at(kind === 'steps' ? lanes?.selected : lanes?.hr, idx(t)) });
  const max = Math.max(1, ...bars.map((b) => b.v ?? 0));
  let counted: number | null = null;
  let ring: number | null = null;
  let phone: number | null = null;
  let covered = 0;
  const srcs = new Set<string>();
  const plus = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + b);
  for (let t = inside.start; t < inside.end; t += MIN) {
    const k = idx(t);
    const v = at(lanes?.selected, k);
    if (v !== null) {
      covered++;
      counted = plus(counted, v);
      const s = lanes?.source?.[k];
      if (s && v > 0) srcs.add(s.startsWith('ring') ? 'ring' : s.startsWith('phone') ? 'phone' : s);
    }
    ring = plus(ring, at(lanes?.ring, k));
    phone = plus(phone, at(lanes?.phone, k));
  }
  const from_: WindowSteps['inside']['from'] = srcs.size === 0 ? null : srcs.size > 1 ? 'both' : srcs.has('ring') ? 'ring' : srcs.has('phone') ? 'phone' : 'both';
  return {
    from,
    to,
    bars,
    max,
    kind,
    inside: { counted, ring: lanes?.ring ? ring : null, phone: lanes?.phone ? phone : null, from: from_, coveredMin: covered, minutes: Math.round((inside.end - inside.start) / MIN) },
  };
}
