/** One part of the slow audit's level matrix: the QA requests whose index falls to it (index mod LEVEL_PARTS). */
import { QA_KEYS } from '../__tests__/qa/requests';
import { LEVEL_PARTS } from './cache';
import { runLevelChain } from './levelsRun';

export async function runLevelPart(part: number): Promise<void> {
  for (const [i, key] of QA_KEYS.entries()) if (i % LEVEL_PARTS === part) await runLevelChain(key);
}
