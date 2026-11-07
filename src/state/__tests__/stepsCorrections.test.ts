/**
 * Step corrections (energy SPEC §2.3 4(a)): `log.stepsCorrection` stores the person's "use this source for these
 * steps", `log.retract` removes it, and the Gauge import sends the in-force ones to `POST /v1/gauge/steps/fuse`. With
 * audit F12: the import reads one calendar day past `to` and writes fused days as app days.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { localToInstant, type LogEntry } from '@/living';
import type { GaugeApi, GaugeSteps, GaugeStepsFuseRequest } from '@/net/gauge';
import { fuseCorrectionsOf, runGaugeImport, type GaugeImportDeps } from '../gaugeImport';

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const entryId = (r: { ok: boolean }) => (r as { output?: { entryId: string } }).output!.entryId;

async function corrections(): Promise<Array<Extract<LogEntry, { kind: 'stepsCorrection' }>>> {
  const r = await dispatch('log.get', { from: '2020-01-01', to: '2099-12-31', kinds: ['stepsCorrection'] });
  return (r as { output: Array<Extract<LogEntry, { kind: 'stepsCorrection' }>> }).output;
}

describe('log.stepsCorrection', () => {
  beforeEach(() => {
    freshState({ cleared: true });
  });

  it('stores the span and the source on the app day of its start; log.retract removes it', async () => {
    const start = Date.now() - 3 * HOUR;
    const r = await dispatch('log.stepsCorrection', { start: iso(start), end: iso(start + HOUR), use: 'phone' });
    expect(r.ok).toBe(true);
    await settleCommits();
    const [c] = await corrections();
    expect(c).toMatchObject({ kind: 'stepsCorrection', start: iso(start), end: iso(start + HOUR), use: 'phone', occurrence: { precision: 'interval', dateMeaning: 'appDay' } });
    expect((await dispatch('log.retract', { entryId: entryId(r) })).ok).toBe(true);
    await settleCommits();
    expect(await corrections()).toEqual([]);
  });

  it.each([
    ['an end before the start', { start: iso(Date.now() - HOUR), end: iso(Date.now() - 2 * HOUR), use: 'ring' }, 'invalid_input'],
    ['more than two days', { start: iso(Date.now() - 50 * HOUR), end: iso(Date.now()), use: 'ring' }, 'invalid_input'],
    ['a span that has not begun', { start: iso(Date.now() + HOUR), end: iso(Date.now() + 2 * HOUR), use: 'ring' }, 'invalid_input'],
    ['an unknown source', { start: iso(Date.now() - 2 * HOUR), end: iso(Date.now() - HOUR), use: 'watch' }, 'invalid_input'],
  ])('refuses %s', async (_n, input, code) => {
    const r = await dispatch('log.stepsCorrection', input);
    expect(r.ok ? null : r.error.code).toBe(code);
  });

  it('takes another Health Connect app by its origin', async () => {
    const start = Date.now() - 2 * HOUR;
    expect((await dispatch('log.stepsCorrection', { start: iso(start), end: iso(start + HOUR), use: 'hc-other:com.google.android.apps.fitness' })).ok).toBe(true);
  });
});

describe('fuseCorrectionsOf', () => {
  const c = (id: string, date: string, start: string, end: string, use: string, at: string, over: object = {}) =>
    ({ id, date, tz: 'UTC', at, recordedAt: at, kind: 'stepsCorrection', start, end, use, source: { by: 'user' }, ...over }) as unknown as LogEntry;

  it('a later correction wins its span over an earlier one; the rest of the earlier stays', () => {
    const out = fuseCorrectionsOf([
      c('a', '2026-10-20', '2026-10-20T00:00:00.000Z', '2026-10-21T00:00:00.000Z', 'ring', '2026-10-20T20:00:00Z'),
      c('b', '2026-10-20', '2026-10-20T08:00:00.000Z', '2026-10-20T09:00:00.000Z', 'phone', '2026-10-20T21:00:00Z'),
    ], '2026-10-20', '2026-10-20');
    expect(out).toEqual([
      { start: '2026-10-20T00:00:00.000Z', end: '2026-10-20T08:00:00.000Z', use: 'ring' },
      { start: '2026-10-20T08:00:00.000Z', end: '2026-10-20T09:00:00.000Z', use: 'phone' },
      { start: '2026-10-20T09:00:00.000Z', end: '2026-10-21T00:00:00.000Z', use: 'ring' },
    ]);
  });

  it('a whole-day correction made after an hour one covers that hour too', () => {
    const out = fuseCorrectionsOf([
      c('b', '2026-10-20', '2026-10-20T08:00:00.000Z', '2026-10-20T09:00:00.000Z', 'phone', '2026-10-20T20:00:00Z'),
      c('a', '2026-10-20', '2026-10-20T00:00:00.000Z', '2026-10-21T00:00:00.000Z', 'ring', '2026-10-20T21:00:00Z'),
    ], '2026-10-20', '2026-10-20');
    expect(out).toEqual([{ start: '2026-10-20T00:00:00.000Z', end: '2026-10-21T00:00:00.000Z', use: 'ring' }]);
  });

  it('removed and out-of-range corrections are not sent', () => {
    const out = fuseCorrectionsOf([
      c('a', '2026-10-20', '2026-10-20T08:00:00.000Z', '2026-10-20T09:00:00.000Z', 'phone', '2026-10-20T20:00:00Z'),
      { id: 'x', date: '2026-10-20', tz: 'UTC', at: '2026-10-20T22:00:00Z', kind: 'retract', target: 'a', source: { by: 'user' } } as unknown as LogEntry,
      c('old', '2026-09-01', '2026-09-01T08:00:00.000Z', '2026-09-01T09:00:00.000Z', 'ring', '2026-09-01T20:00:00Z'),
    ], '2026-10-20', '2026-10-20');
    expect(out).toEqual([]);
  });
});

describe('the import sends the corrections and writes app days (F12)', () => {
  function memoryStorage() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  }
  const TZ = 'Asia/Kolkata';
  const cov = { ringMin: 600, phoneMin: 30, eitherMin: 620, unknownMin: 820 };
  // the 20th (app day) has a walk at 01:00 on the 21st; the read reaches the 21st for it
  const fused: GaugeSteps = {
    fusionVersion: 'steps-fuse/1',
    intervals: [
      { start: localToInstant('2026-10-20', 9, TZ), end: localToInstant('2026-10-20', 10, TZ), steps: 6000, source: 'ring', lineage: 'ring', support: 'minute', selectionReason: 'preference', alternatives: [] },
      { start: localToInstant('2026-10-21', 1, TZ), end: localToInstant('2026-10-21', 1.5, TZ), steps: 2000, source: 'phone', lineage: 'phone', support: 'minute', selectionReason: 'correction', alternatives: [] },
    ],
    days: [
      { date: '2026-10-20', located: 6000, headline: 6000, headlinePolicy: 'located', coverage: cov },
      { date: '2026-10-21', located: 2000, headline: 2000, headlinePolicy: 'located', coverage: cov },
    ],
  } as unknown as GaugeSteps;

  it('posts the corrections, asks one day past `to`, and the walk at 01:00 lands on the app day 20th', async () => {
    const posted: GaugeStepsFuseRequest[] = [];
    const api = {
      activity: async () => ({ days: [] }),
      sleep: async () => ({ sessions: [] }),
      stepsFuse: async (b: GaugeStepsFuseRequest) => (posted.push(b), fused),
      status: () => ({ lastOkAt: null, problem: null }),
    } as unknown as GaugeApi;
    const corr = [{ start: localToInstant('2026-10-21', 1, TZ), end: localToInstant('2026-10-21', 1.5, TZ), use: 'phone' }];
    const seen: Array<{ steps: Array<{ date: string; steps: number }> }> = [];
    const deps: Partial<GaugeImportDeps> = {
      api, enabled: () => true, today: () => '2026-10-20', now: () => Date.parse('2026-10-21T02:00:00+05:30'), storage: memoryStorage(), tz: () => TZ, rolloverH: () => 4,
      stepsContext: () => ({ activities: [], preference: { stepsPreference: ['ring', 'phone'], soleSustainedGait: true }, headline: 'located', corrections: corr }),
      importer: async (input) => (seen.push(input as never), { created: [], skipped: [] }),
    };
    expect((await runGaugeImport(deps)).ran).toBe(true);
    expect(posted[0]).toMatchObject({ to: '2026-10-21', tz: TZ, corrections: corr });
    expect(seen[0]!.steps.map((d) => [d.date, d.steps])).toEqual([['2026-10-20', 8000]]);
  });

  it('without corrections the body carries none', async () => {
    const posted: GaugeStepsFuseRequest[] = [];
    const api = { activity: async () => ({ days: [] }), sleep: async () => ({ sessions: [] }), stepsFuse: async (b: GaugeStepsFuseRequest) => (posted.push(b), fused), status: () => ({ lastOkAt: null, problem: null }) } as unknown as GaugeApi;
    await runGaugeImport({ api, enabled: () => true, today: () => '2026-10-20', now: () => 0, storage: memoryStorage(), tz: () => TZ, stepsContext: () => ({ activities: [], preference: {}, headline: 'atLeast', corrections: [] }), importer: async () => ({ created: [], skipped: [] }) });
    expect(posted[0]).not.toHaveProperty('corrections');
  });
});
