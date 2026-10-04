/** E9b meal logging through the bus: log.meal thresholds and nutrient rules, log.mealFromPhoto with a fake recognizer, log.bulk. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { installAiPorts, type PhotoRecognition } from '@/commands/aiPorts';
import type { LogEntry } from '@/living';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { getDocumentStore } from '@/state/runtime';
import type { MealLogResult } from '..';
import { PLAN_ID, seedPlan } from './seed';

function out<T = MealLogResult>(r: CommandResult): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  if (!('output' in r)) throw new Error('no output');
  return r.output as T;
}
type Logged = Extract<MealLogResult, { status: 'logged' }>;
const meals = () => getDocumentStore().peekAll<LogEntry>('dailyLogs').filter((d) => d.kind === 'meal') as unknown as Array<Extract<LogEntry, { kind: 'meal' }>>;

beforeEach(() => {
  freshState({ cleared: true });
  installAiPorts({});
});
afterEach(() => {
  installAiPorts({});
  setBlobStore(null);
});

describe('log.meal', () => {
  it('computes nutrients from grams × the food table and commits a confident meal', async () => {
    await seedPlan();
    const r = out(await dispatch('log.meal', { slot: 'meal2', components: [{ name: 'rice', foodId: 'rice_white_cooked', grams: 150 }, { name: 'dal', localName: 'dal', foodId: 'lentils_cooked', grams: 150 }], method: 'typed' })) as Logged;
    expect(r.status).toBe('logged');
    expect(r.needsConfirmation).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r.totals.energyKcal.value).toBeCloseTo(195 + 174, 0);
    expect(r.totals.energyKcal.low).toBeLessThan(r.totals.energyKcal.value);
    expect(r.totals.energyKcal.high).toBeGreaterThan(r.totals.energyKcal.value);
    expect(r.undo).toEqual({ command: 'log.retract', input: { entryId: r.entryId } });
    await settleCommits();
    const [e] = meals();
    expect(e).toMatchObject({ kind: 'meal', slot: 'meal2', clockH: 14, planId: PLAN_ID, source: { by: 'user', method: 'typed' } });
    expect(e!.components[1]).toMatchObject({ foodId: 'lentils_cooked', nutrientSource: 'table' });
    expect(e!.totals.energyKcal.value).toBeCloseTo(369, 0);
    // undo info works
    expect((await dispatch('log.retract', { entryId: r.entryId })).ok).toBe(true);
  });

  it('logs a tick "as planned" from the slot\'s prescription when nothing is named', async () => {
    await seedPlan();
    const r = out(await dispatch('log.meal', { slot: 'meal2', components: [], method: 'asPlanned' })) as Logged;
    expect(r.status).toBe('logged');
    expect(r.totals.energyKcal.value).toBeGreaterThan(0);
    expect(r.totals.energyKcal.low).toBeLessThan(r.totals.energyKcal.value);
    await settleCommits();
    expect(meals()[0]).toMatchObject({ slot: 'meal2', clockH: 14, source: { method: 'asPlanned' } });
    const bad = await dispatch('log.meal', { slot: 'nope', components: [], method: 'asPlanned' });
    expect(bad.ok).toBe(false);
  });

  it('parses text when no components are given', async () => {
    const r = out(await dispatch('log.meal', { text: '2 eggs and 1 katori dal', components: [], method: 'typed', clockH: 9 })) as Logged;
    expect(r.status).toBe('logged');
    expect(r.components.map((c) => c.foodId)).toEqual(['egg_whole_raw', 'lentils_cooked']);
    expect(r.totals.proteinG.value).toBeCloseTo(12.6 + 13.5, 0);
  });

  it('commits but asks for confirmation between 0.4 and 0.7', async () => {
    const r = out(await dispatch('log.meal', { components: [{ name: 'banana' }], method: 'typed', clockH: 16 })) as Logged;
    expect(r.status).toBe('logged');
    expect(r.confidence).toBeGreaterThanOrEqual(0.4);
    expect(r.confidence).toBeLessThan(0.7);
    expect(r.needsConfirmation).toBe(true);
    expect(r.lowConfidence.map((c) => c.foodId)).toEqual(['banana_raw']);
    await settleCommits();
    expect(meals()).toHaveLength(1);
  });

  it('asks instead of writing below 0.4 (or with an unknown food)', async () => {
    const a = out(await dispatch('log.meal', { components: [{ name: 'xyzzy pie', grams: 100 }], method: 'typed' }));
    expect(a.status).toBe('ask');
    expect((a as { question: string }).question).toMatch(/xyzzy pie/);
    const b = out(await dispatch('log.meal', { components: [{ name: 'rice', foodId: 'rice_white_cooked', grams: 100 }], method: 'aiText', confidence: 0.3 }));
    expect(b.status).toBe('ask');
    await settleCommits();
    expect(meals()).toHaveLength(0);
  });

  it('rejects nutrient numbers unless they come from a label', async () => {
    const bad = await dispatch('log.meal', { components: [{ name: 'rice', grams: 100, energyKcal: 500 }], method: 'typed' } as never);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error.code).toBe('invalid_input');
    const partial = await dispatch('log.meal', { components: [{ name: 'bar', grams: 60, labelPer100g: { energyKcal: 380 } }], method: 'label' });
    expect(!partial.ok && partial.error.code).toBe('invalid_input');
    const r = out(await dispatch('log.meal', { components: [{ name: 'protein bar', grams: 60, labelPer100g: { energyKcal: 380, proteinG: 33, fatG: 12, carbG: 35, fibreG: 5 } }], method: 'label', clockH: 11 })) as Logged;
    expect(r.status).toBe('logged');
    expect(r.totals.energyKcal.value).toBeCloseTo(228, 0);
    expect(r.totals.carbG.value).toBeCloseTo(18, 0); // net
    expect(r.totals.energyKcal.high - r.totals.energyKcal.value).toBeLessThan(0.12 * 228);
    await settleCommits();
    expect(meals()[0]!.components[0]!.nutrientSource).toBe('label');
  });
});

describe('log.mealFromPhoto', () => {
  const rec = (confidence: number): PhotoRecognition => ({
    saw: 'A plate of rice with dal and a glossy curry.',
    confidence,
    components: [
      { name: 'rice', localName: 'chawal', grams: 180, gramsLow: 140, gramsHigh: 220, confidence: 0.9 },
      { name: 'lentil curry', foodId: 'lentils_cooked', grams: 150, gramsLow: 110, gramsHigh: 190, visibleFatCue: 'glossy', confidence: 0.85 },
    ],
  });

  async function withPhoto(r: PhotoRecognition): Promise<{ seen: Array<{ attachmentId: string; size: number }> }> {
    const blobs = createMemoryBlobStore();
    await blobs.put(new Uint8Array([1, 2, 3, 4]), { purpose: 'photo', aadId: 'photo-1' });
    setBlobStore(blobs);
    const seen: Array<{ attachmentId: string; size: number }> = [];
    installAiPorts({ recognizePhoto: async (req) => (seen.push({ attachmentId: req.attachmentId, size: req.image.size }), r) });
    return { seen };
  }

  it('needs a vision-capable model', async () => {
    const r = await dispatch('log.mealFromPhoto', { attachmentId: 'photo-1' });
    expect(!r.ok && r.error.code).toBe('precondition_failed');
    expect(!r.ok && r.error.message).toMatch(/vision-capable model/);
  });

  it('computes nutrients from grams with photo-only bands and returns "what I saw"', async () => {
    const { seen } = await withPhoto(rec(0.85));
    const r = out(await dispatch('log.mealFromPhoto', { attachmentId: 'photo-1', clockH: 13 })) as Logged;
    expect(seen).toEqual([{ attachmentId: 'photo-1', size: 4 }]);
    expect(r.status).toBe('logged');
    expect(r.saw).toMatch(/rice with dal/);
    expect(r.components.map((c) => c.foodId)).toEqual(['rice_white_cooked', 'lentils_cooked']);
    expect(r.components[0]).toMatchObject({ grams: 180, gramsLow: 140, gramsHigh: 220 });
    const e = r.totals.energyKcal;
    expect(e.value).toBeCloseTo(1.8 * 130 + 1.5 * 116, 0);
    expect((e.value - e.low) / e.value).toBeGreaterThanOrEqual(0.35 - 1e-3);
    const p = r.totals.proteinG;
    expect((p.high - p.value) / p.value).toBeGreaterThanOrEqual(0.5 - 1e-3);
    const f = r.totals.fatG;
    expect((f.high - f.value) / f.value).toBeGreaterThanOrEqual(0.5);
    await settleCommits();
    const [m] = meals();
    expect(m).toMatchObject({ attachmentIds: ['photo-1'], source: { method: 'aiPhoto' }, clockH: 13 });
    expect(m!.id ?? r.entryId).toBeTruthy();
  });

  it('asks below 0.4 and flags 0.4–0.7 for confirmation', async () => {
    await withPhoto(rec(0.3));
    const a = out(await dispatch('log.mealFromPhoto', { attachmentId: 'photo-1' }));
    expect(a.status).toBe('ask');
    expect(a.saw).toMatch(/plate/);
    await settleCommits();
    expect(meals()).toHaveLength(0);
    await withPhoto(rec(0.55));
    const b = out(await dispatch('log.mealFromPhoto', { attachmentId: 'photo-1' })) as Logged;
    expect(b.status).toBe('logged');
    expect(b.needsConfirmation).toBe(true);
  });

  it('reports a missing photo', async () => {
    setBlobStore(createMemoryBlobStore());
    installAiPorts({ recognizePhoto: async () => rec(0.9) });
    const r = await dispatch('log.mealFromPhoto', { attachmentId: 'missing' });
    expect(!r.ok && r.error.code).toBe('not_found');
  });
});

describe('log.bulk', () => {
  it('writes each entry separately and returns one result per entry', async () => {
    const r = out<Array<{ date: string; index: number; status: string; entryId?: string }>>(
      await dispatch('log.bulk', {
        days: [
          { date: '2026-09-29', entries: [{ text: '2 eggs and 150 g rice', clockH: 9 }, { kind: 'session', status: 'done', performed: [] }] },
          { date: '2026-09-30', entries: [{ kind: 'meal', components: [{ name: 'dal', foodId: 'lentils_cooked', grams: 200 }], clockH: 13 }, { components: [{ name: 'xyzzy', grams: 50 }] }, { kind: 'steps', steps: 9000 }] },
        ],
      }),
    );
    expect(r.map((x) => [x.date, x.index, x.status])).toEqual([
      ['2026-09-29', 0, 'logged'],
      ['2026-09-29', 1, 'skipped'],
      ['2026-09-30', 0, 'logged'],
      ['2026-09-30', 1, 'ask'],
      ['2026-09-30', 2, 'logged'],
    ]);
    const ids = r.filter((x) => x.entryId).map((x) => x.entryId);
    expect(new Set(ids).size).toBe(3);
    await settleCommits();
    const m = meals();
    expect(m.map((x) => x.date).sort()).toEqual(['2026-09-29', '2026-09-30']);
    expect(m.every((x) => x.source.method === 'backfill')).toBe(true);
    // each entry is undoable on its own
    expect((await dispatch('log.retract', { entryId: ids[0]! })).ok).toBe(true);
  });
});
