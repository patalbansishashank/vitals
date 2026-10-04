/**
 * Read-only QA hook (plan 02 item 12, Q3): browser journeys assert app state through the command bus, not only the DOM.
 * Installed only when the page was opened with `?qa=1` (see `@/app/qaFlag`; remembered for the tab so in-app navigation
 * and reloads keep it). It can run `perm: 'read'` commands as the local user and list bus events; it cannot write.
 *
 *   await window.__vitals.read('plan.get', {})   // CommandResult
 */
import { allCommands, dispatch, getCommand, on, type BusEvent, type CommandResult } from '.';

export interface QaHook {
  readonly readOnly: true;
  /** Ids of every read command. */
  commands(): string[];
  /** Runs a read command; refuses anything else. */
  read(id: string, input?: unknown): Promise<CommandResult>;
  /** Bus events seen since the hook was installed (most recent last, at most 500). */
  events(): BusEvent[];
}

export function createQaHook(): QaHook {
  const seen: BusEvent[] = [];
  on((e) => {
    seen.push(e);
    if (seen.length > 500) seen.shift();
  });
  return Object.freeze({
    readOnly: true as const,
    commands: () =>
      allCommands()
        .filter((d) => d.perm === 'read')
        .map((d) => d.id as string),
    read: async (id: string, input: unknown = {}): Promise<CommandResult> => {
      const def = getCommand(id);
      if (!def) return { ok: false, error: { code: 'not_found', message: `unknown command ${id}` } };
      if (def.perm !== 'read')
        return { ok: false, error: { code: 'surface_forbidden', message: `${id} is not a read command` } };
      return dispatch(id, input);
    },
    events: () => seen.slice(),
  });
}

export function installQaHook(
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): QaHook {
  const hook = createQaHook();
  Object.defineProperty(target, '__vitals', { value: hook, configurable: true });
  return hook;
}
