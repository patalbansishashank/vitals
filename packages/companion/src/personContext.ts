/**
 * What the server's AI and agent routes need from the server core (SUITE_SPEC §14.1, §14.2): one person resolved
 * from the bearer token alone, with that person's directories, time zone and a way to run an agent tool call in the
 * person's store (the person worker).
 *
 * The real resolver and worker come from the server core (`resolvePerson(req)`, one `worker_threads` Worker per
 * person). Until they are wired, this file also has a small file-backed token store and resolver over the §14.1
 * layout (`persons/index.json`, `persons/<id>/person.json`, `persons/<id>/devices.json`), used by the tests, by the
 * `agent-token` command and by a standalone run. Tokens are stored as SHA-256 only and never logged.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { writeJsonSecret } from './config.ts';
import type { ToolManifest, ToolResultEnvelope } from './toolManifest.ts';

export type AgentScope = 'read' | 'log' | 'edit';
export const AGENT_SCOPES: readonly AgentScope[] = ['read', 'log', 'edit'];
export type TokenKind = 'device' | 'agent';
export type AgentClient = 'codex' | 'opencode' | 'claude' | 'chatgpt-desktop' | 'other';
export const AGENT_CLIENTS: readonly AgentClient[] = ['codex', 'opencode', 'claude', 'chatgpt-desktop', 'other'];

/** A tool call run in the person's store: `guardedCall(createBusAgentDispatcher(…), manifest, 'mcp', …)` in the worker. */
export interface PersonDispatch {
  /** The person's `vitals.tools/1` manifest (every agent-surface tool; the routes filter it). */
  manifest(): Promise<ToolManifest>;
  /** Runs one command for an agent; never throws (failures are `rejected` envelopes). */
  dispatch(commandId: string, input: Record<string, unknown>, actor: { kind: 'mcp'; id: string }, opts?: { idempotencyKey?: string; stage?: boolean }): Promise<ToolResultEnvelope>;
}

export interface PersonContext extends PersonDispatch {
  /** Person id, 16 lowercase hex chars. */
  id: string;
  /** The token's record id (device or agent token). */
  deviceId: string;
  kind: TokenKind;
  scope: AgentScope | 'full';
  /** Agent tokens: which client it was minted for. */
  client?: AgentClient;
  label: string;
  /** `persons/<id>/` */
  dataDir: string;
  /** `persons/<id>/credentials/` (0700): provider keys, the ChatGPT sign-in. */
  configDir: string;
  /** IANA zone from `person.json`; days are the person's days, never the host's. */
  timeZone: string;
}

export type ResolveFailure = { error: 'unauthorized' | 'revoked' };
/** Resolves the person ONLY from `Authorization: Bearer …`; never from a path, query or body. */
export type ResolvePerson = (req: IncomingMessage) => Promise<PersonContext | ResolveFailure>;

export const isFailure = (r: PersonContext | ResolveFailure): r is ResolveFailure => 'error' in r;

// ---------------------------------------------------------------------------------------------------------------
// Directory layout (SUITE_SPEC §14.1)

export const PERSON_ID_RE = /^[0-9a-f]{16}$/;
export const personDir = (dataDir: string, id: string) => {
  if (!PERSON_ID_RE.test(id)) throw new Error('bad person id');
  return join(dataDir, 'persons', id);
};
export const credentialsDir = (dataDir: string, id: string) => join(personDir(dataDir, id), 'credentials');

export interface PersonInfo {
  label: string;
  timeZone: string;
  createdAt: string;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function listPersons(dataDir: string): Promise<Array<{ id: string; label: string; createdAt: string }>> {
  const list = await readJson<Array<{ id: string; label: string; createdAt: string }>>(join(dataDir, 'persons', 'index.json'));
  return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string' && PERSON_ID_RE.test(p.id)) : [];
}

export async function readPersonInfo(dataDir: string, id: string): Promise<PersonInfo | null> {
  return readJson<PersonInfo>(join(personDir(dataDir, id), 'person.json'));
}

/**
 * Creates a person directory (0700) with `person.json` and an index entry. The server core's `persons add` does
 * this (and joins the sync group); this helper exists for tests and standalone runs.
 */
export async function createPersonDir(dataDir: string, label: string, timeZone = 'UTC', id = randomBytes(8).toString('hex')): Promise<string> {
  const dir = personDir(dataDir, id);
  await mkdir(join(dir, 'credentials'), { recursive: true, mode: 0o700 });
  for (const d of [dataDir, join(dataDir, 'persons'), dir, join(dir, 'credentials')]) await chmod(d, 0o700).catch(() => undefined);
  await writeJsonSecret(join(dir, 'person.json'), { label, timeZone, createdAt: new Date().toISOString() });
  const index = await listPersons(dataDir);
  if (!index.some((p) => p.id === id)) await writeJsonSecret(join(dataDir, 'persons', 'index.json'), [...index, { id, label, createdAt: new Date().toISOString() }]);
  return id;
}

// ---------------------------------------------------------------------------------------------------------------
// Token records (`persons/<id>/devices.json`)

export interface TokenRecord {
  id: string;
  kind: TokenKind;
  label: string;
  client?: AgentClient;
  scope: AgentScope | 'full';
  /** hex SHA-256 of the token */
  hash: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt?: string;
}

export interface TokenStore {
  mint(personId: string, r: { kind: TokenKind; label: string; scope: AgentScope | 'full'; client?: AgentClient }): Promise<{ token: string; record: TokenRecord }>;
  list(personId: string, kind?: TokenKind): Promise<TokenRecord[]>;
  /** False when there is no such token of this person. */
  revoke(personId: string, id: string): Promise<boolean>;
  verify(token: string): Promise<{ personId: string; record: TokenRecord } | ResolveFailure>;
  /** Records use (`lastSeenAt`), at most once a minute per token. */
  touch(personId: string, id: string): Promise<void>;
}

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

export function createFileTokenStore(dataDir: string, now: () => number = Date.now): TokenStore {
  const file = (personId: string) => join(personDir(dataDir, personId), 'devices.json');
  const load = async (personId: string): Promise<TokenRecord[]> => {
    const v = await readJson<TokenRecord[]>(file(personId));
    return Array.isArray(v) ? v : [];
  };
  // one writer per person file at a time
  const queues = new Map<string, Promise<unknown>>();
  const update = <T>(personId: string, fn: (list: TokenRecord[]) => T | Promise<T>): Promise<T> => {
    const run = (queues.get(personId) ?? Promise.resolve()).then(async () => {
      const list = await load(personId);
      const out = await fn(list);
      await writeJsonSecret(file(personId), list);
      return out;
    });
    queues.set(personId, run.catch(() => undefined));
    return run;
  };
  const touched = new Map<string, number>();

  return {
    async mint(personId, r) {
      const token = randomBytes(32).toString('base64url');
      const record: TokenRecord = {
        id: randomBytes(8).toString('hex'),
        kind: r.kind,
        label: r.label.slice(0, 40),
        ...(r.client ? { client: r.client } : {}),
        scope: r.scope,
        hash: hashOf(token),
        createdAt: new Date(now()).toISOString(),
        lastSeenAt: null,
      };
      await update(personId, (list) => void list.push(record));
      return { token, record };
    },
    async list(personId, kind) {
      return (await load(personId)).filter((r) => !r.revokedAt && (!kind || r.kind === kind));
    },
    async revoke(personId, id) {
      return update(personId, (list) => {
        const r = list.find((x) => x.id === id && !x.revokedAt);
        if (!r) return false;
        r.revokedAt = new Date(now()).toISOString();
        return true;
      });
    },
    async verify(token) {
      if (typeof token !== 'string' || !token) return { error: 'unauthorized' };
      const want = Buffer.from(hashOf(token), 'hex');
      for (const p of await listPersons(dataDir)) {
        for (const r of await load(p.id)) {
          const have = Buffer.from(r.hash, 'hex');
          if (have.length === want.length && timingSafeEqual(have, want)) return r.revokedAt ? { error: 'revoked' } : { personId: p.id, record: r };
        }
      }
      return { error: 'unauthorized' };
    },
    async touch(personId, id) {
      const key = `${personId}/${id}`;
      if (now() - (touched.get(key) ?? 0) < 60_000) return;
      touched.set(key, now());
      await update(personId, (list) => {
        const r = list.find((x) => x.id === id);
        if (r) r.lastSeenAt = new Date(now()).toISOString();
      }).catch(() => undefined);
    },
  };
}

/** Bearer value of the `Authorization` header only (a token in the query or body is never read). */
export function bearerToken(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]{8,512})\s*$/i.exec(h);
  return m ? m[1]! : null;
}

/**
 * `resolvePerson` over the file token store. `dispatchFor(personId)` gives the person's worker; the server core
 * replaces this whole function with its own.
 */
export function createFileResolver(opts: { dataDir: string; tokens: TokenStore; dispatchFor: (personId: string) => PersonDispatch }): ResolvePerson {
  const { dataDir, tokens, dispatchFor } = opts;
  return async (req) => {
    const token = bearerToken(req);
    if (!token) return { error: 'unauthorized' };
    const v = await tokens.verify(token);
    if ('error' in v) return v;
    const info = await readPersonInfo(dataDir, v.personId);
    void tokens.touch(v.personId, v.record.id);
    const d = dispatchFor(v.personId);
    return {
      id: v.personId,
      deviceId: v.record.id,
      kind: v.record.kind,
      scope: v.record.scope,
      ...(v.record.client ? { client: v.record.client } : {}),
      label: v.record.label,
      dataDir: personDir(dataDir, v.personId),
      configDir: credentialsDir(dataDir, v.personId),
      timeZone: info?.timeZone ?? 'UTC',
      manifest: () => d.manifest(),
      dispatch: (commandId, input, actor, o) => d.dispatch(commandId, input, actor, o),
    };
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The worker side: the app's own guard over the command bus (R17 (c)). Modules are passed in, because this package
// does not import the app; the person worker passes `@/agents/dispatcher`, `@/commands/ai/agentDispatcher` and
// `@/agents/manifest`.

export interface BusModules {
  guardedCall: (
    dispatcher: unknown,
    manifest: ToolManifest,
    surface: 'mcp',
    toolName: string,
    args: unknown,
    opts: { actor: { kind: 'mcp'; id: string }; idempotencyKey?: string; stage?: boolean; correlationId?: string },
  ) => Promise<ToolResultEnvelope>;
  createBusAgentDispatcher: (o: { directApply: () => boolean }) => { manifest(): ToolManifest | Promise<ToolManifest> };
}

/**
 * `PersonDispatch` for the person worker. Direct apply is always off: on the server an agent's consequential write
 * is always staged as a proposal the person applies in the app (SUITE_SPEC §14.4). Each call is its own turn for the
 * bus's per-turn limits (an MCP tools/call has no turn around it; the per-token calls a minute is the throttle).
 */
export function busPersonDispatch(mods: BusModules): PersonDispatch {
  const dispatcher = mods.createBusAgentDispatcher({ directApply: () => false });
  let manifest: ToolManifest | null = null;
  let calls = 0;
  const getManifest = async () => (manifest ??= await dispatcher.manifest());
  return {
    manifest: getManifest,
    async dispatch(commandId, input, actor, o = {}) {
      const m = await getManifest();
      const entry = m.tools.find((t) => t.id === commandId);
      return mods.guardedCall(dispatcher, m, 'mcp', entry?.name ?? commandId, input, {
        actor,
        correlationId: `mcp-call-${++calls}`,
        ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}),
        ...(o.stage ? { stage: true } : {}),
      });
    },
  };
}
