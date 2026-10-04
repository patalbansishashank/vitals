/**
 * Main ↔ page relay for MCP tool calls (SUITE_SPEC §15.6, no server paired): main sends `McpCallRequest` over
 * `CHANNELS.mcpCall`, the page runs the tool through the command bus and answers on `CHANNELS.mcpResult`. The relay
 * also holds the tool manifest the page publishes. Same envelopes as the Companion's agent hub, so an AI tool sees one
 * behaviour whichever way it is connected.
 */
import { randomUUID } from 'node:crypto';
import { rejected, type ToolResultEnvelope } from '../../../../packages/companion/src/toolManifest.ts';
import type { McpCallRequest, McpCallResponse } from '../shared/bridge';

export const RELAY_TIMEOUT_MS = 30_000;
export const NO_WINDOW_MESSAGE = 'Vitals is not open; start it, then try again.';

export interface RelayCall {
  client: string;
  tool: string;
  args: unknown;
  idempotencyKey?: string;
}

export interface PageRelay {
  call(c: RelayCall): Promise<ToolResultEnvelope>;
  handleResult(r: McpCallResponse): void;
  setManifest(m: unknown): void;
  manifest(): unknown | null;
  onManifestChange(cb: () => void): () => void;
  /** The window is gone: pending calls fail, the manifest is dropped. */
  detach(): void;
}

export interface PageRelayOptions {
  send(req: McpCallRequest): void;
  timeoutMs?: number;
}

const STATUSES = new Set(['applied', 'pending_user', 'rejected', 'running']);
const validEnvelope = (e: unknown): e is ToolResultEnvelope => {
  if (!e || typeof e !== 'object') return false;
  const v = e as Record<string, unknown>;
  return typeof v.ok === 'boolean' && typeof v.summary === 'string' && STATUSES.has(v.status as string);
};

const timeoutEnvelope = (ms: number): ToolResultEnvelope => ({
  ok: false,
  status: 'running',
  summary: 'Vitals did not answer in time; the call may still complete. Check Vitals before retrying.',
  error: { code: 'timeout', message: `No answer from Vitals within ${Math.round(ms / 1000)} s` },
});

export function createPageRelay(o: PageRelayOptions): PageRelay {
  const timeoutMs = o.timeoutMs ?? RELAY_TIMEOUT_MS;
  const pending = new Map<string, { resolve: (e: ToolResultEnvelope) => void; timer: NodeJS.Timeout }>();
  const listeners = new Set<() => void>();
  let manifest: unknown | null = null;

  const settle = (callId: string, envelope: ToolResultEnvelope) => {
    const p = pending.get(callId);
    if (!p) return;
    pending.delete(callId);
    clearTimeout(p.timer);
    p.resolve(envelope);
  };
  const failAll = (envelope: ToolResultEnvelope) => {
    for (const id of [...pending.keys()]) settle(id, envelope);
  };
  const changed = () => {
    for (const cb of listeners) {
      try {
        cb();
      } catch {
        // a listener must not break the relay
      }
    }
  };

  return {
    call({ client, tool, args, idempotencyKey }) {
      const callId = randomUUID();
      return new Promise<ToolResultEnvelope>((resolve) => {
        const timer = setTimeout(() => settle(callId, timeoutEnvelope(timeoutMs)), timeoutMs);
        pending.set(callId, { resolve, timer });
        try {
          o.send({ callId, client, tool, args, ...(idempotencyKey ? { idempotencyKey } : {}) });
        } catch {
          settle(callId, rejected('unavailable', NO_WINDOW_MESSAGE));
        }
      });
    },
    handleResult(r) {
      if (!r || typeof r.callId !== 'string') return;
      settle(r.callId, validEnvelope(r.envelope) ? r.envelope : rejected('bad_result', 'Vitals answered with something that is not a tool result.'));
    },
    setManifest(m) {
      const next = m ?? null;
      const hashOf = (v: unknown) => (v && typeof v === 'object' ? (v as { hash?: unknown }).hash : undefined);
      const same = next === manifest || (next !== null && manifest !== null && typeof hashOf(next) === 'string' && hashOf(next) === hashOf(manifest));
      manifest = next;
      if (!same) changed();
    },
    manifest: () => manifest,
    onManifestChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    detach() {
      failAll(rejected('unavailable', NO_WINDOW_MESSAGE));
      if (manifest !== null) {
        manifest = null;
        changed();
      }
    },
  };
}
