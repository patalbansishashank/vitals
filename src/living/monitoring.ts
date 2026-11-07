/**
 * Goal monitoring beyond scale weight (D4-05; C4, C6): every goal whose metric has a logged observable gets an
 * adherence-independent observation summary — count, days, first/latest reading and change, in the measurement's own unit
 * and operator — whether or not the plan also has a weight goal or any weigh-ins. A measurable metric is tracked without
 * pretending its future response is calibrated: these rows are observed-only (no forecast comparison here).
 *
 * Blood pressure is an episode of paired readings: systolic and diastolic of one sitting (shared `episodeId`) stay one
 * atomic observation with its measurement time (the occurrence, separate from the entry time), repeats, setting, rest and
 * time of day. Same-ID sync copies are deduplicated and edits supersede; separate equal-valued records remain separate,
 * individual readings are preserved by record/repeat identity for safety review; ambiguous legacy repeat encodings and
 * readings without an episode stay protocol-unknown. An unpaired reading is an incomplete protocol — still a valid observation, never deleted. No medication dose is adjusted
 * and no diastolic response model is invented.
 */
import { occurrenceBoundsMs } from '@/lib/bodyContracts';
import type { MetricId } from '@/engine';
import { compareDates, daysBetween } from './dates';
import { projectEntries } from './logs';
import type { Instant, LocalDate, MeasurementEntry, MeasurementMetric, PlanDoc } from './types';

/** Goal metric → the measurement that observes it (its own operator; a model tissue fraction is not a scale/BIA/DXA reading). */
export const MONITORED_MEASUREMENT: Readonly<Partial<Record<MetricId, MeasurementMetric>>> = {
  waist: 'waistCm',
  bodyFatPct: 'bodyFatPct',
  sbp: 'sbpMmHg',
  ldl: 'ldlMmolL',
  hdl: 'hdlMmolL',
  triglycerides: 'tgMmolL',
  apoB: 'apoBgL',
  fastingGlucose: 'fastingGlucoseMmolL',
  glucose: 'glucoseMmolL',
  crp: 'crpMgL',
  bhb: 'ketonesMmolL',
};

const UNIT: Readonly<Record<MeasurementMetric, string>> = {
  weightKg: 'kg', waistCm: 'cm', hipCm: 'cm', neckCm: 'cm', chestCm: 'cm', armCm: 'cm', thighCm: 'cm', bodyFatPct: '%', sbpMmHg: 'mmHg', dbpMmHg: 'mmHg',
  ketonesMmolL: 'mmol/L', glucoseMmolL: 'mmol/L', ldlMmolL: 'mmol/L', hdlMmolL: 'mmol/L', tgMmolL: 'mmol/L', apoBgL: 'g/L', fastingGlucoseMmolL: 'mmol/L', hba1cPct: '%', crpMgL: 'mg/L',
};

/** One blood-pressure sitting: paired values and the facts of how it was measured. */
export interface BpEpisode {
  id: string;
  date: LocalDate;
  /** When it was measured (the reading's occurrence), if known; the entry time is separate (`recordedAt`). */
  occurredAt?: Instant;
  recordedAt?: Instant;
  /** Mean of the episode's systolic / diastolic readings (null when that half was not logged). */
  sbp: number | null;
  dbp: number | null;
  /** Every individual reading kept for safety review (mmHg, as entered). */
  readings: { sbp: number[]; dbp: number[] };
  readingIds: { sbp: string[]; dbp: string[] };
  /** Original effective records retain occurrence/method/device/protocol and all entered contextual metadata. */
  rawRecords: readonly MeasurementEntry[];
  /** 'paired' = both halves; 'incompleteProtocol' = one half only; 'protocolUnknown' = a legacy reading without an episode. */
  protocol: 'paired' | 'incompleteProtocol' | 'protocolUnknown';
  setting?: MeasurementEntry['setting'];
  restMin?: number;
  timeOfDay?: MeasurementEntry['timeOfDay'];
  sourceIds: string[];
  encoding: 'known' | 'encodingUnknown';
  legacyRepeats: { sourceId: string; primary: number; repeats: number[] }[];
  comparisonKey: string;
}

const occurredAtOf = (m: MeasurementEntry): Instant | undefined => (m.occurrence?.precision === 'exact' && occurrenceBoundsMs(m.occurrence) ? m.occurrence.at : undefined);

/** Occurrence orders physiology; entry time is provenance only. */
function compareObservations(a: { date: LocalDate; id: string; occurrence?: MeasurementEntry['occurrence']; occurredAt?: Instant }, b: { date: LocalDate; id: string; occurrence?: MeasurementEntry['occurrence']; occurredAt?: Instant }): number {
  const at = a.occurredAt ? Date.parse(a.occurredAt) : a.occurrence?.precision === 'exact' ? occurrenceBoundsMs(a.occurrence)?.startMs : undefined;
  const bt = b.occurredAt ? Date.parse(b.occurredAt) : b.occurrence?.precision === 'exact' ? occurrenceBoundsMs(b.occurrence)?.startMs : undefined;
  if (at !== undefined && bt !== undefined && Number.isFinite(at) && Number.isFinite(bt)) return at - bt || a.id.localeCompare(b.id);
  return compareDates(a.date, b.date) || a.id.localeCompare(b.id);
}

function orderedEndpoints<T extends { id: string; date: LocalDate; occurrence?: MeasurementEntry['occurrence']; occurredAt?: Instant }>(rows: readonly T[]): { first: T | null; latest: T | null; changeKnown: boolean } {
  const sorted = [...rows].sort(compareObservations);
  const first = sorted[0] ?? null;
  const latest = sorted[sorted.length - 1] ?? null;
  const exactMs = (r: T) => {
    const ms = r.occurredAt ? Date.parse(r.occurredAt) : r.occurrence?.precision === 'exact' ? occurrenceBoundsMs(r.occurrence)?.startMs : undefined;
    return ms !== undefined && Number.isFinite(ms) ? ms : undefined;
  };
  const unique = (r: T | null) => !r || sorted.filter((x) => x.date === r.date).length === 1 || sorted.filter((x) => x.date === r.date).every((x) => exactMs(x) !== undefined);
  const f = unique(first) ? first : null;
  const l = unique(latest) ? latest : null;
  const sameTime = f && l && f !== l && exactMs(f) !== undefined && exactMs(f) === exactMs(l);
  return { first: f, latest: l, changeKnown: !!f && !!l && f !== l && !sameTime };
}

function measurementOperator(m: MeasurementEntry): string {
  if (m.metric === 'ketonesMmolL') return (m.specimen === 'capillaryBlood' || m.specimen === 'venousBlood') && (m.operator === undefined || m.operator === 'bhbEndpoint') ? 'bloodDBhb' : `ketones:${m.specimen ?? 'unknown'}:${m.operator ?? 'unknown'}`;
  if (m.metric === 'bodyFatPct') {
    const byMethod = { dxa: 'dxaBodyFat', bia: 'biaBodyFat', navy: 'navyBodyFat', skinfold: 'skinfoldBodyFat' };
    return `bodyFat:${m.operator ?? (m.method && m.method in byMethod ? byMethod[m.method as keyof typeof byMethod] : 'unknown')}`;
  }
  if (m.metric === 'glucoseMmolL' || m.metric === 'fastingGlucoseMmolL') return `glucose:${m.operator ?? m.method ?? 'unknown'}:${m.protocol ?? m.measurementContext ?? m.context ?? 'unknown'}`;
  return m.operator ?? `${m.metric}:${m.method ?? 'unknown'}`;
}

/** Blood-pressure episodes of the effective (edited, retracted, conflict-resolved) measurements, oldest first. */
export function bpEpisodes(measurements: readonly MeasurementEntry[]): BpEpisode[] {
  const groups = new Map<string, MeasurementEntry[]>();
  for (const m of projectEntries(measurements)) {
    if ((m.metric !== 'sbpMmHg' && m.metric !== 'dbpMmHg') || m.assumed || !Number.isFinite(m.value)) continue;
    const key = m.episodeId ? `ep:${m.episodeId}` : `id:${m.id}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const out: BpEpisode[] = [];
  for (const [key, ms] of groups) {
    const legacyRepeats: BpEpisode['legacyRepeats'] = [];
    const readingIds: BpEpisode['readingIds'] = { sbp: [], dbp: [] };
    const raw = (metric: MeasurementMetric): number[] => {
      const vals: number[] = [];
      for (const m of ms.filter((x) => x.metric === metric)) {
        if (m.repeats && m.repeatsEncoding === undefined) {
          legacyRepeats.push({ sourceId: m.id, primary: m.value, repeats: [...m.repeats] });
          continue;
        }
        const readings = m.repeatsEncoding === 'fullRawList' ? m.repeats ?? [] : [m.value, ...(m.repeats ?? [])];
        // projectEntries removed sync copies. Each distinct record/index is an actual repeat, even if values are equal.
        readings.forEach((v, index) => {
          if (!Number.isFinite(v)) return;
          vals.push(v);
          readingIds[metric === 'sbpMmHg' ? 'sbp' : 'dbp'].push(`${m.id}:${m.repeatsEncoding === 'fullRawList' ? 'repeat' : 'raw'}:${index}`);
        });
      }
      return vals;
    };
    const sbp = raw('sbpMmHg');
    const dbp = raw('dbpMmHg');
    const mean = (xs: number[], metric: MeasurementMetric): number | null => xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : ms.find((m) => m.metric === metric)?.value ?? null;
    const first = [...ms].sort(compareObservations)[0]!;
    const occurredAt = ms.map(occurredAtOf).filter((x): x is string => !!x).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    const facts = ms.find((m) => m.setting || m.restMin !== undefined || m.timeOfDay) ?? first;
    out.push({
      id: key,
      date: first.date,
      ...(occurredAt ? { occurredAt } : {}),
      ...(first.recordedAt ?? first.at ? { recordedAt: first.recordedAt ?? first.at! } : {}),
      sbp: mean(sbp, 'sbpMmHg'),
      dbp: mean(dbp, 'dbpMmHg'),
      readings: { sbp, dbp },
      readingIds, rawRecords: ms,
      protocol: key.startsWith('id:') || legacyRepeats.length > 0 ? 'protocolUnknown' : sbp.length > 0 && dbp.length > 0 ? 'paired' : 'incompleteProtocol',
      ...(facts?.setting ? { setting: facts.setting } : {}),
      ...(facts?.restMin !== undefined ? { restMin: facts.restMin } : {}),
      ...(facts?.timeOfDay ? { timeOfDay: facts.timeOfDay } : {}),
      sourceIds: ms.map((m) => m.id).sort(),
      encoding: legacyRepeats.length ? 'encodingUnknown' : 'known', legacyRepeats,
      comparisonKey: JSON.stringify([facts.setting ?? 'unknown', facts.restMin ?? null, facts.timeOfDay ?? 'unknown', facts.method ?? 'unknown', facts.device ?? 'unknown', facts.protocol ?? 'unknown']),
    });
  }
  return out.sort(compareObservations);
}

/** One monitored goal: what was observed, in the measurement's unit (observed-only: no response forecast is claimed). */
export interface MonitoredGoal {
  goal: number;
  metric: MetricId;
  measurement: MeasurementMetric;
  unit: string;
  /** 'observed' when at least one reading exists in the window, else 'unknown' (never zero, never "on track"). */
  status: 'observed' | 'unknown';
  /** Always observed-only here: a forecast comparison needs a compatible operator and a supported response model. */
  forecast: 'observedOnly';
  target: number | null;
  /** Readings (episodes for blood pressure) and the distinct days they cover. */
  readings: number;
  days: number;
  first: { value: number; date: LocalDate } | null;
  latest: { value: number; date: LocalDate } | null;
  change: number | null;
  /** Blood pressure: episode counts by protocol and the latest paired sitting (both values, mmHg). */
  operatorGroups?: { operator: string; compatible: boolean; readings: number; first: { value: number; date: LocalDate } | null; latest: { value: number; date: LocalDate } | null; change: number | null }[];
  excludedOperatorReadings?: number;
  reasonCode?: string;
  bp?: { first?: { sbp: number | null; dbp: number | null; date: LocalDate } | null; change?: { sbp: number | null; dbp: number | null } | null; episodes: number; paired: number; incompleteProtocol: number; protocolUnknown: number; sessionsWithRepeats: number; latest: { sbp: number | null; dbp: number | null; date: LocalDate } | null };
}

/**
 * Monitoring rows for the plan's non-weight goals from the plan start through `today` (D4-05). Works with no weight goal and
 * no weigh-ins; a goal without a logged observable gets no row.
 */
export function monitorGoals(plan: Pick<PlanDoc, 'startDate' | 'request'>, measurements: readonly MeasurementEntry[], today: LocalDate): MonitoredGoal[] {
  const inPlan = (date: LocalDate): boolean => daysBetween(plan.startDate, date) >= 0 && compareDates(date, today) <= 0;
  const effective = projectEntries(measurements).filter((m) => !m.assumed && Number.isFinite(m.value) && inPlan(m.date));
  const out: MonitoredGoal[] = [];
  plan.request.goals.forEach((g, goal) => {
    const measurement = MONITORED_MEASUREMENT[g.metric];
    if (!measurement) return;
    // an absolute target only (a 'change' target is relative to a start value this row does not define)
    const target = g.target !== undefined && (g.targetKind ?? 'absolute') === 'absolute' ? g.target : null;
    if (measurement === 'sbpMmHg') {
      const eps = bpEpisodes(effective).filter((e) => e.sbp !== null);
      const all = bpEpisodes(effective);
      const endpoint = orderedEndpoints(eps);
      const firstE = endpoint.first;
      const lastE = endpoint.latest;
      const comparable = firstE && lastE && firstE.comparisonKey === lastE.comparisonKey && firstE.protocol === 'paired' && lastE.protocol === 'paired' && endpoint.changeKnown;
      const lastAny = all[all.length - 1];
      out.push({
        goal, metric: g.metric, measurement, unit: UNIT[measurement], status: eps.length > 0 ? 'observed' : 'unknown', forecast: 'observedOnly', target,
        readings: eps.length,
        days: new Set(eps.map((e) => e.date)).size,
        first: firstE ? { value: firstE.sbp!, date: firstE.date } : null,
        latest: lastE ? { value: lastE.sbp!, date: lastE.date } : null,
        change: comparable ? lastE.sbp! - firstE.sbp! : null,
        bp: {
          first: firstE ? { sbp: firstE.sbp, dbp: firstE.dbp, date: firstE.date } : null,
          change: comparable ? { sbp: lastE.sbp! - firstE.sbp!, dbp: lastE.dbp! - firstE.dbp! } : null,
          episodes: all.length,
          paired: all.filter((e) => e.protocol === 'paired').length,
          incompleteProtocol: all.filter((e) => e.protocol === 'incompleteProtocol').length,
          protocolUnknown: all.filter((e) => e.protocol === 'protocolUnknown').length,
          sessionsWithRepeats: all.filter((e) => e.readings.sbp.length > 1 || e.readings.dbp.length > 1).length,
          latest: lastAny ? { sbp: lastAny.sbp, dbp: lastAny.dbp, date: lastAny.date } : null,
        },
      });
      return;
    }
    const all = effective.filter((m) => m.metric === measurement);
    const ms = measurement === 'ketonesMmolL' ? all.filter((m) => measurementOperator(m) === 'bloodDBhb') : all;
    const operators = [...new Set(all.map(measurementOperator))].sort();
    const operatorGroups = operators.map((operator) => {
      const rows = all.filter((m) => measurementOperator(m) === operator);
      const ep = orderedEndpoints(rows);
      return { operator, compatible: measurement !== 'ketonesMmolL' || operator === 'bloodDBhb', readings: rows.length, first: ep.first ? { value: ep.first.value, date: ep.first.date } : null, latest: ep.latest ? { value: ep.latest.value, date: ep.latest.date } : null, change: ep.changeKnown && !((measurement === 'bodyFatPct' || measurement === 'glucoseMmolL' || measurement === 'fastingGlucoseMmolL') && operator.includes('unknown')) ? ep.latest!.value - ep.first!.value : null };
    });
    const compatibleGroups = operatorGroups.filter((x) => x.compatible);
    const single = compatibleGroups.length === 1 ? compatibleGroups[0]! : null;
    out.push({
      goal, metric: g.metric, measurement, unit: UNIT[measurement], status: ms.length > 0 ? 'observed' : 'unknown', forecast: 'observedOnly', target,
      readings: ms.length, days: new Set(ms.map((m) => m.date)).size,
      first: single?.first ?? null, latest: single?.latest ?? null, change: single?.change ?? null,
      operatorGroups, excludedOperatorReadings: all.length - ms.length,
      ...(all.length > ms.length ? { reasonCode: 'incompatibleSpecimenOperator' } : operators.length > 1 ? { reasonCode: 'incompatibleOperators' } : ms.length > 1 && (!single?.first || !single?.latest) ? { reasonCode: 'occurrenceOrderUnknown' } : {}),
    });
  });
  return out;
}
