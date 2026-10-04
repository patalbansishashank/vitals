/** `intake.nextQuestions` (E9b): the intake question sets as headless data (through the state gateway). */
import { implementLate as implement } from './late';

type Section = 'activity' | 'training' | 'diet' | 'kitchen' | 'supplements' | 'markers' | 'devices';

implement(
  'intake.nextQuestions',
  async (ctx, input: { section?: Section }) => {
    // loaded on first use: the question sets bring the intake chapters and their copy, which the registry must not carry
    const { nextIntakeQuestions } = await import('@/state/internal/intakeQuestions');
    // an empty list = every question of the section (or of all chapters) is answered or skipped
    return nextIntakeQuestions(ctx.now, input.section).questions;
  },
  'E9b',
);
