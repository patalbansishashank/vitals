/**
 * Joins the server's AI and agent routes (`../serverAi.ts`, SUITE_SPEC §14.3, §14.4) to the `home` role: the person
 * comes from `home.resolvePerson(req)` (the single bearer → person point, §14.2), agent tokens live in the same
 * `persons/<id>/devices.json` as device tokens, and agent tool calls run in the person's worker.
 */
import type { IncomingMessage } from 'node:http';
import type { AgentClient, AgentScope, PersonContext, ResolvePerson, TokenRecord, TokenStore } from '../personContext.ts';
import { HttpError, type Logger } from '../security.ts';
import type { Upstream } from '../proxy.ts';
import { createServerAi } from '../serverAi.ts';
import type { ToolManifest, ToolResultEnvelope } from '../toolManifest.ts';
import type { DeviceRecord } from './devices.ts';
import type { HomeServer } from './home.ts';
import type { PersonRequest } from './personRpc.ts';

const toRecord = (d: DeviceRecord): TokenRecord => ({
  id: d.id,
  kind: d.kind,
  label: d.label,
  ...(d.client ? { client: d.client as AgentClient } : {}),
  scope: d.scope as AgentScope | 'full',
  hash: d.hash,
  createdAt: d.createdAt,
  lastSeenAt: d.lastSeenAt,
  ...(d.revokedAt ? { revokedAt: d.revokedAt } : {}),
});

/** `TokenStore` (E26's interface) over the home role's device store. */
export function homeTokenStore(home: HomeServer): TokenStore {
  const { devices } = home;
  const find = async (personId: string, id: string) => (await devices.list(personId)).find((d) => d.id === id);
  return {
    async mint(personId, r) {
      const { token, deviceId } = await devices.mint(personId, { kind: r.kind, label: r.label, scope: r.scope, ...(r.client ? { client: r.client } : {}) });
      const rec = await find(personId, deviceId);
      if (!rec) throw new Error('Token was not stored.');
      return { token, record: toRecord(rec) };
    },
    async list(personId, kind) {
      return (await devices.list(personId)).filter((d) => !kind || d.kind === kind).map(toRecord);
    },
    revoke: (personId, id) => devices.revoke(personId, id),
    async verify(token) {
      const r = await devices.resolve(token);
      if (!r.ok) return { error: r.error };
      const rec = await find(r.principal.personId, r.principal.deviceId);
      return rec ? { personId: r.principal.personId, record: toRecord(rec) } : { error: 'unauthorized' };
    },
    async touch(personId, id) {
      const rec = await find(personId, id);
      if (rec) devices.touch({ personId, deviceId: id, kind: rec.kind, scope: rec.scope, label: rec.label });
    },
  };
}

/** `ResolvePerson` (E26's interface) over `home.resolvePerson`; 401s become failures, other HTTP errors pass through. */
export function homeResolvePerson(home: HomeServer): ResolvePerson {
  return async (req: IncomingMessage) => {
    let ctx;
    try {
      ctx = await home.resolvePerson(req);
    } catch (e) {
      if (e instanceof HttpError && (e.code === 'unauthorized' || e.code === 'revoked')) return { error: e.code };
      throw e;
    }
    const [person, rec] = await Promise.all([home.persons.get(ctx.personId), home.devices.list(ctx.personId).then((l) => l.find((d) => d.id === ctx.deviceId))]);
    const paths = home.persons.paths(ctx.personId);
    const call = async (r: PersonRequest) => {
      const out = await ctx.worker.call(r);
      if (!out.ok) throw Object.assign(new Error(out.error.message), { code: out.error.code, ...(out.error.detail ? { detail: out.error.detail } : {}) });
      return out.value;
    };
    // one copy of the manifest per request: an MCP tool call reads it twice (tool list, then the call)
    let manifest: Promise<ToolManifest> | null = null;
    const out: PersonContext = {
      id: ctx.personId,
      deviceId: ctx.deviceId,
      kind: ctx.kind,
      scope: ctx.scope as AgentScope | 'full',
      ...(rec?.client ? { client: rec.client as AgentClient } : {}),
      label: rec?.label ?? '',
      dataDir: paths.dir,
      configDir: paths.credentials,
      timeZone: person?.timeZone ?? 'UTC',
      manifest: () => (manifest ??= call({ op: 'agentManifest' }).then((m) => m as ToolManifest)).catch((e: unknown) => {
        manifest = null;
        throw e;
      }),
      dispatch: async (command, input, actor, o = {}) =>
        (await call({
          op: 'agentCall',
          command,
          input,
          actorId: actor.id,
          ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}),
          ...(o.stage ? { stage: true } : {}),
        })) as ToolResultEnvelope,
    };
    return out;
  };
}

export function mountServerAi(home: HomeServer, o: { publicOrigin: string; version: string; log: Logger; aiRequestsPerMinute?: number; requestsPerDay?: number; fetch?: typeof globalThis.fetch; upstreams?: Record<string, Upstream> }) {
  return createServerAi({
    resolvePerson: homeResolvePerson(home),
    tokens: homeTokenStore(home),
    publicOrigin: o.publicOrigin,
    version: o.version,
    log: o.log,
    ...(o.aiRequestsPerMinute !== undefined ? { aiRequestsPerMinute: o.aiRequestsPerMinute } : {}),
    ...(o.requestsPerDay !== undefined ? { requestsPerDay: o.requestsPerDay } : {}),
    ...(o.fetch ? { fetch: o.fetch } : {}),
    ...(o.upstreams ? { upstreams: o.upstreams } : {}),
  });
}
