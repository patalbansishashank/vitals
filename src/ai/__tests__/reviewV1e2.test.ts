// @vitest-environment node
/** Review pass V1e (second round): paging after a cut, label and exercise bounds, small display and rounding fixes. */
import { describe, expect, it } from 'vitest';
import { capToolResult } from '../tools/budget';
import { validate } from '../tools/validate';
import { CoachExecutor, pageOf } from '../coach/executor';
import { normalizeRecognition } from '../coach/vision';
import { parseProposal } from '../coach/recipes';
import { markersReviewCard, reviewOf } from '../coach/markers';

describe('a truncated page keeps every row reachable (V1e-10)', () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({ id: i, label: `entry number ${i} with some words to make it longer` }));

  it('capToolResult reports how many rows of the paged array it kept', () => {
    const r = capToolResult({ items: rows, total: 400 }, 400, 'items');
    expect(r.truncated).toBe(true);
    expect(r.rowsBefore).toBe(400);
    expect(r.rowsKept).toBe((r.data as { items: unknown[] }).items.length);
    expect(r.rowsKept).toBeLessThan(400);
  });

  it('the cursor points at the first row that was cut, not at the end of the page', () => {
    const ex = new CoachExecutor({ bus: {} as never, now: () => new Date('2026-10-02T12:00:00Z'), newId: () => 'x', aiActorId: 'ai', resultTokenCap: 400 });
    const paged = pageOf(rows, '100', 100);
    expect(paged.nextCursor).toBe('200');
    const out = (ex as unknown as { capped: (d: unknown, c?: string, p?: unknown) => { partial: { items: Array<{ id: number }>; nextCursor: string }; nextCursor: string } }).capped(paged.data, paged.nextCursor, paged.page);
    const kept = out.partial.items;
    expect(kept[0]!.id).toBe(100);
    expect(kept.length).toBeLessThan(100);
    const next = String(100 + kept.length);
    expect(out.nextCursor).toBe(next);
    expect(out.partial.nextCursor).toBe(next);
    // the next call starts right after the last row shown
    const second = pageOf(rows, out.nextCursor, 100).data as { items: Array<{ id: number }> };
    expect(second.items[0]!.id).toBe(kept.at(-1)!.id + 1);
  });
});

describe('label values per 100 g must be plausible (V1e-11)', () => {
  const comp = { name: 'bar', grams: 60, gramsLow: 50, gramsHigh: 70, confidence: 0.8 };
  const recog = (labelPer100g: Record<string, unknown>) => normalizeRecognition({ saw: 'A protein bar.', confidence: 0.8, components: [comp], labelPer100g });

  it('keeps a normal label', () => {
    expect(recog({ energyKcal: 380, proteinG: 33, fatG: 12, carbG: 35, sodiumMg: 400 }).labelPer100g).toEqual({ energyKcal: 380, proteinG: 33, fatG: 12, carbG: 35, sodiumMg: 400 });
  });

  it('drops a label with impossible values and says so in plain words', () => {
    for (const bad of [{ energyKcal: 4000 }, { energyKcal: 300, proteinG: 90000 }, { energyKcal: 300, proteinG: 50, fatG: 40, carbG: 30 }, { energyKcal: 300, saltG: 150 }]) {
      const r = recog(bad);
      expect(r.labelPer100g).toBeUndefined();
      expect(r.saw).toMatch(/^A protein bar\. The nutrition label values did not add up/);
    }
  });

  it('refuses kilojoules in the kcal field unless the label gave kJ, and converts when it did', () => {
    const r = recog({ energyKcal: 1590, proteinG: 33 });
    expect(r.labelPer100g).toBeUndefined();
    expect(r.saw).toMatch(/kilojoules/);
    expect(recog({ energyKcal: 1590, energyKj: 1590, proteinG: 33 }).labelPer100g).toEqual({ energyKcal: 380, proteinG: 33 });
    expect(recog({ energyKj: 1590, proteinG: 33 }).labelPer100g).toEqual({ energyKcal: 380, proteinG: 33 });
  });

  it('accepts pure fat at the edge', () => {
    expect(recog({ energyKcal: 900, fatG: 100 }).labelPer100g).toEqual({ energyKcal: 900, fatG: 100 });
  });
});

describe('small fixes', () => {
  it('a grams value that rounds to 0 is dropped, not proposed as 0 g (V1e-14)', () => {
    const r = parseProposal({ meals: [{ slot: 'lunch', dish: 'Dal', ingredients: [{ foodId: 'dal', grams: 0.04 }, { foodId: 'rice', grams: 150 }] }] }, new Set(['dal', 'rice']), new Set(['lunch']));
    expect(r.meals[0]!.ingredients).toEqual([expect.objectContaining({ foodId: 'rice', grams: 150 })]);
  });

  it('a report row with NaN confidence and a misread sample date read plainly (V1e-17)', () => {
    const review = reviewOf({ extractionId: 'e1', sampleDate: '2026-45-01', rows: [{ row: 1, markerId: 'hba1c', nameOnReport: 'HbA1c', value: 5.4, unit: '%', confidence: Number.NaN }] }, 'a1')!;
    expect(review.sampleDate).toBeUndefined();
    const card = markersReviewCard('c1', review, '2026-10-03T00:00:00Z');
    expect(card.items[0]!.after).toBe('5.4 % · 0 % sure');
    expect(card.note).toMatch(/^The sample date was not found/);
    expect(JSON.stringify(card)).not.toMatch(/NaN|undefined/);
    expect(markersReviewCard('c2', reviewOf({ extractionId: 'e2', sampleDate: '2026-02-03', rows: [] }, 'a2')!, '2026-10-03T00:00:00Z').note).toMatch(/^Sample date 3 Feb 2026/);
  });
});

describe('validate: oneOf means exactly one (V1e-18)', () => {
  it('rejects a value that matches two oneOf branches, while anyOf accepts it', () => {
    const branches = [{ type: 'number' }, { type: 'integer' }];
    expect(validate({ oneOf: branches }, 3).ok).toBe(false);
    expect(validate({ oneOf: branches }, 3.5).ok).toBe(true);
    expect(validate({ anyOf: branches }, 3).ok).toBe(true);
    expect(validate({ oneOf: branches }, 'x').ok).toBe(false);
  });
});
