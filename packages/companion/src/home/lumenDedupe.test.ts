// @vitest-environment node
/**
 * `vitals-server gauge dedupe` (`./lumenDedupe.ts`, the store's `dedupe`) and the `gauge_sleep` minute grid, on one
 * real night from the server, anonymised: ids and installation replaced, every instant moved 280 days earlier (the
 * time of day and the sub-second stamps are kept, they are the point). Stages: d deep, l light, r rem, a awake.
 * Gauge < 2.7.3 uploaded the packets at the ring's raw stamps (whole seconds); 2.7.3 re-sent them 383.118 s earlier
 * (`.882`), and later connections added sub-second copies (Jan 20).
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { findDuplicates, inferClockOffset, payloadKey, type DedupeRow } from './lumenDedupe.ts';
import { INSTALL, hr, sleepPacket } from './lumenFixtures.ts';
import { openLumenStore, type LumenStore } from './lumenStore.ts';
import { lumenToolSet, sleepNights } from './lumenTools.ts';
import { serverMain } from './serverCli.ts';
import { defaultServerConfig, writeServerConfig } from './serverConfig.ts';

const TZ = 'Asia/Kolkata';
const STAGE: Record<string, string> = { d: 'deep', l: 'light', r: 'rem', a: 'awake', u: 'unknown' };
type Packet = [observedAt: string, receivedAt: string, stages: string];
const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/** The night of waking day 2026-01-15: the raw uploads (received Jan 16) and 2.7.3's corrected copies (Jan 19). */
const NIGHT: Packet[] = [
  ['2026-01-14T16:44:38.882Z', '2026-01-19T23:36:55.568946Z', `${A}aaaaaaaaaaaarrrrrrrrrrrrrrrrrrrrrrlllllllllllla`],
  ['2026-01-14T16:51:02Z', '2026-01-16T15:43:03.261265Z', `${A}aaaaaaaaaaaarrrrrrrrrrrrrrrrrrrrrrlllllllllllla`],
  ['2026-01-14T18:52:35.882Z', '2026-01-19T23:36:55.559867Z', 'allllllllllllllllllllllllldldllddddddddldddlldlllllllllldllddddddddddddd'],
  ['2026-01-14T18:58:59Z', '2026-01-16T15:43:03.261265Z', 'allllllllllllllllllllllllldldllddddddddldddlldlllllllllldllddddddddddddd'],
  ['2026-01-14T20:07:35.882Z', '2026-01-19T23:36:55.551421Z', 'alllllllllllllllldddlddddddddd'],
  ['2026-01-14T20:13:59Z', '2026-01-16T15:43:03.261265Z', 'alllllllllllllllldddlddddddddd'],
  ['2026-01-14T20:40:35.882Z', '2026-01-19T23:36:55.543184Z', 'allllllllllllllllllllldlddddd'],
  ['2026-01-14T20:46:59Z', '2026-01-16T15:43:03.261265Z', 'allllllllllllllllllllldlddddd'],
  ['2026-01-14T21:12:35.882Z', '2026-01-19T23:36:55.535869Z', 'alllllllllllllllllllldddddd'],
  ['2026-01-14T21:18:59Z', '2026-01-16T15:43:03.261265Z', 'alllllllllllllllllllldddddd'],
  ['2026-01-14T21:40:35.882Z', '2026-01-19T23:36:55.529086Z', 'aaallllllllllllllllddddldddddddddd'],
  // two versions at one raw stamp: the newer, shorter one is current; the dedupe hides the whole instant
  ['2026-01-14T21:46:59Z', '2026-01-16T15:43:03.261265Z', 'aaallllllllllllllllddddlddddddddddllllldddddddddddddddddddddddddllllllldddddddddddddddddddddddddddd'],
  ['2026-01-14T21:46:59Z', '2026-01-16T15:47:49.369112Z', 'aaallllllllllllllllddddldddddddddd'],
  ['2026-01-14T22:01:35.882Z', '2026-01-19T23:36:55.522443Z', 'aaalllllllllllllllddddddddddddddddddddddddd'],
  ['2026-01-14T22:07:59Z', '2026-01-16T15:47:49.355267Z', 'aaalllllllllllllllddddddddddddddddddddddddd'],
  ['2026-01-14T22:31:35.882Z', '2026-01-19T23:36:55.515030Z', 'aaallllllllllllllllldddddddddddddddddddddddddddd'],
  ['2026-01-14T22:37:59Z', '2026-01-16T15:47:49.345887Z', 'aaallllllllllllllllldddddddddddddddddddddddddddd'],
  ['2026-01-14T23:25:35.882Z', '2026-01-19T23:36:55.508022Z', 'aaaaaalllllllllllllllldddlldd'],
  ['2026-01-14T23:31:59Z', '2026-01-16T15:43:03.261265Z', 'aaaaaalllllllllllllllldddlldd'],
  ['2026-01-15T00:01:35.882Z', '2026-01-19T23:36:55.501229Z', 'aaaaaaaaaaaaaaaaaaaaalllddddddddddddddddddddddddlllll'],
  ['2026-01-15T00:07:59Z', '2026-01-16T15:43:03.261265Z', 'aaaaaaaaaaaaaaaaaaaaalllddddddddddddddddddddddddlllll'],
  ['2026-01-15T01:01:35.882Z', '2026-01-19T23:36:55.493339Z', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaalllllllllllllllllllllllddlddll'],
  ['2026-01-15T01:07:59Z', '2026-01-16T15:43:03.261265Z', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaalllllllllllllllllllllllddlddll'],
];
const LONG = `${A}rrrrrrrrrrrrrrrrrrrllllllllllllllllllldlllllllllllll`;
/** Two packets of the morning of Jan 20, each re-sent by ten later connections with their sub-second noise. */
const NOISY: Packet[] = [
  ['23:43:00.272', '02:24:56.715708'], ['23:43:00.321', '06:44:44.615524'], ['23:43:00.434', '03:41:34.265143'], ['23:43:00.671', '08:43:31.537834'],
  ['23:43:01.142', '02:25:34.710730'], ['23:43:01.299', '06:28:35.041077'], ['23:43:01.311', '09:38:39.367829'], ['23:43:01.361', '09:23:32.729074'],
  ['23:43:01.512', '05:09:31.761408'], ['23:43:01.703', '03:43:11.257087'],
].flatMap(([at, rec]): Packet[] => {
  const first = `2026-01-19T${at}Z`;
  // the next packet, 2 h less a second later, came in the same connection
  return [[first, `2026-01-20T${rec}Z`, LONG], [new Date(Date.parse(first) + 7_199_000).toISOString(), `2026-01-20T${rec}Z`, 'llla']];
});

const events = (packets: Packet[]) => packets.map(([at, rec, s]) => sleepPacket(at, [...s].map((c) => STAGE[c]!), { receivedAt: rec }));
const NOW = Date.parse('2026-01-21T00:00:00Z');

const TMP = process.env.TMPDIR ?? '/tmp';
const dirs: string[] = [];
let store: LumenStore | undefined;
const open = (packets: Packet[]) => {
  const dir = mkdtempSync(join(TMP, 'lumen-dedupe-'));
  dirs.push(dir);
  store = openLumenStore(join(dir, 'lumen.db'));
  store.ingest(INSTALL, events(packets), NOW - 3_600_000);
  return store;
};
afterEach(() => {
  store?.close();
  store = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const night = (s: LumenStore, day: string) => sleepNights(s, TZ, day, day).map(({ blocks: _b, ...n }) => n);

describe('gauge_sleep minutes', () => {
  it('puts every packet on one minute grid, so a night of packets stamped at different seconds has no unknown minutes', async () => {
    // the night as the server held it before 2.7.3 existed: the raw uploads only (stamps at :59 and :02)
    const s = open(NIGHT.filter(([at]) => !at.endsWith('.882Z')));
    const [n] = night(s, '2026-01-15');
    // before the grid, a packet stamped at another second than the first never shared its minute keys: on the server this
    // waking day read 458 minutes "unknown"
    expect(n).toMatchObject({ start: '2026-01-14T22:21:00+05:30', end: '2026-01-15T07:47:00+05:30', inBedMinutes: 566, asleepMinutes: 369 });
    expect(n!.minutes).toEqual({ deep: 152, light: 195, rem: 22, awake: 154, unknown: 0 });
    // the gaps between the ring's packets are no data, not a stage
    expect(n!.noDataMinutes).toBe(43);
    expect(n!.efficiencyPercent).toBe(Math.round((369 / (566 - 43)) * 100));
    const tool = await lumenToolSet(() => s, TZ).call('gauge_sleep', { from: '2026-01-15', to: '2026-01-15' });
    expect((tool.data as { sessions: Array<{ blocks: Array<{ stage: string }> }> }).sessions[0]!.blocks.some((b) => b.stage === 'no_data')).toBe(true);
  });

  it('keeps a stage the ring itself marked unknown as unknown', () => {
    const s = open([['2026-01-14T20:00:30Z', '2026-01-14T21:00:00Z', 'lluulld']]);
    expect(night(s, '2026-01-15')[0]).toMatchObject({ inBedMinutes: 7, asleepMinutes: 5, noDataMinutes: 0, minutes: { light: 4, deep: 1, unknown: 2 } });
  });
});

describe('gauge dedupe', () => {
  it('soft-deletes the raw copies and the sub-second copies, keeps what Gauge 2.7.4 keeps, and can be undone', () => {
    const s = open([...NIGHT, ...NOISY]);
    const visible = () => s.get<{ n: number }>("SELECT COUNT(*) AS n FROM sleep_timeline")!.n;
    expect(visible()).toBe(22 + 20);
    const before = night(s, '2026-01-15')[0]!;
    // the raw tails past each corrected packet were counted on top of it
    expect(before).toMatchObject({ asleepMinutes: 408, inBedMinutes: 572 });

    let during: ReturnType<typeof night> = [];
    const dry = s.dedupe({ dryRun: true, nowMs: NOW, inspect: () => (during = night(s, '2026-01-15')) });
    expect(dry.offsets).toEqual([{ installationId: INSTALL, offsetMs: 383_118, source: 'inferred', twins: 11 }]);
    expect(dry.written).toBe(0);
    const count = (r: typeof dry, reason: string) => r.removals.filter((x) => x.reason === reason).length;
    expect([count(dry, 'clock_twin'), count(dry, 'near_copy')]).toEqual([11, 18]);
    // every raw copy goes, never a corrected one
    expect(dry.removals.filter((x) => x.reason === 'clock_twin').every((x) => x.row.observed_ms % 1000 === 0)).toBe(true);
    expect(during[0]).toMatchObject({ asleepMinutes: 369, inBedMinutes: 566, noDataMinutes: 43 });
    expect(visible()).toBe(42);
    expect(night(s, '2026-01-15')[0]).toEqual(before);

    const real = s.dedupe({ nowMs: NOW });
    expect(real.written).toBe(29);
    expect(visible()).toBe(42 - 29);
    expect(night(s, '2026-01-15')[0]).toMatchObject({ asleepMinutes: 369, inBedMinutes: 566, minutes: { deep: 152, light: 195, rem: 22, awake: 154, unknown: 0 } });
    // the raw instant with two versions is gone whole; the older, longer version does not come back
    expect(s.get<{ n: number }>('SELECT COUNT(*) AS n FROM visible_events WHERE observed_ms = ?', Date.parse('2026-01-14T21:46:59Z'))!.n).toBe(0);
    // of the sub-second copies, the one received last stays (no copy is on the corrected grid)
    expect(s.all<{ observed_ms: number }>("SELECT observed_ms FROM sleep_timeline WHERE observed_ms >= ? ORDER BY observed_ms", Date.parse('2026-01-19T23:00:00Z')).map((r) => new Date(r.observed_ms).toISOString()))
      .toEqual(['2026-01-19T23:43:01.311Z', '2026-01-20T01:43:00.311Z']);
    // the raw events stay stored, only hidden, through exact-instant deletions
    expect(s.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')!.n).toBe(43);
    expect(s.get<{ n: number }>("SELECT COUNT(*) AS n FROM deletions WHERE id LIKE 'srv-dedupe-%' AND from_ms = to_ms AND kind = 'sleep_timeline'")!.n).toBe(29);

    // a second run finds nothing more
    expect(s.dedupe({ nowMs: NOW + 1 }).removals).toEqual([]);
    expect(s.undoDedupe({ dryRun: true })).toBe(29);
    expect(s.undoDedupe()).toBe(29);
    expect(visible()).toBe(42);
    expect(night(s, '2026-01-15')[0]).toEqual(before);
  });

  it('does not touch a copy received again after the cleanup (the deletion only covers what was there)', () => {
    const s = open(NIGHT.slice(0, 2));
    // one pair is too few to infer the offset from; it can be given
    expect(s.dedupe({ nowMs: NOW }).written).toBe(0);
    expect(s.dedupe({ nowMs: NOW, offsetMs: 383_118 }).written).toBe(1);
    expect(s.get<{ n: number }>("SELECT COUNT(*) AS n FROM sleep_timeline")!.n).toBe(1);
    const raw = events([NIGHT[1]!])[0]!;
    s.ingest(INSTALL, [{ ...raw, data: { ...raw.data, received_at: '2026-01-22T00:00:00Z' } }], NOW + 3_600_000);
    expect(s.get<{ n: number }>("SELECT COUNT(*) AS n FROM sleep_timeline")!.n).toBe(2);
  });

  it('refuses categories that are not ring history', () => {
    const s = open([]);
    expect(() => s.dedupe({ categories: ['activity/daily'] })).toThrow(/Not a ring-history category/);
    expect(() => s.dedupe({ categories: ['state/sync'] })).toThrow(/Not a ring-history category/);
  });

  it('prints counts per category and per day from the command line, and changes nothing with --dry-run', async () => {
    const dir = mkdtempSync(join(TMP, 'lumen-dedupe-cli-'));
    dirs.push(dir);
    const env0 = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME };
    process.env.XDG_CONFIG_HOME = join(dir, 'config');
    process.env.XDG_DATA_HOME = join(dir, 'data-home');
    try {
      await writeServerConfig(join(dir, 'config', 'vitals-server'), { ...defaultServerConfig(), dataDir: join(dir, 'data') });
      const cli = async (args: string[]) => {
        const lines: string[] = [];
        const code = await serverMain(args, (l) => lines.push(l), Readable.from([]) as unknown as NodeJS.ReadStream);
        return { code, out: lines.join('\n') };
      };
      const id = (await cli(['persons', 'add', 'Ana', '--tz', TZ])).out.slice(0, 16);
    expect((await cli(['gauge', 'dedupe', id, '--dry-run'])).out).toBe('No ring data for this person.');
      const file = join(dir, 'data', 'persons', id, 'lumen.db');
      mkdirSync(join(dir, 'data', 'persons', id), { recursive: true });
      const s = openLumenStore(file);
      s.ingest(INSTALL, events([...NIGHT, ...NOISY]));
      s.close();

      const dry = await cli(['gauge', 'dedupe', id, '--dry-run']);
      expect(dry.code).toBe(0);
      expect(dry.out).toContain('(dry run: nothing is written)');
      expect(dry.out).toContain(`installation ${INSTALL}: ring clock offset 383.118 s (inferred from 11 identical sleep packets)`);
      expect(dry.out).toContain('sleep/timeline: 11 clock twins, 18 near copies (by local date of the reading)');
      expect(dry.out).toMatch(/ {2}2026-01-14 {2}1 clock twins, 0 near copies\n {2}2026-01-15 {2}10 clock twins, 0 near copies/);
      expect(dry.out).toMatch(/ {2}2026-01-20 {2}0 clock twins, 18 near copies/);
      expect(dry.out).toContain('  2026-01-15  408 asleep, 0 unknown, 9 no data, 572 in bed -> 369 asleep, 0 unknown, 43 no data, 566 in bed');
      expect(dry.out).toContain('Would soft-delete 29 events.');
      const again = await cli(['gauge', 'dedupe', id, '--dry-run']);
      expect(again.out).toContain('Would soft-delete 29 events.');

      expect((await cli(['gauge', 'dedupe', id])).out).toContain(`Soft-deleted 29 events (undo: vitals-server gauge dedupe ${id} --undo).`);
      expect((await cli(['gauge', 'dedupe', id])).out).toContain('No copies found.');
      expect((await cli(['gauge', 'dedupe', id, '--undo'])).out).toBe('Removed 29 dedupe deletions; those copies show again.');
      expect((await cli(['gauge', 'dedupe', id, '--category', 'state/sync'])).code).toBe(2);
      expect((await cli(['gauge', 'dedupe', id, '--offset-ms', '6.4m'])).code).toBe(2);
    } finally {
      for (const [k, v] of Object.entries(env0)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
});

describe('the duplicate rule', () => {
  let n = 0;
  const row = (at: string, received: string, data: Record<string, unknown>, o: Partial<DedupeRow> = {}): DedupeRow => ({
    id: `e${n++}`, installation_id: INSTALL, category: 'sleep/timeline', subject: 'sleep_timeline', observed_ms: Date.parse(at), received_ms: Date.parse(received),
    data: JSON.stringify({ schema_version: 1, observed_at: at, received_at: received, ...data }), ...o,
  });

  it('compares payloads without their times', () => {
    expect(payloadKey('{"schema_version":1,"observed_at":"a","received_at":"b","stages":["light"]}')).toBe('{"schema_version":1,"stages":["light"]}');
    expect(payloadKey('not json')).toBeNull();
  });

  it('pairs only identical payloads, and only the later-received copy is kept', () => {
    const rows = [
      row('2026-01-14T21:18:59Z', '2026-01-16T00:00:00Z', { stages: ['light'] }),
      row('2026-01-14T21:12:35.882Z', '2026-01-19T00:00:00Z', { stages: ['light'] }),
      // a different packet 383.118 s away is not a copy
      row('2026-01-14T22:18:59Z', '2026-01-16T00:00:00Z', { stages: ['deep'] }),
      row('2026-01-14T22:12:35.882Z', '2026-01-19T00:00:00Z', { stages: ['rem'] }),
      // received the other way round: the later-received copy is not the one removed
      row('2026-01-14T23:18:59Z', '2026-01-20T00:00:00Z', { stages: ['awake'] }),
      row('2026-01-14T23:12:35.882Z', '2026-01-16T00:00:00Z', { stages: ['awake'] }),
    ];
    const out = findDuplicates(rows, 383_118).map((r) => [r.row.id, r.reason, r.keptId]);
    expect(out).toHaveLength(1);
    expect(out).toContainEqual([rows[0]!.id, 'clock_twin', rows[1]!.id]);
  });

  it('matches the offset within a second, and does not infer a whole-second offset or one seen fewer than three times', () => {
    const pair = (raw: string, corrected: string, s: string) => [row(raw, '2026-01-16T00:00:00Z', { stages: [s] }), row(corrected, '2026-01-19T00:00:00Z', { stages: [s] })];
    expect(findDuplicates(pair('2026-01-14T21:18:59Z', '2026-01-14T21:12:36.300Z', 'light'), 383_118)).toHaveLength(1);
    expect(findDuplicates(pair('2026-01-14T21:18:59Z', '2026-01-14T21:12:34.800Z', 'light'), 383_118)).toHaveLength(0);
    const whole = ['light', 'deep', 'rem', 'awake'].flatMap((s, i) => pair(`2026-01-14T2${i}:18:59Z`, `2026-01-14T2${i}:12:36Z`, s));
    expect(inferClockOffset(whole)).toBeNull();
    const two = ['light', 'deep'].flatMap((s, i) => pair(`2026-01-14T2${i}:18:59Z`, `2026-01-14T2${i}:12:35.882Z`, s));
    expect(inferClockOffset(two)).toBeNull();
    const three = ['light', 'deep', 'rem'].flatMap((s, i) => pair(`2026-01-14T2${i}:18:59Z`, `2026-01-14T2${i}:12:35.882Z`, s));
    expect(inferClockOffset(three)).toEqual({ offsetMs: 383_118, twins: 3 });
  });

  it('keeps heart-rate readings a whole second apart, and a near copy on the corrected grid', () => {
    const at = (iso: string, rec: string) => {
      const e = hr(iso, 61, { receivedAt: rec });
      return { id: e.id, installation_id: INSTALL, category: e.category, subject: e.subject, observed_ms: Date.parse(iso), received_ms: Date.parse(rec), data: JSON.stringify(e.data) };
    };
    expect(findDuplicates([at('2026-01-14T21:00:00Z', '2026-01-16T00:00:00Z'), at('2026-01-14T21:00:01Z', '2026-01-16T00:00:00Z')], 383_118)).toEqual([]);
    const onGrid = at('2026-01-14T21:00:00.882Z', '2026-01-16T00:00:00Z');
    const noisy = at('2026-01-14T21:00:01.300Z', '2026-01-20T00:00:00Z');
    expect(findDuplicates([onGrid, noisy], 383_118).map((r) => [r.row.id, r.keptId])).toEqual([[noisy.id, onGrid.id]]);
  });
});
