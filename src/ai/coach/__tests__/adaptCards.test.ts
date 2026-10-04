// @vitest-environment node
/** Change cards from the living-plan adaptation outputs (AdaptOutput of plan.replan / declareEvent / shift / editDay). */
import { impactOf, proposalCard } from '../cards';
import { adaptNote } from '../executor';

const ADAPT = {
  planId: 'p1',
  version: 3,
  status: 'proposed',
  goalDates: [
    { goal: 0, before: '2026-12-21', after: '2026-12-24', range: ['2026-12-20', '2026-12-30'] },
    { goal: 1, before: null, after: '2027-01-10', range: ['2027-01-05', '2027-01-20'] },
  ],
  impact: [
    { metric: 'scaleWeight', endP50Delta: 0.3 },
    { metric: 'fatMass', endP50Delta: 0.2 },
  ],
  notes: ['Busy days: no training, food as planned.', 'The goal date moves by about three days.', 'A third note.'],
  diff: [{ date: '2026-10-02', field: 'training', before: 'lift 45 min', after: 'rest', why: 'busy' }],
  pinned: ['2026-10-02'],
  cardId: 'version:p1:3',
};

describe('adaptation outputs on Coach cards', () => {
  it('a proposal card carries the goal dates, the metric impacts by name, the diff and the first two notes', () => {
    const card = proposalCard('c1', 'Declare an event', { kind: 'busy' }, ADAPT, { createdAt: '2026-10-01T08:00:00.000Z' });
    expect(card).toMatchObject({ class: 'edit', title: 'Proposal · declare an event', state: 'pending' });
    expect(card.impact?.goalDates).toEqual([
      { label: 'goal date', before: ['2026-12-21', '2026-12-21'], after: ['2026-12-20', '2026-12-30'] },
      { label: 'goal 2 date', before: null, after: ['2027-01-05', '2027-01-20'] },
    ]);
    expect(card.impact?.metrics).toEqual([
      { label: 'weight by the end', delta: 0.3, unit: 'kg', decimals: 1 },
      { label: 'fat mass by the end', delta: 0.2, unit: 'kg', decimals: 1 },
    ]);
    expect(card.items).toEqual([{ label: 'tomorrow · training', before: 'lift 45 min', after: 'rest' }]);
    expect(card.note).toBe('Busy days: no training, food as planned. The goal date moves by about three days.');
  });

  it('no goal dates and no impacts: no impact block', () => {
    expect(impactOf({ ...ADAPT, goalDates: [], impact: [] })).toBeUndefined();
  });

  it('after Apply, the card says what the plan did with it', () => {
    expect(adaptNote(ADAPT)).toBe('Busy days: no training, food as planned. It is waiting on Today: apply it there to change the plan.');
    expect(adaptNote({ ...ADAPT, status: 'adopted' })).toBe('Busy days: no training, food as planned. The plan is updated.');
    expect(adaptNote({ ...ADAPT, status: 'unchanged', version: null, cardId: null })).toBe('The plan already fits, so nothing changed.');
    expect(adaptNote({ applied: true })).toBeUndefined();
    expect(adaptNote(null)).toBeUndefined();
  });
});
