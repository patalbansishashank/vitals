import { describe, expect, it } from 'vitest';
import type { ChartSeries } from '@/features/charts/types';
import type { SimWarning } from '@/engine';
import { computeReadout, readoutLine, summaryText } from '../lib/readouts';
import { chipText, dangerRules, daysText, groupWarnings, warningRemedy, warningTitle } from '../lib/warnings';
import { lanesWithFocus, parseResultsParams, writeResultsParams } from '../lib/urlState';
import { resultsState, runningText } from '../lib/status';
import { dateRange, dayLabel } from '../lib/format';
import { sanitizeResultsUi, useResultsUiStore, RESULTS_UI_KEY } from '../store';
import { getRegisteredStores } from '@/state/persistence';

function series(values: number[], opts: Partial<ChartSeries> & { lo?: number[]; hi?: number[] } = {}): ChartSeries {
  const { lo, hi, ...rest } = opts;
  return {
    id: 'fatMass',
    label: 'Fat mass',
    shortLabel: 'fat mass',
    unit: 'kg',
    category: 'body',
    direction: 'lower',
    grade: 'A',
    format: { decimals: 1 },
    daily: { values: new Float32Array(values), band: lo && hi ? { lo: new Float32Array(lo), hi: new Float32Array(hi) } : undefined },
    ...rest,
  };
}

describe('readouts', () => {
  it('computes start → end, change, likely range and wide ranges', () => {
    const r = computeReadout(series([24, 23, 22, 21], { baseline: 24.1, lo: [23.5, 22, 20, 20.2], hi: [24.5, 24, 23, 21.6] }));
    expect(r.start).toBeCloseTo(24.1);
    expect(r.end).toBe(21);
    expect(r.delta).toBeCloseTo(-3.1, 5);
    expect(r.range).toEqual([expect.closeTo(20.2, 5), expect.closeTo(21.6, 5)]);
    expect(r.wide).toBe(false);
    expect(r.pctChange).toBeCloseTo((-3.1 / 24.1) * 100, 4);
    expect(computeReadout(series([10, 10], { lo: [5, 5], hi: [15, 15] })).wide).toBe(true);
    expect(readoutLine(r)).toBe('Fat mass: 24.1 → 21.0 kg (−3.1 kg), likely 20.2–21.6');
  });

  it('reads a given day and skips trailing gaps of a run that stopped early', () => {
    const s = series([5, 6, 7, Number.NaN]);
    expect(computeReadout(s).end).toBe(7);
    expect(computeReadout(s, undefined, 1).end).toBe(6);
  });

  it('marks change-from-baseline readouts as relative', () => {
    const r = computeReadout(series([0, 0.1, 0.2], { id: 'ldl', label: 'LDL cholesterol', unit: 'mmol/L vs start', baseline: 0, format: { decimals: 2 } }), { presentation: 'deltaFromBaseline' });
    expect(r.relative).toBe(true);
    expect(Number.isNaN(r.pctChange)).toBe(true);
    expect(readoutLine(r)).toBe('LDL cholesterol: +0.20 mmol/L vs start');
  });

  it('writes a plain-text summary with warnings and the disclaimer', () => {
    const r = computeReadout(series([24, 21], { baseline: 24 }));
    const t = summaryText({ title: 'Spring cut', dateRange: '5 Oct → 27 Dec', days: 84, readouts: [r], warnings: { danger: 0, caution: 1, titles: ['Your deficit reaches 31 % of maintenance. (days 4–10)'] }, disclaimer: 'Not medical advice.' });
    expect(t.split('\n')[0]).toBe('Spring cut · 5 Oct → 27 Dec · 84 days');
    expect(t).toContain('Warnings: 1 caution');
    expect(t.trim().endsWith('Not medical advice.')).toBe(true);
  });
});

const W = (id: string, severity: SimWarning['severity'], startDay: number, endDay: number, peakValue = 0, message = 'Risk first. Then what to do.'): SimWarning => ({ id: id as SimWarning['id'], severity, startDay, endDay, peakValue, message, src: '17 §3' });

describe('warnings', () => {
  const list = [
    W('W-U01', 'info', 0, 83, 0, 'Projection for an average person with your inputs. Individual results vary.'),
    W('W-E03', 'caution', 10, 30, 31.4, 'Your deficit is 31% of maintenance. Above about 25% the model shows more muscle loss.'),
    W('W-M08', 'info', 3, 3),
    W('W-E02', 'danger', 20, 47, 640),
    W('W-F02', 'caution', 3, 4, 39),
    W('W-E02', 'danger', 60, 62, 700),
  ];
  const g = groupWarnings(list);

  it('groups by severity, earliest first, notes apart', () => {
    expect(g.danger.map((w) => w.startDay)).toEqual([20, 60]);
    expect(g.caution.map((w) => w.id)).toEqual(['W-F02', 'W-E03']);
    expect(g.info.map((w) => w.id)).toEqual(['W-M08']);
    expect(g.notes.map((w) => w.id)).toEqual(['W-U01']);
    expect(g.counts).toEqual({ danger: 2, caution: 2, info: 1 });
  });

  it('writes risk-first titles with the driving value and keeps the engine message as the body', () => {
    expect(warningTitle(list[1]!)).toBe('Your deficit reaches 31 % of maintenance.');
    // no duration re-derived from the range, no zero-intake hours printed as the fast length
    expect(warningTitle(list[3]!)).toBe('Under 800 kcal a day.');
    expect(warningTitle(list[4]!)).toBe('A fast of 24–48 h.');
    expect(warningTitle(W('W-F03', 'caution', 8, 10, 71))).toBe('A fast of 48–72 h.');
    // the engine's {n} weeks (floor of consecutive days / 7), not the range length rounded
    expect(warningTitle(W('W-E10', 'caution', 84, 90, 90))).toBe('A deficit of 15 % or more for 12 weeks.');
    expect(g.caution[1]!.body).toBe(list[1]!.message);
    // unknown rule: first sentence as the title, the rest as the body
    const unk = groupWarnings([W('W-Q99', 'caution', 0, 0, 0, 'Something specific happens. Here is what to do.')]).caution[0]!;
    expect(unk.title).toBe('Something specific happens.');
    expect(unk.body).toBe('Here is what to do.');
    expect(daysText(3, 3)).toBe('day 4');
    expect(daysText(3, 9)).toBe('days 4–10');
  });

  it('offers a one-tap remedy that jumps to the offending days', () => {
    expect(warningRemedy(list[1]!)).toEqual({ label: 'Adjust energy on days 11–31', startDay: 10, endDay: 30, ruleId: 'W-E03' });
    expect(warningRemedy(list[4]!)?.label).toBe('Shorten the fast on days 4–5');
    expect(warningRemedy(list[2]!)).toBeUndefined(); // info without a schedule remedy
    expect(warningRemedy(W('W-P01', 'danger', 0, 3))).toBeUndefined();
  });

  it('summarises for the toolbar chip and the danger gate', () => {
    expect(chipText(g.counts)).toEqual({ severity: 'danger', text: '2 dangers' });
    expect(chipText({ danger: 0, caution: 1, info: 4 })).toEqual({ severity: 'caution', text: '1 caution' });
    expect(chipText({ danger: 0, caution: 0, info: 4 })).toBeNull();
    const rules = dangerRules(list);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: 'W-E02', title: 'Under 800 kcal a day.' });
  });
});

describe('url state', () => {
  it('honours ?view=focus&m=<metricId> with loose ids', () => {
    expect(parseResultsParams(new URLSearchParams('view=focus&m=fat_mass'))).toEqual({ view: 'focus', metric: 'fatMass' });
    expect(parseResultsParams(new URLSearchParams('m=bhb'))).toEqual({ view: 'focus', metric: 'bhb' });
    expect(parseResultsParams(new URLSearchParams('view=focus&focus=ketosis_state'))).toEqual({ view: 'focus', metric: 'ketosisState' });
    expect(parseResultsParams(new URLSearchParams('view=overlay&z=28&xi=45&explain=ldl'))).toEqual({ view: 'overlay', zoom: 28, day: 45, explain: 'ldl' });
    expect(parseResultsParams(new URLSearchParams('view=pie&m=nope&z=3&xi=-1'))).toEqual({});
  });

  it('writes view, metric and explain back without dropping other params', () => {
    const next = writeResultsParams(new URLSearchParams('keep=1&focus=x'), { view: 'focus', metric: 'bhb', explain: 'ldl' });
    expect(next.toString()).toBe('keep=1&view=focus&m=bhb&explain=ldl');
    expect(writeResultsParams(next, { view: 'lanes' }).toString()).toBe('keep=1');
  });

  it('adds a deep-linked focus metric to the lanes', () => {
    const avail = new Set(['fatMass', 'bhb', 'ldl']);
    expect(lanesWithFocus(['fatMass'], 'ldl', avail)).toEqual(['fatMass', 'ldl']);
    expect(lanesWithFocus(['fatMass', 'ldl'], 'ldl', avail)).toEqual(['fatMass', 'ldl']);
    expect(lanesWithFocus(['fatMass'], 'nope', avail)).toEqual(['fatMass']);
  });
});

describe('state machine', () => {
  const base = { status: 'idle' as const, phase: null, hasResult: false, stale: false };
  it('covers never-run, first run, running, refining, stale, error and done', () => {
    expect(resultsState(base)).toEqual({ phase: 'never-run', chart: 'idle', hasChart: false });
    expect(resultsState({ ...base, status: 'running', phase: 'nominal' })).toEqual({ phase: 'first-run', chart: 'running', hasChart: false });
    expect(resultsState({ ...base, status: 'running', phase: 'nominal', hasResult: true, stale: true })).toEqual({ phase: 'running', chart: 'running', hasChart: true });
    expect(resultsState({ ...base, status: 'running', phase: 'ensemble', hasResult: true })).toEqual({ phase: 'refining', chart: 'idle', hasChart: true });
    expect(resultsState({ ...base, status: 'done', hasResult: true, stale: true })).toEqual({ phase: 'stale', chart: 'stale', hasChart: true });
    expect(resultsState({ ...base, status: 'error', hasResult: true })).toEqual({ phase: 'error', chart: 'stale', hasChart: true });
    expect(resultsState({ ...base, status: 'error' })).toEqual({ phase: 'error', chart: 'idle', hasChart: false });
    expect(resultsState({ ...base, status: 'cancelled', hasResult: true })).toEqual({ phase: 'done', chart: 'idle', hasChart: true });
    expect(resultsState({ ...base, status: 'done', hasResult: true })).toEqual({ phase: 'done', chart: 'idle', hasChart: true });
  });

  it('writes the toolbar status text', () => {
    expect(runningText('running', 1234)).toBe('Running · 1.2 s');
    expect(runningText('refining', 1234, 8, 32)).toBe('Refining ranges · 8/32');
    expect(runningText('done', null)).toBeUndefined();
  });
});

describe('labels', () => {
  it('formats day labels and ranges', () => {
    expect(dayLabel({ startDate: '2026-10-05' }, 83)).toBe('Sun 27 Dec · day 84');
    expect(dayLabel({}, 0)).toBe('day 1');
    expect(dateRange({ days: 84, startDate: '2026-10-05' })).toBe('5 Oct → 27 Dec');
  });
});

describe('results UI store', () => {
  it('persists lanes and pins per scenario and is registered for export', () => {
    const st = useResultsUiStore.getState();
    st.setLanes('s1', ['fatMass', 'bhb', 'fatMass']);
    st.togglePinned('s1', 'ldl');
    st.togglePinned('s1', 'hunger');
    st.togglePinned('s1', 'bhb');
    st.togglePinned('s1', 'vo2max');
    const p = useResultsUiStore.getState().byScenario.s1!;
    expect(p.laneIds).toEqual(['fatMass', 'bhb']);
    expect(p.pinned).toEqual(['hunger', 'bhb', 'vo2max']);
    st.togglePinned('s1', 'bhb');
    expect(useResultsUiStore.getState().byScenario.s1!.pinned).toEqual(['hunger', 'vo2max']);
    expect(getRegisteredStores().some((r) => r.key === RESULTS_UI_KEY)).toBe(true);
    expect(sanitizeResultsUi({ byScenario: { a: { laneIds: [1, 'x'] }, b: { laneIds: ['x', 'x'], pinned: ['a', 'b', 'c', 'd'] } } })).toEqual({
      byScenario: { a: {}, b: { laneIds: ['x'], pinned: ['a', 'b', 'c'] } },
      bandOpen: true,
      breakdownOpen: false,
    });
    st.forgetScenario('s1');
    expect(useResultsUiStore.getState().byScenario.s1).toBeUndefined();
  });
});
