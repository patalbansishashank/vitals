/** Living on the bus: the document-backed read side and the command-backed actions agree (features/living/boot.ts). */
import { freshState } from '@/commands/__tests__/harness';
import { dispatch, settleCommits } from '@/commands';
import { addDays, type PlanDoc } from '@/living';
import { getDocumentStore } from '@/state/runtime';
import { seedClearedSafety, STANDARD_ANSWERS } from '@/features/onboarding/testing';
import { currentDay, systemClock } from '../clock';
import { createCommandLivingActions } from '../data/commands';
import { createDocumentLivingSource, parseProposalCardId, proposalCardId } from '../data/documents';
import { SEED_PLAN_ID, seedPlanDocs } from './seedPlanDocs';

const TODAY = currentDay(systemClock);

async function setup() {
  freshState({ cleared: true });
  const source = createDocumentLivingSource();
  await seedPlanDocs({ startDate: addDays(TODAY, -14) });
  return { source, actions: createCommandLivingActions(source) };
}

describe('document-backed Living data', () => {
  it('reads nothing without a plan', () => {
    freshState({ cleared: true });
    const source = createDocumentLivingSource();
    expect(source.today(TODAY)).toBeNull();
    expect(source.versions()).toEqual([]);
    expect(source.adherence(TODAY).a7).toBeNull();
  });

  it('projects the plan documents: Today, the date strip and the versions', async () => {
    const { source } = await setup();
    const view = source.today(TODAY)!;
    expect(view.plan).toMatchObject({ id: SEED_PLAN_ID, name: 'Spring cut', day: 15 });
    expect(view.prescription?.energyKcal).toBeCloseTo(2000, 0);
    const [start, , mid] = source.days([addDays(TODAY, -14), addDays(TODAY, -15), TODAY]);
    expect(start).toMatchObject({ inPlan: true, isStart: true });
    expect(mid).toMatchObject({ inPlan: true, logged: false });
    expect(source.versions()).toEqual([expect.objectContaining({ version: 1, reason: 'start', status: 'adopted' })]);
  }, 20_000);

  it('quiet mode set in the settings store after the first read reaches Today (Q4-17)', async () => {
    const { source } = await setup();
    expect(source.today(TODAY)!.quietMode).toBe(false);
    const rev = source.revision();
    expect((await dispatch('settings.update', { patch: { quietMode: true } })).ok).toBe(true);
    expect(source.revision()).toBeGreaterThan(rev);
    expect(source.today(TODAY)!.quietMode).toBe(true);
    await dispatch('settings.update', { patch: { quietMode: false } });
    expect(source.today(TODAY)!.quietMode).toBe(false);
  }, 20_000);

  it('quiet mode is on by default in safety mode R1, and the person turning it off is respected (Q4-17)', async () => {
    const { source } = await setup();
    expect(source.today(TODAY)!.quietMode).toBe(false); // not R1, never set: off
    const rev = source.revision();
    seedClearedSafety({ ...STANDARD_ANSWERS, eatingDisorder: 'yes' });
    expect(source.revision()).toBeGreaterThan(rev);
    expect(source.today(TODAY)!.quietMode).toBe(true); // R1, never set: on
    expect((await dispatch('settings.update', { patch: { quietMode: false } })).ok).toBe(true);
    expect(source.today(TODAY)!.quietMode).toBe(false); // R1, turned off: off
  }, 20_000);

  it('a weigh-in written by its command bumps the revision and shows; its undo retracts it', async () => {
    const { source, actions } = await setup();
    const rev = source.revision();
    const heard = vi.fn();
    const off = source.subscribe(heard);
    const out = await actions.logWeight(TODAY, 89.2);
    expect(out.ok).toBe(true);
    await settleCommits();
    expect(source.revision()).toBeGreaterThan(rev);
    expect(heard).toHaveBeenCalled();
    expect(source.trend(addDays(TODAY, -6), TODAY)?.weighIns).toEqual([{ day: 6, value: 89.2 }]);
    expect((await out.undo!()).ok).toBe(true);
    await settleCommits();
    expect(source.trend(addDays(TODAY, -6), TODAY)?.weighIns).toEqual([]);
    off();
  }, 20_000);

  it('marks the day, pauses and resumes, and ends only with the typed word', async () => {
    const { source, actions } = await setup();
    expect((await actions.markDay(TODAY, 'asPlanned')).ok).toBe(true);
    await settleCommits();
    expect(source.days([TODAY])[0]!.logged).toBe(true);
    expect((await actions.pause(TODAY)).ok).toBe(true);
    await settleCommits();
    expect(source.today(TODAY)?.plan?.status).toBe('paused');
    expect((await actions.resume(addDays(TODAY, 1))).ok).toBe(true);
    await settleCommits();
    expect(source.today(TODAY)?.plan?.status).toBe('active');
    expect(await actions.end('nope')).toMatchObject({ ok: false });
    expect((await actions.end('end')).ok).toBe(true);
    await settleCommits();
    expect(getDocumentStore().peek<PlanDoc>('plans', SEED_PLAN_ID)).toMatchObject({ status: 'ended' });
    expect(source.today(TODAY)).toBeNull();
  }, 20_000);

  it('names proposal cards by plan version', () => {
    expect(parseProposalCardId(proposalCardId('p1', 3))).toEqual({ planId: 'p1', version: 3 });
    expect(parseProposalCardId('chg-1')).toBeNull();
  });
});
