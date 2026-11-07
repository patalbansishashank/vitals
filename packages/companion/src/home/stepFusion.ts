/**
 * Step fusion `steps-fuse/1` (energy SPEC §2.3; DECISION D1 and D3 at their recommended defaults). Pure: no store, no
 * clock, no time zone. `./gaugeDerive.ts` feeds it the store's evidence and `./lumenTools.ts` serves the result
 * (`gauge_steps`, `/v1/gauge/steps`).
 *
 * One source is **selected** per supported interval by a ranked policy; counts are never maxed and never summed across
 * lineages:
 *
 * 1. Dedupe: one record per upstream id (the latest revision; tombstones drop it).
 * 2. Validity: cadence over 300/min (P) or a stale source makes a record invalid for selection (kept as an alternative).
 * 3. Per lineage, one disjoint track: valid records first (r063 A8: an invalid primary never hides a valid same-lineage
 *    alternative), then the lineage's primary source (D4: the phone's direct counter before Health Connect's copies),
 *    finer support before coarser, then time. A record overlapping the track is a same-lineage copy: it is reported as
 *    an alternative and never counted.
 * 4. Atomic supports: connected components of overlapping records across lineages. A component of minute records only
 *    is selected minute by minute; any coarser record makes the whole component one unit (a coarse record is never split).
 *    A coarse hc-other or unknown record that valid records of preferred lineages overlap for at least 90 % of its time
 *    (P, `ADEQUATE_COVERAGE`) could never be selected; it is eclipsed (an alternative only) and does not join the
 *    component. One less well covered joins it (r063 A3: a single preferred minute never erases a whole coarse record).
 * 5. Selection, first rule that applies: (a) a user correction, (b) explicit carry and activity context, (c) sole sustained gait (the
 *    treadmill case: ≥ 3 consecutive minutes where one lineage reads ≥ 80/min and the other is observed at ≤ 10 % of it;
 *    minute units only), (d) the only valid lineage (`coverage` when the others covered only part of a coarse unit), (e) the preference `ring > phone > hc-other > unknown`, flagged
 *    `disagreement` at a 20 % relative difference (P). In a coarse unit, rules (b) to (e) consider only the lineages
 *    whose records cover at least 90 % of the unit when any does (r063 A3): a partial witness never speaks for the whole
 *    unit, and is listed as an alternative flagged `partial`. (r068 walk) Before (e), a unit inside a phone walking bout
 *    the phone clearly out-counted the ring over, while the ring missed part of it, takes the phone (`boutCount`). A
 *    complete ring track can instead yield to sustained minute-supported phone gait with repeated wrist stalls
 *    (`wristStall`); ordinary count disagreement retains the preference and its disagreement flag.
 * 6. Days (`fusedDays`): `located` sums the selected units; the ring's daily total is never added to it. Its unlocated
 *    rest is `ringResidual`. The headline is `located` when the ring's detail for the day is complete, otherwise the
 *    labelled `atLeast` scenario `max(located, ringDailyTotal)` (D3).
 *
 * Minutes a phone acquisition window proves were listened to (with step-detector timing) and that carry no phone record
 * are the phone's observed zeros (`zeroWindows`): only then is "the other lineage observed at ≤ 10 %" true for the phone.
 */

export const FUSION_VERSION = 'steps-fuse/1';
/**
 * (r068 B1) The implementation's revision, in every fused answer's `inputsHash` (so its ETag) beside `FUSION_VERSION`:
 * the same inputs now fuse differently (minute detail on the wall clock, the partial-witness refinement, placed units),
 * so a cached answer from before must not be revalidated. The public version stays `steps-fuse/1`.
 * (r068 walk) `+r068-walk`: phone walking bouts the phone clearly out-counted the ring over (`boutCount`), and the
 * phone's detector-timed minutes read at the counter's count (`gaugeDerive.ts`, `counterScaledPhoneSteps`).
 * (r076) `+r076-stall`: sustained minute-supported phone gait can win despite complete ring coverage when the ring
 * repeatedly stalls; unknown-carry activity alone no longer makes any positive phone count authoritative.
 */
export const FUSION_REVISION = 'steps-fuse/1+r076-stall';

export type StepLineage = 'ring' | 'phone' | `hc-other:${string}` | 'unknown';
/** `minute` lies inside one wall-clock minute; every other support is coarse. */
export type StepSupport = 'minute' | 'tenMinuteFallback' | 'quarterHour' | 'counterSpan' | 'span';
/**
 * `coverage` (r063 A3): the only valid lineage whose records cover a coarse unit, others having covered only part of it.
 * `boutCount` (r068 walk): the unit lies in a phone walking bout the phone clearly out-counted the ring over (`PhoneBout`).
 * `wristStall` (r076): direct minute gait on the phone and repeated low ring minutes, despite complete ring coverage.
 */
export type SelectionReason = 'userCorrection' | 'activityContext' | 'soleSustainedGait' | 'soleObserved' | 'coverage' | 'boutCount' | 'wristStall' | 'preference';

export interface StepRecord {
  /** The event id (its revision): what `inputsHash` names. */
  id: string;
  /** The upstream record: one record per upstream id is kept, the latest `rev` (then the greatest id). Default `id`. */
  upstreamId?: string;
  rev?: number;
  lineage: StepLineage;
  /** The physical source inside the lineage (`ring:<device_key>`, `phone:counter`, `hc:<origin>`). */
  source: string;
  /** Lower is the lineage's primary representation (D4: the direct counter 0, Health Connect's copy 1). Default 0. */
  sourceRank?: number;
  startMs: number;
  /** Exclusive. */
  endMs: number;
  steps: number;
  support: StepSupport;
  /** The source's scope is stale (an expired Health Connect token): kept as an alternative, never selected. */
  stale?: boolean;
  /** A tombstone: the upstream record (and only it) is retracted. */
  deleted?: boolean;
}

export type ActivityKind = 'locomotor' | 'locomotorPocket' | 'locomotorRing' | 'treadmill' | 'nonLocomotor';

export interface FusionContext {
  /** Rule (a): the person's "use phone" / "use ring" for an interval. */
  corrections?: ReadonlyArray<{ startMs: number; endMs: number; use: StepLineage }>;
  /**
   * Rule (b): approved activities by step behaviour. `locomotorPocket` and `treadmill` take the phone whenever it was
   * observed with a credible gait; `locomotor` (a gait type whose carry is not known, what Vitals sends) takes the phone
   * only with sustained gait evidence, so a few phone steps on a desk do not overrule a walking ring; `nonLocomotor` takes the phone if observed, else
   * the ring flagged `nonLocomotorSuspect`, and rule (c) never applies inside it. `locomotorRing` (r063: a gait bout with
   * the phone carried in the hand or left on a desk) takes the ring: the phone did not observe the gait, so it is never
   * selected there while the ring has a record, and its observed zeros are not made inside it.
   */
  activities?: ReadonlyArray<{ startMs: number; endMs: number; kind: ActivityKind }>;
  /** Lineage classes in order (`hc-other` stands for every `hc-other:<origin>`). Default `ring > phone > hc-other > unknown`. */
  preference?: readonly string[];
  /** DECISION D1's rule (c) switch (the person's `soleSustainedGait` setting). Default true. */
  soleSustainedGait?: boolean;
  /** Windows in which a lineage was observed: its whole minutes there without a record are observed zeros. */
  zeroWindows?: ReadonlyArray<{ lineage: StepLineage; source: string; startMs: number; endMs: number }>;
  /** Instants that merged minute intervals never cross (the local day starts, and the person's rollovers). */
  breaks?: readonly number[];
  /**
   * (r063 FX2, final review sR08/aR03) The person's day rollover (local hour, may be fractional; Vitals'
   * `settings.dayRolloverH`): `fuseRange` adds each day's rollover instant to `breaks`, so a merged minute interval never
   * spans two app days and Vitals' app-day adapter can place every located count. Absent = midnight breaks only.
   */
  rolloverH?: number;
}

export interface Alternative {
  source: string;
  lineage: StepLineage;
  steps: number;
  support: StepSupport;
  /** Why it could not be selected. */
  invalid?: 'cadence' | 'stale';
  /** A copy inside the selected lineage (D4's alternate representation, or a duplicate upload). */
  sameLineage?: true;
  /** (r063 A3) Its records cover less than `ADEQUATE_COVERAGE` of the coarse unit, while another lineage's cover it. */
  partial?: true;
}

export interface FusedInterval {
  startMs: number;
  endMs: number;
  /** `minute`: selected minute by minute (merged when consecutive minutes chose alike); `component`: one coarse unit, never split. */
  unit: 'minute' | 'component';
  /** Null when no valid lineage observed the unit (unknown, never 0). */
  steps: number | null;
  source: string | null;
  lineage: StepLineage | null;
  support: StepSupport | null;
  selectionReason: SelectionReason | 'noValidSource';
  alternatives: Alternative[];
  disagreement?: true;
  nonLocomotorSuspect?: true;
  /**
   * A component unit's selected count by the selected lineage's own records (each at its last instant), so the day
   * values place each record's steps on its own day: a component crossing midnight is never moved whole onto one day.
   */
  parts?: Array<{ atMs: number; steps: number }>;
  /**
   * (r068 B1) A component unit whose chosen lineage's records are all minute records: each record's steps are placed in
   * its minute in `minuteSelected` (the unit is still one choice; nothing coarse is split).
   */
  placed?: true;
}

/** A record of a lineage track (what the lineage observed, located or not), for the day values and the timeline. */
export interface TrackRecord extends StepRecord {
  valid: boolean;
  invalid?: 'cadence' | 'stale';
  /** An observed zero minute the fusion added from `zeroWindows`. */
  synthetic?: true;
}

/**
 * (r068 walk) A phone walking bout: minutes where the phone counted at least `BOUT_ACTIVE` steps, joined across gaps of at
 * most `BOUT_GAP` minutes, at least `BOUT_MIN` minutes long. `phone` and `ring` are each lineage's valid steps over it
 * (a record partly inside counts in proportion to its time inside), `ringCoverage` the share of its time the ring's
 * records cover. `prefersPhone`: the phone clearly out-counted the ring over the whole bout with missing ring coverage
 * or repeated wrist stalls (see `phoneBouts`).
 */
export interface PhoneBout {
  startMs: number;
  endMs: number;
  phone: number;
  ring: number;
  ringCoverage: number;
  /** Direct minute evidence: sustained phone gait while a complete ring track repeatedly near-stalled. */
  wristStall?: true;
  prefersPhone: boolean;
}

export interface FusionResult {
  version: typeof FUSION_VERSION;
  /**
   * Disjoint, by start. Consecutive minute units with the same choice (lineage, source, reason, flags, alternatives;
   * observed zeros apart from counts) are merged, never across `breaks`.
   */
  intervals: FusedInterval[];
  /** Each lineage's disjoint track, by start. */
  tracks: Map<StepLineage, TrackRecord[]>;
  /** Same-lineage copies that were not counted. */
  copies: StepRecord[];
  /**
   * The selected count of each minute, by minute start: the minute units, and the minute records of a component unit
   * whose chosen lineage gave only minute records (`placed`). A coarse record is never placed in a minute.
   */
  minuteSelected: Map<number, { steps: number; lineage: StepLineage; source: string }>;
  /** (r068 walk) The phone's walking bouts, by start (only while the preference puts the ring before the phone). */
  bouts: PhoneBout[];
}

// --- parameters (§2.3; P = product default)

export const MAX_CADENCE = 300;
export const GAIT_CADENCE = 80;
export const GAIT_OTHER_SHARE = 0.1;
export const GAIT_MIN_RUN = 3;
export const DISAGREEMENT = 0.2;
export const DEFAULT_PREFERENCE = ['ring', 'phone', 'hc-other', 'unknown'] as const;
/**
 * (r063 A3, P) The share of a coarse record's (or a coarse unit's) time that a lineage's valid records must cover before
 * they may stand for all of it: eclipse a whole coarse hc-other record, or win a coarse unit by rules (b) to (e).
 */
export const ADEQUATE_COVERAGE = 0.9;
/**
 * (r068 walk, P) A phone walking bout (`PhoneBout`): a minute is active at `BOUT_ACTIVE` phone steps or more; active
 * minutes `BOUT_GAP` or fewer minutes apart join; a bout is at least `BOUT_MIN` minutes long. The phone clearly
 * out-counted the ring over it when it counted at least `BOUT_RATIO` times the ring's steps and `BOUT_MARGIN` more, and
 * the ring's records cover less than `ADEQUATE_COVERAGE` of it (the ring missed minutes, not only counted low).
 */
export const BOUT_ACTIVE = 40;
export const BOUT_GAP = 2;
export const BOUT_MIN = 5;
export const BOUT_RATIO = 1.5;
export const BOUT_MARGIN = 500;
/** Extra evidence for overriding a complete ring track, not a measured accuracy claim. Coarse spans never qualify. */
export const STALL_MIN = 10;
export const STALL_ACTIVE_SHARE = 0.8;
export const STALL_LOW_SHARE = 0.5;
export const STALL_RING_SHARE = 0.35;

const MIN = 60_000;
const SUPPORT_RANK: Record<StepSupport, number> = { minute: 0, counterSpan: 1, tenMinuteFallback: 2, quarterHour: 3, span: 4 };

const isMinute = (r: { support: StepSupport; startMs: number; endMs: number }) =>
  r.support === 'minute' && r.endMs - r.startMs <= MIN && Math.floor(r.startMs / MIN) === Math.floor((r.endMs - 1) / MIN);

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The first index whose `endMs` is after `t` (records disjoint and sorted, so their ends are sorted too). */
function firstEndAfter(xs: ReadonlyArray<{ endMs: number }>, t: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]!.endMs > t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
const overlapsAny = (xs: ReadonlyArray<{ startMs: number; endMs: number }>, s: number, e: number) => {
  const i = firstEndAfter(xs, s);
  return i < xs.length && xs[i]!.startMs < e;
};

function lineageRank(pref: readonly string[], l: string): number {
  const cls = l.startsWith('hc-other:') ? 'hc-other' : l;
  const i = pref.indexOf(cls);
  return i < 0 ? pref.length : i;
}

/** `|a − b| / max(a, b, 1)` at or over 20 %. */
const disagree = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b, 1) >= DISAGREEMENT;

const within = (windows: ReadonlyArray<{ startMs: number; endMs: number }> | undefined, t: number) => windows?.find((w) => w.startMs <= t && t < w.endMs);

interface Obs {
  lineage: StepLineage;
  steps: number;
  valid: boolean;
  invalid?: 'cadence' | 'stale';
  source: string;
  support: StepSupport;
  /** (coarse units) Its records cover less than `ADEQUATE_COVERAGE` of the unit. */
  partial?: true;
}

/** Milliseconds of `[s, e)` the union of `xs` covers. */
function coveredMs(xs: ReadonlyArray<{ startMs: number; endMs: number }>, s: number, e: number): number {
  const parts = xs.map((x) => [Math.max(s, x.startMs), Math.min(e, x.endMs)] as const).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let total = 0;
  let cs = -Infinity;
  let ce = -Infinity;
  for (const [a, b] of parts) {
    if (a > ce) {
      if (ce > cs) total += ce - cs;
      cs = a;
      ce = b;
    } else ce = Math.max(ce, b);
  }
  if (ce > cs) total += ce - cs;
  return total;
}

/**
 * (r068 B1) Minute detail on a device's own clock, placed on the wall clock. Gauge sends each minute of a ring record as
 * `record start + k · 60 s` (the owner's ring: 19 s past every wall-clock minute), so each of its 60-second `minute`
 * records straddles two wall-clock minutes. The minute grid here, the timeline and the detector read the wall clock, so
 * such a record counted as coarse: never placed in a minute (the ring's lane read "No reading"), and a phone counter span
 * sharing its time made the ring's whole walk one coarse unit that the phone could take.
 *
 * Applied to each lineage's disjoint track (after same-lineage copies are set aside, so which records count is decided on
 * the times as they came): each `minute` record of at most 60 s that straddles a minute is moved into the wall-clock
 * minute holding most of it (its midpoint's), by less than its own length and keeping its length, unless the move makes
 * it meet another record of the list it did not meet as it came (then it stays as it came). Ids do not change. Pure: the
 * input is not modified; the result is sorted by start.
 */
export function alignMinuteDetail<T extends { startMs: number; endMs: number; support: StepSupport }>(records: readonly T[]): T[] {
  const out = records.map((r) => ({ ...r }));
  const moved = new Set<number>();
  out.forEach((r, i) => {
    const d = r.endMs - r.startMs;
    if (r.support !== 'minute' || d <= 0 || d > MIN || Math.floor(r.startMs / MIN) === Math.floor((r.endMs - 1) / MIN)) return;
    const m = Math.floor((r.startMs + d / 2) / MIN) * MIN;
    const s = r.startMs < m ? m : m + MIN - d;
    out[i] = { ...r, startMs: s, endMs: s + d };
    moved.add(i);
  });
  const byStart = (a: number, b: number) => out[a]!.startMs - out[b]!.startMs || out[a]!.endMs - out[b]!.endMs;
  if (!moved.size) return out;
  const meet = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) => a.startMs < b.endMs && b.startMs < a.endMs;
  // undoing only ever restores a record as it came, so this ends
  for (let changed = true; changed;) {
    changed = false;
    const order = out.map((_, i) => i).sort(byStart);
    for (let x = 0; x < order.length; x++) {
      const i = order[x]!;
      for (let y = x + 1; y < order.length && out[order[y]!]!.startMs < out[i]!.endMs; y++) {
        const j = order[y]!;
        if (!(moved.has(i) || moved.has(j)) || meet(records[i]!, records[j]!)) continue;
        for (const k of [i, j]) {
          if (!moved.has(k)) continue;
          out[k] = { ...records[k]! };
          moved.delete(k);
        }
        changed = true;
      }
    }
  }
  return out.map((_, i) => i).sort(byStart).map((i) => out[i]!);
}

/** The steps of `xs` over `[s, e)`: a record partly inside counts in proportion to its time inside. */
function stepsOver(xs: ReadonlyArray<{ startMs: number; endMs: number; steps: number }>, s: number, e: number): number {
  let n = 0;
  for (let i = firstEndAfter(xs, s); i < xs.length && xs[i]!.startMs < e; i++) {
    const x = xs[i]!;
    const d = x.endMs - x.startMs;
    n += d > 0 ? (x.steps * (Math.min(e, x.endMs) - Math.max(s, x.startMs))) / d : 0;
  }
  return n;
}

/**
 * (r068 walk) The phone's walking bouts (`PhoneBout`), from the phone's and the ring's tracks (valid records only; the
 * phone's observed zeros are not steps). A minute record counts in its minute; a coarse phone record is spread over its
 * minutes in proportion to time, only to find the active minutes (nothing is placed by it).
 *
 * The owner's evening walk (2026-10-28): the phone's counter read 92–99 steps a minute for 40 minutes, the ring counted 0
 * in many of them and gave no record for ten (its 10-minute record never came): phone ≈ 3,800, ring ≈ 1,050, the ring's
 * records over 75 % of the bout. Minute by minute the preference took every ring minute, its zeros included, and the
 * phone filled only the ten-minute hole. Over the whole bout the phone is the better account, so the bout takes it.
 */
export function phoneBouts(phone: readonly TrackRecord[], ring: readonly TrackRecord[]): PhoneBout[] {
  const counts = new Map<number, number>();
  const add = (m: number, n: number) => counts.set(m, (counts.get(m) ?? 0) + n);
  const ph = phone.filter((r) => r.valid && !r.synthetic && r.steps > 0);
  for (const r of ph) {
    if (isMinute(r)) {
      add(Math.floor(r.startMs / MIN) * MIN, r.steps);
      continue;
    }
    // a coarse record at under half the active cadence is a quiet stretch (a counter span across an idle hour): skipped
    const d = r.endMs - r.startMs;
    if ((r.steps * MIN) / d < BOUT_ACTIVE / 2) continue;
    for (let m = Math.floor(r.startMs / MIN) * MIN; m < r.endMs; m += MIN) add(m, (r.steps * (Math.min(r.endMs, m + MIN) - Math.max(r.startMs, m))) / d);
  }
  const active = [...counts.entries()].filter(([, n]) => n >= BOUT_ACTIVE).map(([m]) => m).sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const m of active) {
    const last = runs.at(-1);
    if (last && m - last[1] <= BOUT_GAP * MIN) last[1] = m + MIN;
    else runs.push([m, m + MIN]);
  }
  const ringValid = ring.filter((r) => r.valid && !r.synthetic);
  // A coarse count only says how many arrived over its span. It does not establish a gait or a wrist stall in any
  // particular minute. Only actual minute-supported observations can support the full-coverage override.
  const minuteCounts = (xs: readonly TrackRecord[]) => {
    const out = new Map<number, number>();
    for (const r of xs) if (isMinute(r)) {
      const m = Math.floor(r.startMs / MIN) * MIN;
      out.set(m, (out.get(m) ?? 0) + r.steps);
    }
    return out;
  };
  const phoneMinutes = minuteCounts(ph.filter((r) => r.source === 'phone:counter'));
  const ringMinutes = minuteCounts(ringValid);
  return runs.filter(([s, e]) => e - s >= BOUT_MIN * MIN).map(([s, e]) => {
    const phoneSteps = stepsOver(ph, s, e);
    const ringSteps = stepsOver(ringValid, s, e);
    const ringCoverage = coveredMs(ringValid, s, e) / (e - s);
    const countContrast = phoneSteps >= BOUT_RATIO * ringSteps && phoneSteps - ringSteps >= BOUT_MARGIN;
    const n = (e - s) / MIN;
    let both = 0;
    let active = 0;
    let lowRing = 0;
    for (let m = s; m < e; m += MIN) {
      const p = phoneMinutes.get(m);
      const r = ringMinutes.get(m);
      if (p !== undefined && r !== undefined) both++;
      if (p !== undefined && p >= GAIT_CADENCE) {
        active++;
        if (r !== undefined && r <= STALL_RING_SHARE * p) lowRing++;
      }
    }
    const wristStall = countContrast && n >= STALL_MIN && ringCoverage >= ADEQUATE_COVERAGE &&
      both >= Math.ceil(n * ADEQUATE_COVERAGE) && active >= Math.ceil(n * STALL_ACTIVE_SHARE) &&
      lowRing >= Math.ceil(active * STALL_LOW_SHARE);
    const prefersPhone = countContrast && (ringCoverage < ADEQUATE_COVERAGE || wristStall);
    return { startMs: s, endMs: e, phone: Math.round(phoneSteps), ring: Math.round(ringSteps), ringCoverage: Math.round(ringCoverage * 1000) / 1000, ...(wristStall ? { wristStall: true as const } : {}), prefersPhone };
  });
}

function validity(r: StepRecord): { valid: boolean; invalid?: 'cadence' | 'stale' } {
  if (r.stale) return { valid: false, invalid: 'stale' };
  const minutes = isMinute(r) ? 1 : Math.max(1, (r.endMs - r.startMs) / MIN);
  if (r.steps / minutes > MAX_CADENCE) return { valid: false, invalid: 'cadence' };
  return { valid: true };
}

export function fuseSteps(records: readonly StepRecord[], ctx: FusionContext = {}): FusionResult {
  const pref = ctx.preference ?? DEFAULT_PREFERENCE;

  // 1. dedupe: the latest revision of each upstream record; a tombstone retracts it
  const latest = new Map<string, StepRecord>();
  for (const r of records) {
    const k = r.upstreamId ?? r.id;
    const cur = latest.get(k);
    if (!cur || (r.rev ?? 0) > (cur.rev ?? 0) || ((r.rev ?? 0) === (cur.rev ?? 0) && (r.deleted ? 1 : 0) > (cur.deleted ? 1 : 0)) ||
      ((r.rev ?? 0) === (cur.rev ?? 0) && Boolean(r.deleted) === Boolean(cur.deleted) && r.id > cur.id)) latest.set(k, r);
  }
  const live = [...latest.values()].filter((r) => !r.deleted && r.endMs > r.startMs && Number.isFinite(r.steps) && r.steps >= 0);

  // 2. one disjoint track per lineage
  const byLineage = new Map<StepLineage, StepRecord[]>();
  for (const r of live) {
    const list = byLineage.get(r.lineage);
    if (list) list.push(r);
    else byLineage.set(r.lineage, [r]);
  }
  const tracks = new Map<StepLineage, TrackRecord[]>();
  const copies: TrackRecord[] = [];
  for (const [lineage, list] of [...byLineage.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    // (r063 A8) validity before representation: a valid alternative wins over an invalid primary it overlaps
    const checked = list.map((r): TrackRecord => ({ ...r, ...validity(r) }));
    checked.sort((a, b) => (a.valid ? 0 : 1) - (b.valid ? 0 : 1) || (a.sourceRank ?? 0) - (b.sourceRank ?? 0) || cmpStr(a.source, b.source) ||
      SUPPORT_RANK[a.support] - SUPPORT_RANK[b.support] || a.startMs - b.startMs || a.endMs - b.endMs || cmpStr(a.id, b.id));
    const track: TrackRecord[] = [];
    for (const r of checked) {
      if (overlapsAny(track, r.startMs, r.endMs)) {
        copies.push(r);
        continue;
      }
      const at = firstEndAfter(track, r.startMs);
      track.splice(at, 0, r);
    }
    // (r068 B1) the kept minute detail on the wall-clock minute
    tracks.set(lineage, alignMinuteDetail(track));
  }

  // observed zeros: whole minutes of a window without a record of that lineage (never inside a bout whose carry says the
  // phone was not with the gait: a hand or desk carry, `locomotorRing`)
  const unobserved = ctx.activities?.filter((a) => a.kind === 'locomotorRing') ?? [];
  for (const w of [...(ctx.zeroWindows ?? [])].sort((a, b) => a.startMs - b.startMs || cmpStr(a.lineage, b.lineage))) {
    let track = tracks.get(w.lineage);
    if (!track) tracks.set(w.lineage, (track = []));
    for (let m = Math.ceil(w.startMs / MIN) * MIN; m + MIN <= w.endMs; m += MIN) {
      if (overlapsAny(track, m, m + MIN)) continue;
      if (w.lineage === 'phone' && unobserved.some((a) => a.startMs < m + MIN && m < a.endMs)) continue;
      track.splice(firstEndAfter(track, m), 0, { id: `zero:${w.lineage}:${m}`, lineage: w.lineage, source: w.source, startMs: m, endMs: m + MIN, steps: 0, support: 'minute', valid: true, synthetic: true });
    }
  }

  // A coarse record of a lineage the unit could never select (hc-other or unknown: no context rule picks them) that
  // valid records of preferred lineages cover (at least ADEQUATE_COVERAGE of its time, r063 A3) is eclipsed: it stays in
  // its track and is reported as an alternative, but it does not join the component, so it can never turn the phone's
  // or the ring's minutes into one coarse unit (the treadmill walk, phone steps in ring gaps). Covered like that it could
  // not have won the unit, so no located step is lost. One that is not covered keeps its whole evidence: it joins the
  // component, where a partial witness cannot beat it (rule 5's coverage).
  const eclipsed = new Set<TrackRecord>();
  for (const [lineage, track] of tracks) {
    if (lineage === 'ring' || lineage === 'phone') continue;
    const rank = lineageRank(pref, lineage);
    for (const r of track) {
      if (isMinute(r) || ctx.corrections?.some((c) => c.use === lineage && c.startMs < r.endMs && r.startMs < c.endMs)) continue;
      const cover: TrackRecord[] = [];
      for (const [l2, t2] of tracks) {
        if (l2 === lineage || lineageRank(pref, l2) >= rank) continue;
        for (let i = firstEndAfter(t2, r.startMs); i < t2.length && t2[i]!.startMs < r.endMs; i++) if (t2[i]!.valid) cover.push(t2[i]!);
      }
      if (cover.length && coveredMs(cover, r.startMs, r.endMs) >= ADEQUATE_COVERAGE * (r.endMs - r.startMs)) eclipsed.add(r);
    }
  }

  // 4. components across lineages
  const all = [...tracks.values()].flat().filter((r) => !eclipsed.has(r)).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || cmpStr(a.lineage, b.lineage) || cmpStr(a.id, b.id));
  const components: TrackRecord[][] = [];
  let cur: TrackRecord[] = [];
  let curEnd = -Infinity;
  for (const r of all) {
    if (cur.length && r.startMs >= curEnd) {
      components.push(cur);
      cur = [];
      curEnd = -Infinity;
    }
    cur.push(r);
    curEnd = Math.max(curEnd, r.endMs);
  }
  if (cur.length) components.push(cur);

  // minute grid of the minute-only components; coarse components are one unit each
  const minutes = new Map<number, Map<StepLineage, Obs>>();
  const coarse: TrackRecord[][] = [];
  for (const c of components) {
    if (!c.every(isMinute)) {
      coarse.push(c);
      continue;
    }
    for (const r of c) {
      const m = Math.floor(r.startMs / MIN) * MIN;
      let row = minutes.get(m);
      if (!row) minutes.set(m, (row = new Map()));
      const o = row.get(r.lineage);
      if (o) {
        o.steps += r.steps;
        if (!r.valid) Object.assign(o, { valid: false, invalid: r.invalid });
      } else row.set(r.lineage, { lineage: r.lineage, steps: r.steps, valid: r.valid, ...(r.invalid ? { invalid: r.invalid } : {}), source: r.source, support: 'minute' });
    }
  }

  // (c) sole sustained gait: runs of ≥ 3 consecutive gait minutes of one lineage, outside non-locomotor activity. The
  // other lineage observed at ≤ 10 % is the hands-fixed witness; a third lineage (hc-other or unknown) that agrees with
  // the walker (a copy of the same pedometer) supports it rather than blocking the rule. Among walkers, the preference.
  const nonLoco = ctx.activities?.filter((a) => a.kind === 'nonLocomotor');
  const soleGait = ctx.soleSustainedGait ?? true;
  const correlated = (x: Obs) => x.lineage !== 'ring' && x.lineage !== 'phone';
  const gaitOf = (m: number): StepLineage | null => {
    const row = minutes.get(m);
    if (!soleGait || !row || row.size < 2 || within(nonLoco, m + MIN / 2)) return null;
    const obs = [...row.values()];
    const walkers = obs.filter((o) => {
      if (!o.valid || o.steps < GAIT_CADENCE) return false;
      const low = (x: Obs) => x.valid && x.steps <= GAIT_OTHER_SHARE * o.steps;
      const others = obs.filter((x) => x !== o);
      return others.some(low) && others.every((x) => low(x) || (x.valid && correlated(x) && !disagree(o.steps, x.steps)));
    });
    walkers.sort((a, b) => lineageRank(pref, a.lineage) - lineageRank(pref, b.lineage) || cmpStr(a.lineage, b.lineage));
    return walkers[0]?.lineage ?? null;
  };
  const sortedMinutes = [...minutes.keys()].sort((a, b) => a - b);
  const gait = new Map<number, StepLineage>();
  for (let i = 0; i < sortedMinutes.length;) {
    const m0 = sortedMinutes[i]!;
    const l = gaitOf(m0);
    let j = i + 1;
    if (l) while (j < sortedMinutes.length && sortedMinutes[j] === m0 + (j - i) * MIN && gaitOf(sortedMinutes[j]!) === l) j++;
    if (l && j - i >= GAIT_MIN_RUN) for (let k = i; k < j; k++) gait.set(sortedMinutes[k]!, l);
    i = j;
  }

  // (r068 walk) the phone's walking bouts, while the preference puts the ring first (otherwise it already takes the phone)
  const bouts = lineageRank(pref, 'ring') < lineageRank(pref, 'phone') ? phoneBouts(tracks.get('phone') ?? [], tracks.get('ring') ?? []) : [];
  const phoneFirst = bouts.filter((b) => b.prefersPhone && (soleGait || !b.wristStall));
  const stalledWrist = phoneFirst.filter((b) => b.wristStall);

  // 5. selection
  const select = (obs: Obs[], mid: number, gaitLineage: StepLineage | null): Omit<FusedInterval, 'startMs' | 'endMs' | 'unit'> => {
    const allValid = obs.filter((o) => o.valid);
    const alts = (chosen: Obs | null) => obs.filter((o) => o !== chosen).map((o): Alternative => ({ source: o.source, lineage: o.lineage, steps: o.steps, support: o.support, ...(o.invalid ? { invalid: o.invalid } : {}), ...(o.partial ? { partial: true as const } : {}) }));
    if (!allValid.length) return { steps: null, source: null, lineage: null, support: null, selectionReason: 'noValidSource', alternatives: alts(null) };
    // (r063 A3) in a coarse unit, a lineage covering only part of it never stands for all of it while another covers it,
    // (r068 B1) unless the partial witness alone counted at least as many steps as every whole witness did over the whole
    // unit: such a whole witness missed steps the partial one saw (the phone's 8-step counter span across the ring's
    // 4,000-step walk), so it is no better an account of the unit, and the preference decides between them
    const whole = allValid.filter((o) => !o.partial);
    const wholeMost = Math.max(0, ...whole.map((o) => o.steps));
    const valid = whole.length ? allValid.filter((o) => !o.partial || (o.steps > 0 && o.steps >= wholeMost)) : allValid;
    const pick = (o: Obs, reason: SelectionReason, extra: { disagreement?: true; nonLocomotorSuspect?: true } = {}) => {
      const d = extra.disagreement ?? (valid.some((x) => x !== o && disagree(o.steps, x.steps)) ? true : undefined);
      return { steps: o.steps, source: o.source, lineage: o.lineage, support: o.support, selectionReason: reason, alternatives: alts(o), ...(d ? { disagreement: d } : {}), ...(extra.nonLocomotorSuspect ? { nonLocomotorSuspect: true as const } : {}) };
    };
    const find = (l: string) => valid.find((o) => o.lineage === l);
    // (a) the person's own correction stands for the unit even where its lineage covered only part of it
    const corr = within(ctx.corrections, mid) as { use: StepLineage } | undefined;
    const corrected = corr ? allValid.find((o) => o.lineage === corr.use) : undefined;
    if (corrected) return pick(corrected, 'userCorrection');
    const act = within(ctx.activities, mid) as { kind: ActivityKind } | undefined;
    if (act?.kind === 'locomotorRing' && find('ring')) return pick(find('ring')!, 'activityContext');
    const ph = find('phone');
    const rg = find('ring');
    if (act?.kind === 'locomotorPocket' && ph) return pick(ph, 'activityContext');
    if (act?.kind === 'nonLocomotor') {
      if (ph) return pick(ph, 'activityContext');
      if (rg) return pick(rg, 'activityContext', { nonLocomotorSuspect: true });
    }
    if (act?.kind === 'treadmill' && ph && (ph.steps >= BOUT_ACTIVE || !rg || gaitLineage === 'phone'))
      return pick(ph, 'activityContext');
    if (act?.kind === 'locomotor' && ph && (gaitLineage === 'phone' || (ph.steps >= BOUT_ACTIVE && within(phoneFirst, mid)))) {
      return pick(ph, 'activityContext');
    }
    if (gaitLineage && find(gaitLineage)) return pick(find(gaitLineage)!, 'soleSustainedGait', { disagreement: true });
    if (valid.length === 1) return pick(valid[0]!, allValid.length > 1 ? 'coverage' : 'soleObserved');
    if (ph && ph.support === 'minute' && ph.steps >= BOUT_ACTIVE && within(stalledWrist, mid)) return pick(ph, 'wristStall');
    // (r068 walk) inside a bout the phone clearly out-counted the ring over, the phone (where it is a whole witness)
    if (ph && ph.steps >= BOUT_ACTIVE && within(phoneFirst, mid)) return pick(ph, 'boutCount');
    const best = [...valid].sort((a, b) => lineageRank(pref, a.lineage) - lineageRank(pref, b.lineage) || cmpStr(a.lineage, b.lineage))[0]!;
    return pick(best, 'preference');
  };

  const units: FusedInterval[] = [];
  const minuteSelected = new Map<number, { steps: number; lineage: StepLineage; source: string }>();
  for (const m of sortedMinutes) {
    const obs = [...minutes.get(m)!.values()].sort((a, b) => cmpStr(a.lineage, b.lineage));
    const u: FusedInterval = { startMs: m, endMs: m + MIN, unit: 'minute', ...select(obs, m + MIN / 2, gait.get(m) ?? null) };
    if (u.steps !== null) minuteSelected.set(m, { steps: u.steps, lineage: u.lineage!, source: u.source! });
    units.push(u);
  }
  for (const c of coarse) {
    const byL = new Map<StepLineage, Obs & { most: number }>();
    for (const r of c) {
      const o = byL.get(r.lineage);
      if (!o) {
        byL.set(r.lineage, { lineage: r.lineage, steps: r.steps, valid: r.valid, ...(r.invalid ? { invalid: r.invalid } : {}), source: r.source, support: isMinute(r) ? 'minute' : r.support, most: r.steps });
        continue;
      }
      o.steps += r.steps;
      if (!r.valid) Object.assign(o, { valid: false, invalid: r.invalid });
      const sup = isMinute(r) ? 'minute' : r.support;
      if (SUPPORT_RANK[sup] > SUPPORT_RANK[o.support]) o.support = sup;
      if (r.steps > o.most) Object.assign(o, { most: r.steps, source: r.source });
    }
    const startMs = Math.min(...c.map((r) => r.startMs));
    const endMs = Math.max(...c.map((r) => r.endMs));
    const need = ADEQUATE_COVERAGE * (endMs - startMs);
    const obs = [...byL.values()].map(({ most: _m, ...o }): Obs => {
      const partial = coveredMs(c.filter((r) => r.lineage === o.lineage), startMs, endMs) < need;
      return partial ? { ...o, partial: true } : o;
    }).sort((a, b) => cmpStr(a.lineage, b.lineage));
    const u: FusedInterval = { startMs, endMs, unit: 'component', ...select(obs, startMs + (endMs - startMs) / 2, null) };
    if (u.steps !== null) {
      const chosen = c.filter((r) => r.lineage === u.lineage);
      u.parts = chosen.map((r) => ({ atMs: r.endMs - 1, steps: r.steps }));
      // (r068 B1) the unit is one choice, but when every record of the chosen lineage is a minute record its steps are
      // each already in one minute: they are placed there (nothing coarse is split), so the minute timeline and the
      // located total agree (the ring's minutes inside a phone counter span's component)
      if (chosen.every(isMinute)) {
        u.placed = true;
        for (const r of chosen) {
          const m = Math.floor(r.startMs / MIN) * MIN;
          const cur = minuteSelected.get(m);
          if (cur) cur.steps += r.steps;
          else minuteSelected.set(m, { steps: r.steps, lineage: r.lineage, source: r.source });
        }
      }
    }
    units.push(u);
  }
  units.sort((a, b) => a.startMs - b.startMs);

  // merge consecutive minute units with the same choice (never across a break)
  const breaks = [...(ctx.breaks ?? [])].sort((a, b) => a - b);
  const crossesBreak = (t: number) => {
    let lo = 0;
    let hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (breaks[mid]! < t) lo = mid + 1;
      else hi = mid;
    }
    return lo < breaks.length && breaks[lo] === t;
  };
  const sig = (u: FusedInterval) => JSON.stringify([u.lineage, u.source, u.support, u.selectionReason, u.steps === 0, u.disagreement ?? false, u.nonLocomotorSuspect ?? false, u.alternatives.map((a) => [a.lineage, a.source, a.support, a.invalid ?? null])]);
  const intervals: FusedInterval[] = [];
  let prevSig = '';
  for (const u of units) {
    const last = intervals.at(-1);
    const s = u.unit === 'minute' ? sig(u) : '';
    if (last && s && s === prevSig && last.endMs === u.startMs && !crossesBreak(u.startMs)) {
      last.endMs = u.endMs;
      if (last.steps !== null && u.steps !== null) last.steps += u.steps;
      u.alternatives.forEach((a, i) => (last.alternatives[i]!.steps += a.steps));
      continue;
    }
    intervals.push({ ...u, alternatives: u.alternatives.map((a) => ({ ...a })) });
    prevSig = s;
  }

  // same-lineage copies and eclipsed records: reported on the first unit they overlap, never counted
  for (const r of [...copies].sort((a, b) => a.startMs - b.startMs || cmpStr(a.id, b.id))) {
    const i = firstEndAfter(intervals, r.startMs);
    const u = intervals[i];
    if (u && u.startMs < r.endMs) u.alternatives.push({ source: r.source, lineage: r.lineage, steps: r.steps, support: r.support, ...(r.invalid ? { invalid: r.invalid } : {}), sameLineage: true });
  }
  for (const r of [...eclipsed].sort((a, b) => a.startMs - b.startMs || cmpStr(a.id, b.id))) {
    const i = firstEndAfter(intervals, r.startMs);
    const u = intervals[i];
    if (u && u.startMs < r.endMs) u.alternatives.push({ source: r.source, lineage: r.lineage, steps: r.steps, support: r.support, ...(r.invalid ? { invalid: r.invalid } : {}) });
  }

  return { version: FUSION_VERSION, intervals, tracks, copies, minuteSelected, bouts };
}

// --- day values (§2.3 step 6)

export interface DayInput {
  date: string;
  startMs: number;
  endMs: number;
  /** The ring's daily total: its latest authoritative revision for the date. */
  ringDailyTotal: number | null;
  /** The ring's step detail for the date is complete (GA.8 coverage). */
  ringDetailComplete: boolean;
}

export interface FusedDay {
  date: string;
  /** The authoritative fused total; null when no unit of the day was selected. */
  located: number | null;
  ringDailyTotal: number | null;
  /** `ringDailyTotal − Σ ring track steps of the day`, at least 0: unlocated, never added. */
  ringResidual: number | null;
  /** Σ of the phone lineage's track of the day (located or not). */
  phoneDailyTotal: number | null;
  headline: number | null;
  headlinePolicy: 'located' | 'atLeast';
  resolved: boolean;
  headlineLabel: string;
  coverage: { ringMin: number; phoneMin: number; eitherMin: number; unknownMin: number };
}

/** The index of the day holding `t` (days sorted and contiguous), or -1. */
function dayIndex(days: readonly DayInput[], t: number): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (days[m]!.endMs <= t) lo = m + 1;
    else hi = m;
  }
  return lo < days.length && days[lo]!.startMs <= t ? lo : -1;
}

/** Minutes of the union of `parts` (each already inside one day). */
function unionMinutes(parts: Array<readonly [number, number]>): number {
  parts.sort((p, q) => p[0] - q[0]);
  let total = 0;
  let s = -Infinity;
  let e = -Infinity;
  for (const [ps, pe] of parts) {
    if (ps > e) {
      if (e > s) total += e - s;
      s = ps;
      e = pe;
    } else e = Math.max(e, pe);
  }
  if (e > s) total += e - s;
  return Math.round(total / MIN);
}

/** Each span's parts clipped to the days it overlaps, by day index. */
function clipToDays(days: readonly DayInput[], spans: ReadonlyArray<{ startMs: number; endMs: number }>): Array<Array<readonly [number, number]>> {
  const out = days.map(() => [] as Array<readonly [number, number]>);
  for (const x of spans) {
    let k = dayIndex(days, x.startMs);
    if (k < 0 && days.length && x.startMs < days[0]!.startMs && x.endMs > days[0]!.startMs) k = 0;
    for (; k >= 0 && k < days.length && days[k]!.startMs < x.endMs; k++) {
      const a = Math.max(days[k]!.startMs, x.startMs);
      const b = Math.min(days[k]!.endMs, x.endMs);
      if (b > a) out[k]!.push([a, b]);
    }
  }
  return out;
}

/**
 * The §2.3 day values. A unit or record belongs to the day of its last instant (the counter rule `(prev, cur]`, §1.1);
 * a component unit's steps go by its selected records (`parts`), each on its own day. Coverage minutes are clipped to
 * each day.
 */
export function fusedDays(f: FusionResult, days: readonly DayInput[]): FusedDay[] {
  const ring = f.tracks.get('ring') ?? [];
  const phone = f.tracks.get('phone') ?? [];
  const all = [...f.tracks.values()].flat();
  const acc = days.map(() => ({ located: 0, units: 0, ring: 0, phone: 0, phoneN: 0 }));
  for (const u of f.intervals) {
    if (u.steps === null) continue;
    for (const p of u.parts ?? [{ atMs: u.endMs - 1, steps: u.steps }]) {
      const k = dayIndex(days, p.atMs);
      if (k < 0) continue;
      acc[k]!.located += p.steps;
      acc[k]!.units++;
    }
  }
  for (const r of ring) {
    const k = dayIndex(days, r.endMs - 1);
    if (k >= 0 && !r.synthetic) acc[k]!.ring += r.steps;
  }
  for (const r of phone) {
    const k = dayIndex(days, r.endMs - 1);
    if (k >= 0 && !r.synthetic) {
      acc[k]!.phone += r.steps;
      acc[k]!.phoneN++;
    }
  }
  const ringMin = clipToDays(days, ring).map(unionMinutes);
  const phoneMin = clipToDays(days, phone).map(unionMinutes);
  const eitherMin = clipToDays(days, all).map(unionMinutes);
  const selectedMin = clipToDays(days, f.intervals.filter((u) => u.steps !== null)).map(unionMinutes);
  return days.map((d, k) => {
    const a = acc[k]!;
    const located = a.units ? a.located : null;
    const ringResidual = d.ringDailyTotal === null ? null : Math.max(0, d.ringDailyTotal - a.ring);
    const dayMin = Math.round((d.endMs - d.startMs) / MIN);
    let headline: number | null;
    let label: string;
    if (d.ringDetailComplete) {
      headline = located ?? d.ringDailyTotal;
      label = 'Steps placed in time (the ring\'s detail for the day is complete)';
    } else if (d.ringDailyTotal !== null && d.ringDailyTotal > (located ?? 0)) {
      headline = d.ringDailyTotal;
      label = 'At least: includes ring steps not placed in time';
    } else {
      headline = located;
      label = 'At least: the ring\'s detail for the day may be incomplete';
    }
    return {
      date: d.date, located, ringDailyTotal: d.ringDailyTotal, ringResidual, phoneDailyTotal: a.phoneN ? a.phone : null,
      headline, headlinePolicy: d.ringDetailComplete ? 'located' : 'atLeast', resolved: d.ringDetailComplete, headlineLabel: label,
      coverage: { ringMin: ringMin[k]!, phoneMin: phoneMin[k]!, eitherMin: eitherMin[k]!, unknownMin: Math.max(0, dayMin - selectedMin[k]!) },
    };
  });
}

/**
 * `sessionIncludedSteps` (§2.3 step 6): the selected steps of units wholly inside `[startMs, endMs)`, by lineage. The
 * day headline never establishes session overlap.
 */
export function stepsInside(f: FusionResult, startMs: number, endMs: number): Partial<Record<StepLineage, number>> {
  const out: Partial<Record<StepLineage, number>> = {};
  for (const u of f.intervals) if (u.steps !== null && u.lineage && u.startMs >= startMs && u.endMs <= endMs) out[u.lineage] = (out[u.lineage] ?? 0) + u.steps;
  return out;
}
