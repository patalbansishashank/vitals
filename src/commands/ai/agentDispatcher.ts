/**
 * The `AgentDispatcher` (`src/agents/registry.ts`) over the command bus: what WebMCP in this tab and MCP clients
 * through the Companion bridge run (SUITE_SPEC §1.4, §1.8, §7.3).
 *
 * - `manifest()` is the app's own `vitals.tools/1` (`toolManifest()`, every agent-surface tool, with `TOOLSET_HASH`).
 * - `call()` dispatches with `actor: {kind:'webmcp'|'mcp', id}` and the caller's idempotency key. The bus applies
 *   reads and low-impact writes, stages consequential writes as `pendingChanges` (→ `pending_user`) and refuses
 *   destructive ones (`confirmation_required`). When the caller passes `stage: false` for a consequential write — only
 *   when the person let this client apply plan edits directly — it runs as the person on behalf of the agent, after
 *   this module checks that permission again.
 * - Long-running commands wait up to their soft timeout (≤ 25 s), then answer `running` with the job id.
 * - Results become the SUITE_SPEC §1.8 envelope (`data` capped to the tool-result budget); this never throws.
 */
import { rejected, type ToolManifest, type ToolResultEnvelope } from '@/agents/manifest';
import type { AgentCallOptions, AgentDispatcher } from '@/agents/registry';
import { toolManifest } from '../manifest';
import { getCommand } from '../registry';
import type { Actor, CommandDef, CommandError, CommandResult } from '../types';
import { directApplyFromSettings } from './settings';

/** SUITE_SPEC §1.7: agents wait at most this long for a job before answering `running`. */
const MAX_JOB_WAIT_MS = 25_000;

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

function fromError(error: CommandError): ToolResultEnvelope {
  const env: ToolResultEnvelope = {
    ok: false,
    status: 'rejected',
    summary: error.message,
    error: { code: error.code, message: error.message, ...(error.detail ? { detail: error.detail as Record<string, unknown> } : {}) },
  };
  const alternatives = error.detail?.allowedAlternatives;
  if (error.code === 'safety_blocked' && alternatives?.length) env.data = { allowedAlternatives: alternatives };
  return env;
}

async function capped(data: unknown): Promise<unknown> {
  if (data === undefined) return undefined;
  const { capToolResult } = await import('@/ai/tools/budget');
  const c = capToolResult(data);
  return c.truncated ? { partial: c.data, truncated: true, hint: c.hint, ...(c.nextCursor ? { nextCursor: c.nextCursor } : {}) } : c.data;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });
}

async function envelopeOf(def: CommandDef, r: CommandResult, signal?: AbortSignal): Promise<ToolResultEnvelope> {
  if (!r.ok) return fromError(r.error);
  if ('pending' in r && r.redirected) {
    // SUITE_SPEC §14.6: a device records this stream, so the entry was staged as a correction instead of a log entry
    return {
      ok: true,
      status: 'pending_user',
      changeId: r.pending.pendingId,
      summary: 'A device records this, so your entry became a correction for the person to confirm in Vitals; nothing has changed yet.',
      data: { redirected: r.redirected, proposalId: r.pending.pendingId },
    };
  }
  if ('pending' in r) {
    return {
      ok: true,
      status: 'pending_user',
      changeId: r.pending.pendingId,
      summary: `Proposed: ${def.title}. The person reviews and applies it in Vitals; nothing has changed yet.`,
    };
  }
  if ('job' in r) {
    const { jobs } = await import('../bus');
    const wait = Math.min(def.longRunning?.softTimeoutMs ?? MAX_JOB_WAIT_MS, MAX_JOB_WAIT_MS);
    const settled = await Promise.race([jobs.wait(r.job.jobId), sleep(wait, signal).then(() => null)]);
    if (settled?.state === 'done') {
      return { ok: true, status: 'applied', jobId: r.job.jobId, summary: `${def.title}: done.`, data: await capped(jobs.result(r.job.jobId)) };
    }
    if (settled && settled.error) return { ...fromError(settled.error), jobId: r.job.jobId };
    if (settled) return { ok: false, status: 'rejected', jobId: r.job.jobId, summary: `${def.title} stopped (${settled.state}).`, error: { code: 'cancelled', message: `${def.title} stopped.` } };
    return { ok: true, status: 'running', jobId: r.job.jobId, summary: `${def.title} is running. Check progress with the job status tool.` };
  }
  const output = def.toModel ? def.toModel(r.output as never) : r.output;
  const notes = r.notices.filter((n) => n.level !== 'info').map((n) => n.text);
  const base = def.perm === 'read' ? `Looked at ${lowerFirst(def.title)}.` : `${def.title}: done.`;
  return {
    ok: true,
    status: 'applied',
    ...(r.changeSet ? { changeId: r.changeSet.id } : {}),
    summary: notes.length ? `${base} ${notes.join(' ')}`.slice(0, 280) : base,
    ...(output !== undefined ? { data: await capped(output) } : {}),
  };
}

export interface BusAgentDispatcherOptions {
  /** The person's per-client direct-apply setting (default: `agents.configure`'s, from the documents). */
  directApply?: (actor: { kind: string; id: string }) => boolean;
  /** The manifest (default: the app's, generated from the registry). */
  manifest?: () => ToolManifest;
}

export function createBusAgentDispatcher(options: BusAgentDispatcherOptions = {}): AgentDispatcher {
  const allowDirect = options.directApply ?? ((a) => directApplyFromSettings(a));
  return {
    manifest: () => (options.manifest ?? toolManifest)(),
    async call(commandId: string, args: Record<string, unknown>, opts: AgentCallOptions): Promise<ToolResultEnvelope> {
      try {
        const def = getCommand(commandId);
        if (!def) return rejected('not_found', `Vitals has no tool ${JSON.stringify(commandId)}.`);
        if (opts.actor.kind !== 'mcp' && opts.actor.kind !== 'webmcp') return rejected('surface_forbidden', 'Only agents call tools here.');
        const agent: Actor = { kind: opts.actor.kind, id: String(opts.actor.id || opts.actor.kind).slice(0, 128) };
        const consequential = def.perm === 'write' && def.impact === 'consequential';
        if (opts.stage && def.perm === 'write' && !consequential) {
          // the bus applies low-impact writes; staging one is not something it can do
          return rejected('precondition_failed', `${def.title} applies directly; Vitals cannot hold it as a proposal.`);
        }
        // without the person's permission an unstaged consequential write still goes out as the agent: the bus stages it
        const direct = consequential && !opts.stage && allowDirect(agent);
        const actor: Actor = direct ? { kind: 'user', id: 'local-user', onBehalfOf: agent } : agent;
        if (direct && !def.surfaces.includes(agent.kind === 'webmcp' ? 'webmcp' : 'mcp')) {
          return rejected('surface_forbidden', def.excludedReason?.[agent.kind === 'webmcp' ? 'webmcp' : 'mcp'] ?? 'Not available to agents.');
        }
        const { dispatch } = await import('../bus');
        const r = await dispatch(commandId, args, {
          actor,
          ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey.slice(0, 64) } : {}),
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
        return await envelopeOf(def, r, opts.signal);
      } catch (e) {
        return rejected('internal', e instanceof Error && e.message ? e.message : 'Something went wrong in Vitals.');
      }
    },
  };
}
