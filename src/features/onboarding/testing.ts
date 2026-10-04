/**
 * Test helpers: seed the safety gate so screens behind <OnboardingGate> render in tests.
 *
 *   beforeEach(() => seedClearedSafety());      // standard mode, consent current
 */
import { useSafetyStore } from '@/state/safetyStore';
import { ACK_VERSIONS } from './copy';
import type { ScreeningAnswers } from './safetyRules';

export const STANDARD_ANSWERS: ScreeningAnswers = {
  ageBand: '18-64',
  pregnancy: 'no',
  eatingDisorder: 'no',
  scoffRisk: false,
  diabetes: 'no',
  conditions: 'no',
  metabolic: 'no',
  medications: 'no',
  symptoms: 'no',
  supervisedExercise: 'no',
  musculoskeletal: 'no',
  alcohol: 'no',
};

/** Commit answers and acknowledge the current disclaimer (defaults: standard answers, now). */
export function seedClearedSafety(answers: ScreeningAnswers = STANDARD_ANSWERS, at: string = new Date().toISOString()): void {
  const s = useSafetyStore.getState();
  s.resetSafety();
  s.commitAnswers(answers, at);
  s.acknowledge('disclaimer', ACK_VERSIONS.disclaimer, at);
}
