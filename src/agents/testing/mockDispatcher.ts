/**
 * A fake `AgentDispatcher` for tests and dev: records every call and answers `applied` (or `pending_user` when staged).
 * It does not enforce anything itself, so tests can show that `guardedCall` does.
 */
import type { AgentCallOptions, AgentDispatcher } from '../dispatcher';
import type { ToolManifest, ToolResultEnvelope } from '../manifest';

export interface MockCall {
  commandId: string;
  args: Record<string, unknown>;
  opts: AgentCallOptions;
}

export interface MockDispatcher extends AgentDispatcher {
  calls: MockCall[];
  /** Replace the answer (may wait on `opts.signal`). */
  respond: (call: MockCall) => Promise<ToolResultEnvelope> | ToolResultEnvelope;
  setManifest(m: ToolManifest): void;
}

export function createMockDispatcher(manifest: ToolManifest): MockDispatcher {
  let current = manifest;
  const mock: MockDispatcher = {
    calls: [],
    respond: (call) =>
      call.opts.stage
        ? { ok: true, status: 'pending_user', changeId: `chg-${mock.calls.length}`, summary: `Proposed ${call.commandId}` }
        : { ok: true, status: 'applied', summary: `Ran ${call.commandId}`, data: { echo: call.args } },
    manifest: () => current,
    setManifest(m) {
      current = m;
    },
    async call(commandId, args, opts) {
      const call = { commandId, args, opts };
      mock.calls.push(call);
      return mock.respond(call);
    },
  };
  return mock;
}
