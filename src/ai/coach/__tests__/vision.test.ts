// @vitest-environment node
import { aiPorts, installAiPorts } from '@/commands/aiPorts';
import { createPhotoRecognizer, installModelPorts, VisionUnsupportedError } from '../vision';
import { modelWith, textReply } from './helpers';

const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
const req = { attachmentId: 'att1', image, text: 'lunch' };

const good = {
  saw: 'A plate of rice, dal and a roti.',
  confidence: 0.8,
  components: [
    { name: 'Cooked rice', localName: 'chawal', foodId: 'rice_cooked', grams: 150, gramsLow: 120, gramsHigh: 190, cookingMethod: 'boiled', visibleFatCue: 'none', confidence: 0.9, kcal: 195, energyKcal: 195 },
    { name: 'Dal', grams: 180, gramsLow: 200, gramsHigh: 150, confidence: 1.4, proteinG: 12 },
    { name: 'Ghost', grams: -5, confidence: 0.5 },
  ],
  kcal: 640,
};

describe('createPhotoRecognizer', () => {
  it('returns components with grams, sends image and candidates', async () => {
    const { model, ff } = modelWith([textReply(good)]);
    const out = await createPhotoRecognizer(model, { candidates: [{ id: 'rice_cooked', name: 'Rice, cooked' }] })(req);
    expect(out.saw).toBe('A plate of rice, dal and a roti.');
    expect(out.components).toHaveLength(2);
    expect(out.components[0]).toMatchObject({ name: 'Cooked rice', foodId: 'rice_cooked', grams: 150, gramsLow: 120, gramsHigh: 190, visibleFatCue: 'none' });
    const body = JSON.stringify(ff.requests[0]!.body);
    expect(body).toContain('data:image/jpeg;base64');
    expect(body).toContain('rice_cooked: Rice, cooked');
    expect(body).toContain('lunch');
  });

  it('drops invented kcal/nutrient fields and fixes bounds', async () => {
    const { model } = modelWith([textReply(good)]);
    const out = await createPhotoRecognizer(model)(req);
    expect(JSON.stringify(out)).not.toMatch(/kcal|energyKcal|proteinG|640/i);
    const dal = out.components[1]!;
    expect(dal.confidence).toBe(1);
    expect(dal.gramsLow).toBeLessThanOrEqual(dal.grams);
    expect(dal.gramsHigh).toBeGreaterThanOrEqual(dal.grams);
    expect(out.components.some((c) => c.name === 'Ghost')).toBe(false);
  });

  it('drops a foodId that is not among the given candidates, and keeps a transcribed label', async () => {
    const { model } = modelWith([textReply({ ...good, labelPer100g: { energyKcal: 350, proteinG: 8, bogus: 'x' } })]);
    const out = await createPhotoRecognizer(model, { candidates: [{ id: 'other', name: 'Other' }] })(req);
    expect(out.components[0]!.foodId).toBeUndefined();
    expect(out.labelPer100g).toEqual({ energyKcal: 350, proteinG: 8 });
  });

  it('drops a foodId when no foods or candidates were offered (it can only be invented) (V1e-16)', async () => {
    const { model } = modelWith([textReply(good)]);
    const out = await createPhotoRecognizer(model)(req);
    expect(out.components[0]!.foodId).toBeUndefined();
  });

  it('extracts JSON from a fenced plain-text reply', async () => {
    const { model } = modelWith([textReply('Here you go:\n```json\n' + JSON.stringify(good) + '\n```')]);
    expect((await createPhotoRecognizer(model)(req)).components).toHaveLength(2);
  });

  it('throws a typed error when the model has no vision, without a request', async () => {
    const { model, ff } = modelWith([], { vision: false });
    await expect(createPhotoRecognizer(model)(req)).rejects.toBeInstanceOf(VisionUnsupportedError);
    expect(ff.requests).toHaveLength(0);
  });
});

describe('installModelPorts', () => {
  it('installs recognizePhoto only with vision', () => {
    const { model } = modelWith([]);
    installModelPorts(model, { vision: false });
    expect(aiPorts().recognizePhoto).toBeUndefined();
    expect(aiPorts().resolveExercise).toBeDefined();
    installModelPorts(model, { vision: true });
    expect(aiPorts().recognizePhoto).toBeTypeOf('function');
    installAiPorts({});
  });
});
