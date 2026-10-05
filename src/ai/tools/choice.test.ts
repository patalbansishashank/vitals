import { needsChoice, partlyLogged } from './choice';

const ask = { status: 'ask', saved: false, question: 'I couldn’t find "poha" in the food table. What is it?', candidates: [{ component: 'poha', foodId: 'poha_thin', name: 'Poha, thin' }] };

describe('needsChoice', () => {
  it('answers nothing for a write that saved something', () => {
    expect(needsChoice('log_meal', { status: 'logged', entryId: 'e1' })).toBeNull();
    expect(needsChoice('log_meal', undefined)).toBeNull();
    expect(needsChoice('log_meal', [{ status: 'ask' }])).toBeNull();
  });

  it('log_meal: pick a food or ask, then call log_meal again with its foodId', () => {
    expect(needsChoice('log_meal', ask)).toMatchObject({
      status: 'needs_choice',
      saved: false,
      candidates: ask.candidates,
      summary: expect.stringMatching(/^Nothing logged yet\. .*"poha".* Pick one of these foods .* call log_meal again with its foodId\.$/),
    });
    const none = needsChoice('log_meal', { ...ask, candidates: [] })!;
    expect(none).not.toHaveProperty('candidates');
    expect(none.summary).toMatch(/Ask the person, then call log_meal again with the answer\.$/);
  });

  it('log_meal_from_photo takes no foodId: the advice points to log_meal with the components (J3-02)', () => {
    for (const candidates of [ask.candidates, []]) {
      const r = needsChoice('log_meal_from_photo', { ...ask, candidates })!;
      expect(r.summary).toMatch(/call log_meal with the components/);
      expect(r.summary).not.toMatch(/log_meal_from_photo/);
    }
    expect(needsChoice('log_meal_from_photo', ask)!.summary).toMatch(/chosen foodId\.$/);
    expect(needsChoice('log_meal_from_photo', { ...ask, candidates: [] })!.summary).toMatch(/and their answer\.$/);
  });
});

describe('log_bulk results', () => {
  const logged = { date: '2026-09-30', index: 0, status: 'logged', entryId: 'e1' };
  const asked = (name: string, candidates: unknown[] = []) => ({ date: '2026-09-30', index: 1, status: 'ask', question: 'q', components: [{ name, grams: 50 }, { name: 'dal', foodId: 'lentils_cooked' }], confidence: 0, saved: false, candidates });

  it('nothing logged and an entry asked: needs_choice, saved false, with the candidates of every entry (J3-02)', () => {
    const c = { component: 'poha', foodId: 'poha_thin', name: 'Poha, thin' };
    const r = needsChoice('log_bulk', [asked('poha', [c]), asked('xyzzy')])!;
    expect(r).toMatchObject({ status: 'needs_choice', saved: false, candidates: [c] });
    expect(r.summary).toBe('0 of 2 logged; 2 need a food choice: "poha", "xyzzy". Nothing was saved for those entries. Pick a food for each (or ask the person) and call log_bulk again with only those entries and the chosen foodId.');
    expect(needsChoice('log_bulk', [asked('xyzzy')])!.summary).toMatch(/^0 of 1 logged; 1 needs a food choice: "xyzzy"\. Nothing was saved for that entry\. Ask the person and call log_bulk again with only that entry\.$/);
  });

  it('some logged is not needs_choice: partlyLogged gives the honest counts; all logged says nothing', () => {
    const mixed = [logged, asked('xyzzy'), { status: 'skipped', reason: 'x' }, { status: 'error', message: 'x' }];
    expect(needsChoice('log_bulk', mixed)).toBeNull();
    expect(partlyLogged('log_bulk', mixed)!.summary).toMatch(/^1 of 4 logged; 1 needs a food choice: "xyzzy"; 1 skipped; 1 failed\. Nothing was saved for that entry\./);
    expect(partlyLogged('log_bulk', [logged, { ...logged, index: 1 }])).toBeNull();
    expect(partlyLogged('log_bulk', [])).toBeNull();
    expect(partlyLogged('log_meal', mixed)).toBeNull();
    expect(needsChoice('log_bulk', [{ status: 'skipped' }])).toBeNull();
  });
});
