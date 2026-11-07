/**
 * The D11 sleep entry reads and writes the living plan's own data (`log.sleepTimes`): a ring night keeps its source, and
 * "Going to sleep" before the night has arrived waits on the waking date and shows at once.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { readDocs } from '@/commands/living';
import { isGaugeEntry, localToInstant } from '@/living';
import { nightOn } from '@/living/sleepDiary';
import { resetSleepEntries, saveSleepTimes, setSleepEntry, useSleepEntry } from './entry';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const at = (date: string, h: number) => localToInstant(date, h, TZ);
const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };

beforeEach(() => {
  freshState({ cleared: true });
  resetSleepEntries();
});

describe('sleep entry (lights out, out of bed)', () => {
  it('writes onto the ring night without making it the person’s, and reads it back', async () => {
    const d = '2026-10-20';
    await dispatch('log.fromGauge', { steps: [], sleep: [{ wakingDate: d, start: at('2026-10-19', 23), end: at(d, 6.75), asleepMinutes: 440 }] }, SYS);
    await settleCommits();
    const { result } = renderHook(() => useSleepEntry(d));
    expect(result.current).toBeNull();
    await act(async () => void (await saveSleepTimes(d, { lightsOutAt: at('2026-10-19', 22.75) })));
    await settleCommits();
    await waitFor(() => expect(result.current?.lightsOutAt).toBe(at('2026-10-19', 22.75)));
    const night = nightOn((await readDocs(d)).entries, d)!;
    expect(isGaugeEntry(night)).toBe(true);
    expect(night.lightsOutAt).toBe(at('2026-10-19', 22.75));
  });

  it('holds lights out for a night that is not in yet, and setSleepEntry(null) clears it', async () => {
    const d = '2026-10-21';
    const { result } = renderHook(() => useSleepEntry(d));
    const o = await act(async () => saveSleepTimes(d, { lightsOutAt: at('2026-10-20', 23.1) }));
    expect(o).toMatchObject({ ok: true, waiting: true });
    await settleCommits();
    await waitFor(() => expect(result.current?.lightsOutAt).toBe(at('2026-10-20', 23.1)));
    act(() => setSleepEntry(d, null));
    await waitFor(() => expect(result.current).toBeNull());
  });
});

describe('out of bed after noon (Claude UI P3-7)', () => {
  it('is the first such clock time after lights out', async () => {
    const { timeAfter, timeOnNight } = await import('./entry');
    const lo = timeOnNight('2026-10-20', '23:40')!;
    const ob = timeAfter(lo, '12:30')!;
    expect(Date.parse(ob)).toBeGreaterThan(Date.parse(lo));
    expect((Date.parse(ob) - Date.parse(lo)) / 3_600_000).toBeCloseTo(12 + 50 / 60, 6);
    expect(timeAfter(lo, '07:15')).toBe(new Date(2026, 9, 20, 7, 15).toISOString());
    expect(timeAfter(lo, '25:00')).toBeNull();
  });
});
