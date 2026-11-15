// @vitest-environment node
/**
 * The kept Gauge reads, warmed again (r087, `./gaugeReads.ts`): a write that drops answers a client asked for leads,
 * once no write has followed for 5 seconds, to the same reads being derived again with nobody waiting, behind every
 * client's read, so the next request is answered from memory with the bytes and the ETag a request would get.
 *
 * Only `setTimeout` is faked (the debounce, and the queue's pauses): the event loop's turns are real.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFusionContextStore } from './fusionContext.ts';
import { createGaugeReads, gaugeEtag, REWARM_AFTER_MS, REWARM_ASKED_MS, REWARM_MAX_KEYS } from './gaugeReads.ts';
import { FIXTURE_DATE, FIXTURE_NOW, FIXTURE_TZ, fixtureDay, ist } from './gaugeV2Fixture.ts';
import { battery, hr, INSTALL, OTHER_INSTALL, phoneSteps, ringSteps } from './lumenFixtures.ts';
import { openLumenStore } from './lumenStore.ts';
import { lumenToolSet } from './lumenTools.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const P = 'person-1';
const D = FIXTURE_DATE;
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const cleanup: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
  vi.useRealTimers();
});

type Read = [tool: string, args: Record<string, unknown>];
/** What the phone's first screen asks, all of it about today; */
const TODAY: Read[] = [['gauge_daily_summary', { date: D }], ['gauge_timeline', { date: D }], ['gauge_steps', { from: '2026-10-14', to: D }], ['gauge_activity', { from: '2026-10-14', to: D }]];
/** and a day an upload of this evening cannot change. */
const PAST: Read = ['gauge_timeline', { date: '2026-10-16' }];

function setup(o: { failing?: () => boolean; roundMs?: number } = {}) {
  const dir = mkdtempSync(join(TMP, 'gauge-rewarm-'));
  const store = openLumenStore(join(dir, 'lumen.db'));
  const clock = { now: FIXTURE_NOW };
  const context = createFusionContextStore(() => join(dir, 'fusion-context.json'));
  const lines: string[] = [];
  const reads = createGaugeReads({
    store: () => store, opened: () => store, now: () => clock.now, rewarmAfterMs: REWARM_AFTER_MS, rewarmRoundMs: o.roundMs, log: (line) => lines.push(line),
    fusion: (id) => {
      if (o.failing?.()) throw new Error('the context file is gone');
      return context.get(id);
    },
  });
  const plain = lumenToolSet(() => store, FIXTURE_TZ, () => clock.now, () => context.get(P));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close(), () => reads.close());
  const events = fixtureDay();
  for (let i = 0; i < events.length; i += 500) expect(store.ingest(INSTALL, events.slice(i, i + 500), FIXTURE_NOW).rejected).toEqual([]);
  let uploads = 0;
  /** An upload of this evening: a ring minute, the phone's, a heart-rate reading (another minute each time). */
  const upload = () => {
    const at = ist('21:10') + uploads++ * 60_000;
    expect(store.ingest(INSTALL, [ringSteps(iso(at), 60), phoneSteps(iso(at), iso(at + 60_000), 62), hr(iso(at + 30_000), 90), battery(iso(at), 50)], clock.now).rejected).toEqual([]);
  };
  /** A client's read, awaited while the queue's pauses pass. */
  const read = async ([tool, args]: Read, timeZone = FIXTURE_TZ) => {
    const p = reads.read(P, timeZone, tool, args);
    let done = false;
    void p.then(() => (done = true));
    while (!done) {
      await new Promise((r) => setImmediate(r));
      vi.advanceTimersByTime(25);
    }
    return p;
  };
  /** Lets everything queued run. */
  const drained = async () => {
    for (let i = 0; reads.stats().queued + reads.stats().warming > 0; i++) {
      if (i > 5000) throw new Error('the queue never emptied');
      await new Promise((r) => setImmediate(r));
      vi.advanceTimersByTime(25);
    }
  };
  const kept = ([tool, args]: Read) => reads.etag(P, FIXTURE_TZ, tool, args) !== null;
  return { store, reads, plain, clock, context, lines, upload, read, drained, kept };
}

describe('answers a write dropped are derived again', () => {
  it('5 seconds after the last write of a burst, once, with no request: then they are the plain answers byte for byte, from memory', async () => {
    const t = setup();
    for (const r of [...TODAY, PAST]) expect((await t.read(r)).cache).toBe('miss');
    const before = t.reads.stats();
    expect(before).toMatchObject({ misses: TODAY.length + 1, rewarmed: 0, warming: 0 });

    t.upload();
    expect(TODAY.map(t.kept)).toEqual(TODAY.map(() => false));
    expect(t.kept(PAST)).toBe(true);
    // not before the 5 seconds are over, and they start again with the next upload
    vi.advanceTimersByTime(REWARM_AFTER_MS - 1);
    t.upload();
    vi.advanceTimersByTime(REWARM_AFTER_MS - 1);
    await new Promise((r) => setImmediate(r));
    expect(t.reads.stats()).toMatchObject({ misses: before.misses, rewarmed: 0, warming: 0 });
    vi.advanceTimersByTime(1);
    expect(t.reads.stats()).toMatchObject({ rewarmed: 0, warming: TODAY.length });
    await t.drained();
    // each derived once, the past day not at all
    expect(t.reads.stats()).toMatchObject({ misses: before.misses + TODAY.length, rewarmed: TODAY.length, warming: 0, hits: 0 });

    // the next request is answered from memory, without a store read, with what the plain tool answers now
    t.clock.now += 3 * 60_000;
    for (const [tool, args] of TODAY) {
      const want = await t.plain.call(tool, args);
      const sql = t.store.sqlReads();
      const known = t.reads.etag(P, FIXTURE_TZ, tool, args);
      const a = await t.reads.read(P, FIXTURE_TZ, tool, args);
      expect(t.store.sqlReads(), tool).toBe(sql);
      expect(a.cache, tool).toBe('hit');
      expect(want.ok, tool).toBe(true);
      expect(JSON.stringify(a.envelope), tool).toBe(JSON.stringify(want));
      expect(a.etag, tool).toBe(gaugeEtag(want));
      expect(known?.etag, tool).toBe(a.etag);
    }
    expect(t.lines).toEqual([]);
  });

  it('behind every client\'s read: one that waits or arrives goes first, and one for a read about to be warmed takes it over', async () => {
    const t = setup();
    for (const r of [...TODAY, PAST]) await t.read(r);
    t.upload();
    vi.advanceTimersByTime(REWARM_AFTER_MS);
    // queued, the most recently asked first; nothing has run
    expect(t.reads.stats()).toMatchObject({ rewarmed: 0, warming: TODAY.length });
    const misses = t.reads.stats().misses;

    // a client asks for another day, and for the read that is last in line to be warmed
    const seen: Array<{ who: string; rewarmed: number; warming: number }> = [];
    const note = (who: string) => seen.push({ who, rewarmed: t.reads.stats().rewarmed, warming: t.reads.stats().warming });
    const other = t.reads.read(P, FIXTURE_TZ, 'gauge_timeline', { date: '2026-10-15' }).then((a) => (note('other'), a));
    const same = t.reads.read(P, FIXTURE_TZ, ...TODAY[0]!).then((a) => (note('same'), a));
    const again = t.reads.read(P, FIXTURE_TZ, ...TODAY[0]!);
    expect(t.reads.stats()).toMatchObject({ queued: 2, warming: TODAY.length - 1 });
    await t.drained();
    // both were answered before anything was warmed; the read taken over was derived once, for its client
    expect(seen).toEqual([{ who: 'other', rewarmed: 0, warming: TODAY.length - 1 }, { who: 'same', rewarmed: 0, warming: TODAY.length - 1 }]);
    expect((await other).cache).toBe('miss');
    expect((await same).cache).toBe('miss');
    expect((await again).cache).toBe('joined');
    expect(JSON.stringify((await same).envelope)).toBe(JSON.stringify(await t.plain.call(...TODAY[0]!)));
    expect(t.reads.stats()).toMatchObject({ misses: misses + 2 + TODAY.length - 1, rewarmed: TODAY.length - 1, joined: 1 });

    // a client that arrives in the middle of a round is next
    t.upload();
    vi.advanceTimersByTime(REWARM_AFTER_MS);
    while (t.reads.stats().rewarmed < TODAY.length) await new Promise((r) => setImmediate(r));
    expect(t.reads.stats()).toMatchObject({ rewarmed: TODAY.length, warming: TODAY.length - 1 });
    const late = t.reads.read(P, FIXTURE_TZ, 'gauge_timeline', { date: '2026-10-14' }).then((a) => (note('late'), a));
    await t.drained();
    expect(seen.at(-1)).toEqual({ who: 'late', rewarmed: TODAY.length, warming: TODAY.length - 1 });
    expect((await late).cache).toBe('miss');
    expect(t.reads.stats().rewarmed).toBe(2 * TODAY.length - 1);
  });

  it('a client that hangs up before its read\'s turn leaves the read to be warmed, whether it asked before the 5 seconds were over or took the read over', async () => {
    for (const when of ['before', 'queued'] as const) {
      const t = setup();
      for (const r of TODAY) await t.read(r);
      t.upload();
      if (when === 'queued') {
        vi.advanceTimersByTime(REWARM_AFTER_MS);
        expect(t.reads.stats().warming, when).toBe(TODAY.length);
      }
      const { misses } = t.reads.stats();
      // the phone opens, asks for its first screen, and is gone before any of it is derived
      const gone = TODAY.map(([tool, args]) => t.reads.read(P, FIXTURE_TZ, tool, args, { alive: () => false }));
      expect(t.reads.stats(), when).toMatchObject({ queued: TODAY.length, warming: 0 });
      await t.drained();
      for (const p of gone) expect((await p).envelope.ok, when).toBe(false);
      expect(t.reads.stats(), when).toMatchObject({ skipped: TODAY.length, misses, rewarmed: 0 });
      expect(TODAY.map(t.kept), when).toEqual(TODAY.map(() => false));

      // nobody asks again: the answers are derived all the same, each once
      vi.advanceTimersByTime(REWARM_AFTER_MS);
      expect(t.reads.stats().warming, when).toBe(TODAY.length);
      await t.drained();
      expect(t.reads.stats(), when).toMatchObject({ misses: misses + TODAY.length, rewarmed: TODAY.length, warming: 0 });
      expect(vi.getTimerCount(), when).toBe(0);
      for (const [tool, args] of TODAY) {
        const want = await t.plain.call(tool, args);
        const a = await t.reads.read(P, FIXTURE_TZ, tool, args);
        expect(a.cache, `${when} ${tool}`).toBe('hit');
        expect(JSON.stringify(a.envelope), `${when} ${tool}`).toBe(JSON.stringify(want));
        expect(a.etag, `${when} ${tool}`).toBe(gaugeEtag(want));
      }
      // a read its client did wait for is not derived a second time
      t.upload();
      expect((await t.read(TODAY[0]!)).cache, when).toBe('miss');
      const { rewarmed } = t.reads.stats();
      vi.advanceTimersByTime(REWARM_AFTER_MS);
      await t.drained();
      expect(t.reads.stats().rewarmed, when).toBe(rewarmed + TODAY.length - 1);
      expect(t.lines, when).toEqual([]);
    }
  });

  it('the reads warmed after one burst of writes have a time budget: once it is spent the rest wait for their next request', async () => {
    // no time at all: the read asked most recently is derived, and nothing after it
    const t = setup({ roundMs: 0 });
    for (const r of TODAY) await t.read(r);
    const { misses } = t.reads.stats();
    t.upload();
    vi.advanceTimersByTime(REWARM_AFTER_MS);
    expect(t.reads.stats().warming).toBe(TODAY.length);
    await t.drained();
    expect(t.reads.stats()).toMatchObject({ misses: misses + 1, rewarmed: 1, warming: 0 });
    expect(TODAY.map(t.kept)).toEqual([false, false, false, true]);
    // the next upload starts another round with its own budget; what was left out is not queued again by itself
    t.upload();
    vi.advanceTimersByTime(REWARM_AFTER_MS);
    expect(t.reads.stats().warming).toBe(1);
    await t.drained();
    expect(t.reads.stats()).toMatchObject({ misses: misses + 2, rewarmed: 2 });
    expect(TODAY.map(t.kept)).toEqual([false, false, false, true]);
    // until a client asks for it again: then it is the one asked most recently
    expect((await t.read(TODAY[0]!)).cache).toBe('miss');
    t.upload();
    vi.advanceTimersByTime(REWARM_AFTER_MS);
    expect(t.reads.stats().warming).toBe(2);
    await t.drained();
    expect(TODAY.map(t.kept)).toEqual([true, false, false, false]);
    expect(t.reads.stats().rewarmed).toBe(3);
    expect(t.lines).toEqual([]);
  });

  it('only what a client asked for in the last 6 hours (being warmed is not being asked), and the 24 reads asked most recently', async () => {
    const t = setup();
    const [daily, timeline] = [TODAY[0]!, TODAY[1]!];
    await t.read(daily);
    await t.read(timeline);
    t.clock.now += REWARM_ASKED_MS / 2;
    t.upload();
    vi.advanceTimersByTime(REWARM_AFTER_MS);
    await t.drained();
    expect(t.reads.stats().rewarmed).toBe(2);
    // the timeline was asked 6 hours ago and warmed 3 hours ago; the day's summary is asked again (a poll with its ETag)
    t.clock.now += REWARM_ASKED_MS / 2 + 60_000;
    expect(t.kept(daily)).toBe(true);
    t.upload();
    vi.advanceTimersByTime(REWARM_AFTER_MS);
    await t.drained();
    expect(t.reads.stats().rewarmed).toBe(3);
    expect(t.kept(timeline)).toBe(false);
    expect(t.kept(daily)).toBe(true);

    // more reads than are remembered: the ones asked first are left to their next request
    const many: Read[] = Array.from({ length: REWARM_MAX_KEYS + 2 }, (_, i) => ['gauge_hr_intervals', { from: `${D}T05:00`, to: `${D}T23:${String(10 + i)}` }]);
    for (const r of many) await t.read(r);
    const rewarmed = t.reads.stats().rewarmed;
    t.upload();
    expect(many.map(t.kept)).toEqual(many.map(() => false));
    vi.advanceTimersByTime(REWARM_AFTER_MS);
    await t.drained();
    expect(t.reads.stats().rewarmed).toBe(rewarmed + REWARM_MAX_KEYS);
    expect(many.map(t.kept)).toEqual(many.map((_, i) => i >= 2));
  });

  it('never after a write that drops everything, nor under another fusion context than the dropped answer used', async () => {
    const t = setup();
    const series: Read = ['gauge_metric_series', { kind: 'hr', from: D, to: D }];
    for (const r of [...TODAY, series]) await t.read(r);
    const misses = t.reads.stats().misses;
    // an upload, then a pairing before the 5 seconds are over
    t.upload();
    t.store.noteInstallation(OTHER_INSTALL, { pairedAt: iso(t.clock.now) });
    vi.advanceTimersByTime(2 * REWARM_AFTER_MS);
    await t.drained();
    // and a pairing while the round waits its turn
    for (const r of [...TODAY, series]) await t.read(r);
    t.upload();
    vi.advanceTimersByTime(REWARM_AFTER_MS);
    expect(t.reads.stats().warming).toBe(TODAY.length + 1);
    t.store.noteInstallation(OTHER_INSTALL, { pairedAt: iso(t.clock.now + 1000) });
    expect(t.reads.stats().warming).toBe(0);
    await t.drained();
    expect(t.reads.stats()).toMatchObject({ rewarmed: 0, misses: 2 * misses });
    expect([...TODAY, series].map(t.kept)).toEqual([...TODAY, series].map(() => false));

    // the person's context for today changed after the upload: the reads that used it wait for their client
    for (const r of [...TODAY, series]) await t.read(r);
    t.upload();
    t.context.put(P, { windowStartMs: ist('00:00'), windowEndMs: ist('23:59'), activities: [{ startMs: ist('07:00'), endMs: ist('07:30'), kind: 'locomotorPocket' }], corrections: [] }, t.clock.now);
    vi.advanceTimersByTime(REWARM_AFTER_MS);
    await t.drained();
    expect(t.kept(series)).toBe(true);
    expect(t.kept(TODAY[1]!)).toBe(false);
    expect(t.reads.stats().rewarmed).toBeLessThan(TODAY.length + 1);
    expect(t.lines).toEqual([]);
  });

  it('a failure is one log line and reaches nobody; the next client derives its own answer', async () => {
    let failing = false;
    const t = setup({ failing: () => failing });
    await t.read(TODAY[1]!);
    t.upload();
    failing = true;
    vi.advanceTimersByTime(REWARM_AFTER_MS);
    await t.drained();
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toContain('gauge_timeline');
    expect(t.lines[0]).not.toContain(D);
    expect(t.reads.stats()).toMatchObject({ rewarmed: 0, warming: 0 });
    failing = false;
    const a = await t.read(TODAY[1]!);
    expect(a.cache).toBe('miss');
    expect(JSON.stringify(a.envelope)).toBe(JSON.stringify(await t.plain.call(...TODAY[1]!)));
  });

  it('closing cancels what was to be warmed, before the 5 seconds and while it waits its turn; so does releasing the store', async () => {
    for (const end of ['close', 'release'] as const) {
      for (const when of ['before', 'queued'] as const) {
        const t = setup();
        for (const r of TODAY) await t.read(r);
        t.upload();
        if (when === 'queued') {
          vi.advanceTimersByTime(REWARM_AFTER_MS);
          expect(t.reads.stats().warming).toBe(TODAY.length);
        }
        const { misses } = t.reads.stats();
        const sql = t.store.sqlReads();
        if (end === 'close') t.reads.close();
        else t.reads.release(t.store);
        expect(vi.getTimerCount(), `${end} ${when}`).toBe(0);
        vi.advanceTimersByTime(2 * REWARM_AFTER_MS);
        for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
        expect(t.reads.stats(), `${end} ${when}`).toMatchObject({ misses, rewarmed: 0, warming: 0, queued: 0 });
        expect(t.store.sqlReads(), `${end} ${when}`).toBe(sql);
      }
    }
  });
});
