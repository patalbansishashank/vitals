/** The summary lines (design §6.6, §8): a skipped chapter says what the plans use; deferred questions point to Your setup. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyMarkersDoc, type MarkerReading, type MarkersDoc } from '@/markers/types';
import { CHAPTER_QUESTIONS } from '../chapters';
import { SUMMARY, TURN } from '../copy';
import { DEFAULT_CONTEXT, skipChapter, type FlowState } from '../flow';
import { chapterLine, chapterRows } from '../summary';
import { EMPTY_INTAKE, type IntakeDoc } from '../types';

let markers: MarkersDoc | null = null;
vi.mock('../chapters/markersStore', () => ({ readMarkersDoc: () => markers }));
afterEach(() => {
  markers = null;
});

const ctx = DEFAULT_CONTEXT;

function docWithTraining(turns: object): IntakeDoc {
  return { ...EMPTY_INTAKE, training: { turns } } as unknown as IntakeDoc;
}

describe('chapterLine', () => {
  it('is null for a chapter nobody has touched', () => {
    expect(chapterLine('training', EMPTY_INTAKE, ctx)).toBeNull();
  });

  it('says what the plans use for a skipped chapter, marked as asked later', () => {
    const start: FlowState = { answers: { values: {}, status: {} }, reopened: null };
    const skipped = skipChapter(CHAPTER_QUESTIONS.training, start, ctx);
    const line = chapterLine('training', docWithTraining(skipped.answers), ctx);
    expect(line).not.toBeNull();
    expect(line).toMatch(/^using .* · asked later$/);
    expect(line).not.toBe(SUMMARY.notAnswered);
    expect(TURN.usingLater('x')).toBe('using x · asked later');
  });

  it('counts asked-later questions in plain words (the row is hidden when there are none)', () => {
    expect(SUMMARY.askedLaterValue(3)).toBe('3 questions');
    expect(SUMMARY.askedLaterValue(1)).toBe('1 question');
  });
});

const reading = (id: MarkerReading['id'], value: number, unit: string, date: string): MarkerReading => ({
  id,
  value,
  unit,
  valueCanonical: value,
  unitCanonical: unit,
  date,
  provenance: 'manual',
  confirmed: true,
  enteredAt: `${date}T08:00:00.000Z`,
});

const answered = (values: Record<string, unknown>) => ({ values, status: Object.fromEntries(Object.keys(values).map((k) => [k, 'answered'])) });
/** Values under a label, with the no-break spaces of formatted numbers read as plain spaces. */
const get = (rows: ReturnType<typeof chapterRows>, label: string) => rows?.filter((r) => r.label === label).map((r) => r.value.replace(/\s/g, ' '));

describe('chapterRows: one labelled row per answer', () => {
  it('is null for a part nobody has touched', () => {
    for (const c of ['activity', 'training', 'food', 'markers', 'devices'] as const) expect(chapterRows(c, EMPTY_INTAKE, ctx)).toBeNull();
  });

  it('a normal day: steps, time on your feet, exercise and the energy line, each under its own label', () => {
    const doc = {
      ...EMPTY_INTAKE,
      activity: { turns: { ...answered({ work: 'no', stepsKnown: 'roughly', stepsRough: 2100, offDay: 'mixed', home: 'some', sport: [], trainNow: 'sometimes', 'meta.india': false, 'meta.gentle': false, 'meta.stepDevice': false }) } },
    } as unknown as IntakeDoc;
    const rows = chapterRows('activity', doc, ctx, { energy: 'about 2 460 kcal a day — likely 2 150–2 780' })!;
    expect(get(rows, 'steps, roughly')).toEqual(['about 2 100 a day']);
    expect(get(rows, 'on your feet at home')).toEqual(['some (1–2 h)']);
    expect(get(rows, 'energy you burn')).toEqual(['about 2 460 kcal a day — likely 2 150–2 780']);
    // every row has a label and a value, none is a joined line of unlabelled values
    expect(rows.every((r) => r.label && r.value && !r.value.startsWith(' ·'))).toBe(true);
    expect(chapterRows('activity', doc, ctx, { energy: null })!.some((r) => r.label === 'energy you burn')).toBe(false);
  });

  it('training: every equipment item is listed (no "+N"), the sessions and the time of day are two rows', () => {
    const owned = ['band_mini', 'band_tube', 'band_loop_long', 'pullup_bar', 'dumbbell', 'kettlebell'];
    const doc = docWithTraining(answered({ where: ['home'], kit: { owned, custom: ['sandbag'] }, time: { days: 3, minutes: 30, best: 'any' }, injuries: { parts: ['shoulder'], cleared: [] }, wontDo: [] }));
    const rows = chapterRows('training', doc, ctx)!;
    const kit = get(rows, 'equipment at home')![0]!;
    expect(kit).not.toMatch(/\+\d/);
    expect(kit.split(', ')).toHaveLength(owned.length + 1);
    expect(kit).toContain('sandbag');
    expect(get(rows, 'sessions')).toEqual(['3 a week, 30 min each']);
    expect(get(rows, 'time of day')).toEqual(['any time']);
    expect(get(rows, 'pain or injury')).toEqual(['shoulder']);
    expect(get(rows, 'where')).toEqual(['home']);
  });

  it('a question asked later reads "using … · asked later" under its own label', () => {
    const start: FlowState = { answers: { values: {}, status: {} }, reopened: null };
    const skipped = skipChapter(CHAPTER_QUESTIONS.training, start, ctx);
    const rows = chapterRows('training', docWithTraining(skipped.answers), ctx)!;
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.every((r) => r.later && /^using .* · asked later$/.test(r.value))).toBe(true);
  });

  it('food: labels name the question (what you eat, cooking time, supplements) and supplements are listed one by one', () => {
    const doc = {
      ...EMPTY_INTAKE,
      diet: { rulesComplete: false, turns: answered({ cooks: 'self', mealTime: '10to20', supplements: 'taking', taking: [{ supplementId: 'creatine', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['morning'] }, { supplementId: 'whey', state: 'onHand', timesOfDay: [] }] }) },
    } as unknown as IntakeDoc;
    const rows = chapterRows('food', doc, ctx)!;
    expect(rows[0]).toEqual({ label: 'recipes', value: expect.stringMatching(/paused/) });
    expect(get(rows, 'cooking time')).toEqual(['10–20 min']);
    expect(get(rows, 'supplements')).toEqual(['I already take some']);
    expect(rows.find((r) => r.value === '5 g · morning')).toBeTruthy();
    expect(rows.find((r) => r.value === 'at home, not taking')).toBeTruthy();
  });

  it('blood markers: skipped says so and keeps the saved values by name, value and date', () => {
    markers = { ...emptyMarkersDoc(), chapter: 'skipped', readings: [reading('ldl', 192, 'mg/dL', '2026-09-14'), reading('hdl', 41, 'mg/dL', '2026-09-14'), reading('hba1c', 5.6, '%', '2026-09-14')] };
    const rows = chapterRows('markers', EMPTY_INTAKE, ctx, { dateStyle: 'day-month' })!;
    expect(rows[0]).toEqual({ label: 'status', value: 'skipped this time; 3 values you saved before still count in your plan' });
    const lipids = rows.find((r) => r.label === 'lipids')!;
    expect(lipids.value).toMatch(/LDL 192/);
    expect(lipids.value).toMatch(/HDL 41/);
    expect(lipids.value).toMatch(/14 Sep 2026$/);
    expect(rows.find((r) => r.label === 'sugar')!.value).toMatch(/5\.6/);
    markers = { ...emptyMarkersDoc(), chapter: 'skipped' };
    expect(chapterRows('markers', EMPTY_INTAKE, ctx)).toEqual([{ label: 'status', value: 'skipped this time' }]);
  });

  it('devices: each device with its model, the phone, what comes in, the plan and what the Coach sees', () => {
    const streams = [
      { stream: 'sleep_sessions', imported: true, scores: true, engine: true, coach: 'daily+series' },
      { stream: 'heart_rate', imported: true, scores: true, engine: true, coach: 'daily+series' },
      { stream: 'steps', imported: true, scores: false, engine: true, coach: 'daily' },
      { stream: 'spo2', imported: false, scores: false, engine: false, coach: 'hidden' },
    ];
    const doc = {
      ...EMPTY_INTAKE,
      devices: { has: ['ring', 'phoneOnly', 'scale'], models: ['J-Style ring', 'Withings'], platforms: ['android'], streams, turns: answered({ has: ['ring'], routes: 'seen' }) },
    } as unknown as IntakeDoc;
    const rows = chapterRows('devices', doc, ctx)!;
    expect(get(rows, 'ring')).toEqual(['J-Style ring']);
    expect(get(rows, 'smart scale')).toEqual(['Withings']);
    expect(get(rows, 'just my phone')).toEqual(['in use']);
    expect(get(rows, 'phone')).toEqual(['Android']);
    expect(get(rows, 'connection')).toEqual(['not connected yet']);
    expect(get(rows, 'brought in')).toEqual(['sleep, heart rate, steps']);
    expect(get(rows, 'in your scores')).toEqual(['sleep, heart rate']);
    expect(get(rows, 'in your plan')).toEqual(['sleep, heart rate, steps']);
    expect(get(rows, 'Coach sees daily + detail')).toEqual(['sleep, heart rate']);
    expect(get(rows, 'Coach sees daily')).toEqual(['steps']);
    expect(get(rows, 'files and other apps')![0]).toMatch(/off until you turn them on/);
    const none = chapterRows('devices', { ...EMPTY_INTAKE, devices: { has: ['none'], models: [], platforms: [], streams: [], turns: answered({ has: ['none'] }) } } as unknown as IntakeDoc, ctx)!;
    expect(none).toEqual([{ label: 'devices', value: SUMMARY.devicesNone }]);
  });
});
