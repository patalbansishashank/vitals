/** E9b executors through the command bus on an in-memory store: conversations, log.session, intake questions, sim.explain. */
import { SEED_CATALOGUE } from '@/content/catalogues';
import type { ExerciseDraft, ExerciseResolver } from '@/catalogues';
import { createDocumentStore, createMemoryBackend } from '@/store';
import { setDocumentStore } from '@/state/runtime';
import { withSystemWrite } from '@/state/scope';
import { useSimulationStore } from '@/state/simulationStore';
import { dispatch, getCommand, mintConfirmation, settleCommits } from '@/commands';
import { installAiPorts } from '@/commands/aiPorts';
import { appendTurn, getConversation, listSummaries, listTurns, saveSummary } from '@/commands/coach';

beforeEach(() => {
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'testdevice000001' }), validation: 'off' }));
  installAiPorts({});
});

const out = <T,>(r: Awaited<ReturnType<typeof dispatch>>): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};

const T0 = Date.parse('2026-10-01T08:00:00.000Z');
const at = (min: number): string => new Date(T0 + min * 60_000).toISOString();

describe('stubs are replaced', () => {
  // late registration when the state stores load first (see ../late.ts)
  beforeAll(() => vi.waitFor(() => expect(getCommand('sim.explain')!.notImplemented).toBeUndefined()));

  it('marks each command implemented by E9b', () => {
    for (const id of ['coach.conversations', 'coach.history', 'coach.searchNotes', 'coach.delete', 'log.session', 'intake.nextQuestions', 'sim.explain']) expect(getCommand(id)!.notImplemented, id).toBeUndefined();
  });
});

describe('coach conversations', () => {
  async function seed() {
    for (let i = 0; i < 7; i++) await appendTurn('C1', { role: i % 2 ? 'assistant' : 'user', text: i === 0 ? 'Should I eat before sandbag training?' : `message ${i}`, at: at(i), ...(i === 1 ? { tokens: { input: 10, output: 5 }, cards: [{ kind: 'applied', title: 'Logged' }] } : {}) });
    await saveSummary('C1', { date: '2026-10-01', text: 'Agreed to move heavy carries to Thursday; knee is sore.', turnsCovered: 7, tokensCovered: 900 });
    await appendTurn('C2', { role: 'user', text: 'Second chat about protein', at: at(60) });
  }

  it('lists conversations by last activity with turn counts (summaries are not turns)', async () => {
    await seed();
    const list = out<Array<{ conversationId: string; turnCount: number; title: string }>>(await dispatch('coach.conversations', {}));
    expect(list.map((c) => c.conversationId)).toEqual(['C2', 'C1']);
    expect(list[1]).toMatchObject({ turnCount: 7, title: 'Should I eat before sandbag training?' });
  });

  it('pages history backwards from a cursor, oldest first within a page', async () => {
    await seed();
    const p1 = out<Array<{ id: string; text: string; hasMore?: boolean }>>(await dispatch('coach.history', { conversationId: 'C1', limit: 3 }));
    expect(p1.map((t) => t.text)).toEqual(['message 4', 'message 5', 'message 6']);
    expect(p1[0]!.hasMore).toBe(true);
    const p2 = out<typeof p1>(await dispatch('coach.history', { conversationId: 'C1', limit: 3, before: p1[0]!.id }));
    expect(p2.map((t) => t.text)).toEqual(['message 1', 'message 2', 'message 3']);
    const p3 = out<typeof p1>(await dispatch('coach.history', { conversationId: 'C1', limit: 3, before: p2[0]!.id }));
    expect(p3.map((t) => t.text)).toEqual(['Should I eat before sandbag training?']);
    expect(p3[0]!.hasMore).toBeUndefined();
    expect((await dispatch('coach.history', { conversationId: 'nope' })).ok).toBe(false);
  });

  it('keeps tokens, cards and summaries through the store API', async () => {
    await seed();
    const turns = await listTurns('C1');
    expect(turns[1]).toMatchObject({ role: 'assistant', tokens: { input: 10, output: 5 }, cards: [{ title: 'Logged' }] });
    expect(await listTurns('C1', { includeNotes: true })).toHaveLength(8);
    expect(await listSummaries('C1')).toMatchObject([{ date: '2026-10-01', turnsCovered: 7, tokensCovered: 900 }]);
    expect((await getConversation('C1'))?.segment).toBe(1);
  });

  it('searches turns and summaries; summaries rank first', async () => {
    await seed();
    const hits = out<Array<{ kind: string; snippet: string; conversationId: string }>>(await dispatch('coach.searchNotes', { q: 'carries knee' }));
    expect(hits[0]).toMatchObject({ kind: 'summary', conversationId: 'C1' });
    const protein = out<Array<{ conversationId: string }>>(await dispatch('coach.searchNotes', { q: 'protein' }));
    expect(protein.map((h) => h.conversationId)).toEqual(['C2']);
    expect(out<unknown[]>(await dispatch('coach.searchNotes', { q: 'zzzz' }))).toEqual([]);
  });

  it('delete is destructive: needs a confirmation, then tombstones the conversation and its messages', async () => {
    await seed();
    const refused = await dispatch('coach.delete', { conversationId: 'C1' });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.code).toBe('confirmation_required');
    expect(await getConversation('C1')).not.toBeNull();
    const done = await dispatch('coach.delete', { conversationId: 'C1' }, { confirmation: mintConfirmation('coach.delete', { conversationId: 'C1' }) });
    expect(out<{ deleted: boolean }>(done).deleted).toBe(true);
    await settleCommits();
    expect(await getConversation('C1')).toBeNull();
    expect(await listTurns('C1', { includeNotes: true })).toEqual([]);
    expect(out<Array<{ conversationId: string }>>(await dispatch('coach.conversations', {})).map((c) => c.conversationId)).toEqual(['C2']);
    expect(out<unknown[]>(await dispatch('coach.searchNotes', { q: 'carries' }))).toEqual([]);
  });
});

const sandbagDraft: ExerciseDraft = {
  name: 'Sandbag carries',
  pattern: 'carry',
  regions: { core: 1, quads: 0.5, glutes: 0.5, upperBack: 0.5 },
  loadType: 'odd-object',
  intensityScale: 'kgRpe',
  volumeUnit: 'sets',
  defaultDose: { sets: 3, reps: 1 },
  metGross: 6,
  hybridCardioShare: 0.2,
  mechanism: 'Loaded carries train the trunk and legs together.',
  confidence: 0.8,
  resolvedBy: 'ai',
} as unknown as ExerciseDraft;

describe('log.session', () => {
  it('resolves catalogue names and aliases exactly', async () => {
    const ex = SEED_CATALOGUE.exercises.find((e) => e.pattern === 'squat' && e.loadType === 'bodyweight') ?? SEED_CATALOGUE.exercises[0]!;
    const r = out<{ entryId: string; equivalence: { credit: number | null }; resolvedExercises: Array<{ via: string; exerciseId: string }>; unresolved: unknown[] }>(
      await dispatch('log.session', { status: 'done', performed: [{ freeText: `${ex.name} 3 x 10` }] }),
    );
    expect(r.resolvedExercises).toMatchObject([{ via: 'catalogue', exerciseId: ex.id }]);
    expect(r.unresolved).toEqual([]);
    expect(r.equivalence.credit).toBeNull(); // no running plan: nothing prescribed
    const entries = out<Array<{ kind: string; id: string; performed: Array<{ exerciseId: string; setCount?: number }> }>>(await dispatch('log.get', { from: '2000-01-01', to: '2100-01-01' }));
    expect(entries.find((e) => e.id === r.entryId)).toMatchObject({ kind: 'session', performed: [{ exerciseId: ex.id, setCount: 3 }] });
  });

  it('sends unknown names to the installed resolver and returns drafts', async () => {
    const calls: string[] = [];
    const resolver: ExerciseResolver = {
      id: 'fake',
      resolve: (input) => {
        calls.push(input.name);
        return sandbagDraft;
      },
    };
    installAiPorts({ resolveExercise: resolver });
    const r = out<{
      entryId: string;
      resolvedExercises: Array<{ via: string; exerciseId: string; isNew: boolean }>;
      unresolved: Array<{ name: string; draft: ExerciseDraft; exerciseId: string }>;
      equivalence: { perRegion: Array<{ region: string; note: string }> };
    }>(await dispatch('log.session', { status: 'done', performed: [{ freeText: 'sandbag carries 4 x 1' }], rpe: 7 }));
    expect(calls).toEqual(['sandbag carries']);
    expect(r.resolvedExercises).toMatchObject([{ via: 'ai', isNew: true, exerciseId: 'user-sandbag-carries' }]);
    expect(r.unresolved[0]).toMatchObject({ name: 'sandbag carries', exerciseId: 'user-sandbag-carries' });
    expect(r.unresolved[0]!.draft.name).toBe('Sandbag carries');
    expect(r.equivalence.perRegion.length).toBeGreaterThan(0);
    const e = out<Array<{ id: string; performed: Array<{ setCount?: number; exerciseId: string }>; stimulus: { effectiveSetsByRegion: Record<string, number> }; rpe: number }>>(
      await dispatch('log.get', { from: '2000-01-01', to: '2100-01-01' }),
    ).find((x) => x.id === r.entryId)!;
    expect(e.performed[0]).toMatchObject({ exerciseId: 'user-sandbag-carries', setCount: 4 });
    expect(Object.keys(e.stimulus.effectiveSetsByRegion).length).toBeGreaterThan(0);
    expect(e.rpe).toBe(7);
  });

  it('falls back to the heuristic without a provider, and splits a free-text list', async () => {
    const r = out<{ resolvedExercises: Array<{ via: string; name: string }>; unresolved: Array<{ name: string }> }>(
      await dispatch('log.session', { status: 'partial', performed: [{ freeText: 'sandbag carries 3 x 1, stairs 20 min' }] }),
    );
    expect(r.resolvedExercises).toHaveLength(2);
    expect(r.resolvedExercises[0]!.via).toBe('heuristic');
    expect(r.unresolved.map((u) => u.name)).toContain('sandbag carries');
  });

  it('a skipped session earns no credit', async () => {
    const r = out<{ equivalence: { credit: number | null } }>(await dispatch('log.session', { status: 'skipped', performed: [] }));
    expect(r.equivalence.credit).toBe(0);
  });
});

describe('intake.nextQuestions', () => {
  it('returns unanswered questions in chapter order with an answer call; answered ones drop out', async () => {
    const first = out<Array<{ id: string; chapter: string; section: string; prompt: string; answer: { type: string }; answerCall: { input: { section: string; answers: unknown } } }>>(await dispatch('intake.nextQuestions', {}));
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(3);
    expect(first[0]!.chapter).toBe('activity');
    expect(first[0]!.prompt.length).toBeGreaterThan(5);
    const q = first[0]!;
    // answer with the first option (or skip) through intake.answer, as the Coach would
    const shape = q.answer as unknown as { type: string; options?: Array<{ value: string }>; min?: number };
    const value = shape.options ? (shape.type === 'multi' ? [shape.options[0]!.value] : shape.options[0]!.value) : shape.min ?? 0;
    const call = { section: q.section, answers: { turns: { values: { [q.id]: value }, status: { [q.id]: 'answered' } } } };
    expect((await dispatch('intake.answer', call as never)).ok).toBe(true);
    const next = out<Array<{ id: string }>>(await dispatch('intake.nextQuestions', {}));
    expect(next.map((n) => n.id)).not.toContain(q.id);
    const training = out<Array<{ chapter: string }>>(await dispatch('intake.nextQuestions', { section: 'training' }));
    expect(training.every((t) => t.chapter === 'training')).toBe(true);
  });
});

describe('sim.explain', () => {
  const n = 29;
  const arr = (f: (d: number) => number): Float32Array => Float32Array.from({ length: n }, (_, d) => f(d));
  function seedRun(sid: string): void {
    const result = {
      meta: { nDays: n },
      initial: { scaleWeight: 90, fatMass: 25, leanMass: 65, glycogenWater: 2, ecfShift: 0, gutContent: 1 },
      daily: {
        scaleWeight: arr((d) => 90 - d * 0.1),
        fatMass: arr((d) => 25 - d * 0.07),
        leanMass: arr((d) => 65 - d * 0.01),
        glycogenWater: arr((d) => 2 - d * 0.02),
        ecfShift: arr(() => 0),
        gutContent: arr(() => 1),
        inCarbs: arr(() => 120),
      },
      hourly: {},
      final: {},
      safety: {},
      events: [],
      warnings: [],
    };
    withSystemWrite(() => useSimulationStore.setState({ runs: { [sid]: { result } as never }, lastRuns: {} }));
  }

  it('explains scale weight through its components with evidence ids', async () => {
    seedRun('s1');
    const r = out<{ headline: string; metric: string; change: number; drivers: Array<{ factor: string; effect: string; mechanism: string; evidenceIds: string[] }>; caveats: string[]; evidenceIds: string[] }>(
      await dispatch('sim.explain', { source: { scenarioId: 's1' }, metric: 'scaleWeight' }),
    );
    expect(r.metric).toBe('scaleWeight');
    expect(r.change).toBeCloseTo(-2.8, 1);
    expect(r.headline).toMatch(/falls/);
    expect(r.drivers.map((d) => d.factor.toLowerCase()).join(' ')).toMatch(/fat/);
    expect(r.drivers[0]!.effect).toMatch(/fell/);
    expect(r.evidenceIds.length).toBeGreaterThan(0);
    expect(r.evidenceIds.some((id) => /^\d\d-/.test(id))).toBe(true);
  });

  it('refuses an unknown metric and a missing run', async () => {
    seedRun('s1');
    expect((await dispatch('sim.explain', { source: { scenarioId: 's1' }, metric: 'nope' })).ok).toBe(false);
    expect((await dispatch('sim.explain', { source: { scenarioId: 'other' }, metric: 'fatMass' })).ok).toBe(false);
  });
});
