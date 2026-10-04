/** `supplements.*`: rows, validation, migration on write, undo, and the Coach's propose → apply path. */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDocumentStore } from '@/state/runtime';
import { classOf } from '@/ai/coach/tools';
import { dispatch, getCommand, outputOf, settleCommits } from '..';
import { freshState } from '../__tests__/harness';

beforeEach(() => {
  freshState({ cleared: true });
});

const intake = () => getDocumentStore().peek<Record<string, unknown>>('intake', 'me');

describe('supplements commands', () => {
  it('reads nothing on a fresh store', async () => {
    expect(outputOf(await dispatch('supplements.get', {}))).toMatchObject({ stance: null, rows: [], summary: null });
  });

  it('adds a taking row, then moves it to on hand and not for me; the planner view follows', async () => {
    const a = outputOf(await dispatch('supplements.set', { supplementId: 'creatine', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['morning'] }))!;
    expect(a.rows).toEqual([{ supplementId: 'creatine_monohydrate', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['morning'], since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }]);
    expect(a.planner).toMatchObject({ optInLevers: ['creatine'], habitual: ['L7'] });
    await settleCommits();
    const b = outputOf(await dispatch('supplements.set', { supplementId: 'creatine_monohydrate', state: 'onHand' }))!;
    expect(b.rows[0]).toMatchObject({ state: 'onHand', dose: 5, timesOfDay: ['morning'] });
    expect(b.planner).toMatchObject({ optInLevers: ['creatine'], onHand: ['L7'], habitual: [] });
    await settleCommits();
    const c = outputOf(await dispatch('supplements.set', { supplementId: 'creatine_monohydrate', state: 'notForMe' }))!;
    expect(c.planner.excludedLevers).toEqual(['L7']);
    await settleCommits();
    expect(intake()?.supplements).toMatchObject({ _v: 2, stance: 'taking' });
  });

  it('rejects a taking row without a time, a unit the item is not sold in, and an unknown catalogue id', async () => {
    const noTime = await dispatch('supplements.set', { supplementId: 'creatine_monohydrate', state: 'taking', dose: 5 });
    expect(noTime.ok ? null : noTime.error).toMatchObject({ code: 'invalid_input', detail: { path: '/timesOfDay' } });
    const unit = await dispatch('supplements.set', { supplementId: 'creatine_monohydrate', state: 'taking', dose: 5, unit: 'IU', timesOfDay: ['night'] });
    expect(unit.ok ? null : unit.error).toMatchObject({ code: 'invalid_input', detail: { path: '/unit' } });
    const unknown = await dispatch('supplements.set', { supplementId: 'unobtainium', state: 'onHand' });
    expect(unknown.ok ? null : unknown.error.code).toBe('invalid_input');
    // free text is kept as written
    const free = outputOf(await dispatch('supplements.set', { text: 'shilajit', state: 'onHand' }))!;
    expect(free.rows).toEqual([{ supplementId: null, text: 'shilajit', state: 'onHand', unit: 'g', timesOfDay: [] }]);
  });

  it('a v1 section ("I already take some") is migrated on the first write and keeps the other sections', async () => {
    await dispatch('intake.answer', { section: 'supplements', answers: { stance: 'open', taking: [{ supplementId: 'whey_protein', dose: 25, unit: 'g protein', clockH: 8 }] } });
    expect(outputOf(await dispatch('supplements.get', {}))).toMatchObject({ stance: 'taking', rows: [{ supplementId: 'whey_protein', state: 'taking', dose: 25, unit: 'g', timesOfDay: ['morning'] }] });
    await dispatch('supplements.set', { supplementId: 'omega3_epa_dha', state: 'onHand' });
    await settleCommits();
    const s = intake()?.supplements as Record<string, unknown>;
    expect(s).not.toHaveProperty('taking');
    expect(s).toMatchObject({ _v: 2, stance: 'taking', rows: [{ supplementId: 'whey_protein' }, { supplementId: 'omega3_epa_dha', state: 'onHand' }] });
  });

  it('intake.answer accepts a v2 section', async () => {
    const r = await dispatch('intake.answer', { section: 'supplements', answers: { _v: 2, stance: 'onHand', rows: [{ supplementId: 'psyllium', state: 'onHand', timesOfDay: [] }] } });
    expect(r.ok).toBe(true);
    const bad = await dispatch('intake.answer', { section: 'supplements', answers: { _v: 2, stance: 'onHand', rows: [{ supplementId: 'psyllium', state: 'maybe', timesOfDay: [] }] } });
    expect(bad.ok).toBe(false);
  });

  it('undo restores the section; remove deletes a row', async () => {
    await dispatch('supplements.set', { supplementId: 'psyllium', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['evening'] });
    await settleCommits();
    const r = await dispatch('supplements.set', { supplementId: 'psyllium', dose: 10 });
    await settleCommits();
    await dispatch('history.undo', { changeSetId: r.ok && 'changeSet' in r ? r.changeSet!.id : '' });
    await settleCommits();
    expect(outputOf(await dispatch('supplements.get', {}))!.rows).toEqual([expect.objectContaining({ dose: 5 })]);
    expect(outputOf(await dispatch('supplements.remove', { supplementId: 'psyllium' }))!.rows).toEqual([]);
    const gone = await dispatch('supplements.remove', { supplementId: 'psyllium' });
    expect(gone.ok ? null : gone.error.code).toBe('not_found');
  });

  it('permission classes: get is read; set and remove are edits (the Coach proposes, the person applies)', async () => {
    expect(classOf(getCommand('supplements.get')!)).toBe('read');
    expect(classOf(getCommand('supplements.set')!)).toBe('edit');
    expect(classOf(getCommand('supplements.remove')!)).toBe('edit');
    const staged = await dispatch('supplements.set', { supplementId: 'creatine_monohydrate', state: 'onHand' }, { actor: { kind: 'ai', id: 'coach' } });
    expect(staged.ok && 'pending' in staged ? staged.pending.commandId : null).toBe('supplements.set');
    expect(intake()?.supplements).toBeUndefined();
  });
});
