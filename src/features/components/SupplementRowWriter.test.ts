/** Quick successive saves from a screen must all land (each `supplements.set` reads the section it changes). */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, outputOf } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { removeSupplementRow, saveSupplementRow } from './SupplementRowWriter';

beforeEach(() => {
  freshState({ cleared: true });
});

describe('supplement row writer', () => {
  it('keeps every row when saves are fired without waiting', { timeout: 30_000 }, async () => {
    const saves = [
      saveSupplementRow({ supplementId: 'creatine_monohydrate', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['morning'] }, 'taking'),
      saveSupplementRow({ supplementId: 'whey_protein', state: 'onHand', dose: 25, unit: 'g', timesOfDay: [] }),
      saveSupplementRow({ supplementId: 'vitamin_d3', state: 'taking', dose: 600, unit: 'IU', timesOfDay: ['morning', 'night'] }),
      saveSupplementRow({ supplementId: null, text: 'shilajit', state: 'onHand', timesOfDay: [] }),
      removeSupplementRow({ supplementId: 'whey_protein', state: 'onHand', timesOfDay: [] }),
    ];
    expect(await Promise.all(saves)).toEqual([true, true, true, true, true]);
    const rows = outputOf(await dispatch('supplements.get', {}))!.rows;
    expect(rows.map((r) => [r.supplementId ?? r.text, r.state, r.timesOfDay])).toEqual([
      ['creatine_monohydrate', 'taking', ['morning']],
      ['vitamin_d3', 'taking', ['morning', 'night']],
      ['shilajit', 'onHand', []],
    ]);
  });
});
