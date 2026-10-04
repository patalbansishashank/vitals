/** ChangeSets, gesture coalescing and undo (SUITE_SPEC §1.5). */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDocumentStore } from '@/state/runtime';
import { useProfileStore } from '@/state/profileStore';
import { useScheduleStore } from '@/state/scheduleStore';
import { changeSets, dispatch, outputOf, settleCommits, type CommandResult } from '..';
import { AI, freshState } from './harness';

const csOf = (r: CommandResult) => (r.ok && 'changeSet' in r ? r.changeSet : null);

beforeEach(() => {
  freshState({ cleared: true });
});

describe('history.undo', () => {
  it('restores the fields a change wrote, once', async () => {
    await dispatch('profile.patch', { weightKg: 80, heightCm: 175 });
    await settleCommits();
    const r = await dispatch('profile.patch', { weightKg: 77 });
    await settleCommits();
    const id = csOf(r)!.id;
    expect(useProfileStore.getState().weightKg).toBe(77);
    const u = await dispatch('history.undo', { changeSetId: id });
    expect(outputOf(u)).toEqual({ undone: true, skipped: [] });
    expect(useProfileStore.getState().weightKg).toBe(80);
    await settleCommits();
    expect(getDocumentStore().peek<{ weightKg: number }>('profile', 'me')?.weightKg).toBe(80);
    expect(changeSets().find((c) => c.id === id)?.undoneBy).toBe(csOf(u)!.id);
    expect((await dispatch('history.undo', { changeSetId: id })).ok).toBe(false);
  });

  it('skips fields that changed since and says which', async () => {
    const first = await dispatch('profile.patch', { weightKg: 80, heightCm: 175 });
    await settleCommits();
    await dispatch('profile.patch', { weightKg: 81 });
    await settleCommits();
    const u = outputOf(await dispatch('history.undo', { changeSetId: csOf(first)!.id }));
    expect(u?.skipped).toContain('profile/me.weightKg');
    expect(useProfileStore.getState().weightKg).toBe(81);
    expect(useProfileStore.getState().heightCm).toBeNull();
  });

  it('brings back a deleted scenario and the active one', async () => {
    const sid = useScheduleStore.getState().activeId!;
    const created = outputOf(await dispatch('scenario.create', { name: 'Second', starter: 'blank' }))!.scenarioId;
    await settleCommits();
    const del = await dispatch('scenario.delete', { id: created });
    await settleCommits();
    expect(useScheduleStore.getState().scenarios.some((s) => s.id === created)).toBe(false);
    expect(useScheduleStore.getState().activeId).toBe(sid);
    await dispatch('history.undo', { changeSetId: csOf(del)!.id });
    await settleCommits();
    expect(useScheduleStore.getState().scenarios.some((s) => s.id === created)).toBe(true);
    expect(useScheduleStore.getState().activeId).toBe(created);
    expect(getDocumentStore().peek('scenarios', created)).not.toBeNull();
  });

  it('lets agents undo only their own changes', async () => {
    const mine = await dispatch('settings.update', { patch: { theme: 'dark' } });
    await settleCommits();
    expect((await dispatch('history.undo', { changeSetId: csOf(mine)!.id }, { actor: AI })).ok).toBe(false);
    const theirs = await dispatch('settings.update', { patch: { theme: 'light' } }, { actor: AI });
    await settleCommits();
    expect((await dispatch('history.undo', { changeSetId: csOf(theirs)!.id }, { actor: AI })).ok).toBe(true);
  });

  it('does not let another conversation of the same agent undo a change (V1c-11)', async () => {
    const theirs = await dispatch('settings.update', { patch: { theme: 'light' } }, { actor: AI });
    await settleCommits();
    const other = { ...AI, conversationId: '01J00000000000000000000OTH' };
    const r = await dispatch('history.undo', { changeSetId: csOf(theirs)!.id }, { actor: other });
    expect(r.ok ? null : r.error.code).toBe('surface_forbidden');
  });
});

describe('gesture coalescing', () => {
  it('joins a paint stroke into one ChangeSet and one undo step until sealed', async () => {
    const sid = useScheduleStore.getState().activeId!;
    const a = await dispatch('scenario.edit', { id: sid, ops: [{ op: 'paint', days: [1], program: 0 }] }, { coalesceKey: 'stroke:9' });
    const b = await dispatch('scenario.edit', { id: sid, ops: [{ op: 'paint', days: [2], program: 0 }] }, { coalesceKey: 'stroke:9' });
    expect(csOf(b)?.id).toBe(csOf(a)?.id);
    await dispatch('history.seal', { scenarioId: sid });
    const c = await dispatch('scenario.edit', { id: sid, ops: [{ op: 'editDays', days: [6], patch: { steps: 10001 } }] }, { coalesceKey: 'stroke:9' });
    expect(csOf(c)?.id).not.toBe(csOf(a)?.id);
    await settleCommits();
    const list = outputOf(await dispatch('history.list', { scenarioId: sid }))!;
    expect(list[0]!.id).toBe(csOf(c)!.id);
  });

  it('coalesces consecutive edits of the same profile field (slider drags) into one ChangeSet', async () => {
    const a = await dispatch('profile.patch', { shape: { bodyFatPct: 20 } });
    const b = await dispatch('profile.patch', { shape: { bodyFatPct: 21 } });
    const c = await dispatch('profile.patch', { weightKg: 70 });
    expect(csOf(b)?.id).toBe(csOf(a)?.id);
    expect(csOf(c)?.id).not.toBe(csOf(a)?.id);
    await settleCommits();
    const u = await dispatch('history.undo', { changeSetId: csOf(a)!.id });
    expect(u.ok).toBe(true);
    expect(useProfileStore.getState().shape.bodyFatPct).toBeUndefined();
  });

  it('keeps v0.1 scenario undo/redo (50 steps per scenario)', async () => {
    const sid = useScheduleStore.getState().activeId!;
    const before = useScheduleStore.getState().scenarios.find((s) => s.id === sid)!.schedule.horizonDays;
    await dispatch('scenario.edit', { id: sid, ops: [{ op: 'setHorizon', days: 28 }] });
    expect(outputOf(await dispatch('scenario.undo', { id: sid }))?.changed).toBe(true);
    expect(useScheduleStore.getState().scenarios.find((s) => s.id === sid)!.schedule.horizonDays).toBe(before);
    expect(outputOf(await dispatch('scenario.redo', { id: sid }))?.changed).toBe(true);
    expect(useScheduleStore.getState().scenarios.find((s) => s.id === sid)!.schedule.horizonDays).toBe(28);
  });
});
