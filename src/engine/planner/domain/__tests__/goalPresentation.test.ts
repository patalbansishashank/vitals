// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { goalScorePresentation } from '../planner';

const keepFat = { value: 20.096, valueAvailable: true, target: 20, sense: 'min' as const, keepScale: 1, possible: 0.19, targetProgress: 0.904, withheld: false };

describe('keep-goal presentation follows the final simulation and unchanged verdict', () => {
  it('reproduces the hosted kept/90.4 contradiction without a slow search and presents the kept goal as complete', () => {
    expect(goalScorePresentation(keepFat)).toEqual({
      percentOfAchievable: 100, percentOfTarget: 90.4, met: true, verdict: 'kept', keepTolerance: 0.1,
    });
  });

  it('does not present an optimizer success as kept when the finalized prescription misses', () => {
    expect(goalScorePresentation({ ...keepFat, value: 20.3, targetProgress: 1 })).toEqual({
      percentOfAchievable: 70, percentOfTarget: 70, met: false, verdict: 'notReached', keepTolerance: 0.1,
    });
  });

  it('a final improvement remains kept even if the earlier search candidate missed', () => {
    expect(goalScorePresentation({ ...keepFat, value: 19.5, targetProgress: 0.2 })).toMatchObject({
      percentOfAchievable: 100, percentOfTarget: 150, met: true, verdict: 'kept',
    });
  });

  it('preserves the tolerance boundary instead of classifying goals by the rounded percentage', () => {
    expect(goalScorePresentation({ ...keepFat, value: 20.1 })).toMatchObject({ percentOfAchievable: 100, verdict: 'kept', keepTolerance: 0.1 });
    expect(goalScorePresentation({ ...keepFat, value: 20.100001 })).toMatchObject({ percentOfAchievable: 90, met: false, verdict: 'notReached', keepTolerance: 0.1 });
  });

  it('keeps the existing half-display-step floor for a small keep scale', () => {
    expect(goalScorePresentation({ ...keepFat, keepScale: 0.2, value: 20.04 })).toMatchObject({ percentOfAchievable: 100, percentOfTarget: 80, verdict: 'kept', keepTolerance: 0.05 });
    expect(goalScorePresentation({ ...keepFat, keepScale: 0.2, value: 20.06 })).toMatchObject({ percentOfAchievable: 70, verdict: 'notReached', keepTolerance: 0.05 });
  });

  it('uses the correct direction for retaining an upward metric such as muscle mass', () => {
    const muscle = { ...keepFat, value: 9.952, target: 10, sense: 'max' as const, keepScale: 0.5, targetProgress: 1 };
    expect(goalScorePresentation(muscle)).toMatchObject({ percentOfAchievable: 100, percentOfTarget: 90.4, verdict: 'kept', keepTolerance: 0.05 });
    expect(goalScorePresentation({ ...muscle, value: 9.9 })).toMatchObject({ percentOfAchievable: 80, percentOfTarget: 80, met: false, verdict: 'notReached' });
  });

  it('preserves wrong-way negative percentages rather than disguising a large miss as success', () => {
    expect(goalScorePresentation({ ...keepFat, value: 22 })).toMatchObject({ percentOfAchievable: -100, percentOfTarget: -100, met: false, verdict: 'notReached' });
  });

  it('partial or withheld goals retain their final nominal diagnostic percentage without claiming attainment', () => {
    expect(goalScorePresentation({ ...keepFat, targetProgress: 1, withheld: true })).toMatchObject({
      percentOfAchievable: 90.4, percentOfTarget: null, met: null, verdict: null,
    });
    expect(goalScorePresentation({ ...keepFat, value: 20.3, targetProgress: 1, withheld: true })).toMatchObject({
      percentOfAchievable: 70, percentOfTarget: null, met: null, verdict: null,
    });
  });

  it.each([0, Number.NaN])('an unavailable compatibility value %s cannot manufacture keep completion', (value) => {
    expect(goalScorePresentation({ ...keepFat, value, valueAvailable: false, withheld: true })).toMatchObject({
      percentOfAchievable: 0, percentOfTarget: null, met: null, verdict: null,
    });
  });

  it('missing target or invalid keep normalization cannot manufacture completion', () => {
    for (const change of [{ target: null }, { keepScale: 0 }, { keepScale: Number.NaN }]) {
      expect(goalScorePresentation({ ...keepFat, ...change })).toMatchObject({ percentOfAchievable: 0, percentOfTarget: null, met: null, verdict: null });
    }
  });

  it('leaves ordinary target and open-ended goal percentages unchanged', () => {
    expect(goalScorePresentation({ ...keepFat, value: 17, target: 18, keepScale: undefined, possible: 0.72, targetProgress: 1.2 })).toEqual({
      percentOfAchievable: 72, percentOfTarget: 120, met: true, verdict: 'reached',
    });
    expect(goalScorePresentation({ ...keepFat, target: null, keepScale: undefined, possible: 0.6 })).toEqual({
      percentOfAchievable: 60, percentOfTarget: null, met: null, verdict: null,
    });
  });
});
