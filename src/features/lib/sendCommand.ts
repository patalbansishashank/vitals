/**
 * Send a command from a screen and tell the person when it did not go through.
 *
 * `dispatch()` resolves with a result, it never shows anything. A screen that sends an edit and drops the result leaves
 * a refused or failed change silent. `sendCommand()` dispatches, and when the result is not ok it shows the reason in a
 * toast (the app shell's polite live region) in plain words. It resolves with the result, so a caller can react (say
 * "saved" only when `r.ok`). A thrown dispatch becomes an `internal` failure result; it never rejects.
 *
 * Imports the bus, not the registry (`@/commands`): the registry brings the engine. The caller imports the command
 * definitions it sends, as before.
 */
import { dispatch } from '@/commands/bus';
import { SAVE_FAILED_NOTICE, type CommandError, type CommandResult, type DispatchOptions, type InputOf, type KnownCommandId, type OutputOf } from '@/commands/types';
import { toast as showToast } from '@/components/Toast';

/** One failure toast at a time; the same id as the rolled-back save notice, so one failure never shows twice. */
export const COMMAND_FAILED_TOAST_ID = 'save-failed';

export const GENERIC_FAILURE = 'Couldn’t make that change. Try again.';

/**
 * The plain-words reason for a failed result, or null when nothing should be shown (the person cancelled).
 * Messages written for people (refusals, safety gates, preconditions) pass through; messages written for developers
 * (schema errors, unknown commands, raw exceptions) become a generic sentence.
 */
export function failureMessage(error: CommandError): string | null {
  if (error.code === 'cancelled') return null;
  const msg = (error.message ?? '').trim();
  if (!msg) return GENERIC_FAILURE;
  if (error.code === 'internal') return msg === SAVE_FAILED_NOTICE ? msg : GENERIC_FAILURE;
  if (error.code === 'quota_exceeded' && msg === SAVE_FAILED_NOTICE) return msg;
  if (error.code === 'invalid_input' && /^Invalid input/i.test(msg)) return 'That value wasn’t accepted.';
  if (/^Unknown command/i.test(msg)) return GENERIC_FAILURE;
  return msg;
}

export interface SendOptions extends DispatchOptions {
  /** Do not show the failure (the caller shows it itself). The result is still returned. */
  silent?: boolean;
}

/** Test seam: where failures are shown. */
let notify: (message: string) => void = (message) => {
  showToast(message, { id: COMMAND_FAILED_TOAST_ID, duration: 8000 });
};
export function setCommandFailureNotifier(fn: ((message: string) => void) | null): void {
  notify = fn ?? ((message) => void showToast(message, { id: COMMAND_FAILED_TOAST_ID, duration: 8000 }));
}

export function sendCommand<K extends KnownCommandId>(id: K, input: InputOf<K>, opts?: SendOptions): Promise<CommandResult<OutputOf<K>>>;
export function sendCommand(id: string, input: unknown, opts?: SendOptions): Promise<CommandResult>;
export async function sendCommand(id: string, input: unknown, opts: SendOptions = {}): Promise<CommandResult> {
  const { silent, ...dispatchOpts } = opts;
  let r: CommandResult;
  try {
    r = await (dispatch as (id: string, input: unknown, opts?: DispatchOptions) => Promise<CommandResult>)(id, input, dispatchOpts);
  } catch (e) {
    r = { ok: false, error: { code: 'internal', message: e instanceof Error ? e.message : String(e) } };
  }
  if (!r.ok && !silent) {
    const message = failureMessage(r.error);
    if (message) notify(message);
  }
  return r;
}

/** `sendCommand` that resolves true when the command went through. */
export async function sendCommandOk(id: string, input: unknown, opts?: SendOptions): Promise<boolean> {
  return (await sendCommand(id, input, opts)).ok;
}
