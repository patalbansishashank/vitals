/**
 * D4-02: a "yes" to fainting / chest pain / dizziness shows the urgent route in the symptom flow itself, and the safety
 * summary marks exercise for review (no diagnosis, no blanket ban on ordinary activity).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScreeningForm, SYMPTOMS_NOW } from './ScreeningForm';
import { EXERCISE_REVIEW, exerciseInReview } from './SafetySummary';
import type { ScreeningAnswers } from './safetyRules';

const base: ScreeningAnswers = { ageBand: '18-64' };

describe('symptom route (D4-02)', () => {
  it('shows the urgent route only for a yes', () => {
    const { rerender } = render(<ScreeningForm answers={{ ...base, symptoms: 'no' }} onChange={() => undefined} />);
    expect(screen.queryByText(SYMPTOMS_NOW.body)).toBeNull();
    rerender(<ScreeningForm answers={{ ...base, symptoms: 'yes' }} onChange={() => undefined} />);
    expect(screen.getByText(SYMPTOMS_NOW.body)).toBeInTheDocument();
  });

  it('marks exercise for review from the legacy symptom answer', () => {
    expect(exerciseInReview({ flags: ['exercise-symptoms'] })).toBe(true);
    expect(exerciseInReview({ flags: [] })).toBe(false);
    expect(EXERCISE_REVIEW).toBe('Exercise · Review');
  });
});
