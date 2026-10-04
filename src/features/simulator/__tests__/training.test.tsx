/**
 * Training as usual by default (QA ruling R-DETRAIN part 2, release check 2026-10-01): new programs and the starter
 * scenario train the user's habitual sessions; composition presets inherit it, training presets bring their own; the
 * v1 → v2 store migration; the day editor's "as usual / custom / none" choice; calendar, key and summary labels.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileSchedule, resolveProfile } from '@/engine';
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import {
  SCENARIOS_KEY,
  migrateScenarios,
  resetScheduleStore,
  useScheduleStore,
  type Scenario,
} from '@/state/scheduleStore';
import { useSettingsStore } from '@/state/settingsStore';
import { DayEditor } from '../components/DayEditor';
import { ProgramTray } from '../components/ProgramTray';
import { ScheduleRaster, type ScheduleRasterProps } from '../components/ScheduleRaster';
import { SummaryStrip } from '../components/SummaryStrip';
import { PRESETS, PRESET_BY_ID, STARTERS, programFromPreset, starterSchedule } from '../presets';
import { habitualTraining, trainingMode, trainingSourceText, withTrainingMode } from '../lib/training';
import { buildScheduleModel } from '../useScheduleModel';
import { A, B, MAN, schedule } from './fixtures';

/** A habitual lifter: 3 sessions a week, all lifting. */
const LIFTER: PersonProfile = { ...MAN, habits: { sessionsPerWeek: 3, lifingCardioMix: 0, trainingHistory: 'gt3y' } };
const RPL = resolveProfile(LIFTER);

const S = () => useScheduleStore.getState();

beforeEach(() => {
  localStorage.clear();
  resetScheduleStore('2026-09-30');
});
afterEach(() => {
  act(() => useSettingsStore.getState().set({ energyUnit: 'kcal' }));
});

describe('presets and starters', () => {
  it('composition presets keep their macro definitions and inherit "as usual"; training presets bring sessions', () => {
    for (const p of PRESETS) {
      const t = programFromPreset(p.id, 'A');
      // the composition is exactly the preset's
      expect(t.energy).toEqual(p.template.energy);
      expect(t.macros).toEqual(p.template.macros);
      expect(t.meals).toEqual(p.template.meals);
      if (p.aboutTraining) {
        expect(trainingMode(t)).toBe('custom');
        expect(t.exercise).toEqual(p.template.exercise);
      } else {
        expect(trainingMode(t)).toBe('habitual');
        expect(t.habitualTraining).toBe(true);
      }
    }
    expect(PRESET_BY_ID.trainingSurplus.aboutTraining).toBe(true);
    expect(PRESET_BY_ID.hpDeficit.aboutTraining).toBeUndefined();
  });

  it('starters train as usual unless the starter is a training plan', () => {
    const modes = Object.fromEntries(
      STARTERS.map((st) => [st.id, st.programs.map((p) => trainingMode(p))]),
    );
    expect(modes.deficit12).toEqual(['habitual']);
    expect(modes.blank).toEqual(['habitual']);
    expect(modes.weeklyFast6).toEqual(['habitual', 'habitual']);
    expect(modes.maintenance8).toEqual(['custom', 'none']);
  });

  it('the starter keeps a habitual lifter lifting: 3 sessions a week, no activity adjustment', () => {
    const s = starterSchedule('deficit12', '2026-10-05', 0);
    const c = compileSchedule(s, RPL);
    const week = c.days.slice(0, 7);
    const lifts = week.reduce((a, d) => a + d.sessions.slice(0, d.nSessions).filter((x) => x.kind === 'resistance').length, 0);
    expect(lifts).toBe(3);
    expect(week.every((d) => d.habitualTraining === true)).toBe(true);
    // training as usual = the habitual week: maintenance needs no adjustment for it (R-MAINT)
    for (const d of c.days) expect(Math.abs(d.activityDeltaKcal ?? 0)).toBeLessThan(1);
  });
});

describe('store: new programs and the starter scenario', () => {
  it('the initial scenario and every new composition program default to training as usual', () => {
    const sc = S().scenarios[0]!;
    expect(sc.schedule.programs.every((p) => trainingMode(p) === 'habitual')).toBe(true);
    const idx = S().addProgram(sc.id, 'balanced');
    expect(trainingMode(S().scenarios[0]!.schedule.programs[idx]!)).toBe('habitual');
    const j = S().addProgram(sc.id, 'trainingMaintenance');
    expect(trainingMode(S().scenarios[0]!.schedule.programs[j]!)).toBe('custom');
    // a new blank scenario too
    const sid = S().createScenario({ starter: 'blank' });
    expect(S().scenarios.find((x) => x.id === sid)!.schedule.programs[0]!.habitualTraining).toBe(true);
  });

  it('a schedule handed in (Planner plan) keeps its rest days as explicit "no training"', () => {
    const sid = S().createScenario({ name: 'Plan B', schedule: schedule(14, [0, 1]), provenance: 'from Plan B' });
    const [a, b] = S().scenarios.find((x) => x.id === sid)!.schedule.programs;
    expect(trainingMode(a!)).toBe('custom');
    expect(trainingMode(b!)).toBe('none');
    expect(b!.habitualTraining).toBe(false);
  });

  it('switching one day to "none" is an override; the program stays as usual', () => {
    const sid = S().scenarios[0]!.id;
    S().editDays(sid, [2], (t) => withTrainingMode(t, 'none'));
    const sc = S().scenarios[0]!.schedule;
    expect(sc.days[2]!.override).toEqual({ habitualTraining: false });
    expect(sc.programs[0]!.habitualTraining).toBe(true);
    const c = compileSchedule(sc, RPL);
    expect(c.days[2]!.nSessions).toBe(0);
  });

  it('deloading a week halves the usual sessions of the days that lift as usual', () => {
    const sid = S().scenarios[0]!.id;
    const h = habitualTraining(RPL);
    S().deloadWeek(sid, 0, h.byWeekday);
    const sc = S().scenarios[0]!.schedule;
    const lifted = sc.days.slice(0, 7).filter((d) => d.override);
    expect(lifted).toHaveLength(3);
    for (const d of lifted) {
      expect(d.override!.habitualTraining).toBe(false);
      expect(d.override!.exercise![0]!.kind).toBe('resistance');
      expect(d.override!.exercise![0]!.durationMin).toBe(30);
    }
  });
});

describe('store migration v1 → v2', () => {
  const t0 = '2026-09-20T10:00:00.000Z';
  const v1 = (id: string, programs: DayTemplate[], extra: Partial<Scenario> = {}): Scenario => ({
    id,
    name: id,
    createdAt: t0,
    updatedAt: '2026-09-21T10:00:00.000Z',
    started: true,
    schedule: schedule(14, programs.map((_, i) => i), programs),
    ...extra,
  });
  const noEx = (id: string): DayTemplate => ({ ...structuredClone(B), id });

  it('programs with no sessions and never-set training become "as usual" when the scenario trains nowhere', () => {
    const out = migrateScenarios({ scenarios: [v1('diet', [noEx('A'), noEx('B')])], activeId: 'diet' }, 1) as {
      scenarios: Scenario[];
    };
    expect(out.scenarios[0]!.schedule.programs.map((p) => trainingMode(p))).toEqual(['habitual', 'habitual']);
  });

  it('explicit choices stay: sessions stay custom, removed sessions stay none, rest days of a training plan stay rest', () => {
    const explicitNone: DayTemplate = { ...noEx('C'), exercise: [] };
    const out = migrateScenarios({ scenarios: [v1('plan', [structuredClone(A), noEx('B'), explicitNone])] }, 1) as {
      scenarios: Scenario[];
    };
    const [a, b, c] = out.scenarios[0]!.schedule.programs;
    expect(a!.exercise).toEqual(A.exercise);
    expect(trainingMode(a!)).toBe('custom');
    expect(trainingMode(b!)).toBe('none');
    expect(trainingMode(c!)).toBe('none');
    // a lone explicit "none" in a scenario without sessions is kept too
    const out2 = migrateScenarios({ scenarios: [v1('x', [explicitNone])] }, 1) as { scenarios: Scenario[] };
    expect(trainingMode(out2.scenarios[0]!.schedule.programs[0]!)).toBe('none');
  });

  it('plans opened from the Planner keep days without sessions as rest days', () => {
    const out = migrateScenarios({ scenarios: [v1('p', [noEx('A')], { provenance: 'from Plan A · 30 Sep' })] }, 1) as {
      scenarios: Scenario[];
    };
    expect(trainingMode(out.scenarios[0]!.schedule.programs[0]!)).toBe('none');
  });

  it('rebuilds the untouched default scenario from the new starter, and is idempotent', () => {
    const old = starterSchedule('blank', '2026-10-05', 0);
    const untouched: Scenario = { ...v1('starter', []), name: 'Moderate deficit', updatedAt: t0, schedule: old };
    const out = migrateScenarios({ scenarios: [untouched] }, 1) as { scenarios: Scenario[] };
    expect(out.scenarios[0]!.schedule).toEqual(starterSchedule('deficit12', '2026-10-05', 0));
    expect(migrateScenarios(out, 1)).toEqual(out);
    expect(migrateScenarios(out, 2)).toBe(out);
  });

  it('runs on rehydrate from a v1 localStorage entry', async () => {
    const saved = { state: { scenarios: [v1('diet', [noEx('A')])], activeId: 'diet' }, version: 1 };
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(saved));
    await useScheduleStore.persist.rehydrate();
    expect(S().scenarios[0]!.schedule.programs[0]!.habitualTraining).toBe(true);
    expect(JSON.parse(localStorage.getItem(SCENARIOS_KEY)!).version).toBe(2);
  });
});

describe('labels: calendar, program keys, summary and day editor', () => {
  const model = () => buildScheduleModel(starterSchedule('deficit12', '2026-10-05', 0), RPL);

  it('calendar cells mark usual training and say so', () => {
    const m = model();
    const props: ScheduleRasterProps = {
      model: m,
      armed: null,
      selection: new Set([0]),
      anchor: 0,
      focusDay: 0,
      editorDay: null,
      onSelect: vi.fn(),
      onFocusDay: vi.fn(),
      onOpenDay: vi.fn(),
      onPaint: vi.fn(),
      onStrokeEnd: vi.fn(),
      onCommand: vi.fn(),
      onSelectPhase: vi.fn(),
    };
    const { container } = render(<ScheduleRaster {...props} />);
    const liftDays = m.cells.filter((c) => c.lift);
    expect(liftDays.length).toBe(36); // 3 a week for 12 weeks
    expect(liftDays.every((c) => c.training === 'habitual')).toBe(true);
    expect(liftDays[0]!.ariaLabel).toMatch(/lifting \(as usual\)/);
    const rest = m.cells.find((c) => !c.lift)!;
    expect(rest.ariaLabel).toMatch(/rest day of your usual week/);
    expect(container.querySelectorAll('.sim-cell__train[data-source="habitual"]')).toHaveLength(36);
  });

  it('program keys and the summary strip name the training source (kcal or kJ)', () => {
    const m = model();
    render(
      <ProgramTray
        programs={m.schedule.programs}
        resolved={RPL}
        maintKcal={m.programMaintKcal}
        usage={m.usage}
        armed={null}
        onArm={vi.fn()}
        onEdit={vi.fn()}
        onAdd={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const key = screen.getByRole('radio', { name: /^Program A/ });
    expect(key).toHaveAccessibleName(expect.stringContaining('training as usual (from Your body: 3 sessions/week · 3 lifting)'));
    expect(within(key).getByText('as usual')).toBeInTheDocument();
    expect(trainingSourceText('habitual', m.habitual)).toBe('as usual (from Your body: 3 sessions/week · 3 lifting)');

    const { container, rerender } = render(<SummaryStrip model={m} focusDay={0} />);
    const src = container.querySelector('.sim-summary__src')!;
    expect(src).toHaveAttribute('data-source', 'habitual');
    expect(src.textContent).toBe('as usual · from Your body: 3 sessions/week · 3 lifting');
    expect(container.textContent).toMatch(/kcal\/d/);
    act(() => useSettingsStore.getState().set({ energyUnit: 'kJ' }));
    rerender(<SummaryStrip model={m} focusDay={0} />);
    expect(container.textContent).toMatch(/kJ\/d/);
    expect(container.textContent).not.toMatch(/kcal/);
  });

  it('the summary names a mix of sources by days', () => {
    const s: Schedule = starterSchedule('deficit12', '2026-10-05', 0);
    s.programs.push(withTrainingMode<DayTemplate>({ ...structuredClone(B), id: 'B' }, 'none'));
    s.days[5] = { program: 1 };
    s.days[6] = { program: 1 };
    const { container } = render(<SummaryStrip model={buildScheduleModel(s, RPL)} focusDay={0} />);
    expect(container.querySelector('.sim-summary__src')!.textContent).toBe('as usual 5 d · none 2 d');
  });

  it('the day editor offers as usual / custom / none and lists the usual sessions read-only', () => {
    const sid = S().scenarios[0]!.id;
    const m = buildScheduleModel(S().scenarios[0]!.schedule, RPL);
    render(<DayEditor sid={sid} model={m} target={{ day: null, program: 0 }} scope="all" onScope={vi.fn()} onNavigate={vi.fn()} />);
    const bank = screen.getByRole('radiogroup', { name: 'Training' });
    expect(within(bank).getByRole('radio', { name: 'as usual' })).toBeChecked();
    expect(screen.getByText('from Your body: 3 sessions/week · 3 lifting')).toBeInTheDocument();
    const usual = screen.getByRole('group', { name: 'Your usual training (read-only)' });
    expect(within(usual).getAllByRole('listitem')).toHaveLength(3);
    expect(usual.textContent).toMatch(/≈ [\d\u00a0]+\u2009kcal of exercise a week, already inside your maintenance/);
    fireEvent.click(within(bank).getByRole('radio', { name: 'none' }));
    const p = S().scenarios[0]!.schedule.programs[0]!;
    expect(p.habitualTraining).toBe(false);
    expect(p.exercise).toEqual([]);
  });
});
