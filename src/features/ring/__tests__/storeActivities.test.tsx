/**
 * r063 FX3 (aR01): the Ring's production store-backed activity read. Log storage removes `id` from the body (the
 * document's `_id` carries it), so the hook must restore it the way `readDocs()` does; without it every saved log had
 * the same undefined id and `uniqueById` collapsed them into one (or none). These tests go through the real commands
 * and the real document store, never fixtures that already carry ids.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { localToInstant } from '@/living';
import { getDocumentStore } from '@/state/runtime';
import { useProfileStore } from '@/state/profileStore';
import { readCandidates } from '@/commands/living/activity';
import type { ActivityCandidateDoc } from '@/living/activityCandidates';
import { setRingActivitySource, useRingActivities } from '../useActivities';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TODAY = '2026-10-21';
const Y = '2026-10-20';
const ms = (date: string, h: number) => Date.parse(localToInstant(date, h, TZ));
const out = <T,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ms(TODAY, 12)));
});
afterAll(() => {
  vi.useRealTimers();
  setRingActivitySource(null);
});

beforeEach(async () => {
  freshState({ cleared: true });
  await getDocumentStore().ready;
  const p = useProfileStore.getState();
  p.setAge(40);
  p.setHeight(170);
  p.setWeight(75);
  // the store-backed source (a fresh one per test: the app's source binds the store it first reads)
  setRingActivitySource(null);
});

const log = async (exerciseId: string, startH: number, durationMin: number) =>
  out<{ id: string; entryId: string }>(await dispatch('activity.logManual', { exerciseId, date: Y, startH, durationMin, intensity: { class: 'moderate' } }));

describe('aR01: the store-backed Ring activities keep every saved log', () => {
  it('several sessions stay several, each with its document id', async () => {
    const a = await log('walk', 9, 30);
    const b = await log('jog_outdoor', 13, 20);
    const c = await log('badminton', 18, 45);
    await settleCommits();
    const { result } = renderHook(() => useRingActivities(Y, Y));
    await waitFor(() => expect(result.current.approved).toHaveLength(3));
    const ids = result.current.approved.map((x) => x.id);
    expect(new Set(ids).size).toBe(3);
    expect([...ids].sort()).toEqual([a.entryId, b.entryId, c.entryId].sort());
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(result.current.approved.map((x) => x.exerciseId).sort()).toEqual(['badminton', 'jog_outdoor', 'walk']);
  });

  it('an edit replaces its session (new window, one row) and a retraction removes only its own', async () => {
    const a = await log('walk', 9, 30);
    const b = await log('jog_outdoor', 13, 20);
    const c = await log('badminton', 18, 45);
    await settleCommits();
    const { result } = renderHook(() => useRingActivities(Y, Y));
    await waitFor(() => expect(result.current.approved).toHaveLength(3));

    // edit the walk: 09:00–09:30 becomes 09:00–10:00
    const doc = (await readCandidates()).byKey.get(a.id) as ActivityCandidateDoc;
    const ed = out<{ entryId: string }>(await dispatch('activity.edit', { id: a.id, revision: doc.revision, endAt: new Date(ms(Y, 10)).toISOString() }));
    // retract the jog (the person deletes the log)
    out(await dispatch('log.retract', { entryId: b.entryId }));
    await settleCommits();

    await waitFor(() => expect(result.current.approved).toHaveLength(2));
    const byEx = new Map(result.current.approved.map((x) => [x.exerciseId, x] as const));
    expect([...byEx.keys()].sort()).toEqual(['badminton', 'walk']);
    const walk = byEx.get('walk')!;
    expect(walk.id).toBe(ed.entryId);
    expect(walk.id).not.toBe(a.entryId);
    expect(walk.window).toEqual({ start: ms(Y, 9), end: ms(Y, 10) });
    expect(byEx.get('badminton')!.id).toBe(c.entryId);
  });
});
