import { describe, expect, it } from 'vitest';
import { estimateWidth, fitPhaseLabel, placeEventLabels, relaxLabels } from '../lib/labels';

describe('truthful phase labels (REVIEW_FINDINGS 6)', () => {
  const p = { startDay: 28, endDay: 35, label: 'diet break', shortLabel: 'break', letter: '2' };
  const m = estimateWidth(6);
  it('uses the full name when it fits', () => {
    expect(fitPhaseLabel(p, 200, m)).toEqual({ text: 'diet break', abbreviated: false });
  });
  it('falls back to the authored short form, then the letter, never a clipped prefix', () => {
    expect(fitPhaseLabel(p, 50, m)).toEqual({ text: 'break', abbreviated: true });
    expect(fitPhaseLabel(p, 24, m)).toEqual({ text: '2', abbreviated: true });
    expect(fitPhaseLabel(p, 10, m).text).toBe('');
    for (const w of [20, 30, 40, 60, 70]) expect(fitPhaseLabel(p, w, m).text).not.toBe('diet');
  });
});

describe('greedy event labels', () => {
  it('keeps higher-priority labels and drops colliding ones', () => {
    const placed = placeEventLabels(
      [
        { id: 'a', x: 100, text: 'ketosis entered', priority: 60 },
        { id: 'b', x: 110, text: 'fast starts', priority: 50 },
        { id: 'c', x: 400, text: '36 h fast right after a lifting day', priority: 100 },
      ],
      800,
      estimateWidth(6),
    );
    const ids = placed.map((p) => p.id);
    expect(ids).toContain('c');
    expect(ids).toContain('a');
    for (let i = 1; i < placed.length; i++) expect(placed[i]!.left).toBeGreaterThanOrEqual(placed[i - 1]!.left + placed[i - 1]!.width);
  });
  it('flips a label to the left of its glyph near the right edge', () => {
    const [p] = placeEventLabels([{ id: 'a', x: 790, text: 'refeed', priority: 1 }], 800, estimateWidth(6));
    expect(p!.left + p!.width).toBeLessThanOrEqual(790);
  });
});

describe('end-label relaxation', () => {
  it('enforces a minimum gap, keeps order, stays in bounds', () => {
    const out = relaxLabels(
      [
        { id: 'a', y: 100 },
        { id: 'b', y: 103 },
        { id: 'c', y: 104 },
        { id: 'd', y: 300 },
      ],
      13,
      0,
      310,
    );
    expect(out.get('a')).toBe(100);
    expect(out.get('b')).toBe(113);
    expect(out.get('c')).toBe(126);
    expect(out.get('d')).toBe(300);
  });
  it('pushes labels back up from the bottom edge', () => {
    const out = relaxLabels(
      [
        { id: 'a', y: 98 },
        { id: 'b', y: 99 },
        { id: 'c', y: 100 },
      ],
      10,
      0,
      100,
    );
    expect(out.get('c')).toBe(100);
    expect(out.get('b')).toBe(90);
    expect(out.get('a')).toBe(80);
  });
});
