#!/usr/bin/env node
// Times automatic detection (detect/2, r067 AD-SERVER) on a COPY of a real lumen.db: the v5 migration, the background
// job over the 30-day backlog the migration queues (per 6-hour window: median, p95 and max), an incremental run after a
// one-minute upload, and the `gauge_detections` route (= MCP tool) reads.
//
//   node packages/companion/scripts/detect-bench.mjs --db <lumen.db> [--tz Asia/Kolkata] [--keep] [--synthetic]
//
// --synthetic first uploads (through the real ingest, which queues detection) a dense month of made-up evidence on top
// of the copy: the phone's detector minutes 16 h a day with its acquisition, the ring's minutes all day, heart rate every
// minute with a declared cadence, recognition transitions, and a few walks a day: the worst case per window.
//
// The file (and its -wal) is copied to $TMPDIR and only the copy is opened; the copy is deleted at the end (unless
// --keep). Health data stays private: only timings and counts are printed, never values, labels or times of episodes.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({ options: { db: { type: 'string' }, tz: { type: 'string', default: 'Asia/Kolkata' }, keep: { type: 'boolean' }, synthetic: { type: 'boolean' } } });
if (!opt.db || !existsSync(opt.db)) {
  console.error('usage: detect-bench.mjs --db <lumen.db>');
  process.exit(2);
}
const { openLumenStore } = await import('../src/home/lumenStore.ts');
const { lumenToolSet } = await import('../src/home/lumenTools.ts');
const { processCore, CORE_MS, AFFECT_PAD_MS, createDetectionJob } = await import('../src/home/detect/job.ts');
const { withReadBudget, READ_BUDGET_ROWS } = await import('../src/home/gaugeDerive.ts');
const { mergeRanges } = await import('../src/home/detect/queue.ts');

const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'detect-bench-'));
const file = join(dir, 'lumen.db');
copyFileSync(opt.db, file);
if (existsSync(`${opt.db}-wal`)) copyFileSync(`${opt.db}-wal`, `${file}-wal`);
const ms = (t) => Math.round((performance.now() - t) * 10) / 10;
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : null;
};
try {
  let t = performance.now();
  const store = openLumenStore(file);
  console.log(`open + migrate to v5: ${ms(t)} ms`);
  const nowMs = Date.now();
  if (opt.synthetic) {
    const { lumenEvent } = await import('../src/home/lumenFixtures.ts');
    const install = store.installations()[0]?.id ?? '6f1d2c3b4a594e8f9d0123456789abcd';
    const o = { install };
    const BOOT = '3f2a1c9e-7b4d-4e8a-9c1f-2d3e4f5a6b7c';
    const iso = (x) => new Date(x).toISOString();
    const ns = (x) => String(BigInt(x - (nowMs - 40 * 86_400_000)) * 1_000_000n);
    const day0 = Math.floor((nowMs - 30 * 86_400_000) / 86_400_000) * 86_400_000;
    let batch = [];
    let n = 0;
    const ingestTimes = [];
    const flush = () => {
      const s = performance.now();
      store.ingest(install, batch, nowMs);
      ingestTimes.push(performance.now() - s);
      n += batch.length;
      batch = [];
    };
    const push = (e) => {
      batch.push(e);
      if (batch.length === 500) flush();
    };
    for (let d = 0; d < 30; d++) {
      const day = day0 + d * 86_400_000;
      push(lumenEvent('phone/acquisition', 'phone_acquisition', 'com.pulseloop.phone.acquisition.v1', iso(day + 6 * 3_600_000), { from: iso(day + 6 * 3_600_000), to: iso(day + 22 * 3_600_000), state: 'listening', detector: 'registered', observed_zero: true }, o));
      push(lumenEvent('phone/activity_recognition_acquisition', 'activity_recognition', 'x.v1', iso(day), { from: iso(day), to: iso(day + 86_400_000), state: 'listening', registration_epoch: 1 }, o));
      const walks = [7.5, 13, 18.25].map((h) => day + h * 3_600_000);
      for (const w of walks) {
        push(lumenEvent('phone/activity_transition', 'WALKING', 'x.v1', iso(w), { activity: 'WALKING', transition: 'ENTER', occurred_at: iso(w), boot_id: BOOT, elapsed_ns: ns(w), registration_epoch: 1 }, o));
        push(lumenEvent('phone/activity_transition', 'WALKING', 'x.v1', iso(w + 30 * 60_000), { activity: 'WALKING', transition: 'EXIT', occurred_at: iso(w + 30 * 60_000), boot_id: BOOT, elapsed_ns: ns(w + 30 * 60_000), registration_epoch: 1 }, o));
      }
      for (let m = 0; m < 1440; m++) {
        const t0 = day + m * 60_000;
        const walking = walks.some((w) => t0 >= w && t0 < w + 30 * 60_000);
        if (m >= 360 && m < 1320 && (walking || m % 7 === 0)) {
          push(lumenEvent('activity/phone_steps', `phone_steps:${BOOT}:${ns(t0)}`, 'com.pulseloop.activity.phone_steps.v1', iso(t0 + 60_000), {
            start: iso(t0), end: iso(t0 + 60_000), steps: walking ? 95 + (m % 5) : 12, support: 'minute', timing: 'detector', boot_id: BOOT, m_start_ns: ns(t0), m_end_ns: ns(t0 + 60_000), utc_anchor_id: 'a1',
          }, o));
        }
        push(lumenEvent('activity/buckets', 'ring_steps', 'health.activity.bucket.observed', iso(t0), { start: iso(t0), duration_s: 60, steps: walking ? 3 : m % 11, distance_m: 0, support: 'minute' }, o));
        push(lumenEvent('metrics/hr', 'hr', 'health.metric.observed', iso(t0 + 30_000), { metric: 'hr', value: walking ? 96 : 68 + (m % 5), unit: 'bpm', provenance: 'device_history', cadence_s: 60 }, o));
      }
    }
    if (batch.length) flush();
    console.log(`synthetic month: ${n} events ingested in ${Math.round(ingestTimes.reduce((a, b) => a + b, 0))} ms (per 500: median ${q(ingestTimes, 0.5).toFixed(1)} ms, max ${Math.max(...ingestTimes).toFixed(1)} ms)`);
  }
  const queued = store.detections.queue();
  console.log(`queued ranges after the migration: ${queued.length}, spanning ${Math.round((Math.max(...queued.map((x) => x.toMs)) - Math.min(...queued.map((x) => x.fromMs))) / 86_400_000)} days`);

  // the backlog, window by window (as the job runs it), each in its own row budget
  const ranges = mergeRanges(queued.map((x) => [x.fromMs - AFFECT_PAD_MS, x.toMs + AFFECT_PAD_MS]), nowMs, 0);
  const times = [];
  let writes = 0;
  t = performance.now();
  for (const [a, b] of ranges) for (let x = a; x < b; x += CORE_MS) {
    const s = performance.now();
    const r = withReadBudget(() => processCore(store, x, Math.min(b, x + CORE_MS), { tz: opt.tz, nowMs }), READ_BUDGET_ROWS);
    times.push(performance.now() - s);
    writes += r.writes;
  }
  const total = ms(t);
  store.detections.dequeue(Number.MAX_SAFE_INTEGER);
  const d = store.detections.diagnostics();
  console.log(`backlog: ${times.length} windows of 6 h in ${total} ms; per window median ${q(times, 0.5)?.toFixed(1)} ms, p95 ${q(times, 0.95)?.toFixed(1)} ms, max ${Math.max(...times).toFixed(1)} ms`);
  console.log(`episodes written: ${writes} (open ${d.open}, final ${d.final}, withdrawn ${d.withdrawn})`);
  if (opt.synthetic) {
    const labels = store.all("SELECT label, COUNT(*) AS n FROM detection_episodes WHERE state <> 'withdrawn' GROUP BY label");
    console.log(`synthetic episodes by label: ${labels.map((x) => `${x.label} ${x.n}`).join(', ')}`);
  }

  // the same backlog again: nothing changes, nothing is written
  t = performance.now();
  let rewrites = 0;
  for (const [a, b] of ranges) for (let x = a; x < b; x += CORE_MS) rewrites += withReadBudget(() => processCore(store, x, Math.min(b, x + CORE_MS), { tz: opt.tz, nowMs }), READ_BUDGET_ROWS).writes;
  console.log(`re-run over the same 30 days: ${ms(t)} ms, ${rewrites} writes (idempotent: 0 expected)`);

  // an incremental run through the job: one queued minute (what an upload queues), ±30 min, as the server runs it
  const last = store.get('SELECT MAX(observed_ms) AS m FROM event_state WHERE category = ?', 'activity/buckets')?.m ?? nowMs - 3_600_000;
  store.detections.enqueue([[last - 60_000, last]], nowMs);
  const job = createDetectionJob({ open: () => store, tzOf: () => opt.tz, now: () => nowMs, debounceMs: 0 });
  t = performance.now();
  const r = await job.run('bench');
  console.log(`incremental job run (one queued minute): ${ms(t)} ms wall, ${r.cores} window(s), ${r.writes} writes`);
  job.close();

  // the route (GET /v1/gauge/detections answers exactly this tool call)
  const tools = lumenToolSet(() => store, opt.tz, () => nowMs);
  for (const [name, args] of [['all (first page)', {}], ['28 days', { from: new Date(nowMs - 28 * 86_400_000).toISOString().slice(0, 10), to: new Date(nowMs).toISOString().slice(0, 10) }]]) {
    const runs = [];
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const s = performance.now();
      const res = await tools.call('gauge_detections', args);
      runs.push(performance.now() - s);
      n = res.ok ? res.data.episodes.length : -1;
    }
    console.log(`gauge_detections ${name}: cold ${runs[0].toFixed(1)} ms, warm median ${q(runs.slice(1), 0.5).toFixed(1)} ms (${n} episodes)`);
  }
  const s2 = performance.now();
  const av = await tools.call('gauge_data_availability', {});
  console.log(`gauge_data_availability: ${ms(s2)} ms, detection = ${av.data.detection}`);
  store.close();
} finally {
  if (!opt.keep) rmSync(dir, { recursive: true, force: true });
}
