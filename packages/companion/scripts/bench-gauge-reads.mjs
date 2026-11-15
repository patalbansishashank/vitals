#!/usr/bin/env node
// Times the Gauge read tools (r087) on a COPY of a person's lumen.db, through the server code of a build: each read
// cold (derived from the file with nothing kept), in the pass (derived beside the reads before it, whose step rows it
// shares) and then warm (answered from the kept reads, `src/home/gaugeReads.ts`).
//
//   node packages/companion/scripts/bench-gauge-reads.mjs --db <copy of lumen.db> --tz Asia/Kolkata \
//     [--server packages/companion/dist/server] [--date YYYY-MM-DD] [--days 56] [--context <fusion-context.json>] [--upload]
//
// --server  the build to time: a directory with src/home/*.ts (default: this checkout's package; the packed build is
//           packages/companion/dist/server, on the host ~/vitals-server/current).
// --date    "today" (default: the local date of the newest reading in the copy, so an old copy still has a today).
// --context the person's fusion-context.json (optional): the fused reads then use it, as the server does.
// --upload  then uploads one made-up ring minute (0 steps, a minute after the newest reading) to the copy and times
//           every read again: what an import pass costs after the ring synced.
//
// The file is opened in place and may be migrated: give it a copy (with its -wal, if any), never the live file. A
// file that sits in a person's directory (next to devices.json) is refused.
// Health data stays private: only timings, row counts, SQL statement counts and cache counts are printed.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: { db: { type: 'string' }, tz: { type: 'string' }, server: { type: 'string' }, date: { type: 'string' }, days: { type: 'string', default: '56' }, context: { type: 'string' }, upload: { type: 'boolean' } },
});
if (!opt.db || !opt.tz || !existsSync(opt.db)) {
  console.error('usage: bench-gauge-reads.mjs --db <copy of lumen.db> --tz <IANA zone> [--server <build dir>] [--date YYYY-MM-DD] [--days 56] [--context <fusion-context.json>] [--upload]');
  process.exit(2);
}
const file = resolve(opt.db);
if (existsSync(join(dirname(file), 'devices.json'))) {
  console.error('That file is in a person\'s directory: copy it somewhere else first (and its -wal), then give the copy.');
  process.exit(2);
}
const server = resolve(opt.server ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const load = (name) => import(pathToFileURL(join(server, 'src', 'home', name)).href);
const { openLumenStore } = await load('lumenStore.ts');
const { createGaugeReads } = await load('gaugeReads.ts');
const { localDate, validZone } = await load('lumenTools.ts');
const { addDays } = await load('gaugeDerive.ts');
if (!validZone(opt.tz)) {
  console.error(`Not a time zone: ${opt.tz}`);
  process.exit(2);
}

const round = (x) => Math.round(x * 10) / 10;
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : 0;
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

let t = performance.now();
const store = openLumenStore(file);
console.log(`build: ${server}`);
console.log(`open (and migrate): ${round(performance.now() - t)} ms`);
const fusion = opt.context ? JSON.parse(readFileSync(opt.context, 'utf8')) : null;
const reads = createGaugeReads({ store: () => store, opened: () => store, fusion: () => fusion });
const last = store.status().lastObservedAt;
const today = opt.date ?? localDate(last ? Date.parse(last) : Date.now(), opt.tz);
const days = Math.max(0, Math.min(400, Number(opt.days) || 0));
const from30 = addDays(today, -29);
console.log(`today: ${today} (${opt.tz}); fusion context: ${fusion ? 'given' : 'none'}`);

const PERSON = 'bench';
/**
 * One read: derived with nothing kept (cold: its own kept reads, so no other read's step rows help it), derived again
 * beside the reads before it (shared: what it costs inside an import pass), asked again (warm), and its ETag asked
 * alone (what a matching If-None-Match costs: one question for the file's version, no table read).
 */
async function measure(tool, args) {
  const alone = createGaugeReads({ store: () => store, opened: () => store, fusion: () => fusion });
  const cold = await alone.read(PERSON, opt.tz, tool, args);
  alone.close();
  const shared = await reads.read(PERSON, opt.tz, tool, args);
  const sqlBefore = store.sqlReads();
  const checksBefore = store.versionChecks?.() ?? 0;
  let w = performance.now();
  const warm = await reads.read(PERSON, opt.tz, tool, args);
  const warmMs = performance.now() - w;
  w = performance.now();
  const tag = reads.etag(PERSON, opt.tz, tool, args);
  const etagMs = performance.now() - w;
  return {
    ok: cold.envelope.ok, coldMs: cold.tookMs, rows: cold.rows, sql: cold.sql, sharedMs: shared.tookMs, sharedSql: shared.sql, warmMs, warmCache: warm.cache, etagMs, etagKept: tag !== null && tag.etag === warm.etag,
    warmSql: store.sqlReads() - sqlBefore, warmChecks: (store.versionChecks?.() ?? 0) - checksBefore,
  };
}
const line = (name, m) =>
  console.log(`${name.padEnd(28)} cold ${String(round(m.coldMs)).padStart(8)} ms  rows ${String(m.rows).padStart(7)}  sql ${String(m.sql).padStart(4)}  | in the pass ${String(round(m.sharedMs)).padStart(8)} ms (sql ${m.sharedSql})  | warm ${String(round(m.warmMs)).padStart(6)} ms (${m.warmCache}, sql ${m.warmSql}, version checks ${m.warmChecks})  etag ${round(m.etagMs)} ms${m.etagKept ? '' : ' (not kept)'}${m.ok ? '' : '  REJECTED'}`);

const tz = opt.tz;
line('activity, 30 days', await measure('gauge_activity', { from: from30, to: today, tz }));
line('steps (fuse), 30 days', await measure('gauge_steps', { from: from30, to: today, tz }));
line('baselines', await measure('gauge_baselines', { date: today, tz }));
line('sleep, 30 days', await measure('gauge_sleep', { from: from30, to: today, tz }));
line('daily, today', await measure('gauge_daily_summary', { date: today, tz }));
line('timeline, today', await measure('gauge_timeline', { date: today, tz }));

const tl = [];
for (let i = 1; i <= days; i++) tl.push(await measure('gauge_timeline', { date: addDays(today, -i), tz }));
if (tl.length) {
  const cold = tl.map((m) => m.coldMs);
  const warm = tl.map((m) => m.warmMs);
  console.log(`timeline, each of ${tl.length} days before: cold median ${round(q(cold, 0.5))} ms, p95 ${round(q(cold, 0.95))} ms, max ${round(Math.max(...cold))} ms, total ${round(sum(cold))} ms; rows ${sum(tl.map((m) => m.rows))}, sql ${sum(tl.map((m) => m.sql))}`);
  console.log(`  in the pass (step rows of the 30-day reads already kept): median ${round(q(tl.map((m) => m.sharedMs), 0.5))} ms, total ${round(sum(tl.map((m) => m.sharedMs)))} ms, sql ${sum(tl.map((m) => m.sharedSql))}`);
  console.log(`  warm median ${round(q(warm, 0.5))} ms, max ${round(Math.max(...warm))} ms, total ${round(sum(warm))} ms; from memory ${tl.filter((m) => m.warmCache === 'hit').length} of ${tl.length}, sql ${sum(tl.map((m) => m.warmSql))}; etag kept ${tl.filter((m) => m.etagKept).length} of ${tl.length}, etag total ${round(sum(tl.map((m) => m.etagMs)))} ms`);
  console.log(`  rejected: ${tl.filter((m) => !m.ok).length}`);
}

// the whole sweep again, as a second import pass asks it: everything should come from memory
t = performance.now();
const sqlBefore = store.sqlReads();
const again = [
  await reads.read(PERSON, tz, 'gauge_activity', { from: from30, to: today, tz }), await reads.read(PERSON, tz, 'gauge_steps', { from: from30, to: today, tz }),
  await reads.read(PERSON, tz, 'gauge_baselines', { date: today, tz }), await reads.read(PERSON, tz, 'gauge_sleep', { from: from30, to: today, tz }),
  await reads.read(PERSON, tz, 'gauge_daily_summary', { date: today, tz }),
];
for (let i = 0; i <= days; i++) again.push(await reads.read(PERSON, tz, 'gauge_timeline', { date: addDays(today, -i), tz }));
console.log(`second pass, ${again.length} reads: ${round(performance.now() - t)} ms, from memory ${again.filter((a) => a.cache === 'hit').length}, sql ${store.sqlReads() - sqlBefore}`);

if (opt.upload) {
  const installation = store.installations()[0]?.id;
  const at = new Date(Math.floor((last ? Date.parse(last) : Date.now()) / 60_000) * 60_000 + 60_000).toISOString();
  if (!installation) console.log('after an upload: skipped (the copy has no installation)');
  else {
    const event = {
      specversion: '1.0', id: `pl-bench-${Date.now().toString(36)}`, type: 'health.activity.bucket.observed', source: `urn:pulseloop:installation:${installation}`, subject: 'ring_steps', time: at, category: 'activity/buckets',
      data: { schema_version: 1, observed_at: at, received_at: new Date().toISOString(), start: at, duration_s: 60, steps: 0, distance_m: 0, support: 'minute' },
    };
    t = performance.now();
    const r = store.ingest(installation, [event]);
    console.log(`after an upload of one ring minute (${r.accepted} accepted, ${round(performance.now() - t)} ms): ${reads.stats().dropped} kept entries dropped`);
    const pass = [
      ['activity, 30 days', 'gauge_activity', { from: from30, to: today, tz }], ['steps (fuse), 30 days', 'gauge_steps', { from: from30, to: today, tz }], ['baselines', 'gauge_baselines', { date: today, tz }],
      ['sleep, 30 days', 'gauge_sleep', { from: from30, to: today, tz }], ['daily, today', 'gauge_daily_summary', { date: today, tz }], ['timeline, today', 'gauge_timeline', { date: today, tz }],
    ];
    for (const [name, tool, args] of pass) {
      const a = await reads.read(PERSON, tz, tool, args);
      console.log(`  ${name.padEnd(26)} ${String(round(a.tookMs)).padStart(8)} ms  rows ${String(a.rows).padStart(7)}  sql ${String(a.sql).padStart(4)}  (${a.cache})`);
    }
    const sqlAt = store.sqlReads();
    const before = [];
    for (let i = 1; i <= days; i++) before.push(await reads.read(PERSON, tz, 'gauge_timeline', { date: addDays(today, -i), tz }));
    console.log(`  timeline, each of ${before.length} days before: from memory ${before.filter((a) => a.cache === 'hit').length}, derived again ${before.filter((a) => a.cache !== 'hit').length} (${round(sum(before.map((a) => a.tookMs)))} ms), sql ${store.sqlReads() - sqlAt}`);
  }
}

const s = reads.stats();
console.log(`kept reads: ${s.hits} hits, ${s.misses} misses, ${s.joined} joined, ${s.dropped} dropped, ${s.evicted} evicted; ${s.entries} entries, ${round(s.bytes / 1024 / 1024)} MB counted`);
const mem = process.memoryUsage();
console.log(`memory: rss ${round(mem.rss / 1024 / 1024)} MB, heap used ${round(mem.heapUsed / 1024 / 1024)} MB`);
reads.close();
store.close();
