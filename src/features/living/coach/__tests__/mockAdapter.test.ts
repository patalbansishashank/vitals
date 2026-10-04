import { fixedClock } from '../../clock';
import { FIXTURE_TODAY, fixturePlan } from '../../data/fixtures';
import { createStubLiving, fixedPlanControl } from '../../data/stub';
import { MAIN_CONVERSATION, createNoProviderAdapter, type CoachStreamEvent } from '../adapter';
import { buildCoachBriefing, briefingFromLiving } from '../briefing';
import { createMockCoachAdapter } from '../mockAdapter';

function setup(status?: Parameters<typeof createMockCoachAdapter>[0]['status']) {
  const clock = fixedClock(`${FIXTURE_TODAY}T13:00:00`);
  const stub = createStubLiving({ clock, plan: fixedPlanControl(fixturePlan(FIXTURE_TODAY)) });
  const coach = createMockCoachAdapter({ clock, actions: stub.actions, source: stub.source, ...(status ? { status } : {}) });
  return { clock, stub, coach };
}

async function send(coach: ReturnType<typeof setup>['coach'], text: string) {
  const events: CoachStreamEvent[] = [];
  await coach.send({ conversationId: MAIN_CONVERSATION, text }, (e) => events.push(e), new AbortController().signal);
  return events;
}

describe('mock Coach adapter', () => {
  it('streams food text as read → text chunks → log card → done, and logs through the actions', async () => {
    const { coach, stub } = setup();
    const events = await send(coach, 'had dal, rice and two eggs for lunch');
    const kinds = events.map((e) => e.type);
    expect(kinds[0]).toBe('read');
    expect(kinds.filter((k) => k === 'text').length).toBeGreaterThan(1);
    expect(kinds.slice(-2)).toEqual(['card', 'done']);
    expect(stub.inspect().entries).toHaveLength(1);
    const [you, reply] = coach.history(MAIN_CONVERSATION);
    expect(you).toMatchObject({ role: 'you', text: 'had dal, rice and two eggs for lunch' });
    expect(reply).toMatchObject({ role: 'coach', streaming: false });
    expect(reply!.cards[0]).toMatchObject({ class: 'log', state: 'applied', title: 'Logged lunch · 13:00', totals: '≈ 640 kcal (510–780) · protein 33 g (25–41)' });
    expect(coach.conversations()).toEqual([expect.objectContaining({ id: MAIN_CONVERSATION })]);
  });

  it('undo retracts the entry and flips the card; a second undo is refused', async () => {
    const { coach, stub } = setup();
    await send(coach, 'had dal for lunch');
    const id = coach.history(MAIN_CONVERSATION)[1]!.cards[0]!.id;
    expect(await coach.act(id, 'undo')).toEqual({ ok: true });
    expect(stub.inspect().entries).toHaveLength(0);
    expect(coach.history(MAIN_CONVERSATION)[1]!.cards[0]!.state).toBe('undone');
    expect((await coach.act(id, 'undo')).ok).toBe(false);
  });

  it('stops between chunks when aborted and keeps what was already made', async () => {
    const { coach } = setup();
    const ctrl = new AbortController();
    const p = coach.send({ conversationId: MAIN_CONVERSATION, text: 'busy Thu to Sat' }, () => undefined, ctrl.signal);
    ctrl.abort();
    await p;
    expect(coach.history(MAIN_CONVERSATION)[1]).toMatchObject({ stopped: true, streaming: false });
  });

  it('destructive cards are only completed when the page reports the typed confirmation', async () => {
    const { coach } = setup();
    await send(coach, 'end my plan');
    const card = coach.history(MAIN_CONVERSATION)[1]!.cards[0]!;
    expect(card).toMatchObject({ class: 'destructive', title: 'end Spring cut', state: 'pending' });
    await coach.act(card.id, 'apply');
    await coach.act(card.id, 'review');
    expect(coach.history(MAIN_CONVERSATION)[1]!.cards[0]!.state).toBe('pending');
    await coach.act(card.id, 'review', { outcome: 'confirmed' });
    expect(coach.history(MAIN_CONVERSATION)[1]!.cards[0]!.state).toBe('applied');
  });

  it('provider failures become an error turn with the plain reason', async () => {
    const { coach } = setup('keyRefused');
    const events = await send(coach, 'had dal');
    expect(events).toEqual([{ type: 'error', kind: 'keyRefused', message: 'Your key was refused by Anthropic. Check it in Settings › AI provider.' }]);
    expect(coach.history(MAIN_CONVERSATION)[1]!.error?.kind).toBe('keyRefused');
  });

  it('the no-provider adapter sends nothing and keeps no history', async () => {
    const coach = createNoProviderAdapter();
    const events: CoachStreamEvent[] = [];
    await coach.send({ conversationId: MAIN_CONVERSATION, text: 'hi' }, (e) => events.push(e), new AbortController().signal);
    expect(events[0]).toMatchObject({ type: 'error', kind: 'noProvider' });
    expect(coach.history(MAIN_CONVERSATION)).toEqual([]);
    expect(coach.status().kind).toBe('noProvider');
    expect(coach.briefing().sections.find((s) => s.id === 'sentTo')!.lines).toEqual(['Nothing is sent: no AI provider is connected.']);
  });
});

describe('Coach briefing', () => {
  it('has every section in order, built from the living source', () => {
    const clock = fixedClock(`${FIXTURE_TODAY}T13:00:00`);
    const stub = createStubLiving({ clock, plan: fixedPlanControl(fixturePlan(FIXTURE_TODAY)) });
    const b = briefingFromLiving(stub.source, clock, { provider: { name: 'Anthropic', model: 'Claude Sonnet 5.5' } });
    expect(b.sections.map((s) => s.title)).toEqual(['Always', 'About you', 'Your plan', 'Last 7 days', 'Body signals it can see', 'Still to ask', 'Sent to']);
    const plan = b.sections.find((s) => s.id === 'plan')!;
    expect(plan.lines[0]).toBe('Spring cut · medium · day 15 of 84');
    expect(b.sections.find((s) => s.id === 'week')!.lines).toHaveLength(7);
    expect(b.sections.find((s) => s.id === 'sentTo')!.lines[0]).toMatch(/^Anthropic \(Claude Sonnet 5\.5\): this conversation/);
  });

  it('without a plan says so; quiet mode keeps numbers out', async () => {
    expect(buildCoachBriefing({ today: null }).sections.find((s) => s.id === 'plan')!.lines).toEqual(['No plan is running. It can help you choose one.']);
    const clock = fixedClock(`${FIXTURE_TODAY}T13:00:00`);
    const stub = createStubLiving({ clock, plan: fixedPlanControl(fixturePlan(FIXTURE_TODAY)) });
    await stub.actions.setQuietMode(true);
    const b = briefingFromLiving(stub.source, clock);
    const text = b.sections.flatMap((s) => (s.id === 'plan' || s.id === 'about' || s.id === 'week' ? s.lines : [])).join('\n');
    expect(text).not.toMatch(/\d+ kg/);
    expect(text).not.toMatch(/last 7 days \d/);
  });
});
