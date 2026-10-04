/** The command-backed plan changes (data/commands.ts): what they dispatch and what the screens are told. */
import type * as Commands from '@/commands';
import type { CommandResult } from '@/commands';
import { createCommandLivingActions } from '../data/commands';
import type { LivingDataSource } from '../data/source';

const dispatch = vi.hoisted(() => vi.fn<(id: string, input: unknown, opts?: unknown) => Promise<CommandResult>>());
vi.mock('@/commands', async (importOriginal) => ({ ...(await importOriginal<typeof Commands>()), dispatch }));

const actions = createCommandLivingActions({ today: () => null } as unknown as LivingDataSource);
const done = (output: unknown, changeSetId: string | null = 'cs1'): CommandResult => ({ ok: true, output, changeSet: changeSetId ? ({ id: changeSetId } as never) : null, notices: [] });
const adapt = (status: string, more: Record<string, unknown> = {}) => ({ planId: 'p1', version: status === 'proposed' || status === 'adopted' ? 3 : null, status, goalDates: [], impact: [], notes: [], diff: [], pinned: [], cardId: status === 'proposed' || status === 'adopted' ? 'version:p1:3' : null, ...more });

beforeEach(() => dispatch.mockReset());

describe('plan changes over the bus', () => {
  it('Re-plan the rest dispatches plan.replan and says a proposal waits on Today (with its first note)', async () => {
    dispatch.mockResolvedValue(done(adapt('proposed', { notes: ['Two more walks a week keep the goal date.'] })));
    const o = await actions.replanRest();
    expect(dispatch).toHaveBeenCalledWith('plan.replan', { reason: 'Re-plan the rest (same goals)' });
    expect(o).toMatchObject({ ok: true, message: 'Two more walks a week keep the goal date. A proposal is waiting on Today.', proposalId: 'version:p1:3' });
    // undo removes the version again
    dispatch.mockResolvedValue(done(null, null));
    await o.undo!();
    expect(dispatch).toHaveBeenLastCalledWith('history.undo', { changeSetId: 'cs1' });
  });

  it('applied, unchanged and no safe plan read as such', async () => {
    dispatch.mockResolvedValue(done(adapt('adopted', { notes: ['Busy days: no training, food as planned.'] })));
    expect(await actions.replanRest()).toMatchObject({ ok: true, message: 'Busy days: no training, food as planned. The plan is updated.' });
    dispatch.mockResolvedValue(done(adapt('unchanged', { notes: ['Nothing to change.'] }), null));
    expect(await actions.replanRest()).toEqual({ ok: true, message: 'The plan already fits, so nothing changed.' });
    dispatch.mockResolvedValue(done(adapt('noSafePlan', { notes: ['Protein cannot stay above your floor.'] }), null));
    expect(await actions.replanRest()).toEqual({ ok: false, message: 'There is no safe plan from here, so nothing changed. Protein cannot stay above your floor.' });
    dispatch.mockResolvedValue({ ok: false, error: { code: 'precondition_failed', message: 'The plan is paused; resume it first.' } } as CommandResult);
    expect(await actions.replanRest()).toEqual({ ok: false, message: 'The plan is paused; resume it first.' });
  });

  it('declares an event with only the fields given', async () => {
    dispatch.mockResolvedValue(done(adapt('proposed', { notes: ['A meal out: the extra food is planned in.'] })));
    const o = await actions.declareEvent({ kind: 'socialMeal', from: '2026-10-03', to: '2026-10-03', note: 'wedding', extraCarbG: 200 });
    expect(dispatch).toHaveBeenCalledWith('plan.declareEvent', { kind: 'socialMeal', from: '2026-10-03', to: '2026-10-03', note: 'wedding', extraCarbG: 200 });
    expect(o).toMatchObject({ ok: true, message: 'A meal out: the extra food is planned in. A proposal is waiting on Today.', proposalId: 'version:p1:3' });
    await actions.declareEvent({ kind: 'busy', from: '2026-10-02', to: '2026-10-04' });
    expect(dispatch).toHaveBeenLastCalledWith('plan.declareEvent', { kind: 'busy', from: '2026-10-02', to: '2026-10-04' });
  });

  it('shifts plan days (push back) with only the fields given', async () => {
    dispatch.mockResolvedValue(done(adapt('adopted', { notes: [] })));
    const o = await actions.shift({ from: '2026-10-02', days: 3, mode: 'pushBack' });
    expect(dispatch).toHaveBeenCalledWith('plan.shift', { from: '2026-10-02', days: 3, mode: 'pushBack' });
    expect(o).toMatchObject({ ok: true, message: 'The plan is updated.' });
    expect(o.undo).toBeTypeOf('function');
  });

  it('swaps an exercise for the day (credit, no proposal) or every week (a proposal with the weekly credit)', async () => {
    const equivalence = { score: 0.96, credit: 0.96, parity: true, band: 'full' };
    dispatch.mockResolvedValue(done({ equivalence, swap: {}, everyWeek: false, version: null, cardId: null, notes: [] }));
    const day = await actions.swapExercise('2026-10-02', { slotKey: '15:0', from: 'dand', to: { exerciseId: 'dand_garnal', setCount: 4 } as never });
    expect(dispatch).toHaveBeenCalledWith('plan.swapExercise', { date: '2026-10-02', slotKey: '15:0', from: 'dand', to: { exerciseId: 'dand_garnal', setCount: 4 }, everyWeek: false });
    expect(day).toMatchObject({ ok: true, credit: 0.96 });
    expect(day.proposalId).toBeUndefined();
    dispatch.mockResolvedValue(done({ equivalence, swap: {}, everyWeek: true, weekly: { weeks: 6, meanCredit: 0.93 }, version: 4, status: 'proposed', cardId: 'version:p1:4', notes: [] }));
    const week = await actions.swapExercise('2026-10-02', { slotKey: '15:0', from: 'dand', to: 'dand_garnal', everyWeek: true });
    expect(dispatch).toHaveBeenLastCalledWith('plan.swapExercise', expect.objectContaining({ to: 'dand_garnal', everyWeek: true }));
    expect(week).toMatchObject({ ok: true, credit: 0.93, proposalId: 'version:p1:4', message: 'A proposal is waiting on Today.' });
  });
});
