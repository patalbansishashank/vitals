import type { CommandResult } from '@/commands';

/** The output of a finished command (the caller knows its shape), or its error message thrown for the screen to show. */
export function unwrap(result: CommandResult): unknown {
  if (!result.ok) throw new Error(result.error.message);
  if (!('output' in result)) throw new Error('The sync command did not finish.');
  return result.output;
}
