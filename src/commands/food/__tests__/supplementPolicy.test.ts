/**
 * D7-03 consumer wiring (phase 0C): the food supplements line reads the CURRENT safety state through the shared policy
 * provider (`@/lib/safetyPolicy`, built like the `supplements.*` commands: screening, marker evaluation, food allergies,
 * refusals and clinician stops), never a stale Food profile or an empty negative screen.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { defineCommand } from '@/commands/registry';
import { T } from '@/commands/schema';
import type { CommandId } from '@/commands/types';
import { readingFromInput } from '@/markers/doc';
import { mintWriteToken } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { daySupplementLine, type SupplementLine } from '..';
import { seedIntake } from './seed';

// a test-only read command: the line needs a real command context (document reads, clock, the day's prescription)
const LINE = 'test.foodSupplementLine' as CommandId;
defineCommand({
  id: LINE,
  version: 1,
  title: 'Supplements line (test)',
  description: 'Test-only: the food supplements line for a date.',
  input: T.Object({ date: T.String() }),
  output: T.OpenObject(),
  perm: 'read',
  surfaces: ['ui'],
  undo: { kind: 'none' },
  idempotency: 'none',
  sideEffects: [],
  execute: (ctx, input: { date: string }) => daySupplementLine(ctx, input.date) as never,
});

const DATE = '2026-10-01';
async function line(): Promise<SupplementLine> {
  const r: CommandResult = await dispatch(LINE as never, { date: DATE } as never);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r as { output: SupplementLine }).output;
}
const withheld = (l: SupplementLine, id: string) => l.withheld?.find((w) => w.id === id);
const KIDNEY = { ageBand: '18-64', pregnancy: 'no', eatingDisorder: 'no', scoffRisk: false, diabetes: 'no', conditions: 'yes', conditionItems: ['kidney'], metabolic: 'no', medications: 'no', symptoms: 'no', supervisedExercise: 'no', musculoskeletal: 'no', alcohol: 'no' };

async function seedMarkers(): Promise<void> {
  const store = getDocumentStore();
  await store.ready;
  const egfr = readingFromInput({ id: 'egfr', value: 52, unit: 'mL/min/1.73 m²', date: '2026-09-12' }, 'manual', '2026-09-12T09:00:00Z');
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('markers', { _id: 'me', readings: [egfr], displayOnly: [], context: {}, chapter: 'manual' });
  });
}

describe('food supplements line through the shared policy (D7-03)', () => {
  beforeEach(() => {
    freshState({ cleared: true });
  });

  it('a negative screen with answered food rules suggests creatine and whey (no blanket hiding)', async () => {
    await seedIntake({ stance: 'open' });
    const l = await line();
    expect(l.optedIn).toBe(true);
    expect(l.items.find((i) => i.id === 'creatine_monohydrate')).toMatchObject({ policy: 'allow' });
    expect(withheld(l, 'creatine_monohydrate')).toBeUndefined();
  });

  it('a current kidney-disease screening withholds creatine (Not suggested) and whey (Review) by name, with the rule', async () => {
    await seedIntake({ stance: 'open' });
    await dispatch('safety.commitScreening', { answers: KIDNEY, at: '2026-10-01T09:00:00.000Z' });
    await settleCommits();
    const l = await line();
    expect(l.items.map((i) => i.id)).not.toContain('creatine_monohydrate');
    expect(withheld(l, 'creatine_monohydrate')).toMatchObject({ policy: 'noSuggest', reasons: [expect.objectContaining({ rule: 'predicate:kidney-disease', source: 'screening', applicability: 'applicable' })] });
    expect(withheld(l, 'whey_protein')?.policy).toBe('clinicianReview');
    expect(l.hiddenForSafety).toBeGreaterThanOrEqual(2);
  });

  it('a low-eGFR marker patch reaches the food line with its marker provenance (no screening answer needed)', async () => {
    await seedIntake({ stance: 'open' });
    await seedMarkers();
    const l = await line();
    const c = withheld(l, 'creatine_monohydrate');
    expect(c).toBeDefined();
    expect(c!.reasons.some((r) => r.source === 'marker' && r.rule === 'W-L-EGFR-2' && r.sampleDate === '2026-09-12')).toBe(true);
    expect(['noSuggest', 'unchecked']).toContain(c!.policy);
  });

  it('unanswered screening is Unchecked (named), never a negative screen; items without contraindications stay', async () => {
    freshState({ cleared: false });
    await seedIntake({ stance: 'open' });
    const l = await line();
    expect(withheld(l, 'creatine_monohydrate')?.policy).toBe('unchecked');
    expect(withheld(l, 'creatine_monohydrate')?.reasons.every((r) => r.applicability === 'unresolved')).toBe(true);
    expect(l.hiddenForSafety).toBe(0);
  });

  it('a product already taken stays visible with its status (taking is never refused or deleted)', async () => {
    await seedIntake({ stance: 'open' });
    await dispatch('safety.commitScreening', { answers: KIDNEY, at: '2026-10-01T09:00:00.000Z' });
    await settleCommits();
    await dispatch('supplements.set', { supplementId: 'creatine', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['morning'] });
    await settleCommits();
    const l = await line();
    expect(l.taking).toContainEqual(expect.objectContaining({ id: 'creatine_monohydrate', policy: 'noSuggest' }));
    expect(l.items.map((i) => i.id)).not.toContain('creatine_monohydrate');
  });
});
