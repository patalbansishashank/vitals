// Four-replica sync harness (plan 04 item 3): three Node replicas running the app's sync code (A = desktop app, B =
// phone app, C = website profile stand-ins) and the server person on the real Vitals Server, one sync group. Scenarios
// print PASS/FAIL lines and write qa/results/sync/<scenario>.json; the test person is removed at the end, also on failure.
//   node qa/scripts/sync/run.mjs [S1 S2 S3 S4 S5 S6]        (default: all)
//   SYNC_OFFLINE_S=60 (S2's offline period), SYNC_KEEP=1 (keep the person and the replica data for a look afterwards)
import './lib/tsResolve.mjs';
import fs from 'node:fs';
import { ROOT, harnessConfig, log, results, runDir, sleep } from './lib/config.mjs';
import { canonical, converged, todayIn } from './lib/docs.mjs';
import { openReplica } from './lib/replica.mjs';
import { LABEL_PREFIX, addPerson, agentToken, removePerson } from './lib/server.mjs';

const { newOwnerSecret, secretToWords } = await import('../../../src/sync/pairing.ts');
const { ulid } = await import('../../../src/store/ids.ts');

const TZ = 'Asia/Kolkata';
const OFFLINE_S = Number(process.env.SYNC_OFFLINE_S ?? 60);
/** Synced settings fields the server's `settings_get` shows (it adds device-local ones such as theme). */
const SETTINGS_FIELDS = ['units', 'energyUnit', 'glucoseUnit', 'dateStyle', 'weekStart', 'quietMode'];

/* ------------------------------------------------------------------------------------------------ waiting */

/**
 * Polls `replica.read(query)` until `pred(docs)` holds. Returns ms from `t0` to the first time it held (for Node
 * replicas, the moment the child process saw the document arrive when `arrival` names it), or null on timeout.
 */
async function visible(replica, query, pred, t0, { timeoutMs = 30000, every = null, arrival = null, read = null } = {}) {
  // the server answers 60 MCP calls a minute per agent token (packages/companion/src/agentsRemote.ts)
  const step = every ?? (replica.kind === 'server' ? 1100 : 100);
  const end = t0 + timeoutMs;
  while (Date.now() < end) {
    let docs = null;
    try {
      docs = read ? await read(replica) : await replica.read(query);
    } catch {
      /* a replica restarting; try again */
    }
    if (docs && pred(docs)) {
      const seen = Date.now();
      if (arrival && replica.arrivedAt) {
        const at = await replica.arrivedAt(arrival.col, arrival.id).catch(() => null);
        if (at && at >= t0 && at <= seen) return at - t0;
      }
      return seen - t0;
    }
    await sleep(step);
  }
  return null;
}
const has = (id) => (docs) => Boolean(docs[id]);
const fmt = (ms) => (ms === null ? 'not within the limit' : `${(ms / 1000).toFixed(2)} s`);

/** Same documents on every replica: dailyLogs of the day (all fields) and, once written, settings/me (synced fields). */
async function assertConvergence(r, reps, dates, { timeoutMs = 30000 } = {}) {
  const t0 = Date.now();
  let last = null;
  const nodes = reps.filter((x) => x.kind !== 'server').map((x) => x.name);
  while (Date.now() - t0 < timeoutMs) {
    const logs = {};
    const settings = {};
    const notes = [];
    try {
      const cut = [];
      for (const x of reps) {
        logs[x.name] = {};
        for (const date of dates) {
          const part = await x.read({ col: 'dailyLogs', date });
          if (part.truncated) cut.push({ name: x.name, date, ids: new Set(Object.keys(part)) });
          Object.assign(logs[x.name], part);
        }
        settings[x.name] = await x.read({ col: 'settings', id: 'me' });
      }
      // a server answer cut by the tool result cap is compared on the entries it shows (each must match the Node view)
      for (const c of cut) {
        notes.push(`${c.name}'s log_get for ${c.date} was cut by the 4000-token tool result cap: ${c.ids.size} entries compared`);
        for (const [id, d] of Object.entries(logs[nodes[0]])) if (d.date === c.date && !c.ids.has(id)) logs[c.name][id] = d;
      }
      const anySettings = nodes.some((n) => settings[n].me);
      const a = converged(logs);
      // The Node replicas hold the settings document as written (only the fields someone set); the server's
      // settings_get shows the settings in effect, defaults filled in. So the Node replicas are compared on the whole
      // document and the server on the synced fields the Node replicas actually hold (the 08:35Z run compared all six
      // and failed on defaults the documents never had).
      const held = SETTINGS_FIELDS.filter((f) => nodes.some((n) => settings[n].me?.[f] !== undefined));
      const bNodes = anySettings ? converged(Object.fromEntries(nodes.map((n) => [n, settings[n]]))) : { ok: true, diffs: [] };
      const bAll = anySettings ? converged(settings, held) : { ok: true, diffs: [] };
      if (anySettings) notes.push(`settings compared with the server on ${held.join(', ')}`);
      const counts = Object.fromEntries(Object.entries(logs).map(([n, d]) => [n, Object.keys(d).length]));
      last = { a, b: { ok: bNodes.ok && bAll.ok, diffs: [...bNodes.diffs, ...bAll.diffs] }, count: Object.keys(logs[nodes[0]]).length, counts, notes };
      if (last.a.ok && last.b.ok) break;
    } catch (e) {
      last = { a: { ok: false, diffs: [e.message] }, b: { ok: false, diffs: [e.message] }, count: last?.count ?? 0, notes };
    }
    await sleep(2500);
  }
  r.time('convergence check', Date.now() - t0);
  r.check(`convergence: dailyLogs of ${dates.join(', ')} identical on ${reps.map((x) => x.name).join(', ')} (${last.count} entries)`, last.a.ok, [...last.a.diffs.slice(0, 3), ...last.notes.filter((n) => !n.startsWith('settings')), last.counts ? `entries per replica ${JSON.stringify(last.counts)}` : ''].filter(Boolean).join('; '));
  r.check('convergence: settings/me identical (whole document on the Node replicas, the fields they hold on the server)', last.b.ok, [...last.b.diffs.slice(0, 3), ...last.notes.filter((n) => n.startsWith('settings'))].join('; '));
  return last.a.ok && last.b.ok;
}

/* ------------------------------------------------------------------------------------------------ scenarios */

async function S1({ A, B, C, S, day }) {
  const r = results('S1-online');
  const date = day(0);
  const id = ulid();
  const t0 = Date.now();
  await A.write({ op: 'logFood', id, date, text: 'S1 moong dal' });
  const q = { col: 'dailyLogs', date };
  const [b, c, s] = await Promise.all([B, C, S].map((x) => visible(x, q, has(id), t0, { timeoutMs: 15000, arrival: { col: 'dailyLogs', id } })));
  r.time('A→B', b);
  r.time('A→C', c);
  r.time('A→server', s);
  r.check(`A's food entry visible on B within 5 s (${fmt(b)})`, b !== null && b <= 5000);
  r.check(`A's food entry visible on C within 5 s (${fmt(c)})`, c !== null && c <= 5000);
  r.check(`A's food entry visible on the server within 5 s (${fmt(s)})`, s !== null && s <= 5000);
  await assertConvergence(r, [A, B, C, S], [date]);
  return r.save();
}

async function S2({ A, B, C, S, day }) {
  const r = results('S2-offline', { offlineSeconds: OFFLINE_S });
  const date = day(1);
  const q = { col: 'dailyLogs', date };
  const idA = ulid();
  const idB = ulid();
  await A.goOffline();
  await sleep(500);
  await A.write({ op: 'logFood', id: idA, date, text: 'S2 offline poha' });
  await B.write({ op: 'logFood', id: idB, date, text: 'S2 meanwhile upma' });
  log(`S2: A offline for ${OFFLINE_S} s`);
  await sleep(OFFLINE_S * 1000);
  const leaked = (await C.read(q))[idA] || (await S.read(q))[idA];
  r.check('while A is offline its entry reaches nobody (the cut is real)', !leaked);
  r.check("while A is offline it does not have B's entry", !(await A.read(q))[idB]);
  const upgradesBefore = (await A.status()).upgrades;
  const t0 = Date.now();
  await A.goOnline();
  const reconnect = (async () => {
    while (Date.now() - t0 < 60000) {
      const st = await A.status();
      if (st.upgrades > upgradesBefore) return Date.now() - t0;
      await sleep(100);
    }
    return null;
  })();
  const [b, c, s, back, rc] = await Promise.all([
    visible(B, q, has(idA), t0, { timeoutMs: 60000, arrival: { col: 'dailyLogs', id: idA } }),
    visible(C, q, has(idA), t0, { timeoutMs: 60000, arrival: { col: 'dailyLogs', id: idA } }),
    visible(S, q, has(idA), t0, { timeoutMs: 60000 }),
    visible(A, q, has(idB), t0, { timeoutMs: 60000, arrival: { col: 'dailyLogs', id: idB } }),
    reconnect,
  ]);
  r.time('A reconnect (socket re-opened)', rc);
  r.time('A→B', b);
  r.time('A→C', c);
  r.time('A→server', s);
  r.time('B→A', back);
  r.check(`A reconnected by itself after the network came back (${fmt(rc)})`, rc !== null);
  r.check(`A's offline entry visible on B within 30 s of coming online (${fmt(b)})`, b !== null && b <= 30000);
  r.check(`A's offline entry visible on C within 30 s (${fmt(c)})`, c !== null && c <= 30000);
  r.check(`A's offline entry visible on the server within 30 s (${fmt(s)})`, s !== null && s <= 30000);
  r.check(`A sees what B wrote meanwhile within 30 s (${fmt(back)})`, back !== null && back <= 30000);
  await assertConvergence(r, [A, B, C, S], [date]);
  return r.save();
}

async function S3({ A, B, C, S, day }) {
  const r = results('S3-fields');
  const date = day(2);
  const q = { col: 'settings', id: 'me' };
  // baseline written by C and seen everywhere
  const t0 = Date.now();
  await C.write({ op: 'patch', col: 'settings', id: 'me', fields: { units: 'metric', energyUnit: 'kcal' } });
  const isBase = (d) => d.me?.units === 'metric' && d.me?.energyUnit === 'kcal';
  const base = await Promise.all([A, B, S].map((x) => visible(x, q, isBase, t0, { timeoutMs: 20000 })));
  r.check('baseline settings (metric, kcal) on every replica', base.every((x) => x !== null), base.map(fmt).join(', '));

  const round = async (label, first, second, f1, f2) => {
    await first.goOffline();
    await second.goOffline();
    await sleep(500);
    await first.write({ op: 'patch', col: 'settings', id: 'me', fields: f1 });
    await second.write({ op: 'patch', col: 'settings', id: 'me', fields: f2 });
    await sleep(2000);
    const t1 = Date.now();
    await first.goOnline();
    await sleep(3000);
    await second.goOnline();
    const want = { ...f1, ...f2 };
    const both = (d) => Object.entries(want).every(([k, v]) => d.me?.[k] === v);
    const seen = await Promise.all([A, B, C, S].map((x) => visible(x, q, both, t1, { timeoutMs: 45000 })));
    seen.forEach((ms, i) => r.time(`${label} both edits on ${[A, B, C, S][i].name}`, ms));
    r.check(`${label}: ${first.name} edits ${Object.keys(f1)} and ${second.name} edits ${Object.keys(f2)} offline; ${first.name} online first; both edits survive on all four`, seen.every((x) => x !== null), seen.map(fmt).join(', '));
  };
  await round('round 1', A, B, { units: 'imperial' }, { energyUnit: 'kJ' });
  await round('round 2', B, A, { units: 'metric' }, { energyUnit: 'kcal' });
  await assertConvergence(r, [A, B, C, S], [date]);
  return r.save();
}

async function S4({ A, B, C, S, day }) {
  const r = results('S4-restart');
  const date = day(3);
  // the burst spreads over three days, 10 entries each: one log_get answer of 30 meals passes the 4000-token tool
  // result cap and comes back cut in half (the 08:35Z run), so the server could not be compared on all of them
  const burstDates = [day(4), day(6), day(7)];
  const burstDay = (i) => burstDates[i % 3];
  const q = { col: 'dailyLogs', date };
  const readBurst = async (x) => Object.assign({}, ...(await Promise.all(burstDates.map((d) => x.read({ col: 'dailyLogs', date: d })))));
  // (a) A writes while cut off and is killed (SIGKILL): 0 ms after the write resolved, then 100 ms after; both
  // writes must be on disk after restart, and after reconnecting they must reach everyone
  const id0 = ulid();
  const id = ulid();
  await A.goOffline();
  await sleep(300);
  await A.write({ op: 'logFood', id: id0, date, text: 'S4 killed at once' });
  await A.kill();
  await A.restart();
  r.check('A killed 0 ms after a write resolved (before any sync): the write is still there after restart', Boolean((await A.read(q))[id0]), 'known product finding R20-OUTBOX-09: put() resolves before Evolu stores the row; window measured by killWindow.mjs (S4-kill-window.json)');
  await A.write({ op: 'logFood', id, date, text: 'S4 killed-before-sync khichdi' });
  await sleep(100);
  await A.kill();
  const tr = Date.now();
  await A.restart();
  r.time('A restart', Date.now() - tr);
  r.check('A killed 100 ms after a write, before its first sync: the write is still there after restart', Boolean((await A.read(q))[id]));
  const t0 = Date.now();
  await A.goOnline();
  const seen = await Promise.all([B, C, S].map((x) => visible(x, q, has(id), t0, { timeoutMs: 45000, arrival: { col: 'dailyLogs', id } })));
  seen.forEach((ms, i) => r.time(`killed write → ${[B, C, S][i].name}`, ms));
  r.check(`after restart and reconnect the write reaches B, C and the server (${seen.map(fmt).join(', ')})`, seen.every((x) => x !== null));

  // (b) B is killed while receiving a burst, restarted, and ends with everything
  const ids = Array.from({ length: 30 }, () => ulid());
  const t1 = Date.now();
  for (const [i, x] of ids.entries()) await A.write({ op: 'logFood', id: x, date: burstDay(i), text: `S4 burst ${i + 1}` });
  const qb = { col: 'dailyLogs' };
  const first = await visible(B, qb, (d) => ids.some((x) => d[x]), t1, { timeoutMs: 20000, every: 20 });
  const gotBeforeKill = Object.keys(await B.read(qb).catch(() => ({}))).filter((x) => ids.includes(x)).length;
  await B.kill();
  r.check(`B killed while receiving (it held ${gotBeforeKill} of 30 burst entries)`, first !== null, `first arrival ${fmt(first)}`);
  await sleep(1000);
  const t2 = Date.now();
  await B.restart();
  const all = await visible(B, qb, (d) => ids.every((x) => d[x]), t2, { timeoutMs: 45000 });
  r.time('B restart → all 30 entries', all);
  r.check(`B restarted holds all 30 entries, nothing lost (${fmt(all)})`, all !== null);
  const onServer = await visible(S, { col: 'dailyLogs', dates: burstDates }, (d) => ids.every((x) => d[x]), t1, { timeoutMs: 30000, read: readBurst });
  r.check(`the server holds all 30 burst entries (${fmt(onServer)} after the first write)`, onServer !== null);
  await assertConvergence(r, [A, B, C, S], [date, ...burstDates]);
  return r.save();
}

/* ------------------------------------------------------------------------------------------------ S5: one ring, two devices */

// The ring as the app's BLE driver hands it over: decoded events (src/biometrics/core/ble/types.ts RingDecodedEvent),
// mapped and ingested by the app's own code inside each Node replica (nodeReplicaChild.mjs ring/bioView). A test ring
// model, so the source key is the person's own test source: ble:jstyle2301|j-style:l-sync_test_ring.
const RING_TZ_OFFSET_S = 19800; // Asia/Kolkata, the person's zone
const ringCtx = (ingestedAt) => ({
  tz: TZ,
  tzOffsetS: RING_TZ_OFFSET_S,
  channel: 'ble:jstyle2301',
  device: { type: 'ring', manufacturer: 'J-Style', model: 'L-SYNC test ring', tier: 'C' },
  decoder: 'jstyle2301/V0789@1',
  firmware: 'V0789',
  producer: { name: 'vitals-ble', version: '1' },
  ingestedAt,
  exportedAt: ingestedAt,
});
/** Minute `i` of the night of `date` (01:00 local + i minutes). */
const minuteAt = (date, i) => Date.parse(`${date}T01:00:00+05:30`) + i * 60_000;
const hrEvents = (date, from, to, value = (i) => 60 + (i % 25)) =>
  Array.from({ length: to - from }, (_, k) => ({ type: 'sample', stream: 'hr', t: minuteAt(date, from + k), value: value(from + k), unit: 'bpm', origin: 'history' }));
/** The night that ends on `date`: 23:00 local the evening before, 420 one-minute epochs; `revised` moves the stages. */
const sleepEvent = (date, { complete, revised = false }) => {
  const start = Date.parse(`${date}T00:00:00+05:30`) - 3600_000;
  const stages = Array.from({ length: 420 }, (_, i) => {
    const c = i % 90;
    if (revised) return c < 25 ? 'deep' : c < 60 ? 'light' : c < 80 ? 'rem' : 'awake';
    return c < 15 ? 'deep' : c < 70 ? 'light' : 'rem';
  });
  return { type: 'sleepEpochs', start, epochS: 60, stages, rawCodes: [], firmware: 'V0789', complete };
};
const minuteOf = (date, t) => Math.round((t - minuteAt(date, 0)) / 60_000);

async function S5({ A, B, S }) {
  const r = results('S5-ring-two-devices', {
    asserted: 'one sleep record per night on A and B, the highest version (B\'s complete, revised night); the union of both reads, one sample per (origin, time) and the same value on A, B and the server; the newest write wins a revised minute; no reader threw; the server agent view shows the union and the revised night; after the next write one live manifest per day on A and B',
    observed: 'stored record versions per night (both kept, the reader takes the highest); live and superseded manifests before the fold; partial reads while chunk bytes are missing; times',
  });
  // dates far from the food scenarios' days; bio data never touches dailyLogs
  const bioDay = (n) => {
    const d = new Date(`${todayIn(TZ)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const flushBoth = () => Promise.all([A.ring({ op: 'flush' }), B.ring({ op: 'flush' })]);
  const viewOf = (x, date, recordId) => x.bioView({ sourceKey: sk, stream: 'hr', date, recordId });
  const until = async (fn, timeoutMs, every = 300) => {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeoutMs) {
      try {
        last = await fn();
        if (last?.ok) return { ...last, ms: Date.now() - t0 };
      } catch (e) {
        last = { ok: false, error: e.message };
      }
      await sleep(every);
    }
    return { ...last, ok: false, ms: null };
  };

  // (1) seed: the night before on A, online; A shares hr and sleep with the Coach (what the person does in Settings);
  // B and the server see it
  const seedDate = bioDay(12);
  const seed = await A.ring({ op: 'read', events: [...hrEvents(seedDate, 0, 10), sleepEvent(seedDate, { complete: true })], ctx: ringCtx(new Date().toISOString()) });
  const sk = seed.sources[0];
  r.check('seed: A ingested the first night through the app\'s BLE mapping and biometrics store', seed.samples === 10 && seed.records >= 1 && Boolean(sk), JSON.stringify({ ...seed, sources: undefined }));
  await A.ring({ op: 'share', sourceKey: sk, streams: { hr: 'daily+series', sleep_sessions: 'daily' } });
  const tSeed = Date.now();
  await A.ring({ op: 'flush' });
  const seenB = await until(async () => {
    const v = await viewOf(B, seedDate);
    return { ok: v.samples.length === 10 && v.records.length === 1, v };
  }, 30000);
  const seenS = await until(async () => {
    const v = await S.bio({ metric: 'hr', date: seedDate });
    return { ok: v.points.length === 10, n: v.points.length, hidden: v.hidden };
  }, 45000, 0);
  r.time('seed A→B (10 samples + record readable)', seenB.ms);
  r.time('seed A→server (bio_series shows 10 samples)', seenS.ms);
  r.check(`seed visible on B (${fmt(seenB.ms)}) and on the server through bio_series (${fmt(seenS.ms)})`, seenB.ok && seenS.ok, seenS.ok ? '' : JSON.stringify(seenS).slice(0, 300));

  const K = 30;
  const M = 15;
  const REVISED = [10, 11, 12];
  const bValue = (i) => (REVISED.includes(i) ? 120 + i : 60 + (i % 25));
  const round = async (label, date, order) => {
    // (2) both offline: A reads minutes 0..K-1 and a provisional night; a little later B reads 0..K+M-1 with the
    // ring's revised night (complete, other stages) and three revised minutes
    await A.goOffline();
    await B.goOffline();
    await sleep(300);
    const tA = new Date().toISOString();
    const a = await A.ring({ op: 'read', events: [...hrEvents(date, 0, K), sleepEvent(date, { complete: false })], ctx: ringCtx(tA) });
    const tB = new Date(Date.now() + 1000).toISOString();
    const b = await B.ring({ op: 'read', events: [...hrEvents(date, 0, K + M, bValue), sleepEvent(date, { complete: true, revised: true })], ctx: ringCtx(tB) });
    r.check(`${label}: same night, same record id on both devices; B's version is higher (complete beats provisional)`, a.sleep && b.sleep && a.sleep.record_id === b.sleep.record_id && b.sleep.version > a.sleep.version, JSON.stringify({ a: a.sleep, b: b.sleep }));
    // (3) online in the given order; each one's sync round uploads its chunk bytes
    const [first, second] = order === 'A first' ? [A, B] : [B, A];
    const t0 = Date.now();
    await first.goOnline();
    await sleep(1500);
    await first.ring({ op: 'flush' });
    await sleep(1500);
    await second.goOnline();
    await sleep(1500);
    await second.ring({ op: 'flush' });
    const want = Array.from({ length: K + M }, (_, i) => i);
    const views = {};
    const conv = await until(async () => {
      const [va, vb] = await Promise.all([viewOf(A, date, b.sleep.record_id), viewOf(B, date, b.sleep.record_id)]);
      views.A = va;
      views.B = vb;
      const okv = (v) => v.samples.length === K + M && v.records.length === 1 && v.records[0].version === b.sleep.version && v.partial === false;
      return { ok: okv(va) && okv(vb) };
    }, 60000);
    r.time(`${label}: both online → A and B hold the union and the revised night`, conv.ms === null ? null : Date.now() - t0);
    for (const [n, v] of Object.entries(views)) {
      const mins = v.samples.map((x) => minuteOf(date, x.t));
      const keys = new Set(v.samples.map((x) => `${x.origin}|${x.t}`));
      r.check(`${label}: ${n} holds one sleep record for the night, version ${b.sleep.version} (B's), asleep ${b.sleep.asleep_s} s`, v.records.length === 1 && v.records[0].version === b.sleep.version && v.records[0].asleep_s === b.sleep.asleep_s, JSON.stringify(v.records));
      r.check(`${label}: ${n} reads the union of both reads (minutes 0..${K + M - 1}), one sample per (origin, time)`, keys.size === v.samples.length && canonical([...mins].sort((x, y) => x - y)) === canonical(want), `${v.samples.length} samples, ${keys.size} distinct`);
      r.check(`${label}: ${n}'s revised minutes carry B's newer values`, REVISED.every((i) => v.samples.find((x) => minuteOf(date, x.t) === i)?.value === bValue(i)), JSON.stringify(v.samples.filter((x) => REVISED.includes(minuteOf(date, x.t))).map((x) => x.value)));
      r.check(`${label}: no reader threw on ${n} (non-strict and strict reads)`, v.readError === null && v.strictError === null, [v.readError, v.strictError].filter(Boolean).join('; '));
      r.observe(`${label}: ${n} stored versions of the night`, v.recordDocs.length);
      r.observe(`${label}: ${n} live manifests for the day`, v.live.length);
      r.observe(`${label}: ${n} manifests incl. superseded`, v.all);
    }
    r.check(`${label}: A and B read identical samples`, canonical(views.A.samples) === canonical(views.B.samples));
    // the server agrees when its agent view shows the union, one point per time, with A's and B's values
    const byMin = Object.fromEntries(views.A.samples.map((x) => [minuteOf(date, x.t), x.value]));
    const srv = await until(async () => {
      const v = await S.bio({ metric: 'hr', date });
      const sMins = v.points.map((p) => minuteOf(date, Date.parse(p.t)));
      const wrong = v.points.filter((p) => p.value !== byMin[minuteOf(date, Date.parse(p.t))]).map((p) => `${minuteOf(date, Date.parse(p.t))}:${p.value}≠${byMin[minuteOf(date, Date.parse(p.t))]}`);
      const ok = new Set(sMins).size === v.points.length && canonical([...sMins].sort((x, y) => x - y)) === canonical(want) && wrong.length === 0;
      return { ok, n: v.points.length, distinct: new Set(sMins).size, wrong: wrong.slice(0, 6), truncated: v.truncated, hidden: v.hidden };
    }, 60000, 0);
    r.time(`${label}: both online → the server's bio_series agrees with A and B`, srv.ms === null ? null : Date.now() - t0);
    r.check(`${label}: the server (agent view, bio_series) shows the same union, one point per time, the same values as A and B (${fmt(srv.ms === null ? null : Date.now() - t0)})`, srv.ok, srv.ok ? '' : JSON.stringify({ n: srv.n, distinct: srv.distinct, wrong: srv.wrong, truncated: srv.truncated, hidden: srv.hidden, error: srv.error }).slice(0, 300));
    const daily = await S.bio({ daily: date });
    const asleepH = daily.day?.sleep?.asleepH;
    r.check(`${label}: the server's bio_daily shows the revised night (${(b.sleep.asleep_s / 3600).toFixed(2)} h asleep; A's provisional night had ${(a.sleep.asleep_s / 3600).toFixed(2)} h)`, typeof asleepH === 'number' && Math.abs(asleepH - b.sleep.asleep_s / 3600) < 0.02, JSON.stringify(daily.day?.sleep ?? daily).slice(0, 300));
    return { views, b };
  };

  const d1 = bioDay(10);
  const r1 = await round('order A first', d1, 'A first');
  await round('order B first', bioDay(9), 'B first');

  // (5) the next write folds the siblings: A reads one more minute online; A and B end with one live manifest
  const before = r1.views.A.live.length;
  await A.ring({ op: 'read', events: hrEvents(d1, 50, 51), ctx: ringCtx(new Date(Date.now() + 2000).toISOString()) });
  await A.ring({ op: 'flush' });
  const folded = await until(async () => {
    const [va, vb] = await Promise.all([viewOf(A, d1), viewOf(B, d1)]);
    return { ok: va.live.length === 1 && vb.live.length === 1 && vb.samples.length === K + M + 1 && vb.partial === false, va, vb };
  }, 45000);
  r.observe('fold: live manifests on A before the next write', before);
  r.check(`fold: after A's next write one live manifest for the day on A and B, holding all ${K + M + 1} samples`, folded.ok, folded.ok ? '' : JSON.stringify({ a: folded.va?.live, b: folded.vb?.live, nB: folded.vb?.samples?.length }).slice(0, 300));

  // (6) A's documents reach the relay, A is killed before it uploads the chunk bytes, B comes online: B reads what it
  // can without throwing; after A restarts and uploads, B reads everything
  const d3 = bioDay(8);
  await A.goOffline();
  await B.goOffline();
  await sleep(300);
  await A.ring({ op: 'read', events: hrEvents(d3, 0, K), ctx: ringCtx(new Date().toISOString()) });
  await B.ring({ op: 'read', events: hrEvents(d3, K - 10, K + M), ctx: ringCtx(new Date(Date.now() + 1000).toISOString()) });
  await A.goOnline();
  const docsOut = await until(async () => ({ ok: (await A.status()).state === 'synced' }), 15000, 200);
  await sleep(1500);
  await A.kill();
  await B.goOnline();
  await B.ring({ op: 'flush' });
  const half = await until(async () => {
    const v = await viewOf(B, d3);
    return { ok: v.live.length >= 2 || v.partial === true, v };
  }, 30000);
  const hv = half.v ?? {};
  r.time('kill before upload: B sees A\'s manifest without its bytes (ms)', half.ms);
  r.observe('kill before upload: B samples readable while A\'s bytes were missing', hv.samples?.length ?? null);
  r.observe('kill before upload: B partial flag / strict read error', { partial: hv.partial ?? null, strictError: hv.strictError ? hv.strictError.slice(0, 120) : null });
  r.check(`kill before upload: A's documents were out (${docsOut.ok}); B's non-strict read did not throw while A's bytes were missing (partial ${hv.partial})`, half.ok && hv.readError === null, JSON.stringify({ partial: hv.partial, readError: hv.readError, strictError: hv.strictError?.slice(0, 120), live: hv.live?.length }));
  const tR = Date.now();
  await A.restart();
  await A.ring({ op: 'flush' });
  const full = await until(async () => {
    const v = await viewOf(B, d3);
    return { ok: v.samples.length === K + M && v.partial === false && v.strictError === null, v };
  }, 45000);
  r.time('kill before upload: A restart + upload → B reads everything', full.ms === null ? null : Date.now() - tR);
  r.check(`kill before upload: after A restarts and uploads, B reads all ${K + M} samples (${fmt(full.ms)})`, full.ok, full.ok ? '' : JSON.stringify({ n: full.v?.samples?.length, partial: full.v?.partial }).slice(0, 200));
  await flushBoth();
  return r.save({ sourceKey: sk });
}

async function S6({ A, B, C, S, day }) {
  const r = results('S6-mcp');
  const date = day(5);
  const t0 = Date.now();
  const w = await S.write({ op: 'logFood', date, text: 'boiled egg' });
  const res = w.result?.data;
  const id = res?.entryId;
  r.check('log_meal through the server MCP (agent token, log scope) logged an entry', res?.status === 'logged' && Boolean(id), JSON.stringify(w.result).slice(0, 200));
  if (id) {
    const q = { col: 'dailyLogs', date };
    const seen = await Promise.all([A, B, C].map((x) => visible(x, q, has(id), t0, { timeoutMs: 15000, arrival: { col: 'dailyLogs', id } })));
    seen.forEach((ms, i) => r.time(`server→${[A, B, C][i].name}`, ms));
    r.check(`the MCP meal appears on A, B and C within 5 s (${seen.map(fmt).join(', ')})`, seen.every((x) => x !== null && x <= 5000));
  }
  await assertConvergence(r, [A, B, C, S], [date]);
  return r.save();
}

/* ------------------------------------------------------------------------------------------------ main */

const ALL = { S1, S2, S3, S4, S5, S6 };
const want = process.argv.slice(2).filter((a) => ALL[a]);
const list = want.length ? want : Object.keys(ALL);
const cfg = harnessConfig();
const run = new Date().toISOString().replace(/[:.]/g, '-');
const dir = runDir(run);
const secret = newOwnerSecret();
const summary = {};
let personId = null;
let token = null;
const reps = [];
let exitCode = 1;
const onSignal = () => cleanup().finally(() => process.exit(130));
process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const x of reps) await x.close().catch(() => undefined);
  if (personId && !process.env.SYNC_KEEP) log(`server person removed: ${await removePerson(cfg.sshHost, personId, token?.id).catch((e) => e.message)}`);
  if (!process.env.SYNC_KEEP) fs.rmSync(dir, { recursive: true, force: true });
}
try {
  log(`run ${run}: scenarios ${list.join(' ')}`);
  personId = await addPerson(cfg.sshHost, `${LABEL_PREFIX}harness`, secretToWords(secret).join(' '), TZ);
  log(`server person ${personId} joined the harness's sync group`);
  token = await agentToken(cfg.sshHost, personId);
  const S = await openReplica('server', { name: 'server', serverBaseUrl: cfg.serverBaseUrl, token: token.token });
  reps.push(S);
  const used = new Set();
  // each scenario logs on its own day (today, yesterday, …) so one server answer stays under the tool result cap
  const day = (n) => {
    const d = new Date(`${todayIn(TZ)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    const iso = d.toISOString().slice(0, 10);
    used.add(iso);
    return iso;
  };
  await S.read({ col: 'dailyLogs', date: todayIn(TZ) }); // opens the person's worker before any timing
  for (const name of ['A', 'B', 'C']) reps.push(await openReplica('node', { name, secret, relayTarget: cfg.serverBaseUrl, dir: `${dir}/${name}` }));
  const [A, B, C] = reps.slice(1);
  for (let i = 0; i < 100 && !(await Promise.all([A, B, C].map((x) => x.status()))).every((s) => s.state === 'synced'); i++) await sleep(200);
  log(`replicas: ${JSON.stringify(Object.fromEntries(await Promise.all(reps.map(async (x) => [x.name, (await x.status()).state]))))}`);
  for (const s of list) {
    try {
      const out = await ALL[s]({ A, B, C, S, day });
      summary[s] = { passed: out.passed, failed: out.failed, timingsMs: out.timingsMs };
    } catch (e) {
      log(`FAIL ${s}: ${e.message}`);
      summary[s] = { passed: 0, failed: 1, error: e.message.slice(0, 300) };
    }
  }
  if (used.size) {
    const r = results('final');
    await assertConvergence(r, [A, B, C, S], [...used].sort());
    const out = r.save({ server: S.kind, serverLimits: await S.status() });
    summary.final = { passed: out.passed, failed: out.failed };
  }
  exitCode = Object.values(summary).some((v) => v.failed) ? 1 : 0;
} catch (e) {
  log(`FAIL setup: ${e.message}`);
  summary.setup = { passed: 0, failed: 1, error: e.message.slice(0, 300) };
} finally {
  await cleanup();
  fs.mkdirSync(`${ROOT}/qa/results/sync`, { recursive: true });
  fs.writeFileSync(`${ROOT}/qa/results/sync/summary.json`, JSON.stringify({ at: new Date().toISOString(), server: 'real', scenarios: summary }, null, 1) + '\n');
  console.table(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { passed: v.passed, failed: v.failed }])));
}
process.exit(exitCode);
