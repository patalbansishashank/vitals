/**
 * `log.sleepTimes` (energy SPEC §V3.6, D11, D21): the person's lights-out and out-of-bed times. A ring-imported night
 * takes them without becoming the person's correction (its source and its bed and wake times stay); before the night has
 * arrived the times wait on the waking date; a later ring correction keeps them; undo puts the night back.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { readDocs } from '@/commands/living';
import { isGaugeEntry, localToInstant, projectEntries, type DayStatusDoc, type LogEntry } from '@/living';
import { diaryOf, nightOn } from '@/living/sleepDiary';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TODAY = '2026-10-21';
const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
const at = (date: string, h: number) => localToInstant(date, h, TZ);
const night = (bedH = 23.25, wakeH = 7, asleep = 430) => ({ wakingDate: TODAY, start: at('2026-10-20', bedH), end: at(TODAY, wakeH), asleepMinutes: asleep });

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.parse(at(TODAY, 9))));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => freshState({ cleared: true }));

const ok = <T,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};

async function nightNow(): Promise<(LogEntry & { kind: 'sleep' }) | null> {
  await settleCommits();
  return nightOn((await readDocs(TODAY)).entries, TODAY);
}

describe('log.sleepTimes', () => {
  it('puts the times on a ring night without making it the person’s correction', async () => {
    ok(await dispatch('log.fromGauge', { steps: [], sleep: [night()] }, SYS));
    const ring = (await nightNow())!;
    expect(isGaugeEntry(ring)).toBe(true);
    const r = ok<{ entryId: string; waiting: boolean }>(await dispatch('log.sleepTimes', { date: TODAY, lightsOutAt: at('2026-10-20', 22.9), outOfBedAt: at(TODAY, 7.4) }));
    expect(r.waiting).toBe(false);
    const after = (await nightNow())!;
    expect(after.id).toBe(r.entryId);
    expect(isGaugeEntry(after)).toBe(true);
    expect(after.source).toEqual(ring.source);
    expect([after.bedAt, after.wakeAt, after.asleepMin]).toEqual([ring.bedAt, ring.wakeAt, ring.asleepMin]);
    expect(after.lightsOutAt).toBe(at('2026-10-20', 22.9));
    expect(after.outOfBedAt).toBe(at(TODAY, 7.4));
    // one night in force, no conflict, nothing typed by the person hiding the ring's night
    const nights = projectEntries((await readDocs(TODAY)).entries).filter((e) => e.kind === 'sleep');
    expect(nights).toHaveLength(1);
    expect(nights[0]!.conflict).toBeUndefined();
    // the import sees the same reading (nothing to rewrite), and a later correction keeps the person's times
    const again = ok<{ skipped: Array<{ reason: string }> }>(await dispatch('log.fromGauge', { steps: [], sleep: [night()] }, SYS));
    expect(again.skipped.map((s) => s.reason)).toEqual(['unchanged']);
    ok(await dispatch('log.fromGauge', { steps: [], sleep: [night(23.5, 7, 420)] }, SYS));
    const corrected = (await nightNow())!;
    expect(corrected.asleepMin).toBe(420);
    expect(corrected.lightsOutAt).toBe(at('2026-10-20', 22.9));
    expect(corrected.outOfBedAt).toBe(at(TODAY, 7.4));
  });

  it('holds "Going to sleep" on the date until the night arrives, then moves it onto the night', async () => {
    const r = ok<{ entryId: string | null; waiting: boolean }>(await dispatch('log.sleepTimes', { date: TODAY, lightsOutAt: at('2026-10-20', 23) }));
    expect(r).toMatchObject({ entryId: null, waiting: true });
    await settleCommits();
    const status = bodyOf<DayStatusDoc>(getDocumentStore().peek('dayStatus', `day:${TODAY}`)!);
    expect(status.sleepDiary?.lightsOutAt).toBe(at('2026-10-20', 23));
    ok(await dispatch('log.fromGauge', { steps: [], sleep: [night()] }, SYS));
    const ring = (await nightNow())!;
    // the reader joins them before anything moves
    expect(diaryOf(ring, status.sleepDiary).lightsOutAt).toBe(at('2026-10-20', 23));
    ok(await dispatch('log.sleepTimes', { date: TODAY, outOfBedAt: at(TODAY, 7.25) }));
    const joined = (await nightNow())!;
    expect(isGaugeEntry(joined)).toBe(true);
    expect([joined.lightsOutAt, joined.outOfBedAt]).toEqual([at('2026-10-20', 23), at(TODAY, 7.25)]);
    await settleCommits();
    expect(bodyOf<DayStatusDoc>(getDocumentStore().peek('dayStatus', `day:${TODAY}`)!).sleepDiary).toBeUndefined();
  });

  it('accepts tomorrow’s night ("Going to sleep" tonight), refuses getting up before lights out', async () => {
    expect((await dispatch('log.sleepTimes', { date: '2026-10-22', lightsOutAt: at(TODAY, 23) })).ok).toBe(true);
    expect((await dispatch('log.sleepTimes', { date: '2026-10-23', lightsOutAt: at('2026-10-22', 23) })).ok).toBe(false);
    const bad = await dispatch('log.sleepTimes', { date: TODAY, lightsOutAt: at(TODAY, 7), outOfBedAt: at(TODAY, 6) });
    expect(bad.ok).toBe(false);
  });

  it('clears a time with null, and undo puts the night back as it was', async () => {
    ok(await dispatch('log.fromGauge', { steps: [], sleep: [night()] }, SYS));
    const ring = (await nightNow())!;
    ok(await dispatch('log.sleepTimes', { date: TODAY, lightsOutAt: at('2026-10-20', 22.5) }));
    const r = await dispatch('log.sleepTimes', { date: TODAY, lightsOutAt: null });
    expect((await nightNow())!.lightsOutAt).toBeUndefined();
    const cs = r.ok && 'output' in r ? r.changeSet?.id : undefined;
    expect(cs).toBeTruthy();
    ok(await dispatch('history.undo', { changeSetId: cs! }));
    expect((await nightNow())!.lightsOutAt).toBe(at('2026-10-20', 22.5));
    expect((await nightNow())!.bedAt).toBe(ring.bedAt);
  });
});
