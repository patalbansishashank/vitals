// The replica contract of the sync harness. Every replica, whatever runs it, answers:
//   write(cmd) → { at }      cmd: { op: 'logFood', id, date, text, kcal } | { op: 'patch', col, id, fields } | { op: 'put', col, id, value }
//   read(query) → { [docId]: fields }   query: { col: 'dailyLogs', date } | { col: 'settings', id: 'me' } | { col }
//   goOffline(), goOnline(), kill(), restart(), status(), close()
// Ring data (S5), optional: ring(cmd) on Node replicas (the app's own BLE mapping and biometrics store, see
// nodeReplicaChild.mjs), bioView(query) → { records, samples, live, … }; the server answers bio(query) through its
// `bio_series` / `bio_daily` tools.
// Kinds today: 'node' (a Node client running the app's sync code, one process per replica, behind its own switchable
// relay proxy) and 'server' (the person on the real Vitals Server, read and written through its MCP tools).
// L-QA adds 'desktop', 'phone' and 'browser' later by implementing the same object (see README.md).
import './tsResolve.mjs';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startProxy } from './proxy.mjs';
import { mealEntry } from './docs.mjs';
import { mcpClient } from './server.mjs';

const CHILD = fileURLToPath(new URL('./nodeReplicaChild.mjs', import.meta.url));
const { newDeviceId } = await import('../../../../src/store/ids.ts');

export async function openReplica(kind, opts) {
  if (kind === 'node') return openNodeReplica(opts);
  if (kind === 'server') return openServerReplica(opts);
  throw new Error(`replica kind "${kind}" is not built yet (L-QA plugs the real apps in through this contract)`);
}

/**
 * opts: { name, secret (Uint8Array), relayTarget (server origin), dir (data dir) }.
 * The replica's relay is a local proxy in front of `relayTarget`, so goOffline() cuts its socket like a lost network.
 */
async function openNodeReplica({ name, secret, relayTarget, dir }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const proxy = await startProxy(relayTarget);
  const deviceId = newDeviceId();
  const secretB64 = Buffer.from(secret).toString('base64url');
  let child = null;
  let seq = 0;
  const waiting = new Map();

  const spawnChild = async () => {
    const c = fork(CHILD, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env } });
    let errTail = '';
    c.stderr.on('data', (d) => (errTail = (errTail + d).slice(-2000)));
    c.on('message', (m) => {
      if (m.ready) return;
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      clearTimeout(w.timer);
      if (m.ok) w.resolve(m.value);
      else w.reject(new Error(`${name}: ${m.error}`));
    });
    c.on('exit', () => {
      for (const [id, w] of waiting) {
        waiting.delete(id);
        clearTimeout(w.timer);
        w.reject(new Error(`${name}: process exited${errTail ? ` (${errTail.split('\n').filter(Boolean).slice(-1)[0]})` : ''}`));
      }
    });
    await new Promise((resolve, reject) => {
      c.once('message', (m) => (m.ready ? resolve() : undefined));
      c.once('exit', (code) => reject(new Error(`${name}: child exited ${code}: ${errTail.slice(-300)}`)));
    });
    child = c;
    await call('open', { secret: secretB64, relayUrl: proxy.url, dataDir: dir, appName: `vitals-${name}`, deviceId, instance: name });
  };
  const call = (op, args, timeoutMs = 30000) =>
    new Promise((resolve, reject) => {
      if (!child || child.exitCode !== null || child.signalCode) return reject(new Error(`${name} is not running`));
      const id = ++seq;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`${name}: ${op} timed out`));
      }, timeoutMs);
      waiting.set(id, { resolve, reject, timer });
      child.send({ id, op, args });
    });
  const stop = async (signal) => {
    if (!child || child.exitCode !== null || child.signalCode) return;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill(signal);
    await exited;
  };

  await spawnChild();
  const docsOf = (list) => Object.fromEntries(list.filter((d) => !d._deleted).map((d) => [d._id, d.value]));
  return {
    kind: 'node',
    name,
    deviceId,
    async write(cmd) {
      if (cmd.op === 'logFood') return call('put', { col: 'dailyLogs', id: cmd.id, value: mealEntry(cmd), schema: 1 });
      if (cmd.op === 'patch') return call('patch', { col: cmd.col, id: cmd.id, fields: cmd.fields, schema: cmd.schema ?? 1 });
      if (cmd.op === 'put') return call('put', { col: cmd.col, id: cmd.id, value: cmd.value, schema: cmd.schema ?? 1 });
      throw new Error(`unknown write op ${cmd.op}`);
    },
    async read(query) {
      if (query.id) {
        const d = await call('get', { col: query.col, id: query.id });
        return d && !d._deleted ? { [d._id]: d.value } : {};
      }
      const docs = docsOf(await call('list', { col: query.col }));
      if (query.date) for (const [id, d] of Object.entries(docs)) if (d.date !== query.date) delete docs[id];
      return docs;
    },
    /** Epoch ms when this process first saw the document arrive from another replica (null: not yet). */
    arrivedAt: (col, id) => call('arrivedAt', { col, id }),
    async goOffline() {
      proxy.off();
    },
    async goOnline() {
      proxy.on();
    },
    /** SIGKILL: no close, no flush. */
    async kill() {
      await stop('SIGKILL');
    },
    async restart() {
      await stop('SIGKILL');
      await spawnChild();
    },
    async status() {
      const s = child && child.exitCode === null && !child.signalCode ? await call('status', {}).catch((e) => ({ state: 'error', error: e.message })) : { state: 'killed' };
      return { ...s, proxy: proxy.offline ? 'off' : 'on', upgrades: proxy.upgrades };
    },
    pull: () => call('pull', {}),
    /** Ring data through the app's own code: `{ op: 'read', events, ingestedAt, … }` (offline-safe), `{ op: 'flush' }` (uploads chunk bytes, what a sync round does), `{ op: 'share', … }`. */
    ring: (cmd) => call('ring', cmd, 60000),
    /** `{ records, recordDocs, samples, partial, strictError, live, all }` for one source, stream and day. */
    bioView: (q) => call('bioView', q, 60000),
    async close() {
      await call('close', {}, 15000).catch(() => undefined);
      await stop('SIGTERM');
      await proxy.close();
    },
  };
}

/**
 * opts: { name, serverBaseUrl, token, date }. The person worker's replica: reads through `log_get` / `settings_get`,
 * writes through `log_meal` / `settings_update` (MCP, agent token). The harness never takes the real server offline or
 * restarts it (only the orchestrator deploys); those calls throw.
 */
async function openServerReplica({ name = 'server', serverBaseUrl, token }) {
  // Two limits answer `rate_limited` (both checked by the 08:35Z run, which hit the first):
  //  - 60 tool calls a minute per agent token, a token bucket (packages/companion/src/agentsRemote.ts
  //    AGENT_CALLS_PER_MINUTE): every call here waits until at least PACE_MS after the previous one started, so a
  //    long scenario stays under it however many replicas poll at once; a `Wait N s` answer still waits and retries;
  //  - 20 reads / 5 writes per tool per "turn" on the command bus (src/commands/bus.ts rateLimited), keyed by the MCP
  //    client name when the call carries no turn id: the harness reconnects under a new client name before the count
  //    reaches the limit, and on a `rate_limited` answer without a wait.
  const PACE_MS = 1100;
  const PER_TURN = { read: 18, write: 4 };
  const WRITES = new Set(['log_meal', 'settings_update']);
  let generation = 0;
  let rotations = 0;
  let waits = 0;
  let calls = 0;
  let counts = new Map();
  let mcp = await mcpClient(serverBaseUrl, token, `l-sync-harness-${generation}`);
  const reconnect = async () => {
    await mcp.close();
    rotations += 1;
    counts = new Map();
    mcp = await mcpClient(serverBaseUrl, token, `l-sync-harness-${++generation}`);
  };
  let gate = Promise.resolve();
  let lastStart = 0;
  const paced = (fn) => {
    const run = gate.then(async () => {
      const wait = lastStart + PACE_MS - Date.now();
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
      lastStart = Date.now();
      calls += 1;
      return fn();
    });
    gate = run.catch(() => undefined);
    return run;
  };
  const once = (tool, args) =>
    paced(async () => {
      const n = (counts.get(tool) ?? 0) + 1;
      if (n > (WRITES.has(tool) ? PER_TURN.write : PER_TURN.read)) await reconnect();
      counts.set(tool, (counts.get(tool) ?? 0) + 1);
      try {
        return await mcp.call(tool, args);
      } catch {
        // a dropped MCP session: reconnect once
        await reconnect();
        counts.set(tool, 1);
        return mcp.call(tool, args);
      }
    });
  const call = async (tool, args) => {
    let r = await once(tool, args);
    for (let i = 0; i < 6 && r?.error?.code === 'rate_limited'; i++) {
      const wait = /Wait (\d+) s/.exec(r.summary ?? r.error.message ?? '')?.[1];
      if (wait) {
        waits += 1;
        await new Promise((res) => setTimeout(res, Number(wait) * 1000 + 200));
      } else await paced(reconnect);
      r = await once(tool, args);
    }
    return r;
  };
  const out = (r) => (r && r.ok !== false ? (r.data ?? r.output) : undefined);
  const unsupported = (what) => async () => {
    throw new Error(`${name}: ${what} is not done on the real server by this harness`);
  };
  return {
    kind: 'server',
    name,
    call,
    async write(cmd) {
      const at = Date.now();
      let r;
      if (cmd.op === 'logFood') r = await call('log_meal', { date: cmd.date, text: cmd.text, components: [{ name: cmd.text, grams: 150 }], method: 'typed', confidence: 1 });
      else if (cmd.op === 'patch' && cmd.col === 'settings') r = await call('settings_update', { patch: cmd.fields });
      else throw new Error(`${name}: write ${cmd.op} ${cmd.col ?? ''} has no MCP tool`);
      return { at, result: r };
    },
    async read(query) {
      if (query.col === 'dailyLogs') {
        const r = await call('log_get', { from: query.date, to: query.date });
        const data = out(r);
        // the tool result cap (4000 tokens, src/ai/tools/budget.ts) halves long lists: `{ partial, truncated }`, no cursor
        const list = Array.isArray(data) ? data : Array.isArray(data?.partial) ? data.partial : null;
        if (!list) throw new Error(`${name}: log_get answered ${JSON.stringify(r).slice(0, 200)}`);
        const docs = Object.fromEntries(list.map(({ id, ...rest }) => [id, rest]));
        if (!Array.isArray(data)) Object.defineProperty(docs, 'truncated', { value: true, enumerable: false });
        return docs;
      }
      if (query.col === 'settings') {
        const r = await call('settings_get', {});
        const v = out(r);
        if (!v || typeof v !== 'object') throw new Error(`${name}: settings_get answered ${JSON.stringify(r).slice(0, 200)}`);
        return { me: v };
      }
      throw new Error(`${name}: no MCP tool reads ${query.col}`);
    },
    /**
     * Ring data as an agent sees it: `{ metric, date }` → bio_series raw points of that day (`{ points, truncated,
     * hidden }`); `{ daily: date }` → bio_daily's row of that day (`{ day, hidden }`). Only streams the person shares
     * with the Coach are shown (the harness shares hr and sleep from replica A).
     */
    async bio(query) {
      if (query.daily) {
        const r = await call('bio_daily', { from: query.daily, to: query.daily });
        const v = out(r);
        if (!v || !Array.isArray(v.days)) throw new Error(`${name}: bio_daily answered ${JSON.stringify(r).slice(0, 200)}`);
        return { day: v.days.find((d) => d.date === query.daily) ?? null, hidden: v.hidden };
      }
      const r = await call('bio_series', { metric: query.metric, from: query.date, to: query.date, resolution: 'raw' });
      const v = out(r);
      const points = Array.isArray(v?.points) ? v.points : Array.isArray(v?.partial) ? v.partial : null;
      if (!points) throw new Error(`${name}: bio_series answered ${JSON.stringify(r).slice(0, 200)}`);
      return { points, truncated: Boolean(v.truncated) || !Array.isArray(v?.points), hidden: v.hidden };
    },
    goOffline: unsupported('going offline'),
    goOnline: async () => undefined,
    kill: unsupported('kill'),
    restart: unsupported('restart'),
    async status() {
      return { state: 'server', mcpCalls: calls, clientNameRotations: rotations, rateLimitWaits: waits };
    },
    close: () => mcp.close(),
  };
}
