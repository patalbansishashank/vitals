/**
 * Intake v3 acceptance (SUITE_SPEC §13.1): fixed order, Back, Change that re-asks one question, determinism after
 * leaving and returning (a property test over random answer sequences in every chapter), progress = answered ÷
 * visible, the wording rules, and the measured-maintenance golden against the v2 `profile.patch` path.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, resetBusState, resetHistory } from '@/commands';
import '@/commands/defs/profile';
import { summarizeBody } from '@/features/body/model';
import { createDocumentStore, createMemoryBackend } from '@/store';
import { selectBodyValues, useProfileStore } from '@/state/profileStore';
import { setDocumentStore } from '@/state/runtime';
import { withSystemWrite } from '@/state/scope';
import { CHAPTER_QUESTIONS, CHAPTERS, mergeParts, withContextLines } from '../chapters';
import { ACTIVITY_QUESTIONS } from '../chapters/activity';
import { FOOD_KEYS } from '../chapters/food';
import { toIntakeDoc, turnsOf } from '../doc';
import {
  activeQuestion,
  back,
  backTarget,
  cancelReopen,
  commit,
  DEFAULT_CONTEXT,
  firstOpen,
  initialFlow,
  isDone,
  notUsed,
  optionsOf,
  progress,
  reopen,
  skip,
  stampContext,
  visibleQuestions,
  type FlowContext,
  type FlowState,
  type Question,
} from '../flow';
import { saveChapter, settleIntakeSaves } from '../persist';
import { chapterOutput, type SectionContext } from '../sections';
import { TURNS_SECTION, type ChapterAnswers, type ChapterId } from '../types';

const ctx = DEFAULT_CONTEXT;
const A = CHAPTER_QUESTIONS.activity;

/* ------------------------------------------------------------------------------------------- helpers */

/** A small seeded PRNG (mulberry32) so failures reproduce. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const subset = <T>(r: () => number, xs: readonly T[]): T[] => xs.filter(() => r() < 0.35);

/** A plausible answer of the right shape for any question (conditions read these shapes). */
function randomValue(q: Question, r: () => number, c: FlowContext): unknown {
  switch (q.kind) {
    case 'single':
      return pick(r, optionsOf(q, c)).value;
    case 'multi': {
      const s = subset(r, optionsOf(q, c)).map((o) => o.value);
      return s.length ? s : [optionsOf(q, c)[0]!.value];
    }
    case 'number':
      return pick(r, q.presets);
    case 'custom':
      switch (q.widget) {
        case 'eat':
          return { foods: subset(r, FOOD_KEYS) };
        case 'kit':
          return { owned: subset(r, ['dumbbell', 'resistance_band', 'pullup_bar']) };
        case 'workTime':
          return { days: pick(r, [3, 5, 6]), hours: pick(r, [4, 8, 10]) };
        case 'steps':
          return { mean: pick(r, [4000, 7000, 11000]) };
        case 'sleep':
          return { bed: 23, wake: 7 };
        case 'measured':
          return { value: pick(r, [1500, 1720, 2600]), unit: 'kcal', method: pick(r, ['metabolic_cart', 'calculator', 'tracking']) };
        case 'sportRows':
        case 'weekdays':
        case 'supplements':
        case 'streams':
          return [];
        case 'staples':
          return { grain: [], fat: [] };
        case 'text':
          return 'rice and dal';
        default:
          return {};
      }
  }
}

/** Store a chapter's turns the way `intake.answer` does and read them back (JSON round trip, a fresh view). */
function storedAndBack(chapter: ChapterId, a: ChapterAnswers): ChapterAnswers {
  const body = JSON.parse(JSON.stringify({ [TURNS_SECTION[chapter]]: { turns: a }, answeredAt: {}, questionSetVersion: {} }));
  return turnsOf(toIntakeDoc(body), chapter);
}

const answerAll = (qs: readonly Question[], s: FlowState, values: Record<string, unknown>): FlowState => {
  let next = s;
  for (let guard = 0; guard < 40; guard++) {
    const q = firstOpen(qs, next.answers, ctx);
    if (!q || !(q.id in values)) break;
    next = commit(next, q.id, values[q.id]);
  }
  return next;
};

/* ------------------------------------------------------------------------------------------- (1) Back and Change */

const DESK_DAY = {
  work: 'yes',
  job: 'desk',
  workTime: { days: 5, hours: 8 },
  commute: 'walk',
  commuteMin: 20,
  stepsKnown: 'roughly',
  stepsRough: 7000,
  offDay: 'mixed',
  home: 'some',
  sport: [],
  trainNow: '1-2',
  trainMix: 'mixed',
  sleep: { bed: 23, wake: 7 },
  sleepQuality: 'good',
  measuredEver: 'no',
};

describe('Back and Change (acceptance 1)', () => {
  it('answer chapter A to the end, Back three times, Change work to no: the work rows show "not used", nothing else changes', () => {
    let s = answerAll(A, initialFlow(), DESK_DAY);
    expect(activeQuestion(A, s, ctx)).toBeNull();
    const before = s.answers;

    // Back from the end: the last visible question, then the two before it, each in change mode
    s = back(A, s, ctx);
    expect(s.reopened).toBe('measuredEver');
    s = back(A, s, ctx);
    expect(s.reopened).toBe('sleepQuality');
    s = back(A, s, ctx);
    expect(s.reopened).toBe('sleep');
    // Back erases nothing
    expect(s.answers).toEqual(before);
    s = cancelReopen(s);

    // Change "work": only that question is re-asked
    s = reopen(s, 'work');
    expect(activeQuestion(A, s, ctx)?.id).toBe('work');
    s = commit(s, 'work', 'no');
    expect(notUsed(A, s.answers, ctx).sort()).toEqual(['commute', 'commuteMin', 'job', 'workTime'].sort());
    // every other answer is untouched; the chapter is still complete
    for (const [k, v] of Object.entries(before.values)) if (k !== 'work') expect(s.answers.values[k]).toEqual(v);
    expect(firstOpen(A, s.answers, ctx)).toBeNull();

    // back to yes: the kept answers apply again, nothing is asked twice
    s = commit(reopen(s, 'work'), 'work', 'yes');
    expect(notUsed(A, s.answers, ctx)).toEqual([]);
    expect(firstOpen(A, s.answers, ctx)).toBeNull();
  });

  it('a newly applying child is asked next, directly under its parent', () => {
    let s = answerAll(A, initialFlow(), { ...DESK_DAY, commute: 'ride' });
    expect(firstOpen(A, s.answers, ctx)).toBeNull();
    s = commit(reopen(s, 'commute'), 'commute', 'cycle');
    expect(firstOpen(A, s.answers, ctx)?.id).toBe('commuteMin');
    const vis = visibleQuestions(A, s.answers, ctx).map((q) => q.id);
    expect(vis.indexOf('commuteMin')).toBe(vis.indexOf('commute') + 1);
  });

  it('Back from the first question goes nowhere; from a change it goes to the question before', () => {
    expect(backTarget(A, initialFlow(), ctx)).toBeNull();
    const s = answerAll(A, initialFlow(), { work: 'yes', job: 'desk' });
    expect(backTarget(A, s, ctx)?.id).toBe('job');
    expect(backTarget(A, reopen(s, 'job'), ctx)?.id).toBe('work');
  });

  it('the commit order is kept for audit and never decides what is asked', () => {
    let s = answerAll(A, initialFlow(), { work: 'yes', job: 'desk' });
    s = commit(reopen(s, 'work'), 'work', 'varies');
    expect(s.answers.order).toEqual(['job', 'work']);
    const shuffled = { ...s.answers, order: ['work', 'job'] };
    expect(firstOpen(A, shuffled, ctx)?.id).toBe(firstOpen(A, s.answers, ctx)?.id);
  });
});

/* ------------------------------------------------------------------------------------------- (2) determinism */

describe('determinism (acceptance 2): the open question depends on the stored answers only', () => {
  it('after any step of 200 random sequences, the stored-and-read-back answers give the same first open question, in every live context', () => {
    const contexts: FlowContext[] = [
      { india: false, gentle: false, stepDevice: false },
      { india: true, gentle: true, stepDevice: true },
      { india: true, gentle: false, stepDevice: false },
    ];
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const chapter = CHAPTERS[seed % CHAPTERS.length]!;
      const qs = CHAPTER_QUESTIONS[chapter];
      const entry = pick(r, contexts);
      let s: FlowState = { answers: stampContext(initialFlow().answers, entry), reopened: null };
      for (let step = 0; step < 30; step++) {
        const roll = r();
        const open = activeQuestion(qs, s, entry);
        const done = visibleQuestions(qs, s.answers, entry).filter((q) => isDone(s.answers, q.id));
        if (roll < 0.1 && done.length) s = reopen(s, pick(r, done).id);
        else if (roll < 0.18) s = back(qs, s, entry);
        else if (roll < 0.28 && open && open.askLater !== false) s = skip(s, open.id);
        else if (open) s = commit(s, open.id, randomValue(open, r, entry));
        else break;

        // leave and return: a fresh read of the stored document, any live context
        const expected = firstOpen(qs, s.answers, entry)?.id ?? null;
        const back2 = storedAndBack(chapter, s.answers);
        for (const live of contexts) expect(firstOpen(qs, back2, live)?.id ?? null, `seed ${seed} step ${step} ${chapter}`).toBe(expected);
        // the card shown when nothing is being changed is always the first open one
        expect(activeQuestion(qs, cancelReopen(s), entry)?.id ?? null).toBe(expected);
        // progress = answered (incl. later) ÷ visible
        const p = progress(qs, cancelReopen(s), entry);
        const vis = visibleQuestions(qs, s.answers, entry);
        expect(p.total).toBe(vis.length);
        expect(p.done).toBe(vis.filter((q) => isDone(s.answers, q.id)).length);
      }
    }
  });

  it('a Change commit keeps every other stored answer (200 random sequences)', () => {
    for (let seed = 1000; seed < 1200; seed++) {
      const r = rng(seed);
      const chapter = CHAPTERS[seed % CHAPTERS.length]!;
      const qs = CHAPTER_QUESTIONS[chapter];
      let s = initialFlow();
      for (let i = 0; i < 12; i++) {
        const q = firstOpen(qs, s.answers, ctx);
        if (!q) break;
        s = commit(s, q.id, randomValue(q, r, ctx));
      }
      const done = visibleQuestions(qs, s.answers, ctx).filter((q) => isDone(s.answers, q.id));
      if (!done.length) continue;
      const target = pick(r, done);
      const next = commit(reopen(s, target.id), target.id, randomValue(target, r, ctx));
      for (const [k, v] of Object.entries(s.answers.values)) if (k !== target.id) expect(next.answers.values[k]).toEqual(v);
      for (const [k, v] of Object.entries(s.answers.status)) if (k !== target.id) expect(next.answers.status[k]).toBe(v);
    }
  });

  it('the live context counts only until it is stamped into the answers at chapter entry', () => {
    const F = CHAPTER_QUESTIONS.food;
    const gentle = stampContext(initialFlow().answers, { ...ctx, gentle: true });
    // stamped gentle: alcohol is not asked, whatever the live context says later
    expect(visibleQuestions(F, gentle, { ...ctx, gentle: false }).some((q) => q.id === 'alcohol')).toBe(false);
    const plain = stampContext(initialFlow().answers, ctx);
    expect(visibleQuestions(F, plain, { ...ctx, gentle: true }).some((q) => q.id === 'alcohol')).toBe(true);
    // stamping is idempotent
    expect(stampContext(gentle, { ...ctx, gentle: true })).toBe(gentle);
  });
});

/* ------------------------------------------------------------------------------------------- graph and wording */

describe('the graph and its wording (no-vagueness test)', () => {
  const all = CHAPTERS.flatMap((c) => CHAPTER_QUESTIONS[c].map((q) => ({ c, q })));

  it('ids are unique per chapter; children come after their parent; a child has a context line', () => {
    for (const c of CHAPTERS) {
      const qs = CHAPTER_QUESTIONS[c];
      const ids = qs.map((q) => q.id);
      expect(new Set(ids).size, c).toBe(ids.length);
      for (const q of qs) {
        if (!q.parent) continue;
        expect(ids.indexOf(q.parent), `${c}.${q.id} parent`).toBeGreaterThanOrEqual(0);
        expect(ids.indexOf(q.parent)).toBeLessThan(ids.indexOf(q.id));
        expect(q.contextLine, `${c}.${q.id} contextLine`).toBeTypeOf('function');
      }
    }
  });

  it('every prompt is self-contained: at least 6 words, no leading "And", "Mostly" or "Which one"', () => {
    for (const { c, q } of all) {
      const words = q.prompt.trim().split(/\s+/);
      expect(words.length, `${c}.${q.id}: ${q.prompt}`).toBeGreaterThanOrEqual(6);
      expect(q.prompt, `${c}.${q.id}`).not.toMatch(/^(And\b|Mostly\b|Which one\b)/);
      expect(q.prompt, `${c}.${q.id}`).not.toMatch(/…$/);
    }
  });

  it('the follow-ups the owner hit restate their context', () => {
    const p = (id: string) => A.find((q) => q.id === id)!.prompt;
    expect(p('workTime')).toMatch(/work or study/);
    expect(p('commute')).toMatch(/to work or study on a workday/);
    expect(p('commuteMin')).toMatch(/to work and back/);
  });

  it('the parent chip reads the parent answer', () => {
    const job = A.find((q) => q.id === 'commute')!;
    expect(job.contextLine?.({ work: 'yes' }, ctx)).toBe('work or study outside home · yes');
  });

  it('measured maintenance sits at the end of chapter A, the figure under its question', () => {
    const ids = A.map((q) => q.id);
    expect(ids.slice(-2)).toEqual(['measuredEver', 'measured']);
    expect(A.find((q) => q.id === 'measured')?.parent).toBe('measuredEver');
  });

  it('parts from other packages merge at their anchor and can take over base questions', () => {
    const extra: Question = { id: 'pantryV3', chapter: 'food', section: 'kitchen', kind: 'number', name: 'x', min: 0, max: 1, step: 1, presets: [0], prompt: 'Which foods do you have at home right now?', short: 'pantry', skipText: 'nothing' };
    const merged = withContextLines(mergeParts(CHAPTER_QUESTIONS.food, [{ chapter: 'food', after: 'eat', replaces: ['pantry'], questions: [extra] }]));
    const ids = merged.map((q) => q.id);
    expect(ids[ids.indexOf('eat') + 1]).toBe('pantryV3');
    expect(ids).not.toContain('pantry');
  });

  it('without a blood-markers module the chapter is not shown', () => {
    expect(CHAPTERS).toEqual(CHAPTER_QUESTIONS.markers.length ? ['activity', 'training', 'food', 'markers', 'devices'] : ['activity', 'training', 'food', 'devices']);
  });
});

/* ------------------------------------------------------------------------------------------- (4) measured golden */

describe('measured maintenance (acceptance 4)', () => {
  beforeEach(() => {
    localStorage.clear();
    setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001' }));
    resetHistory();
    resetBusState();
    withSystemWrite(() => useProfileStore.getState().resetBody());
    const st = useProfileStore.getState();
    st.setSex('female');
    st.setAge(41);
    st.setHeight(160);
    st.setWeight(68);
    st.setSetup('done');
  });

  const sctx: SectionContext = { ...DEFAULT_CONTEXT, safety: null, now: '2026-10-02T09:00:00.000Z' };
  const day: ChapterAnswers = { values: { work: 'yes', job: 'desk', workTime: { days: 5, hours: 8 }, commute: 'ride', stepsKnown: 'roughly', stepsRough: 6000 }, status: { work: 'answered', job: 'answered', workTime: 'answered', commute: 'answered', stepsKnown: 'answered', stepsRough: 'answered' } };

  const resolvedNow = () => summarizeBody(selectBodyValues(useProfileStore.getState())).maintenance;

  it('a metabolic-cart resting figure gives the same maintenance, byte for byte, as the v2 measured path (profile.patch)', async () => {
    // v2: the answers, then "Use this measurement" = profile.patch {labs:{measuredRmrKcal}}
    await saveChapter('activity', day, sctx);
    await settleIntakeSaves();
    const r = await dispatch('profile.patch', { labs: { measuredRmrKcal: 1480 } });
    expect(r.ok).toBe(true);
    const v2 = resolvedNow();
    const v2Activity = JSON.stringify(v2.activity);

    // reset, then v3: the same answers plus the two questions, through intake.answer only
    withSystemWrite(() => useProfileStore.getState().clearLabs());
    expect(resolvedNow().rmrMethod).not.toBe('measured');
    const v3answers: ChapterAnswers = {
      values: { ...day.values, measuredEver: 'rmr', measured: { value: 1480, unit: 'kcal', method: 'metabolic_cart', date: '2026-03' } },
      status: { ...day.status, measuredEver: 'answered', measured: 'answered' },
    };
    await saveChapter('activity', v3answers, sctx);
    await settleIntakeSaves();
    const v3 = resolvedNow();
    expect(v3.rmrMethod).toBe('measured');
    expect(v3.kcal).toBe(v2.kcal);
    expect(v3.band80).toEqual(v2.band80);
    expect(JSON.stringify(v3.activity)).toBe(v2Activity);
  });

  it('the same figure from a calculator changes nothing in the engine', async () => {
    await saveChapter('activity', day, sctx);
    await settleIntakeSaves();
    const before = JSON.stringify(resolvedNow().activity);
    const out = chapterOutput('activity', { values: { ...day.values, measuredEver: 'rmr', measured: { value: 1480, unit: 'kcal', method: 'calculator' } }, status: { ...day.status, measuredEver: 'answered', measured: 'answered' } }, sctx);
    expect(out.sections.activity?.measured).toMatchObject({ method: 'calculator' });
    await saveChapter('activity', { values: { ...day.values, measuredEver: 'rmr', measured: { value: 1480, unit: 'kcal', method: 'calculator' } }, status: { ...day.status, measuredEver: 'answered', measured: 'answered' } }, sctx);
    await settleIntakeSaves();
    expect(JSON.stringify(resolvedNow().activity)).toBe(before);
  });

  it('the base graph is the chapter file (nothing else reorders chapter A)', () => {
    expect(A.map((q) => q.id)).toEqual(ACTIVITY_QUESTIONS.map((q) => q.id));
  });
});

describe('blood markers skipped after values were saved (Q3-J1)', () => {
  it('the summary line says the saved values still count instead of "typical values"', async () => {
    const { markersChapterLine } = await import('../chapters/markers');
    const { emptyMarkersDoc } = await import('@/markers');
    const reading = { id: 'ldl', value: 162, unit: 'mg/dL', valueCanonical: 4.19, unitCanonical: 'mmol/L', date: '2026-10-02', provenance: 'manual', confirmed: true, enteredAt: '2026-10-02T10:00:00.000Z' };
    expect(markersChapterLine({ ...emptyMarkersDoc(), chapter: 'skipped' })).toBe('skipped · plans start from typical values for your age and sex');
    const kept = markersChapterLine({ ...emptyMarkersDoc(), chapter: 'skipped', readings: [reading] } as never);
    expect(kept).toBe('skipped · the value you saved before still counts in plans');
    expect(kept).not.toMatch(/typical values/);
  });
});
