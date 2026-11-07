/**
 * Ensemble bands (MODEL_SPEC §8, D8-02/C6): the one reducer behind `simulateEnsemble` and the Simulator's streaming bands,
 * so both public paths give identical numbers and metadata for the same members.
 *
 * - Quantiles come from the stochastic members only. The nominal run is reported separately and never mixed in (it is not
 *   an independent draw); zero contributing members export no band (`method: 'none'`).
 * - Endpoint convention for series presented as change from baseline (`presentation: 'deltaFromBaseline'`): each member's
 *   change from its OWN t = 0 value, re-based on the nominal t = 0 value (`deltaRebasedOnNominal`), so the band is the
 *   spread of the change, not of the parameter-dependent baseline (the planner's `dailyBands` uses the same convention).
 * - What a band is travels beside it (`BandMeta`): a parameter-sensitivity range with unvalidated predictive coverage —
 *   never relabelled as an 80 % prediction interval.
 *
 * A1-049 (re-audit 2026-10-19): a member crosses this boundary as an envelope (`EnsembleMemberEnvelope`: its band inputs
 * with its own output status and onset, its run validity and its early abort). Per series and day the reducer counts the
 * attempted, valid and excluded members and why each was excluded (`BandAvailability`): a value is valid only when it is
 * finite, inside the member's valid run (no model-limit termination, not after an early abort) and its own status is
 * interpretable — a finite compatibility number never makes a forbidding status usable. Scenario/limited members stay
 * valid contributions and the band inherits their conditional status, kind and first day. A day with no valid member, or
 * with a model-limit/domain exclusion (unless the caller explicitly asks for the named valid-domain conditional range),
 * has no usable range (`BAND_DAY_METHOD.none`); a day whose only exclusions are non-finite values, forbidding statuses or
 * aborts gets the range of the valid members, named conditional (`conditionalValid`). Quantile arrays stay finite
 * compatibility storage (the valid members' quantiles, or 0 with no valid member — never the nominal, never the previous
 * day's range); the per-day mask says whether a day's range may be used. `bandMeta.draws` keeps the scalar attempted count.
 *
 * Linear interpolation between order statistics.
 */
import {
  BAND_DAY_METHOD,
  CONTRACT_VERSIONS,
  INTERPRETABLE_STATUSES,
  bandDayMethodOf,
  bandMetaFor,
  worstStatus,
  type BandAvailability,
  type BandExclusionReason,
  type BandMeta,
  type OutputStatus,
  type UncertaintyKind,
} from '@/lib/bodyContracts';
import { seriesDef, type SeriesId } from '../types/metrics';
import type { EnsembleMemberEnvelope, SeriesStatusMeta, SimulationResult } from '../types/result';

/** Daily values of one ensemble member, by series (the legacy member form: values only, no status or validity). */
export type MemberSeries = Partial<Record<SeriesId, Float32Array>>;

/** A member as the reducer accepts it: an envelope (A1-049), or the legacy values-only form (validity = finiteness). */
export type BandMember = EnsembleMemberEnvelope | MemberSeries;

/** Whether a member is an envelope (its `daily` map and `nDays` travel beside its status/validity). */
export function isMemberEnvelope(m: BandMember): m is EnsembleMemberEnvelope {
  const e = m as Partial<EnsembleMemberEnvelope>;
  return typeof e.nDays === 'number' && e.daily !== null && typeof e.daily === 'object' && !ArrayBuffer.isView(e.daily);
}

/** Whether a series uses the change-from-own-baseline endpoint convention. */
export function isDeltaSeries(id: SeriesId): boolean {
  return seriesDef(id).presentation === 'deltaFromBaseline';
}

/**
 * A member's band input for one series: its change from its own t = 0 value for change-from-baseline series, its raw daily
 * values otherwise. A member without a finite t = 0 value gives NaN for a change series (it cannot contribute).
 */
export function memberBandInput(id: SeriesId, daily: Float32Array, initial: number | undefined): Float32Array {
  if (!isDeltaSeries(id)) return daily;
  const out = new Float32Array(daily.length);
  const base = initial !== undefined && Number.isFinite(initial) ? initial : Number.NaN;
  for (let d = 0; d < daily.length; d++) out[d] = daily[d]! - base;
  return out;
}

/** Band inputs of every series of one member (`memberBandInput` applied per series). */
export function memberBandInputs(daily: MemberSeries, initial: Partial<Record<SeriesId, number>>): MemberSeries {
  const out: MemberSeries = {};
  for (const id of Object.keys(daily) as SeriesId[]) {
    const a = daily[id];
    if (a) out[id] = memberBandInput(id, a, initial[id]);
  }
  return out;
}

/**
 * A1-049: the envelope of one member run — its band inputs (`memberBandInputs`) with its own output status and onset, its
 * run validity (a model-limit termination) and its early abort. The same envelope crosses the worker (`simulateDrawChunk`)
 * and the direct ensemble (`simulateEnsemble`).
 */
export function memberEnvelope(r: Pick<SimulationResult, 'daily' | 'initial' | 'meta'>): EnsembleMemberEnvelope {
  return {
    daily: memberBandInputs(r.daily, r.initial),
    nDays: r.meta.nDays,
    ...(r.meta.outputStatus ? { status: r.meta.outputStatus } : {}),
    ...(r.meta.validity ? { validity: r.meta.validity } : {}),
    ...(r.meta.aborted ? { aborted: r.meta.aborted } : {}),
  };
}

/** Quantile p of the first n entries of an ascending-sorted buffer (linear interpolation); NaN when n = 0. */
export function quantileSorted(s: ArrayLike<number>, n: number, p: number): number {
  if (n <= 0) return Number.NaN;
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
}

export interface EnsembleBands {
  p10: Partial<Record<SeriesId, Float32Array>>;
  p50: Partial<Record<SeriesId, Float32Array>>;
  p90: Partial<Record<SeriesId, Float32Array>>;
  method: Partial<Record<SeriesId, 'draws' | 'none'>>;
  bandMeta: Partial<Record<SeriesId, BandMeta>>;
  /** A1-049: per-series, per-day availability, counts, exclusion reasons and member status. */
  bandDays: Partial<Record<SeriesId, BandAvailability>>;
}

export interface EnsembleBandOptions {
  /**
   * Offer the range of the valid members on a day with a model-limit/domain exclusion, explicitly named conditional on
   * their validity (`BAND_DAY_METHOD.conditionalValid`). Default false: such a day has no usable range.
   */
  conditionalValidDomain?: boolean;
}

/** Exclusion code of member value `d` of series `id` (null = a valid contribution). Pure. */
function exclusionOf(m: BandMember, env: boolean, id: SeriesId, a: Float32Array | undefined, d: number): BandExclusionReason | null {
  if (env) {
    const e = m as EnsembleMemberEnvelope;
    // an early abort: the abort day itself was simulated and recorded; the days after it were not
    if (e.aborted && d > e.aborted.day) return 'aborted';
    // a model-limit termination: a day not wholly inside the valid run is not a contribution (whatever its number); a run
    // outside the model's domain contributes nothing
    const v = e.validity;
    if (v && v.status === 'modelLimit' && d * 24 + 23 > (v.validThroughHour ?? -1)) return 'modelLimit';
    if (v && v.status === 'outsideDomain') return 'outOfDomain';
    const st = e.status?.[id];
    if (st && (st.fromDay === undefined || d >= st.fromDay) && !INTERPRETABLE_STATUSES.has(st.status)) {
      return st.status === 'modelLimit' ? 'modelLimit' : st.status === 'outOfDomain' ? 'outOfDomain' : 'forbiddingStatus';
    }
  }
  if (!a || d >= a.length || !Number.isFinite(a[d]!)) return 'nonFinite';
  return null;
}

/** The member's interpretable conditional status of series `id` in force on day `d` (null = estimated). */
function conditionalStatusOf(m: BandMember, env: boolean, id: SeriesId, d: number): SeriesStatusMeta | null {
  if (!env) return null;
  const st = (m as EnsembleMemberEnvelope).status?.[id];
  if (!st || (st.fromDay !== undefined && d < st.fromDay)) return null;
  return st.status === 'estimated' || st.status === 'observed' || st.status === 'verified' ? null : st;
}

/**
 * P10/P50/P90 per day of every series of the nominal run, from the members (envelopes, or legacy values-only members). Change
 * series are re-based on the nominal t = 0 value (`nominalInitial`; without it such a series gets no band). Per series and
 * day: attempted/valid/excluded counts with reasons and the per-day method (`bandDays`, A1-049). A series without a usable
 * day gets `method: 'none'` and no quantile arrays. `bandMeta.draws` is the scalar attempted count.
 */
export function ensembleBands(
  nominalDaily: Partial<Record<SeriesId, Float32Array>>,
  nominalInitial: Partial<Record<SeriesId, number>> | undefined,
  members: readonly BandMember[],
  opts: EnsembleBandOptions = {},
): EnsembleBands {
  const out: EnsembleBands = { p10: {}, p50: {}, p90: {}, method: {}, bandMeta: {}, bandDays: {} };
  const attempted = members.length;
  const buf = new Float64Array(Math.max(1, attempted));
  const envs = members.map(isMemberEnvelope);
  const daily = members.map((m, k) => (envs[k] ? (m as EnsembleMemberEnvelope).daily : (m as MemberSeries)));
  for (const id of Object.keys(nominalDaily) as SeriesId[]) {
    const nd = nominalDaily[id];
    if (!nd) continue;
    const n = nd.length;
    const delta = isDeltaSeries(id);
    const base0 = delta ? (nominalInitial?.[id] ?? Number.NaN) : 0;
    const endpoint = delta ? 'deltaRebasedOnNominal' : 'raw';
    const valid = new Uint16Array(n);
    const excluded = new Uint16Array(n);
    const method = new Uint8Array(n);
    const excludedBy: Partial<Record<BandExclusionReason, Uint16Array>> = {};
    const a10 = new Float32Array(n);
    const a50 = new Float32Array(n);
    const a90 = new Float32Array(n);
    let status: OutputStatus = 'estimated';
    let statusMeta: SeriesStatusMeta | null = null;
    let statusFrom = Number.POSITIVE_INFINITY;
    let usableDays = 0;
    for (let d = 0; d < n; d++) {
      let nv = 0;
      let domain = 0;
      for (let k = 0; k < attempted; k++) {
        const a = daily[k]![id];
        const why = exclusionOf(members[k]!, envs[k]!, id, a, d);
        if (why !== null) {
          (excludedBy[why] ??= new Uint16Array(n))[d]! += 1;
          if (why === 'modelLimit' || why === 'outOfDomain') domain++;
          continue;
        }
        buf[nv++] = a![d]!;
        const cond = conditionalStatusOf(members[k]!, envs[k]!, id, d);
        if (cond) {
          // days run in order, so the first day a status is seen is its onset; a worse status restarts the onset
          const w = worstStatus(status, cond.status);
          if (w !== status) {
            status = w;
            statusMeta = cond;
            statusFrom = d;
          }
        }
      }
      valid[d] = nv;
      excluded[d] = attempted - nv;
      method[d] = Number.isFinite(base0) ? bandDayMethodOf({ valid: nv, excluded: attempted - nv, domainExcluded: domain }, opts) : BAND_DAY_METHOD.none;
      if (method[d] !== BAND_DAY_METHOD.none) usableDays++;
      if (nv > 0 && Number.isFinite(base0)) {
        const s = buf.subarray(0, nv).sort();
        a10[d] = base0 + quantileSorted(s, nv, 0.1);
        a50[d] = base0 + quantileSorted(s, nv, 0.5);
        a90[d] = base0 + quantileSorted(s, nv, 0.9);
      }
      // no valid member: finite compatibility storage only (0); the day's method says it is not a range
    }
    const conditional = status !== 'estimated';
    const uncertaintyKind: UncertaintyKind = conditional ? (statusMeta?.uncertaintyKind ?? 'scenario') : 'parameterSensitivity';
    out.bandDays[id] = {
      version: CONTRACT_VERSIONS.uncertainty,
      attempted,
      valid,
      excluded,
      method,
      excludedBy,
      status,
      ...(conditional && Number.isFinite(statusFrom) ? { fromDay: statusFrom } : {}),
      uncertaintyKind,
      reasonCode: conditional ? (statusMeta?.reasonCode ?? 'memberScenario') : 'parameterSensitivity',
    };
    if (usableDays === 0) {
      out.method[id] = 'none';
      out.bandMeta[id] = bandMetaFor('none', 0, endpoint);
      continue;
    }
    out.p10[id] = a10;
    out.p50[id] = a50;
    out.p90[id] = a90;
    out.method[id] = 'draws';
    out.bandMeta[id] = bandMetaFor('draws', attempted, endpoint);
  }
  return out;
}
