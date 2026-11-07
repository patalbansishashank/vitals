/** Tools added only to an explicitly owner-launched --full-control LOCAL MCP session. */
import type { HostedMcpTool, McpBackend } from '../../../../packages/companion/src/mcp.ts';
import { idempotencyKeyFor } from '../../../../packages/companion/src/agentHub.ts';
import { rejected } from '../../../../packages/companion/src/toolManifest.ts';
import type { PageRelay } from './pageRelay';

export const OWNER_TOOLS: HostedMcpTool[] = [
  {
    name: 'app_commands',
    title: 'Discover all app commands',
    description:
      'Owner-delegated full app control: discover ALL registered app commands, including UI-only features, with optional schemas. Available only in this explicit local --full-control session. Native device gestures can still require hardware.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        schemas: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    annotations: { title: 'Discover all app commands', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'app_execute',
    title: 'Execute an app command',
    description:
      'Execute an app command under the owner delegation granted when launching this local MCP session. Ordinary schemas, clinical gates, idempotency, undo and audit still apply. Destructive operations additionally require confirm:true and the user authorization for that action. Use app_commands to discover the exact input schema.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        commandId: { type: 'string', minLength: 1 },
        input: { type: 'object', additionalProperties: true },
        confirm: { type: 'boolean' },
      },
      required: ['commandId', 'input'],
      additionalProperties: false,
    },
    annotations: { title: 'Execute an app command', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
];

export function ownerControlBackend(base: McpBackend, relay: PageRelay, client: string): McpBackend {
  return {
    async listTools() {
      return [...(await base.listTools()), ...OWNER_TOOLS];
    },
    async call(tool, args, ctx) {
      if (!OWNER_TOOLS.some((t) => t.name === tool) && !(await base.listTools()).some((t) => t.name === tool))
        return rejected('surface_forbidden', 'Unknown tool; use app_commands to discover app commands.');
      return relay.call({
        client,
        tool,
        args,
        fullControl: true,
        idempotencyKey: idempotencyKeyFor(client, ctx.scope, ctx.requestId),
      });
    },
  };
}
