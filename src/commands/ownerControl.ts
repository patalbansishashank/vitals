/**
 * Explicit local-owner delegation from the native MCP host (--mcp --full-control).
 * This entry point is reached only on the trusted preload IPC, never from an ordinary tool argument or WebMCP.
 * Commands retain validation, clinical/precondition gates, idempotency, confirmation and undo; history records the
 * local user acting on behalf of the named MCP client. The delegation ends with the native connection.
 */
import { rejected, type ToolResultEnvelope } from '@/agents/manifest';
import { dispatch } from '@/commands';
import { envelopeOf } from '@/commands/ai/agentDispatcher';
import { mintConfirmation } from '@/commands/confirm';
import { allCommands, getCommand } from '@/commands/registry';
import { toolName } from '@/commands/manifest';
import type { Actor, CommandId } from '@/commands/types';

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

export async function runOwnerControl(call: {
  client: string;
  tool: string;
  args: unknown;
  idempotencyKey?: string;
}): Promise<ToolResultEnvelope> {
  if (!object(call.args)) return rejected('invalid_input', 'Arguments must be a JSON object.');
  const input = call.args;
  if (call.tool === 'app_commands') {
    if (input.query !== undefined && typeof input.query !== 'string')
      return rejected('invalid_input', 'query must be text.');
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 50;
    if (
      !Number.isInteger(offset) ||
      (offset as number) < 0 ||
      !Number.isInteger(limit) ||
      (limit as number) < 1 ||
      (limit as number) > 100
    )
      return rejected('invalid_input', 'Use an offset of zero or more and a limit from 1 to 100.');
    const q = String(input.query ?? '').toLowerCase();
    const matches = allCommands().filter((d) => !q || `${d.id} ${d.title}`.toLowerCase().includes(q));
    const commands = matches
      .slice(offset as number, (offset as number) + (limit as number))
      .map((d) => ({
        id: d.id,
        title: d.title,
        perm: d.perm,
        impact: d.impact ?? null,
        implemented: !d.notImplemented,
        ...(input.schemas === true
          ? {
              inputSchema: d.input,
              outputSchema: d.output,
              safety: d.safety ?? [],
              preconditions: d.preconditions ?? [],
            }
          : {}),
      }));
    return {
      ok: true,
      status: 'applied',
      summary: 'Read the app command catalogue under owner delegation.',
      data: {
        authority: 'localOwnerDelegation',
        total: matches.length,
        offset,
        nextOffset:
          (offset as number) + commands.length < matches.length ? (offset as number) + commands.length : null,
        commands,
      },
    };
  }
  let id: string;
  let args: Record<string, unknown>;
  let confirm = false;
  if (call.tool === 'app_execute') {
    if (
      typeof input.commandId !== 'string' ||
      !object(input.input) ||
      (input.confirm !== undefined && typeof input.confirm !== 'boolean')
    )
      return rejected(
        'invalid_input',
        'Supply commandId and its input object; confirm is an optional boolean.',
      );
    id = input.commandId;
    args = input.input;
    confirm = input.confirm === true;
  } else {
    const entry = allCommands().find((d) => toolName(d.id) === call.tool);
    if (!entry) return rejected('not_found', 'That app command does not exist.');
    id = entry.id;
    args = input;
  }
  const def = getCommand(id);
  if (!def) return rejected('not_found', 'That app command does not exist.');
  const actor: Actor = { kind: 'user', id: 'local-user', onBehalfOf: { kind: 'mcp', id: call.client } };
  try {
    const result = await dispatch(id as CommandId, args as never, {
      actor,
      ...(call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {}),
      ...(confirm && def.perm === 'destructive' ? { confirmation: mintConfirmation(def.id, args) } : {}),
    });
    const envelope = await envelopeOf(def, result, undefined, { capResults: false });
    return envelope;
  } catch (error) {
    return rejected('internal', error instanceof Error ? error.message : 'The command failed.');
  }
}
