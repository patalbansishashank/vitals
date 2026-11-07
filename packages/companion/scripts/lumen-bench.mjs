#!/usr/bin/env node
// Times every lumen.db read the Gauge routes run, on a COPY of a real lumen.db (r063 package SRV, the 2026-10-28 incident).
//
//   node packages/companion/scripts/lumen-bench.mjs --db <lumen.db> [--date YYYY-MM-DD] [--tz Asia/Kolkata]
//        [--timeout-s 60] [--repeat 3] [--only <case>,<case>] [--wide] [--json <out.json>] [--no-ingest]
//   --wide adds the widest ranges the tools accept (400 days; steps 62).
//
// - The file (and its -wal) is copied to $TMPDIR first and only the copy is opened, through the real `openLumenStore`
//   (so the first open runs the pending migrations: its time is reported as `open+migrate`). The original is never
//   opened.
// - Each case is one `gauge_*` tool call exactly as `GET /v1/gauge/*`, `POST /v1/gauge/steps/fuse` and the MCP tools run
//   it (`lumenToolSet(...).call`), plus `GET /v1/lumen/status` (`store.status()`) and one 500-event ingest. Every case
//   runs in its own child process with a wall-clock limit, so a read that never ends is reported as `>limit` instead
//   of hanging the benchmark (as it hung the server).
// - Per case it prints the cold time, the median of the warm repeats and the slowest SQL statements behind it.
// - Health data stays private: only counts and timings are printed, never values.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const self = fileURLToPath(import.meta.url);
const { values: opt } = parseArgs({
  options: {
    db: { type: 'string' },
    file: { type: 'string' },
    child: { type: 'string' },
    date: { type: 'string' },
    tz: { type: 'string', default: 'Asia/Kolkata' },
    'timeout-s': { type: 'string', default: '60' },
    repeat: { type: 'string', default: '3' },
    only: { type: 'string' },
    json: { type: 'string' },
    'no-ingest': { type: 'boolean' },
    keep: { type: 'boolean' },
    wide: { type: 'boolean' },
  },
});

const DAY = 86_400_000;
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The cases: [name, tool, args(day, from28)]. */
const CASES = [
  ['availability', 'gauge_data_availability', () => ({})],
  ['series hr raw day', 'gauge_metric_series', (d) => ({ kind: 'hr', from: d, to: d })],
  ['series hr hour 28d', 'gauge_metric_series', (d, f) => ({ kind: 'hr', from: f, to: d, bucket: 'hour' })],
  ['series hr day 28d', 'gauge_metric_series', (d, f) => ({ kind: 'hr', from: f, to: d, bucket: 'day' })],
  ['series hrv raw 28d', 'gauge_metric_series', (d, f) => ({ kind: 'hrv', from: f, to: d })],
  ['daily', 'gauge_daily_summary', (d) => ({ date: d })],
  ['sleep day', 'gauge_sleep', (d) => ({ from: d, to: d })],
  ['sleep 28d', 'gauge_sleep', (d, f) => ({ from: f, to: d })],
  ['activity day', 'gauge_activity', (d) => ({ from: d, to: d })],
  ['activity 28d', 'gauge_activity', (d, f) => ({ from: f, to: d })],
  ['scores day', 'gauge_scores', (d) => ({ from: d, to: d })],
  ['scores 28d', 'gauge_scores', (d, f) => ({ from: f, to: d })],
  ['device', 'gauge_device_state', () => ({})],
  ['short-video 28d', 'gauge_short_video', (d, f) => ({ from: f, to: d })],
  ['workouts day', 'gauge_workouts', (d) => ({ from: d, to: d })],
  ['workouts 28d', 'gauge_workouts', (d, f) => ({ from: f, to: d })],
  ['steps day', 'gauge_steps', (d) => ({ from: d, to: d })],
  ['steps 28d', 'gauge_steps', (d, f) => ({ from: f, to: d })],
  ['steps/fuse day (POST)', 'gauge_steps', (d) => ({ from: d, to: d, activities: [{ start: `${d}T07:00`, end: `${d}T07:45`, kind: 'locomotor' }], preference: { stepsPreference: ['ring', 'phone'] } })],
  ['steps/fuse 28d (POST)', 'gauge_steps', (d, f) => ({ from: f, to: d, activities: [{ start: `${d}T07:00`, end: `${d}T07:45`, kind: 'locomotor' }] })],
  ['timeline', 'gauge_timeline', (d) => ({ date: d })],
  ['baselines', 'gauge_baselines', (d) => ({ date: d })],
  ['hc Steps day', 'gauge_hc', (d) => ({ type: 'Steps', from: d, to: d })],
  ['hc Steps 28d', 'gauge_hc', (d, f) => ({ type: 'Steps', from: f, to: d })],
  ['hc HeartRate day', 'gauge_hc', (d) => ({ type: 'HeartRate', from: d, to: d })],
  ['hc ExerciseSession 28d', 'gauge_hc', (d, f) => ({ type: 'ExerciseSession', from: f, to: d })],
  ['lumen status', null, () => ({})],
  // (r063 CORE) the person's stored fusion context on every fused read, and the change feed
  ['timeline (ctx)', 'gauge_timeline', (d) => ({ date: d })],
  ['daily (ctx)', 'gauge_daily_summary', (d) => ({ date: d })],
  ['activity 28d (ctx)', 'gauge_activity', (d, f) => ({ from: f, to: d })],
  ['steps 28d (ctx)', 'gauge_steps', (d, f) => ({ from: f, to: d })],
  ['changes head', 'gauge_changes', () => ({})],
  ['changes from start (page)', 'gauge_changes', () => ({ since: 'c1.0.0' })],
  ['changes from start (limit 2000)', 'gauge_changes', () => ({ since: 'c1.0.0', limit: 2000 })],
  // the widest ranges the tools accept (route-level caps: 400 days, steps 62)
  ['series hr hour 400d', 'gauge_metric_series', (d) => ({ kind: 'hr', from: addDays(d, -399), to: d, bucket: 'hour' })],
  ['sleep 400d', 'gauge_sleep', (d) => ({ from: addDays(d, -399), to: d })],
  ['activity 400d', 'gauge_activity', (d) => ({ from: addDays(d, -399), to: d })],
  ['steps 62d', 'gauge_steps', (d) => ({ from: addDays(d, -61), to: d })],
  ['scores 400d', 'gauge_scores', (d) => ({ from: addDays(d, -399), to: d })],
  ['hc Steps 400d', 'gauge_hc', (d) => ({ type: 'Steps', from: addDays(d, -399), to: d })],
];
const WIDE = new Set(['series hr hour 400d', 'sleep 400d', 'activity 400d', 'steps 62d', 'scores 400d', 'hc Steps 400d']);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const fmt = (ms) => (ms === null || ms === undefined ? '-' : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`);

// ---------------------------------------------------------------------------------------------------------------
// child: one case against the (already migrated) copy

async function child() {
  const { openLumenStore } = await import('../src/home/lumenStore.ts');
  const { lumenToolSet } = await import('../src/home/lumenTools.ts');
  const store = openLumenStore(opt.file);
  const sql = new Map();
  const note = (key, ms) => {
    const k = key.replace(/\s+/g, ' ').slice(0, 140);
    const e = sql.get(k) ?? { n: 0, ms: 0 };
    e.n++;
    e.ms += ms;
    sql.set(k, e);
  };
  const timed = (key, f) => {
    const t = performance.now();
    try {
      return f();
    } finally {
      note(key, performance.now() - t);
    }
  };
  const wrapped = {
    ...store,
    all: (q, ...p) => timed(q, () => store.all(q, ...p)),
    get: (q, ...p) => timed(q, () => store.get(q, ...p)),
    readIntervals: (c, a, b, o) => timed(`readIntervals(${c})`, () => store.readIntervals(c, a, b, o)),
    readMetricSamples: (k, a, b, o) => timed(`readMetricSamples(${k})`, () => store.readMetricSamples(k, a, b, o)),
    status: () => timed('status()', () => store.status()),
    installations: () => store.installations(),
  };
  const [name, tool, argsOf] = CASES[Number(opt.child)];
  const day = opt.date;
  const args = argsOf(day, addDays(day, -27));
  // (r063) the `(ctx)` cases read with a stored fusion context: an approved 45-minute bout on each of the 28 days
  const ctxDays = Array.from({ length: 28 }, (_, k) => addDays(day, -k));
  const stored = name.includes('(ctx)') ? {
    revision: 'bench', updatedAt: new Date().toISOString(), corrections: [],
    activities: ctxDays.map((x, k) => ({ startMs: Date.parse(`${x}T02:00:00Z`), endMs: Date.parse(`${x}T02:45:00Z`), kind: k % 2 ? 'nonLocomotor' : 'locomotor' })),
  } : null;
  const tools = lumenToolSet(() => wrapped, opt.tz, Date.now, () => stored);
  const run = async () => {
    const t = performance.now();
    let rows = 0;
    let ok = true;
    if (!tool) rows = Object.keys(wrapped.status().counts).length;
    else {
      const env = await tools.call(tool, args);
      ok = env.ok;
      const d = env.data ?? {};
      rows = ['records', 'points', 'sessions', 'days', 'intervals', 'categories', 'nights', 'scores', 'devices', 'minutes', 'changes'].reduce((n, k) => n + (Array.isArray(d[k]) ? d[k].length : 0), 0);
    }
    return { ms: performance.now() - t, rows, ok };
  };
  const cold = await run();
  const warm = [];
  const repeat = Number(opt.repeat);
  if (cold.ms < 2000) for (let i = 0; i < repeat; i++) warm.push((await run()).ms);
  const top = [...sql.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 4).map(([q, e]) => ({ sql: q, calls: e.n, ms: Math.round(e.ms * 10) / 10 }));
  store.close();
  process.stdout.write(`${JSON.stringify({ name, ok: cold.ok, rows: cold.rows, coldMs: cold.ms, warmMs: median(warm), top })}\n`);
}

// ---------------------------------------------------------------------------------------------------------------
// parent

function runChild(index, file, day, limitS) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [self, '--child', String(index), '--file', file, '--date', day, '--tz', opt.tz, '--repeat', opt.repeat], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (b) => (out += b));
    p.stderr.on('data', (b) => (err += b));
    const timer = setTimeout(() => p.kill('SIGKILL'), limitS * 1000);
    p.on('close', (code, signal) => {
      clearTimeout(timer);
      if (signal === 'SIGKILL') return resolve({ name: CASES[index][0], timeout: true, coldMs: null, warmMs: null, top: [] });
      try {
        resolve(JSON.parse(out.trim().split('\n').at(-1)));
      } catch {
        resolve({ name: CASES[index][0], error: `exit ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`, coldMs: null, warmMs: null, top: [] });
      }
    });
  });
}

async function parent() {
  if (!opt.db || !existsSync(opt.db)) throw new Error('--db <lumen.db> is required');
  const base = process.env.TMPDIR || tmpdir();
  const dir = mkdtempSync(join(base, 'lumen-bench-'));
  const file = join(dir, 'lumen.db');
  copyFileSync(opt.db, file);
  for (const ext of ['-wal']) if (existsSync(opt.db + ext)) copyFileSync(opt.db + ext, file + ext);
  const { openLumenStore } = await import('../src/home/lumenStore.ts');
  const Database = (await import('better-sqlite3')).default;
  const raw = new Database(file, { readonly: true });
  const v0 = raw.pragma('user_version', { simple: true });
  const nEvents = raw.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  const nDel = raw.prepare('SELECT COUNT(*) AS n FROM deletions').get().n;
  const lastHr = raw.prepare("SELECT MAX(observed_ms) AS m FROM events WHERE category = 'metrics/hr'").get().m;
  raw.close();
  const day = opt.date ?? new Intl.DateTimeFormat('en-CA', { timeZone: opt.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(lastHr - DAY));
  let t = performance.now();
  const s = openLumenStore(file);
  const openMs = performance.now() - t;
  s.close();
  t = performance.now();
  openLumenStore(file).close();
  const reopenMs = performance.now() - t;
  const db = new Database(file, { readonly: true });
  const v1 = db.pragma('user_version', { simple: true });
  db.close();
  console.log(`lumen.db copy: ${nEvents} events, ${nDel} deletions, user_version ${v0} → ${v1}; open+migrate ${fmt(openMs)}, reopen ${fmt(reopenMs)}; typical day ${day} (${opt.tz}), 28-day range ${addDays(day, -27)}..${day}`);
  const only = opt.only ? new Set(opt.only.split(',').map((x) => x.trim())) : null;
  const results = [];
  for (let i = 0; i < CASES.length; i++) {
    if (only ? !only.has(CASES[i][0]) : WIDE.has(CASES[i][0]) && !opt.wide) continue;
    const r = await runChild(i, file, day, Number(opt['timeout-s']));
    results.push(r);
    const status = r.timeout ? `>${opt['timeout-s']} s (killed)` : r.error ? `error ${r.error}` : `cold ${fmt(r.coldMs)}  warm ${fmt(r.warmMs)}  rows ${r.rows}${r.ok ? '' : ' (not ok)'}`;
    console.log(`${r.name.padEnd(26)} ${status}`);
    for (const q of r.top ?? []) if (q.ms >= 1) console.log(`    ${fmt(q.ms).padStart(10)}  ×${q.calls}  ${q.sql}`);
  }
  let ingest = null;
  if (!opt['no-ingest']) {
    // 500 new heart-rate readings in one batch, as an upload sends them (synthetic values; ids never seen)
    const st = openLumenStore(file);
    const inst = st.installations()[0]?.id ?? '6f1d2c3b4a594e8f9d0123456789abcd';
    const t0 = lastHr + 60_000;
    const events = Array.from({ length: 500 }, (_, i) => {
      const at = new Date(t0 + i * 60_000).toISOString();
      return { specversion: '1.0', id: `bench-${t0}-${i}`, type: 'health.metric.observed', source: `urn:pulseloop:installation:${inst}`, subject: 'hr', time: at, category: 'metrics/hr',
        data: { schema_version: 1, observed_at: at, received_at: at, value: 60, unit: 'bpm', provenance: 'bench' } };
    });
    t = performance.now();
    const r = st.ingest(inst, events);
    ingest = { ms: performance.now() - t, accepted: r.accepted, rejected: r.rejected.length };
    st.close();
    console.log(`${'ingest 500 events'.padEnd(26)} ${fmt(ingest.ms)} (accepted ${ingest.accepted}, rejected ${ingest.rejected})`);
  }
  if (opt.json) writeFileSync(opt.json, JSON.stringify({ at: new Date().toISOString(), events: nEvents, deletions: nDel, userVersion: [v0, v1], openMs, reopenMs, day, tz: opt.tz, results, ingest }, null, 2));
  if (!opt.keep) rmSync(dir, { recursive: true, force: true });
  else console.log(`kept ${dir}`);
}

if (opt.child !== undefined) await child();
else await parent();
