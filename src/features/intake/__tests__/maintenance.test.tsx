/**
 * The maintenance card against the engine: the number, band and drivers it shows are `resolveProfile` output for the
 * stored body plus the activity answers; every "change" opens a question (v3: no "Correct it" sheet).
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { resolveActivity } from '@/engine/intake/activity';
import { BIGGEST_UNKNOWN_MIN_KCAL, estimateMaintenance, explainMaintenance, narrowingWith, round10 } from '@/features/body/maintenance';
import { buildPersonProfile, summarizeBody, withIntakeActivity } from '@/features/body/model';
import { DEFAULT_BODY, type BodyProfileValues } from '@/state/profileStore';
import { reduceActivity } from '../chapters/activity';
import { MaintenanceResult } from '../components/Maintenance';
import { DRIVER_LABEL } from '../copy';
import { DEFAULT_CONTEXT } from '../flow';
import { driverRows, maintenanceView } from '../maintenanceView';
import type { ChapterAnswers, TurnStatus } from '../types';
import { draftBodyValues } from '../useMaintenance';

const BODY: BodyProfileValues = { ...DEFAULT_BODY, sex: 'male', ageYears: 36, heightCm: 178, weightKg: 84.9, setup: 'done' };

function turns(values: Record<string, unknown>, skipped: string[] = []): ChapterAnswers {
  const status: Record<string, TurnStatus> = {};
  for (const k of Object.keys(values)) status[k] = 'answered';
  for (const k of skipped) status[k] = 'skipped';
  return { values, status };
}

const DESK = turns({
  work: 'yes',
  job: 'desk',
  workTime: { days: 5, hours: 8 },
  commute: 'ride',
  stepsKnown: 'no',
  offDay: 'mixed',
  home: 'some',
  sport: [],
  trainNow: '3-4',
  trainMix: 'lifting',
});

function live(answers: ChapterAnswers) {
  const r = reduceActivity(answers, DEFAULT_CONTEXT);
  const v = draftBodyValues(BODY, r, true);
  return { r, v, summary: summarizeBody(v) };
}

describe('maintenance from the engine', () => {
  it('shows resolveProfile’s TDEE0, its p10/p90 band and drivers that sum to it', () => {
    const { v, summary } = live(DESK);
    const resolved = resolveProfile(buildPersonProfile(v));
    const m = summary.maintenance;
    expect(m.kcal).toBeCloseTo(resolved.tdee0Kcal, 6);
    expect(resolved.activity?.source).toBe('intake');
    expect(m.band80[0]).toBeCloseTo(resolved.activity!.uncertainty.p10, 6);
    expect(m.band80[1]).toBeCloseTo(resolved.activity!.uncertainty.p90, 6);
    expect(m.drivers.reduce((a, d) => a + d.kcal, 0)).toBeCloseTo(m.kcal, 3);
    // the answers reach the engine: desk work 5 × 8 h, 4 sessions a week
    expect(resolved.activity?.work).toBe('desk');
    expect(resolved.habits.sessionsPerWeek).toBe(4);
  });

  it('a heavier job raises maintenance; the what-if is the closed form on the same base', () => {
    const desk = live(DESK).summary.maintenance;
    const heavy = live({ ...DESK, values: { ...DESK.values, job: 'manualHeavy' } }).summary.maintenance;
    expect(heavy.kcal).toBeGreaterThan(desk.kcal + 200);
    const whatIf = resolveActivity({ ...desk.resolved.habits.activity, work: 'manualHeavy' }, desk.activity!.base);
    expect(Math.abs(whatIf.tdee0Kcal - heavy.kcal) / heavy.kcal).toBeLessThan(0.01);
  });

  it('without answers the profile keeps its pre-intake maintenance (and the merge is a no-op)', () => {
    const r = reduceActivity({ values: {}, status: {} }, DEFAULT_CONTEXT);
    expect(draftBodyValues(BODY, r, true)).toEqual(BODY);
    expect(withIntakeActivity(BODY, undefined)).toBe(BODY);
    expect(summarizeBody(BODY).maintenance.activity?.source).toBe('default');
  });

  it('the intake document’s activity (minus its turns) is what Your body merges', () => {
    const r = reduceActivity(DESK, DEFAULT_CONTEXT);
    const merged = withIntakeActivity(BODY, { ...r.activity!, turns: DESK });
    expect(merged.habits.activity).toEqual(r.activity);
    expect(estimateMaintenance(buildPersonProfile(merged)).activity?.source).toBe('intake');
  });
});

describe('what the card says', () => {
  it('states the biggest unknown in the unit its number is in (kJ mode said "±310 kcal" for a kJ figure)', () => {
    const { r, summary } = live(DESK);
    const kc = maintenanceView(summary.maintenance, summary.maintenance.resolved.habits.activity, r.defaulted, 'kcal');
    const kj = maintenanceView(summary.maintenance, summary.maintenance.resolved.habits.activity, r.defaulted, 'kJ');
    expect(kc.unknownText).toMatch(/±[\d\s\u2009]+ kcal\.$/);
    expect(kj.unknownText).toMatch(/±[\d\s\u2009]+ kJ\.$/);
    expect(kj.unknownText).not.toMatch(/kcal/);
  });
  it('rounds to 10 kcal, lists the drivers in the fixed order and omits zero parts', () => {
    const { r, summary } = live(DESK);
    const view = maintenanceView(summary.maintenance, summary.maintenance.resolved.habits.activity, r.defaulted, 'kcal');
    expect(view.headline).toMatch(/^about [\d\s]+ kcal a day — likely [\d\s]+–[\d\s]+$/);
    const kcal = Number(view.kcal.replace(/\D/g, ''));
    expect(kcal % 10).toBe(0);
    expect(kcal).toBe(round10(summary.maintenance.kcal));
    const order = ['rmr', 'dailyLiving', 'steps', 'work', 'home', 'commute', 'recreation', 'training', 'digestion'];
    const shown = view.rows.map((x) => x.id);
    expect(shown).toEqual(order.filter((id) => shown.includes(id as never)));
    // passive commute and no sport: zero parts are omitted
    expect(shown).not.toContain('commute');
    expect(shown).not.toContain('recreation');
    expect(view.rows.map((x) => x.label)).toContain(DRIVER_LABEL.rmr);
    expect(view.comparison).toMatch(/^Similar to people described as "(inactive|low active|active|very active)"\.$/);
  });

  it('marks parts that rest on skipped answers as assumed', () => {
    const answers = turns({ work: 'yes', job: 'desk' }, ['stepsKnown', 'home']);
    const { r, summary } = live(answers);
    const rows = driverRows(summary.maintenance, r.defaulted);
    expect(rows.find((x) => x.id === 'steps')?.assumed).toBe(true);
    expect(rows.find((x) => x.id === 'home')?.assumed).toBe(true);
    expect(rows.find((x) => x.id === 'rmr')?.assumed).toBe(false);
  });

  it('offers the biggest unknown only when fixing it narrows the range by at least 20 kcal', () => {
    const guess = live(DESK).summary.maintenance;
    const ex = explainMaintenance(guess, guess.resolved.habits.activity);
    expect(ex.biggestUnknown).toBeDefined();
    expect(ex.biggestUnknown!.narrowsByKcal).toBeGreaterThanOrEqual(BIGGEST_UNKNOWN_MIN_KCAL);
    // a wrist average for steps leaves nothing to gain there
    const wrist = live({ ...DESK, values: { ...DESK.values, stepsKnown: 'wrist', stepsNumber: { mean: 6500 } } }).summary.maintenance;
    expect(narrowingWith('steps', wrist.activity!, wrist.resolved.habits.activity)).toBe(0);
    expect(narrowingWith('home', wrist.activity!, wrist.resolved.habits.activity)).toBe(0);
  });

  it('renders the readout, the driver table and the lines; every "change" names a question and nothing opens a sheet', () => {
    const { r, summary } = live(DESK);
    const m = summary.maintenance;
    const view = maintenanceView(m, m.resolved.habits.activity, r.defaulted, 'kcal');
    const onChangeAnswer = vi.fn();
    render(<MaintenanceResult m={m} view={view} unit="kcal" onChangeAnswer={onChangeAnswer} />);
    expect(screen.getByRole('heading', { name: 'Your maintenance' })).toBeInTheDocument();
    const table = screen.getAllByRole('table')[0]!;
    expect(within(table).getByRole('rowheader', { name: 'resting metabolism' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'digesting food' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'training' })).toBeInTheDocument();
    expect(screen.getByText(/This is a starting estimate/)).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'Change: steps' }));
    expect(onChangeAnswer).toHaveBeenCalledWith('stepsKnown');
    // resting metabolism: the measured-energy question (no sheet, no "Correct it")
    fireEvent.click(within(table).getByRole('button', { name: 'Change: resting metabolism' }));
    expect(onChangeAnswer).toHaveBeenLastCalledWith('measuredEver');
    expect(screen.queryByRole('button', { name: 'Correct it' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.lm-panel, .lm-sheet, [role="dialog"]')).toBeNull();
  });

  it('says what a measured figure does: a breath-test resting value is used, a calculator figure is shown only', () => {
    const { r, summary } = live(DESK);
    const m = summary.maintenance;
    const view = maintenanceView(m, m.resolved.habits.activity, r.defaulted, 'kcal');
    const { rerender } = render(<MaintenanceResult m={m} view={view} unit="kcal" onChangeAnswer={() => undefined} measured={{ kind: 'rmr', value: 1720, unit: 'kcal', method: 'calculator', date: '2026-03' }} />);
    expect(screen.getByText('Your measurement: 1 720 kcal resting · calculator · Mar 2026 · ' + "shown, not used: this method estimates, it doesn't measure")).toBeInTheDocument();
    // the engine's route decides "used": a measured RMR on the profile
    const measuredBody = summarizeBody({ ...draftBodyValues(BODY, r, true), labs: { measuredRmrKcal: 1720 } }).maintenance;
    rerender(<MaintenanceResult m={measuredBody} view={view} unit="kcal" onChangeAnswer={() => undefined} measured={{ kind: 'rmr', value: 1720, unit: 'kcal', method: 'metabolic_cart' }} />);
    expect(screen.getByText(/breath test · used as your resting energy$/)).toBeInTheDocument();
  });

  it('gentle mode: no kcal until "show numbers"', () => {
    const { r, summary } = live(DESK);
    const m = summary.maintenance;
    const view = maintenanceView(m, m.resolved.habits.activity, r.defaulted, 'kcal');
    render(<MaintenanceResult m={m} view={view} unit="kcal" quiet onChangeAnswer={() => undefined} />);
    expect(screen.getByText(/Set from your answers/)).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'kcal a day' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'show numbers' }));
    expect(screen.getAllByRole('columnheader', { name: 'kcal a day' }).length).toBeGreaterThan(0);
  });
});
