/** Slow audit, level matrix part 4 (PLANNER_V2_SPEC §12.6; see levels.ts). */
import { it } from 'vitest';
import { runLevelPart } from './levelsPart';

it('level matrix, part 4', { timeout: 6 * 60 * 60 * 1000 }, async () => {
  await runLevelPart(4);
});
