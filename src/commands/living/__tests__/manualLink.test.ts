/**
 * r063 FX3 (aR16): a manual log resolved as "the same activity" as a recording keeps the recording's window and
 * evidence. The preview (`manualCheck` with `resolution: 'link'`) must show exactly what the booking saves — the linked
 * recording's window, minutes and estimate — and the command returns the saved facts for the success message.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { useProfileStore } from '@/state/profileStore';
import { addDays, effectiveEntries, localToInstant, type LogEntry } from '@/living';
import type { ReviewSheetModel } from '@/living/activityCandidates';
import { manualCheck, readCandidates } from '../activity';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TODAY = '2026-10-21';
const Y = addDays(TODAY, -1);
const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
const ms = (date: string, h: number) => Date.parse(localToInstant(date, h, TZ));
const out = <T,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ms(TODAY, 12)));
});
afterAll(() => vi.useRealTimers());

beforeEach(async () => {
  freshState({ cleared: true });
  await getDocumentStore().ready;
  const p = useProfileStore.getState();
  p.setAge(40);
  p.setHeight(170);
  p.setWeight(80);
});

const sessions = () =>
  effectiveEntries(getDocumentStore().peekAll<LogEntry>('dailyLogs').map((d) => ({ ...bodyOf<LogEntry>(d), id: d._id }) as LogEntry)).filter(
    (e): e is Extract<LogEntry, { kind: 'session' }> => e.kind === 'session',
  );

/** A 60-minute ring run 18:00–19:00, approved. */
async function approvedRun(): Promise<string> {
  out(await dispatch('activity.fromGauge', { gaugeSessions: [{ id: 'g-run', revision: 'r1', start: ms(Y, 18), end: ms(Y, 19), type: 'run', kcal: 600 }], hcSessions: [] }, SYS));
  await settleCommits();
  const row = out<ReviewSheetModel>(await dispatch('activity.candidates', { from: Y, to: Y })).rows[0]!;
  out(await dispatch('activity.approve', { id: row.id, revision: row.revision }));
  await settleCommits();
  return row.id;
}

describe('aR16: "the same activity" previews and saves the recording’s window and evidence', () => {
  // the person says 30 minutes of badminton from 18:15; the ring recorded 60 minutes from 18:00
  const input = { exerciseId: 'badminton', date: Y, startH: 18.25, durationMin: 30, intensity: { class: 'vigorous' as const } };

  it('the link preview is the linked recording’s window and estimate, and the booking saves exactly that', async () => {
    const run = await approvedRun();
    const s = await readCandidates();
    const plain = manualCheck(input, { ent: { measurements: [] }, records: s.records, tz: TZ });
    const linked = manualCheck({ ...input, resolution: 'link' }, { ent: { measurements: [] }, records: s.records, tz: TZ });
    // the plain preview is the manual 30 minutes; the link preview is the recording's 60
    expect(plain.estimate!.durationMin).toBe(30);
    expect(linked.linked).toMatchObject({ key: run, window: { start: ms(Y, 18), end: ms(Y, 19) }, durationMin: 60 });
    expect(linked.estimate!.durationMin).toBe(60);
    expect(linked.estimate!.exerciseId).toBe('badminton');
    // replace and separate keep the manual preview
    expect(manualCheck({ ...input, resolution: 'separate' }, { ent: { measurements: [] }, records: s.records, tz: TZ }).linked).toBeUndefined();

    const o = out<{ id: string; resolution: string; kcal: number | null; saved: { exerciseId: string; durationMin: number; startAt: string | null; endAt: string | null } }>(
      await dispatch('activity.logManual', { ...input, resolution: 'link' }),
    );
    await settleCommits();
    expect(o).toMatchObject({ id: run, resolution: 'link' });
    // the saved facts are the recording's window, never the manual 30 minutes
    expect(o.saved).toEqual({ exerciseId: 'badminton', durationMin: 60, startAt: new Date(ms(Y, 18)).toISOString(), endAt: new Date(ms(Y, 19)).toISOString() });
    const e = sessions();
    expect(e).toHaveLength(1);
    expect(e[0]!.durationMin).toBe(60);
    // the booked energy is the previewed one
    expect(e[0]!.cost!.grossKcal).toBeCloseTo(linked.estimate!.booked.grossKcal, 6);
    expect(o.kcal).toBe(Math.round(linked.estimate!.booked.grossKcal));
  });

  it('an ordinary log returns its own saved facts', async () => {
    const o = out<{ saved: { exerciseId: string; durationMin: number; startAt: string | null } }>(await dispatch('activity.logManual', { ...input, startH: 9 }));
    expect(o.saved).toEqual({ exerciseId: 'badminton', durationMin: 30, startAt: new Date(ms(Y, 9)).toISOString(), endAt: new Date(ms(Y, 9.5)).toISOString() });
    // a log without a clock time has no window to report
    const u = out<{ saved: { durationMin: number; startAt: string | null; endAt: string | null } }>(await dispatch('activity.logManual', { exerciseId: 'walk', date: Y, durationMin: 20, intensity: {} }));
    expect(u.saved).toMatchObject({ durationMin: 20, startAt: null, endAt: null });
  });
});
