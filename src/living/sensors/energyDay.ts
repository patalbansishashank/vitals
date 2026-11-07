/**
 * The day's energy as a display allocation of the engine's own ledger (`energy-day/1`, energy SPEC §V2.6, notes C04,
 * Addendum A.1.2 #29-30, DECISION D15). NOT a second calorie model: every hourly component total comes from the realised
 * projection run and is fixed; only its placement inside the hour is a disclosed display model (`allocation: 'modelled'`).
 *
 * Inputs per hour (kcal in that hour, the engine's hourly series): `rmr`, `tef`, `neat`, `stepsEnergy`, `exerciseEnergy`
 * and `tdee`; `other = tdee − rmr − tef − neat − exerciseEnergy` (adaptation and the remaining TEE terms). `stepsEnergy` is
 * already inside `neat` (V1), so `neatBase = neat − stepsEnergy` (may be negative in an hour of step deficit).
 *
 * Hour → minutes:
 *  - `rmr` uniform over the hour (sleep multiplier 1.00: no stage-based energy, RESEARCH E3);
 *  - `neatBase` uniform over the hour's awake minutes, else uniform;
 *  - `stepsEnergy` (signed) in proportion to the minute's selected steps, else uniform over awake minutes, else uniform;
 *  - `exerciseEnergy` first to minutes inside the run's bouts (by bout share, up to each bout's own incremental kcal/min when
 *    given); the remainder is the recovery tail, shown as `recovery` in post-bout minutes. (r063 A16) The bouts are every
 *    session the run books: each effective session entry (approved activities and ordinary logs) and, today, the plan's
 *    sessions still ahead (`source: 'planned'`); without them a bout hour's direct energy read as recovery. A paused bout
 *    counts only its moving `parts`;
 *  - `tef` and `other` uniform, shown as their own components.
 * Conservation: Σ minutes = the engine's `tdee` for every hour (exact by construction; checked ≤ 0.1 %).
 *
 * Time states (mutually exclusive; each includes its resting energy): `exercise` (an approved bout), `sleep` (known
 * asleep), `active` (minute-supported cadence ≥ 100), `light` (cadence 1-99, or an observed count without minute support),
 * `resting` (awake with observed 0 steps), `unknown` (no coverage, or an unknown sleep label). States and components are two
 * views of ONE total and are never added together.
 *
 * "Active" (D15) = movement above own rest = Σ(neatBase + stepsEnergy + exerciseEnergy − recovery); TEF, recovery and other
 * are shown separately. The ring's `calories_kcal` is a labelled comparison ("Ring energy estimate"), never booked.
 *
 * Warrants: first-principles A (conservation: one ledger, two groupings), analytically true A (the state partition); the
 * within-hour placement is a display model (W8, C) and is labelled so; the totals inherit the engine's own grades. The
 * envelope is a scenario (SPEC §1.5): RMR ±15 % only where the engine supplies no draws, plus bout envelopes added
 * linearly (correlated person bias; never root-sum-square).
 */
import { SENSOR_VERSIONS, isFiniteNum, overlapMs, sp, type Envelope, type Interval, type Ms, type UncertaintyKind } from './types';

export interface EnergyHour {
  /** UTC start of the hour. Hours are contiguous; a DST day has 23 or 25 of them. */
  start: Ms;
  rmr: number;
  tef: number;
  neat: number;
  stepsEnergy: number;
  exerciseEnergy: number;
  tdee: number;
}

/** One minute of the fused timeline (S2 `timeline`), aligned to the hours (minute h·60 + k starts at hour h + k min). */
export interface EnergyMinute {
  /** `asleep` known asleep; `awake` a known awake label; `unknownLabel` an unknown sleep label; `none` outside any sleep record. */
  sleep: 'asleep' | 'awake' | 'unknownLabel' | 'none';
  /** Selected steps of the minute; null = no coverage. */
  steps: number | null;
  /** `minute` when the count is minute-supported; `coarse` when it is a share of a coarse record. */
  support: 'minute' | 'coarse' | null;
}

export interface EnergyBout {
  id: string;
  window: Interval;
  /**
   * (r063 S10/A15) The bout's moving intervals when it was paused (one bout identity, one recovery booking): exercise
   * energy goes only to their minutes, a pause is not exercise. Absent = the whole window moved.
   */
  parts?: readonly Interval[];
  /** (r063 A16) `planned` = a plan session still ahead today (the run books it); absent = an approved or logged actual. */
  source?: 'actual' | 'planned';
  /** The booked bout's incremental kcal/min (activityEnergy cost I ÷ minutes); caps the bout's share of exerciseEnergy. */
  incrementalKcalPerMin?: number | null;
  /** The bout's gross envelope (activityEnergy), added linearly to the day's. */
  envelope?: Envelope | null;
}

export type EnergyState = 'exercise' | 'sleep' | 'active' | 'light' | 'resting' | 'unknown';
export type EnergyComponent = 'rmr' | 'neatBase' | 'stepsEnergy' | 'exercise' | 'recovery' | 'tef' | 'other';

export const ENERGY_STATES: readonly EnergyState[] = ['exercise', 'sleep', 'active', 'light', 'resting', 'unknown'];
export const ENERGY_COMPONENTS: readonly EnergyComponent[] = ['rmr', 'neatBase', 'stepsEnergy', 'exercise', 'recovery', 'tef', 'other'];

export interface EnergyBin {
  start: Ms;
  kcal: number;
  components: Record<EnergyComponent, number>;
  stateMin: Record<EnergyState, number>;
  /**
   * (UI audit #4) The bin's allocated kcal by the state of the minute it was allocated to, food digestion left out (TEF is
   * its own band): the allocation itself (exercise energy on the bout's minutes), never re-split by state minutes.
   */
  stateBodyKcal: Record<EnergyState, number>;
}

export interface EnergyDay {
  version: typeof SENSOR_VERSIONS.energyDay;
  allocation: 'modelled';
  label: 'estimated';
  /** Σ of the hours' `tdee`. */
  total: number;
  /** D15: movement above own rest. */
  active: number;
  rest: number;
  tef: number;
  recovery: number;
  other: number;
  /** The component sums (they add to `total`). */
  components: Record<EnergyComponent, number>;
  byState: Record<EnergyState, { minutes: number; kcal: number }>;
  bins15: EnergyBin[];
  /** One state per minute (same order as the input minutes). */
  minuteStates: EnergyState[];
  envelope: Envelope;
  uncertaintyKind: UncertaintyKind;
  coverage: { knownMin: number; unknownMin: number; pct: number };
  /** Largest |Σ minutes − tdee| ÷ tdee of any hour, % (the conservation check). */
  maxHourMismatchPct: number;
  ringComparison: { label: 'Ring energy estimate'; kcal: number; booked: false } | null;
  versions: { energyDay: string };
  status: 'inferred';
}

const zero = <K extends string>(keys: readonly K[]): Record<K, number> => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

function stateOf(m: EnergyMinute | undefined, inBout: boolean): EnergyState {
  if (inBout) return 'exercise';
  if (!m) return 'unknown';
  if (m.sleep === 'asleep') return 'sleep';
  if (m.sleep === 'unknownLabel') return 'unknown';
  if (!isFiniteNum(m.steps)) return 'unknown';
  if (m.support === 'minute' && m.steps >= sp('activeCadence')) return 'active';
  if (m.steps >= 1) return 'light';
  return 'resting';
}

/** Spread `amount` over the minutes with weight w (Σw > 0), else uniformly over `fallback` indices, else over all 60. */
function spread(out: Float64Array, amount: number, w: readonly number[] | null, fallback: readonly number[]): void {
  if (amount === 0) return;
  if (w) {
    let sw = 0;
    for (const x of w) sw += x;
    if (sw > 0) {
      for (let k = 0; k < 60; k++) out[k]! += (amount * w[k]!) / sw;
      return;
    }
  }
  const idx = fallback.length > 0 ? fallback : Array.from({ length: 60 }, (_, k) => k);
  for (const k of idx) out[k]! += amount / idx.length;
}

export interface EnergyDayInput {
  hours: readonly EnergyHour[];
  /** hours.length × 60 minutes (missing entries are unknown). */
  minutes: readonly EnergyMinute[];
  /** Approved bouts only (pending candidates never enter the ledger). */
  bouts: readonly EnergyBout[];
  /** RMR scenario half-width (default ±15 %); pass 0 when the engine's own draws supply the band. */
  rmrEnvelopeFrac?: number;
  /** The ring's daily `calories_kcal` (vendor), a comparison. */
  ringKcal?: number | null;
}

/** The day's energy display (SPEC V2.6). */
export function energyDay(i: EnergyDayInput): EnergyDay {
  const comps = zero(ENERGY_COMPONENTS);
  const byState = Object.fromEntries(ENERGY_STATES.map((s) => [s, { minutes: 0, kcal: 0 }])) as EnergyDay['byState'];
  const bins: EnergyBin[] = [];
  const minuteStates: EnergyState[] = [];
  let total = 0;
  let maxMis = 0;
  const partsOf = (b: EnergyBout): readonly Interval[] => (b.parts && b.parts.length > 0 ? b.parts : [b.window]);
  const lastBoutEnd = (t: Ms) => i.bouts.some((b) => partsOf(b).some((p) => p.end <= t));
  for (let h = 0; h < i.hours.length; h++) {
    const H = i.hours[h]!;
    const other = H.tdee - H.rmr - H.tef - H.neat - H.exerciseEnergy;
    const neatBase = H.neat - H.stepsEnergy;
    const alloc: Record<EnergyComponent, Float64Array> = Object.fromEntries(ENERGY_COMPONENTS.map((c) => [c, new Float64Array(60)])) as Record<EnergyComponent, Float64Array>;
    const awake: number[] = [];
    const nonBout: number[] = [];
    const postBout: number[] = [];
    const stepW: number[] = new Array(60).fill(0);
    const boutW: number[] = new Array(60).fill(0);
    let capacity = 0;
    let capped = true;
    const states: EnergyState[] = [];
    for (let k = 0; k < 60; k++) {
      const t0 = H.start + k * 60_000;
      const m = i.minutes[h * 60 + k];
      let boutMs = 0;
      for (const b of i.bouts) {
        let ov = 0;
        for (const p of partsOf(b)) ov += overlapMs(t0, t0 + 60_000, p.start, p.end);
        if (ov <= 0) continue;
        boutMs += ov;
        const rate = b.incrementalKcalPerMin;
        if (isFiniteNum(rate) && rate > 0) {
          boutW[k]! += (ov / 60_000) * rate;
          capacity += (ov / 60_000) * rate;
        } else {
          boutW[k]! += ov / 60_000;
          capped = false;
        }
      }
      const inBout = boutMs >= 30_000;
      const st = stateOf(m, inBout);
      states.push(st);
      if (m?.sleep !== 'asleep') awake.push(k);
      if (boutMs === 0) {
        nonBout.push(k);
        if (lastBoutEnd(t0)) postBout.push(k);
      }
      if (m && isFiniteNum(m.steps) && m.steps > 0) stepW[k] = m.steps;
    }
    spread(alloc.rmr, H.rmr, null, []);
    spread(alloc.neatBase, neatBase, null, awake);
    spread(alloc.stepsEnergy, H.stepsEnergy, stepW, awake);
    // exercise energy: bout minutes first (by bout share, capped at the bouts' own incremental rate), the rest is recovery
    const E = H.exerciseEnergy;
    const hasBout = boutW.some((x) => x > 0);
    let toBout = 0;
    if (hasBout) toBout = capped && E > capacity ? capacity : E;
    const rec = E - toBout;
    if (toBout !== 0) spread(alloc.exercise, toBout, boutW, []);
    if (rec !== 0) spread(alloc.recovery, rec, null, postBout.length > 0 ? postBout : nonBout);
    spread(alloc.tef, H.tef, null, []);
    spread(alloc.other, other, null, []);
    let hourSum = 0;
    for (let k = 0; k < 60; k++) {
      let kcal = 0;
      for (const c of ENERGY_COMPONENTS) kcal += alloc[c][k]!;
      hourSum += kcal;
      const st = states[k]!;
      byState[st].minutes += 1;
      byState[st].kcal += kcal;
      minuteStates.push(st);
      const binIdx = Math.floor((h * 60 + k) / 15);
      let bin = bins[binIdx];
      if (!bin) {
        bin = { start: H.start + (k - (k % 15)) * 60_000, kcal: 0, components: zero(ENERGY_COMPONENTS), stateMin: zero(ENERGY_STATES), stateBodyKcal: zero(ENERGY_STATES) };
        bins[binIdx] = bin;
      }
      bin.kcal += kcal;
      bin.stateMin[st] += 1;
      bin.stateBodyKcal[st] += kcal - alloc.tef[k]!;
      for (const c of ENERGY_COMPONENTS) bin.components[c] += alloc[c][k]!;
    }
    for (const c of ENERGY_COMPONENTS) for (let k = 0; k < 60; k++) comps[c] += alloc[c][k]!;
    total += H.tdee;
    if (H.tdee !== 0) maxMis = Math.max(maxMis, (100 * Math.abs(hourSum - H.tdee)) / Math.abs(H.tdee));
  }
  const day: Interval = i.hours.length > 0 ? { start: i.hours[0]!.start, end: i.hours[i.hours.length - 1]!.start + 3_600_000 } : { start: 0, end: 0 };
  let boutHalf = 0;
  for (const b of i.bouts) {
    if (!b.envelope) continue;
    const ps = partsOf(b);
    const len = ps.reduce((a, p) => a + Math.max(0, p.end - p.start), 0);
    const share = len > 0 ? ps.reduce((a, p) => a + overlapMs(p.start, p.end, day.start, day.end), 0) / len : 0;
    boutHalf += (share * (b.envelope.hi - b.envelope.lo)) / 2;
  }
  const half = (i.rmrEnvelopeFrac ?? sp('envRmr')) * comps.rmr + boutHalf;
  const unknownMin = byState.unknown.minutes;
  const allMin = i.hours.length * 60;
  return {
    version: SENSOR_VERSIONS.energyDay,
    allocation: 'modelled',
    label: 'estimated',
    total,
    active: comps.neatBase + comps.stepsEnergy + comps.exercise,
    rest: comps.rmr,
    tef: comps.tef,
    recovery: comps.recovery,
    other: comps.other,
    components: comps,
    byState,
    bins15: bins,
    minuteStates,
    envelope: { lo: total - half, hi: total + half },
    uncertaintyKind: 'scenario',
    coverage: { knownMin: allMin - unknownMin, unknownMin, pct: allMin > 0 ? (100 * (allMin - unknownMin)) / allMin : 0 },
    maxHourMismatchPct: maxMis,
    ringComparison: isFiniteNum(i.ringKcal) ? { label: 'Ring energy estimate', kcal: i.ringKcal, booked: false } : null,
    versions: { energyDay: SENSOR_VERSIONS.energyDay },
    status: 'inferred',
  };
}

/**
 * Hours of an engine run for one local day, from its hourly series (kcal in each hour; `simulate(..., { record: 'full' })`
 * `hourly.{rmr, tef, neat, stepsEnergy, exerciseEnergy, tdee}`). `firstHour` indexes the run; `dayStart` is the UTC start.
 */
export function hoursFromRun(
  hourly: Readonly<Record<'rmr' | 'tef' | 'neat' | 'stepsEnergy' | 'exerciseEnergy' | 'tdee', ArrayLike<number> | undefined>>,
  firstHour: number,
  count: number,
  dayStart: Ms,
): EnergyHour[] {
  const at = (a: ArrayLike<number> | undefined, k: number) => (a && isFiniteNum(a[k]) ? a[k] : 0);
  return Array.from({ length: count }, (_, j) => {
    const k = firstHour + j;
    return { start: dayStart + j * 3_600_000, rmr: at(hourly.rmr, k), tef: at(hourly.tef, k), neat: at(hourly.neat, k), stepsEnergy: at(hourly.stepsEnergy, k), exerciseEnergy: at(hourly.exerciseEnergy, k), tdee: at(hourly.tdee, k) };
  });
}

export interface EnergyToday {
  version: typeof SENSOR_VERSIONS.energyDay;
  /** Σ of the realised today run's hours before now, the current hour pro-rated. */
  soFar: number;
  /** The run's day total (actual through now + plan remainder + named priors): never zero for future hours. */
  byBedtime: number;
  /** The head schedule's today TEE. */
  plan: number | null;
  /** The plan's day active energy (energyDay on the head schedule): the active-energy goal of A.1.4. */
  planActive: number | null;
  status: 'inferred';
}

/** Today's figures from the single authority: the engine's realised today run (SPEC V2.6 "Today"). */
export function energyToday(i: { run: readonly EnergyHour[]; now: Ms; planDay?: Pick<EnergyDay, 'total' | 'active'> | null }): EnergyToday {
  let soFar = 0;
  let byBedtime = 0;
  for (const h of i.run) {
    byBedtime += h.tdee;
    const f = Math.min(1, Math.max(0, (i.now - h.start) / 3_600_000));
    soFar += h.tdee * f;
  }
  return { version: SENSOR_VERSIONS.energyDay, soFar, byBedtime, plan: i.planDay ? i.planDay.total : null, planActive: i.planDay ? i.planDay.active : null, status: 'inferred' };
}
