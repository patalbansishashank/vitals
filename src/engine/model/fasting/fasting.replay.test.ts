// @vitest-environment node
/**
 * D2-01/D2-02 phase 0C: the fasting and cellular consumers checked with their providers in the whole engine. The realised
 * history arrives as observed (replayed) days, built the way the living reducer builds them (logged meals and a confirmed
 * "nothing eaten" day). The compiler (W0-core) turns fast events into policy metadata and observed windows. The loop reports
 * the named routing approximation and the causal resolution, and it captures and restores day-stamped snapshots. Every
 * comparison uses the same profile, parameters and seed. The probe module only reads the bus after the last real module and
 * changes nothing.
 */
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { defineModule } from '../../core/moduleKit';
import { MODULES } from '../../core/moduleRegistry';
import { buildModelParams } from '../../core/paramsRegistry';
import { resolveProfile } from '../../core/resolveProfile';
import { MAN } from '../../core/__tests__/fixtures';
import type { AnyEngineModule } from '../../types/module';
import type { EngineSnapshot, SimulationResult } from '../../types/result';
import type { DayObservationMeta, DayTemplate, FastEvent, MealSpec, Schedule } from '../../types/schedule';
import type { SignalName } from '../../types/signals';
import { CELLULAR_CAUSAL_RESOLUTION } from '../cellular';
import { COMPOSITION_CAUSAL_RESOLUTION } from '../composition';
import { ENERGY_CAUSAL_RESOLUTION } from '../energy';
import { FASTING_CAUSAL_RESOLUTION, FASTING_DAILY_NATIVE, FASTING_ROUTING, fastingModule } from './index';

const profile = resolveProfile(MAN);

// ------------------------------------------------------------------ realised history (observed days, C1/C2)

const OBS: DayObservationMeta = { coverage: { energy: 'complete', protein: 'complete' }, resolution: 'eventPrefix', historyHash: 'h-fast' };
const meal = (clockH: number, p: number, c: number, f: number): MealSpec => ({ clockH, energyKcal: 4 * p + 4 * c + 9 * f, macros: { proteinG: p, carbG: c, fatG: f } });
function logged(id: string, meals: MealSpec[]): DayTemplate {
  const g = (k: 'proteinG' | 'carbG' | 'fatG'): number => meals.reduce((a, m) => a + (m.macros?.[k] ?? 0), 0);
  return {
    id,
    label: id,
    energy: { kind: 'kcal', kcal: meals.reduce((a, m) => a + (m.energyKcal ?? 0), 0) },
    macros: { protein: { unit: 'g', value: g('proteinG') }, carbs: { unit: 'g', value: g('carbG') }, fat: { unit: 'g', value: g('fatG') } },
    meals: { meals },
    observed: OBS,
  };
}
const FED = logged('fed', [meal(8, 30, 70, 20), meal(13, 45, 100, 30), meal(19, 55, 90, 40)]);
/** The person's explicit "nothing eaten" (the living reducer's confirmed zero-intake day). */
const ZERO: DayTemplate = { id: 'zero', label: 'nothing eaten', energy: { kind: 'zero' }, macros: FED.macros, observed: OBS };
const REFEED = logged('refeed', [meal(19, 50, 120, 30)]);
/** The same refeed day with a 22:00 snack after the 19:00 meal. */
const REFEED_SNACK = logged('refeedSnack', [meal(19, 50, 120, 30), meal(22, 40, 150, 40)]);
const SNACK_HOUR = 4 * 24 + 22;
/** Dinner 19:00 on day 2, nothing on day 3, first meal 19:00 on day 4 (48 h meal to meal), logged days after it. */
const PATTERN = [0, 0, 0, 1, 2, 0, 0, 0];
const LAST_MEAL_HOUR = 2 * 24 + 19;
const REFEED_HOUR = 4 * 24 + 19;

function schedule(events: FastEvent[], refeed: DayTemplate = REFEED): Schedule {
  return {
    schemaVersion: 1,
    startDate: MAN.startDate!,
    horizonDays: PATTERN.length,
    programs: [FED, ZERO, refeed],
    days: PATTERN.map((program) => ({ program })),
    events,
    realised: { historyHash: 'h-fast', asOf: '2026-10-13T00:00:00Z', contractVersion: 1, throughDay: PATTERN.length },
  };
}
const fast = (durationH: number, extra: Partial<FastEvent> = {}): FastEvent => ({ kind: 'fast', startDay: 2, startH: 19, durationH, ...extra });

/** Fast metadata only: every variant replays the same realised intake. */
const VARIANTS: Record<string, FastEvent[]> = {
  none: [],
  'planned 23 h': [fast(23)],
  'planned 24 h (dinner to dinner)': [fast(24)],
  'planned 48 h': [fast(48)],
  'observed 48 h': [fast(48, { source: 'observed', eventId: 'fast-1' })],
  'interrupted planned 72 h': [fast(72)],
};

// ------------------------------------------------------------------ probe: fasting outputs, the intake-event clock, ASI

const PROBED = ['fastActive', 'fastHoursH', 'fastRmrMult', 'fastProtOxGH', 'fastRepletionGH', 'fastOedemaL', 'hoursSinceIntakeH', 'asiIdx'] as const satisfies readonly SignalName[];
const col = (n: (typeof PROBED)[number]): number => PROBED.indexOf(n);

function probe(rows: number[][]): AnyEngineModule {
  return defineModule<object>({
    id: 'probe' as never,
    specSection: 'test',
    dossiers: 'test',
    params: [],
    reads: [],
    writes: [],
    records: [],
    init: () => ({}),
    stepHour: (_s, _k, bus, _hour, _day, clock) => {
      if (clock.day >= 0) rows[clock.hourIndex] = PROBED.map((n) => bus[n]);
    },
  }) as unknown as AnyEngineModule;
}

interface Run {
  r: SimulationResult;
  /** Probed bus values by absolute plan hour (holes before a restored snapshot's day). */
  rows: number[][];
}
function run(s: Schedule, opts: { captureSnapshotAt?: number[]; initialSnapshot?: EngineSnapshot } = {}): Run {
  const rows: number[][] = [];
  const r = runEngine(profile, compileSchedule(s, profile), { record: 'full', collectEvents: true, collectWarnings: true, ...opts }, [...MODULES, probe(rows)]);
  return { r, rows };
}

/** Series (daily and hourly) whose values differ between two runs on days [from, nDays). */
function differing(a: SimulationResult, b: SimulationResult, from = 0): string[] {
  const out: string[] = [];
  const n = a.meta.nDays;
  for (const id of Object.keys(a.daily) as (keyof typeof a.daily)[]) {
    const x = a.daily[id]!;
    const y = b.daily[id]!;
    for (let i = from; i < n; i++)
      if (!Object.is(x[i], y[i])) {
        out.push(`daily:${id}`);
        break;
      }
  }
  for (const id of Object.keys(a.hourly) as (keyof typeof a.hourly)[]) {
    const x = a.hourly[id]!;
    const y = b.hourly[id]!;
    for (let i = from * 24; i < n * 24; i++)
      if (!Object.is(x[i], y[i])) {
        out.push(`hourly:${id}`);
        break;
      }
  }
  return out;
}

const base = run(schedule(VARIANTS.none!));

describe('D2-01 (0C): in the whole engine, future fast metadata never changes replayed physiology', () => {
  it('the realised fast is seen through observed intake only (the overlay starts 24 h after the last meal, ends at the refeed)', () => {
    const active = base.rows.map((x) => x[col('fastActive')]);
    expect(active.indexOf(1)).toBe(LAST_MEAL_HOUR + 24);
    expect(active.lastIndexOf(1)).toBe(REFEED_HOUR - 1);
    expect(base.rows[REFEED_HOUR - 1]![col('fastHoursH')]).toBe(REFEED_HOUR - 1 - LAST_MEAL_HOUR);
  });

  it.each(Object.keys(VARIANTS).filter((v) => v !== 'none'))('"%s" label: same realised intake ⇒ identical series and fasting outputs', (name) => {
    const v = run(schedule(VARIANTS[name]!));
    // the metadata really differs (the policy events follow the label) …
    expect(v.r.events.find((e) => e.type === 'fastStart')?.hour).not.toBe(base.r.events.find((e) => e.type === 'fastStart')?.hour);
    // … and nothing physiological does: no recorded series, fasting output, intake-event clock or research index value
    expect(differing(base.r, v.r)).toEqual([]);
    expect(v.rows).toEqual(base.rows);
    // only the fasting policy warnings (W-F…) may differ: the eating-window rule exempts a labelled fast day
    const other = (r: SimulationResult): string[] => r.warnings.map((w) => w.id).filter((id) => !id.startsWith('W-F'));
    expect(other(v.r)).toEqual(other(base.r));
  });

  it('the run reports the routing approximation by its declared name, and observed days make it daily resolution', () => {
    expect(base.r.meta.assumptions).toContain(FASTING_ROUTING.assumption);
    expect(base.r.meta.resolution).toBe('daily');
  });
});

describe('D2-01 (0C): a later meal on the same day, and the daily status it implies', () => {
  const snack = run(schedule([], REFEED_SNACK));
  const firstDiff = (j: number): number => base.rows.findIndex((x, h) => !Object.is(x[j], snack.rows[h]![j]));

  it('observed event values and the intake-event clock before the later meal are unchanged', () => {
    for (const n of ['fastActive', 'fastHoursH', 'hoursSinceIntakeH'] as const) {
      const d = firstDiff(col(n));
      expect(d === -1 || d >= SNACK_HOUR, n).toBe(true);
    }
    expect(snack.rows[SNACK_HOUR]![col('hoursSinceIntakeH')]).toBe(0); // ends in the hour of ingestion
  });

  it('every probed output that moves before the later meal is declared daily by its module (no within-day causal claim)', () => {
    const daily = new Set<string>([...FASTING_CAUSAL_RESOLUTION.signals, ...CELLULAR_CAUSAL_RESOLUTION.signals]);
    const early = PROBED.filter((n) => {
      const d = firstDiff(col(n));
      return d !== -1 && d < SNACK_HOUR;
    });
    for (const n of early) expect(daily.has(n), n).toBe(true);
    expect(FASTING_CAUSAL_RESOLUTION.nativeResolution).toBe('daily');
    expect(CELLULAR_CAUSAL_RESOLUTION.nativeResolution).toBe('daily');
  });

  it('upstream daily signals are declared daily-native by their writers (provider/consumer agreement)', () => {
    const upstream = new Set<string>([...ENERGY_CAUSAL_RESOLUTION.signals, ...COMPOSITION_CAUSAL_RESOLUTION.signals]);
    for (const n of [...FASTING_CAUSAL_RESOLUTION.upstreamDailySignals, ...CELLULAR_CAUSAL_RESOLUTION.upstreamDailySignals]) expect(upstream.has(n), n).toBe(true);
    for (const n of FASTING_CAUSAL_RESOLUTION.upstreamDailySignals) expect(fastingModule.reads as readonly string[]).toContain(n);
    expect(FASTING_CAUSAL_RESOLUTION.signals).toEqual(expect.arrayContaining(FASTING_DAILY_NATIVE.map((d) => d.signal)));
    expect(FASTING_CAUSAL_RESOLUTION.dailyInputs).toEqual(FASTING_DAILY_NATIVE[0]!.dayInputs);
    expect([...FASTING_CAUSAL_RESOLUTION.signals].sort()).toEqual([...fastingModule.writes].sort());
    expect(FASTING_CAUSAL_RESOLUTION.planMetadataReads).toEqual([]);
  });
});

describe('D2-01 (0C): resume, adopt and version through snapshots', () => {
  const capture = run(schedule(VARIANTS.none!), { captureSnapshotAt: [3, 4, 5] });

  it('restoring mid-fast (day 3), at the refeed (day 4) or after it continues bit-identically', () => {
    for (const k of [3, 4, 5]) {
      const cont = run(schedule(VARIANTS.none!), { initialSnapshot: capture.r.snapshots![k]! });
      expect(cont.r.meta.startDay).toBe(k);
      expect(differing(capture.r, cont.r, k)).toEqual([]);
      expect(cont.rows.slice(k * 24)).toEqual(capture.rows.slice(k * 24));
    }
  });

  it('a fast label adopted after the snapshot was taken resumes to the same physiology (the label is policy only)', () => {
    const labelled = run(schedule(VARIANTS['planned 48 h']!));
    const cont = run(schedule(VARIANTS['planned 48 h']!), { initialSnapshot: capture.r.snapshots![3]! });
    expect(differing(labelled.r, cont.r, 3)).toEqual([]);
    expect(cont.rows.slice(3 * 24)).toEqual(base.rows.slice(3 * 24));
  });

  it('the removed planned-span parameter is gone from the registry whose hash keys every snapshot', () => {
    expect(buildModelParams(MODULES).index.has('fasting.plannedMinSpanH')).toBe(false);
    expect(capture.r.snapshots![3]!.key.split('|')).toContain(capture.r.meta.registryHash);
  });
});
