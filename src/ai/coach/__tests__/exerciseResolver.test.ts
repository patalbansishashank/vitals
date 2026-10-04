// @vitest-environment node
import { validateDraft, type ExerciseRecord } from '@/catalogues';
import { SEED_CATALOGUE } from '@/content/catalogues';
import { createAiExerciseResolver } from '../exerciseResolver';
import { modelWith, textReply } from './helpers';

const ctx = { candidates: [{ id: 'goblet_squat', name: 'Goblet squat' } as unknown as ExerciseRecord] };

const valid = {
  pattern: 'squat',
  regions: { quads: 1, glutes: 0.6, bogus: 0.2 },
  loadType: 'odd-object',
  intensityScale: 'kgRpe',
  volumeUnit: 'setsReps',
  defaultDose: { sets: 3, reps: 8, rir: 2, junk: 4 },
  metGross: 5,
  mechanism: 'Loaded squat counted like a goblet squat.',
  basedOn: 'goblet_squat',
  confidence: 0.7,
};

describe('createAiExerciseResolver', () => {
  it('turns a valid model answer into a validated ai draft', async () => {
    const { model } = modelWith([textReply(valid)]);
    const d = await createAiExerciseResolver(model).resolve({ name: 'Sandbag squat' }, ctx);
    expect(d).toMatchObject({ name: 'Sandbag squat', pattern: 'squat', resolvedBy: 'ai', basedOn: 'goblet_squat' });
    expect(validateDraft(d!)).toEqual([]);
    expect(d!.regions).toEqual({ quads: 1, glutes: 0.6 });
    expect(d!.defaultDose).toEqual({ sets: 3, reps: 8, rir: 2 });
  });

  it('falls back to the heuristic on invalid output, or null without a catalogue', async () => {
    const { model } = modelWith([textReply({ ...valid, metGross: 99 }), textReply('not json at all'), textReply({ ...valid, metGross: 99 })]);
    const plain = createAiExerciseResolver(model);
    expect(await plain.resolve({ name: 'Sandbag squat' }, ctx)).toBeNull();
    expect(await plain.resolve({ name: 'Sandbag squat' }, ctx)).toBeNull();
    const d = await createAiExerciseResolver(model, { catalogue: SEED_CATALOGUE }).resolve({ name: 'Wooden wheel curls' }, ctx);
    expect(d?.resolvedBy).toBe('heuristic');
    expect(validateDraft(d!)).toEqual([]);
  });
});
