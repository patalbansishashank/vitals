/**
 * Re-audit waves 0–1, Simulator result consumers (A1-049, A1-051, A1-052):
 *  - A1-051: a drawn range keeps exactly the members' P10/P90 under unit conversion — the nominal line is its own
 *    trajectory and is never folded into the range; a producer's explicit `method: 'none'` suppresses the band whatever
 *    compatibility arrays travel with it, through the ResultsScreen bridge too; the fixed fallback stays a separately named
 *    heuristic;
 *  - A1-049: a day the ensemble reports without a usable range (every member stopped, or members excluded by their own
 *    status or validity) is a gap in the chart and has no range in the readouts and the copied summary — never the
 *    nominal, an earlier day's range or the finite compatibility numbers in its slot — while the valid prefix keeps its
 *    range; the day's attempted/valid/excluded counts and reasons travel with the readout; a valid-members-only range is
 *    named so; labelled scenario members keep their range with the scenario word;
 *  - A1-052: a measured lab outside the model's domain is observed only at t = 0: every modelled daily sample, day 0
 *    included, reads Unsupported with the exact measured start (chart, table words, readouts and clipboard), on a one-day
 *    horizon and on a resumed snapshot too; in-domain labs and unrelated outcomes keep their numbers.
 */
import '@/features/charts/test/setupDom';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simulate, type PersonProfile, type Schedule, type SimulationResult } from '@/engine';
import type { EnsembleMemberEnvelope } from '@/engine/types/result';
import { ensembleBands } from '@/engine/core/bands';
import { CONTRACT_VERSIONS, bandDayMethodOf, type BandAvailability, type BandExclusionReason, type OutputStatus } from '@/lib/bodyContracts';
import { computeBands } from '@/state/simulationStore';
import { useSafetyStore } from '@/state/safetyStore';
import { withSystemWrite } from '@/state/scope';
import { ResultsScreen, type SimulationLike } from '../ResultsScreen';
import { buildResultsData, statusWordsOf, type BandsLike } from '../lib/adapt';
import { METRIC_UNITS } from '../lib/metrics';
import { computeReadouts, readoutLine, summaryText } from '../lib/readouts';
import { useResultsUiStore } from '../store';
import { DAYS, PROFILE, SCHEDULE, engineResult, resolved } from './fixture';

const { compiled } = resolved();
const engine = engineResult();
/** Without the fixture's danger rules (the acknowledged view; the gate is tested elsewhere). */
const result: SimulationResult = { ...engine, warnings: engine.warnings.filter((w) => w.severity !== 'danger') };
const n = result.meta.nDays;
const nominalFat = result.daily.fatMass!;
const IMPERIAL = { ...METRIC_UNITS, units: 'imperial' as const };
const LB = 2.2046226218;

const fill = (v: number) => new Float32Array(n).fill(v);
const shifted = (a: Float32Array, dv: number) => a.map((v) => v + dv);

describe('A1-051: drawn ranges keep the members’ endpoints; explicit none suppresses the band', () => {
  it('stochastic P10/P90 below the nominal stay exactly where the members put them (metric and imperial)', () => {
    // two members entirely below the nominal path: the real reducer gives P10/P90 strictly below it
    const b = ensembleBands({ fatMass: nominalFat }, result.initial, [{ fatMass: shifted(nominalFat, -5) }, { fatMass: shifted(nominalFat, -3) }]);
    const bands: BandsLike = { p10: b.p10, p90: b.p90, bandMeta: b.bandMeta, bandDays: b.bandDays, draws: 2, total: 2 };
    for (const [prefs, f] of [[METRIC_UNITS, 1], [IMPERIAL, LB]] as const) {
      const adapted = buildResultsData({ result, bands, schedule: SCHEDULE, compiled }, prefs);
      const s = adapted.data.series.find((x) => x.id === 'fatMass')!;
      expect(adapted.bandSource.get('fatMass')).toBe('draws');
      for (let i = 0; i < n; i++) {
        expect(s.daily.band!.lo[i]).toBeCloseTo(b.p10.fatMass![i]! * f, 4);
        expect(s.daily.band!.hi[i]).toBeCloseTo(b.p90.fatMass![i]! * f, 4);
        // the nominal stays its own line, outside the range
        expect(s.daily.values[i]!).toBeGreaterThan(s.daily.band!.hi[i]!);
      }
      const [r] = computeReadouts(adapted.data, ['fatMass'], adapted.metrics, undefined, adapted.bandInfo);
      expect(r!.range![0]).toBeCloseTo(b.p10.fatMass![n - 1]! * f, 4);
      expect(r!.range![1]).toBeCloseTo(b.p90.fatMass![n - 1]! * f, 4);
      expect(r!.end).toBeCloseTo(nominalFat[n - 1]! * f, 4);
      expect(r!.rangeKind).toBe('parameterSensitivity');
    }
  });

  it('the probe case: nominal 100 with members 10 and 20 reads 11–19, not 11–100', () => {
    const nominal = { ...result, daily: { ...result.daily, fatMass: fill(100) }, initial: { ...result.initial, fatMass: 100 } };
    const b = ensembleBands({ fatMass: nominal.daily.fatMass }, nominal.initial, [{ fatMass: fill(10) }, { fatMass: fill(20) }]);
    const adapted = buildResultsData({ result: nominal, bands: { p10: b.p10, p90: b.p90, bandMeta: b.bandMeta, bandDays: b.bandDays, draws: 2, total: 2 }, schedule: SCHEDULE, compiled });
    const [r] = computeReadouts(adapted.data, ['fatMass'], adapted.metrics, undefined, adapted.bandInfo);
    expect(r!.range).toEqual([11, 19]);
    expect(r!.end).toBe(100);
    expect(readoutLine(r!)).toMatch(/range 11\.0–19\.0/);
  });

  it('an explicit complete no-contributor result (method none) carries no band through the bridge, arrays or not', () => {
    // the real state reducer: a complete member set that never reports fat mass
    const sb = computeBands(result.daily, [{}], 1, result.initial);
    expect(sb.bandMeta!.fatMass!.method).toBe('none');
    const bridge: BandsLike = { p10: sb.p10, p90: sb.p90, draws: sb.drawsDone, total: sb.drawsTotal, bandMeta: sb.bandMeta };
    const adapted = buildResultsData({ result, bands: bridge, schedule: SCHEDULE, compiled });
    expect(adapted.bandSource.get('fatMass')).toBe('none');
    expect(adapted.bandInfo.get('fatMass')).toEqual({ source: 'none', uncertaintyKind: 'none' });
    expect(adapted.data.series.find((x) => x.id === 'fatMass')!.daily.band).toBeUndefined();
    // compatibility arrays beside an explicit none are never a range
    const withArrays = buildResultsData({ result, bands: { ...bridge, p10: { fatMass: fill(1) }, p90: { fatMass: fill(2) }, method: { fatMass: 'draws' } }, schedule: SCHEDULE, compiled });
    expect(withArrays.bandSource.get('fatMass')).toBe('none');
    const [r] = computeReadouts(withArrays.data, ['fatMass'], withArrays.metrics, undefined, withArrays.bandInfo);
    expect(r!.range).toBeUndefined();
    expect(readoutLine(r!)).not.toMatch(/range/);
  });

  it('the no-ensemble display fallback keeps its own name and kind (heuristic), separate from drawn ranges', () => {
    const adapted = buildResultsData({ result, bands: null, schedule: SCHEDULE, compiled });
    expect(adapted.bandSource.get('fatMass')).toBe('fallback');
    expect(adapted.bandInfo.get('fatMass')).toEqual({ source: 'fallback', uncertaintyKind: 'heuristic' });
    const [r] = computeReadouts(adapted.data, ['fatMass'], adapted.metrics, undefined, adapted.bandInfo);
    expect(r!.rangeKind).toBe('heuristic');
  });
});

/** Members of the fixture's fat mass: four paths around the nominal that all stop after `stopAfter` days (NaN after). */
function stoppingMembers(stopAfter: number, alive = 0) {
  return [-2, -1, 1, 2].map((dv, k) => ({ fatMass: shifted(nominalFat, dv).map((v, d) => (d >= stopAfter && k >= alive ? Number.NaN : v)) }));
}

/**
 * The producer's per-day availability for the members (the published `BandAvailability` contract): finite = valid, NaN =
 * excluded for `reason`; the day method follows the contract's own policy (`bandDayMethodOf`).
 */
function availability(members: ReturnType<typeof stoppingMembers>, opts: { reason?: BandExclusionReason; conditionalValidDomain?: boolean; status?: OutputStatus; fromDay?: number } = {}): BandAvailability {
  const reason = opts.reason ?? 'aborted';
  const domain = reason === 'modelLimit' || reason === 'outOfDomain';
  const valid = new Uint16Array(n);
  const excluded = new Uint16Array(n);
  const method = new Uint8Array(n);
  for (let d = 0; d < n; d++) {
    for (const m of members) if (Number.isFinite(m.fatMass[d]!)) valid[d]!++;
    excluded[d] = members.length - valid[d]!;
    method[d] = bandDayMethodOf({ valid: valid[d]!, excluded: excluded[d]!, domainExcluded: domain ? excluded[d]! : 0 }, { conditionalValidDomain: opts.conditionalValidDomain });
  }
  return {
    version: CONTRACT_VERSIONS.uncertainty,
    attempted: members.length,
    valid,
    excluded,
    method,
    excludedBy: { [reason]: Uint16Array.from(excluded) },
    status: opts.status ?? 'estimated',
    ...(opts.fromDay !== undefined ? { fromDay: opts.fromDay } : {}),
    uncertaintyKind: opts.status === 'scenario' ? 'scenario' : 'parameterSensitivity',
    reasonCode: opts.status === 'scenario' ? 'lowProteinSurplusPartition' : 'none',
  };
}

/**
 * Compatibility storage at its most misleading: every unavailable day (from `from`) holds the last available day's quantile
 * (the "stale previous range" a reader must never show as a range).
 */
function compatible(a: Float32Array, from: number): Float32Array {
  const out = Float32Array.from(a);
  for (let i = Math.max(1, from); i < out.length; i++) out[i] = out[from - 1]!;
  return out;
}

describe('A1-049: per-day band availability through the adapter and the readouts', () => {
  const STOP = 10;

  it('an all-stopped suffix is a gap through the real reducer’s own availability; the valid prefix keeps its range', () => {
    const members = stoppingMembers(STOP);
    const b = ensembleBands({ fatMass: nominalFat }, result.initial, members);
    const adapted = buildResultsData({ result, bands: { p10: b.p10, p90: b.p90, bandMeta: b.bandMeta, bandDays: b.bandDays, draws: 4, total: 4 }, schedule: SCHEDULE, compiled });
    const s = adapted.data.series.find((x) => x.id === 'fatMass')!;
    for (let d = 0; d < STOP; d++) expect(Number.isFinite(s.daily.band!.lo[d]!)).toBe(true);
    for (let d = STOP; d < n; d++) expect(Number.isNaN(s.daily.band!.lo[d]!) && Number.isNaN(s.daily.band!.hi[d]!)).toBe(true);
    const [prefix] = computeReadouts(adapted.data, ['fatMass'], adapted.metrics, STOP - 1, adapted.bandInfo);
    expect(prefix!.range).toBeDefined();
    const [last] = computeReadouts(adapted.data, ['fatMass'], adapted.metrics, undefined, adapted.bandInfo);
    expect(last!.range).toBeUndefined();
    // the nominal itself is still read (it did not stop)
    expect(last!.end).toBeCloseTo(nominalFat[n - 1]!, 5);
  });

  it('finite compatibility numbers on unavailable days never become a displayed range; counts and reasons travel', () => {
    const members = stoppingMembers(STOP);
    const b = ensembleBands({ fatMass: nominalFat }, result.initial, members);
    const p10 = { fatMass: compatible(b.p10.fatMass!, STOP) };
    const p90 = { fatMass: compatible(b.p90.fatMass!, STOP) };
    const bandDays = { fatMass: availability(members) };
    const adapted = buildResultsData({ result, bands: { p10, p90, bandMeta: b.bandMeta, bandDays, draws: 4, total: 4 }, schedule: SCHEDULE, compiled });
    const s = adapted.data.series.find((x) => x.id === 'fatMass')!;
    for (let d = STOP; d < n; d++) expect(Number.isNaN(s.daily.band!.lo[d]!)).toBe(true);
    for (let d = 0; d < STOP; d++) expect(s.daily.band!.lo[d]).toBeCloseTo(b.p10.fatMass![d]!, 5);
    const [last] = computeReadouts(adapted.data, ['fatMass'], adapted.metrics, undefined, adapted.bandInfo);
    expect(last!.range).toBeUndefined();
    expect(last!.members).toEqual({ attempted: 4, valid: 0, excluded: 4, reasons: ['aborted'] });
    const [early] = computeReadouts(adapted.data, ['fatMass'], adapted.metrics, 2, adapted.bandInfo);
    expect(early!.members).toEqual({ attempted: 4, valid: 4, excluded: 0, reasons: [] });
    expect(early!.range).toBeDefined();
    // the serialized state the adapter read stays finite and unchanged (the gap is chart-local)
    expect(Array.from(p10.fatMass).every(Number.isFinite)).toBe(true);
    expect(Array.from(p90.fatMass).every(Number.isFinite)).toBe(true);
  });

  it('one member stopped at a model limit: by default no survivor-only range; an explicitly named valid-domain range says so', () => {
    const members = stoppingMembers(STOP, 3); // members 0-2 run to the end, member 3 stops
    const b = ensembleBands({ fatMass: nominalFat }, result.initial, members);
    const base = { p10: b.p10, p90: b.p90, bandMeta: b.bandMeta, draws: 4, total: 4 };
    const withheld = buildResultsData({ result, bands: { ...base, bandDays: { fatMass: availability(members, { reason: 'modelLimit' }) } }, schedule: SCHEDULE, compiled });
    const [w] = computeReadouts(withheld.data, ['fatMass'], withheld.metrics, undefined, withheld.bandInfo);
    expect(w!.range).toBeUndefined();
    expect(w!.members).toEqual({ attempted: 4, valid: 3, excluded: 1, reasons: ['modelLimit'] });
    expect(Number.isNaN(withheld.data.series.find((x) => x.id === 'fatMass')!.daily.band!.lo[n - 1]!)).toBe(true);
    const offered = buildResultsData({ result, bands: { ...base, bandDays: { fatMass: availability(members, { reason: 'modelLimit', conditionalValidDomain: true }) } }, schedule: SCHEDULE, compiled });
    const [o] = computeReadouts(offered.data, ['fatMass'], offered.metrics, undefined, offered.bandInfo);
    expect(o!.range).toBeDefined();
    expect(o!.rangeValidOnly).toBe(true);
    expect(readoutLine(o!)).toMatch(/, range [\d.]+–[\d.]+ · 3 of 4 variations$/);
    // before the stop the full ensemble's range is unqualified
    const [pre] = computeReadouts(offered.data, ['fatMass'], offered.metrics, 1, offered.bandInfo);
    expect(pre!.rangeValidOnly).toBeUndefined();
    expect(pre!.members).toEqual({ attempted: 4, valid: 4, excluded: 0, reasons: [] });
    expect(readoutLine(pre!)).not.toMatch(/variations/);
  });

  it('the real reducer with member envelopes: one member stopped at a model limit withholds the later days by default', () => {
    // three members run to the end; the fourth's run is valid through day STOP − 1 (its later numbers are compatibility only)
    const members: EnsembleMemberEnvelope[] = [-2, -1, 1, 2].map((dv, k) => ({
      daily: { fatMass: shifted(nominalFat, dv) },
      nDays: n,
      ...(k === 3 ? { validity: { status: 'modelLimit' as const, validThroughHour: STOP * 24 - 1, reasonCode: 'tissueFloorModelLimit', version: 1 } } : {}),
    }));
    const b = ensembleBands({ fatMass: nominalFat }, result.initial, members);
    const adapted = buildResultsData({ result, bands: { p10: b.p10, p90: b.p90, bandMeta: b.bandMeta, bandDays: b.bandDays, draws: 4, total: 4 }, schedule: SCHEDULE, compiled });
    const s = adapted.data.series.find((x) => x.id === 'fatMass')!;
    for (let d = 0; d < STOP; d++) expect(Number.isFinite(s.daily.band!.lo[d]!)).toBe(true);
    for (let d = STOP; d < n; d++) expect(Number.isNaN(s.daily.band!.lo[d]!)).toBe(true);
    const [last] = computeReadouts(adapted.data, ['fatMass'], adapted.metrics, undefined, adapted.bandInfo);
    expect(last!.range).toBeUndefined();
    expect(last!.members).toEqual({ attempted: 4, valid: 3, excluded: 1, reasons: ['modelLimit'] });
    // the serialized quantiles stay finite (compatibility storage), never NaN or Infinity
    expect(Array.from(b.p10.fatMass!).every(Number.isFinite)).toBe(true);
  });

  it('one aborted member: the valid members’ range is offered as such (never as the full ensemble’s)', () => {
    const members = stoppingMembers(STOP, 3);
    const b = ensembleBands({ fatMass: nominalFat }, result.initial, members);
    const adapted = buildResultsData({ result, bands: { p10: b.p10, p90: b.p90, bandMeta: b.bandMeta, bandDays: { fatMass: availability(members) }, draws: 4, total: 4 }, schedule: SCHEDULE, compiled });
    const [r] = computeReadouts(adapted.data, ['fatMass'], adapted.metrics, undefined, adapted.bandInfo);
    expect(r!.members).toEqual({ attempted: 4, valid: 3, excluded: 1, reasons: ['aborted'] });
    expect(readoutLine(r!)).toMatch(/ · 3 of 4 variations$/);
  });

  it('labelled scenario members keep their range around an estimated nominal and add the scenario word from their day', () => {
    const members = [{ fatMass: shifted(nominalFat, -1) }, { fatMass: shifted(nominalFat, 1) }];
    const b = ensembleBands({ fatMass: nominalFat }, result.initial, members);
    const bandDays = { fatMass: availability(members, { status: 'scenario', fromDay: 5 }) };
    const adapted = buildResultsData({ result, bands: { p10: b.p10, p90: b.p90, bandMeta: b.bandMeta, bandDays, draws: 2, total: 2 }, schedule: SCHEDULE, compiled });
    expect(adapted.metrics.get('fatMass')!.status).toBeUndefined();
    const [r] = computeReadouts(adapted.data, ['fatMass'], adapted.metrics, undefined, adapted.bandInfo);
    expect(r!.range).toBeDefined();
    expect(r!.rangeStatus).toBe('scenario');
    expect(r!.rangeKind).toBe('scenario');
    expect(readoutLine(r!)).toMatch(/, range .*, scenario$/);
    const [early] = computeReadouts(adapted.data, ['fatMass'], adapted.metrics, 2, adapted.bandInfo);
    expect(readoutLine(early!)).not.toMatch(/scenario/);
  });
});

// ------------------------------------------------------------------------------------------------ the actual screen

function sim(over: Partial<SimulationLike> = {}): SimulationLike {
  return { status: 'done', phase: null, progress: 1, result, bands: null, stale: false, hasResult: true, error: null, startedAt: 0, finishedAt: 1, resultHash: 'h-reaudit', runId: 1, ...over };
}

function mount(s: SimulationLike) {
  const screenEl = createElement(ResultsScreen, {
    scenarioId: 's1',
    scenarioName: 'Spring cut',
    sim: s,
    inputs: { profile: PROFILE, schedule: SCHEDULE },
    horizonDays: DAYS,
    prefs: { units: 'metric', energyUnit: 'kcal', glucoseUnit: 'mmol', showFigure: false, textures: false },
    scheduleHref: () => '/simulate/s1/schedule',
  });
  return render(createElement(MemoryRouter, { initialEntries: ['/simulate/s1/results'] }, createElement(Routes, null, createElement(Route, { path: '/simulate/:sid/results', element: screenEl }))));
}

async function copiedSummary(): Promise<string> {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy summary' }));
    await new Promise((r) => setTimeout(r, 10));
  });
  expect(writeText).toHaveBeenCalledTimes(1);
  return writeText.mock.calls[0]![0] as string;
}

describe('the ResultsScreen bridge carries band metadata and the per-day accounting (A1-049, A1-051)', () => {
  beforeEach(() => {
    useResultsUiStore.setState({ byScenario: {}, bandOpen: true, breakdownOpen: false });
    withSystemWrite(() => useSafetyStore.setState({ dangerAcks: {} }));
  });
  afterEach(() => cleanup());

  it('an all-stopped suffix (finite compatibility numbers, availability 0) copies no fat-mass range', async () => {
    const STOP = 10;
    const members = stoppingMembers(STOP);
    const b = ensembleBands({ fatMass: nominalFat }, result.initial, members);
    mount(sim({ bands: { p10: { fatMass: compatible(b.p10.fatMass!, STOP) }, p90: { fatMass: compatible(b.p90.fatMass!, STOP) }, drawsDone: 4, drawsTotal: 4, complete: true, bandMeta: b.bandMeta, bandDays: { fatMass: availability(members) } } }));
    const text = await copiedSummary();
    const line = text.split('\n').find((l) => l.startsWith('Fat mass:'))!;
    expect(line).toBeDefined();
    expect(line).not.toMatch(/range/);
  });

  it('an explicit method none copies no range for that channel (never the fixed fallback)', async () => {
    const sb = computeBands(result.daily, [{}], 1, result.initial);
    mount(sim({ bands: sb }));
    const text = await copiedSummary();
    const line = text.split('\n').find((l) => l.startsWith('Fat mass:'))!;
    expect(line).not.toMatch(/range/);
  });

  it('a stochastic range copies its own endpoints, not stretched to the nominal', async () => {
    const b = ensembleBands({ fatMass: nominalFat }, result.initial, [{ fatMass: shifted(nominalFat, -5) }, { fatMass: shifted(nominalFat, -3) }]);
    mount(sim({ bands: { p10: b.p10, p90: b.p90, drawsDone: 2, drawsTotal: 2, complete: true, bandMeta: b.bandMeta, bandDays: b.bandDays } }));
    const text = await copiedSummary();
    const line = text.split('\n').find((l) => l.startsWith('Fat mass:'))!;
    const m = /range ([\d.]+)–([\d.]+)/.exec(line)!;
    expect(Number(m[1])).toBeCloseTo(b.p10.fatMass![n - 1]!, 1);
    expect(Number(m[2])).toBeCloseTo(b.p90.fatMass![n - 1]!, 1);
    expect(Number(m[2])).toBeLessThan(nominalFat[n - 1]!);
  });
});

// ------------------------------------------------------------------------------------------------ A1-052

const LAB_PROFILE: PersonProfile = { ...PROFILE, labs: { ldlMmolL: 8.02, hdlMmolL: 1.3 } };
const short = (days: number): Schedule => ({ ...SCHEDULE, horizonDays: days, days: SCHEDULE.days.slice(0, days), blocks: [] });

function ldlLines(r: SimulationResult, sched: Schedule) {
  const adapted = buildResultsData({ result: r, schedule: sched, compiled: null });
  const ids = ['ldl', 'hdl', 'fatMass'];
  const [day0] = computeReadouts(adapted.data, ['ldl'], adapted.metrics, 0, adapted.bandInfo);
  const all = computeReadouts(adapted.data, ids, adapted.metrics, undefined, adapted.bandInfo);
  const text = summaryText({ title: 't', dateRange: 'd', days: r.meta.nDays, readouts: all, warnings: { danger: 0, caution: 0, titles: [] }, disclaimer: 'x' });
  return { adapted, day0: day0!, all, text };
}

describe('A1-052: an out-of-domain measured lab is observed only at t = 0', () => {
  it('real engine, LDL 8.02 mmol/L: day 0 and the end read Unsupported with the exact start; nothing numeric leaks', () => {
    const r = simulate(LAB_PROFILE, SCHEDULE, { record: 'full' });
    expect(r.initial.ldl).toBe(8.02);
    expect(r.meta.outputStatus?.ldl?.status).toBe('outOfDomain');
    // the first end-of-day sample is a modelled response, not the observation
    expect(r.daily.ldl![0]).not.toBe(8.02);
    const { adapted, day0, all, text } = ldlLines(r, SCHEDULE);
    expect(adapted.data.series.some((s) => s.id === 'ldl')).toBe(false);
    expect(day0.statusText).toBe('Unsupported');
    expect(day0.measuredStart).toBe(8.02);
    expect(readoutLine(day0)).toBe('LDL cholesterol: 8.02 mmol/L at start · Unsupported');
    expect(readoutLine(all[0]!)).toBe('LDL cholesterol: 8.02 mmol/L at start · Unsupported');
    expect(statusWordsOf(adapted.metrics).ldl).toBe('Unsupported');
    expect(text).toContain('LDL cholesterol: 8.02 mmol/L at start · Unsupported');
    expect(text.split('\n').filter((l) => l.startsWith('LDL cholesterol:'))).toEqual(['LDL cholesterol: 8.02 mmol/L at start · Unsupported']);
    // the in-domain lab and an unrelated outcome keep their readable estimates
    const hdl = all.find((x) => x.id === 'hdl')!;
    expect(hdl.statusText).toBeNull();
    expect(Number.isFinite(hdl.end)).toBe(true);
    const fat = all.find((x) => x.id === 'fatMass')!;
    expect(fat.statusText).toBeNull();
    expect(Number.isFinite(fat.end)).toBe(true);
  });

  it('a one-day horizon has no numeric LDL endpoint', () => {
    const sched = short(1);
    const r = simulate(LAB_PROFILE, sched, { record: 'full' });
    expect(r.meta.nDays).toBe(1);
    const { day0, text } = ldlLines(r, sched);
    expect(day0.statusText).toBe('Unsupported');
    expect(day0.measuredStart).toBe(8.02);
    expect(text.split('\n').filter((l) => l.startsWith('LDL cholesterol:'))).toEqual(['LDL cholesterol: 8.02 mmol/L at start · Unsupported']);
  });

  it('a resumed snapshot keeps the same distinction (the anchor stays the only observation)', () => {
    const base = simulate(LAB_PROFILE, SCHEDULE, { record: 'daily', captureSnapshotAt: [5] });
    const snap = base.snapshots?.[5];
    expect(snap).toBeDefined();
    const cont = simulate(LAB_PROFILE, SCHEDULE, { record: 'full', initialSnapshot: snap! });
    expect(cont.meta.outputStatus?.ldl?.status).toBe('outOfDomain');
    const { adapted, all } = ldlLines(cont, SCHEDULE);
    expect(adapted.data.series.some((s) => s.id === 'ldl')).toBe(false);
    const ldl = all.find((x) => x.id === 'ldl')!;
    expect(ldl.statusText).toBe('Unsupported');
    expect(ldl.measuredStart).toBe(8.02);
    const hdl = all.find((x) => x.id === 'hdl');
    if (hdl) expect(hdl.statusText).toBeNull();
  });
});
