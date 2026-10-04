// @vitest-environment node
/** Undo on a Coach plan card after the person adopted the change on Today un-adopts it first (Q4). */
import type { CommandResult } from '@/commands';
import { CoachExecutor } from '../executor';
import type { CardView } from '../types';

describe('Undo of an applied plan card', () => {
  it('undoes the adoption on Today, then the change itself', async () => {
    const undone: string[] = [];
    const ok = (output: unknown): CommandResult => ({ ok: true, output, changeSet: null, notices: [] }) as unknown as CommandResult;
    const bus = {
      on: () => () => undefined,
      dispatch: async (id: string, input: Record<string, unknown>) => {
        if (id === 'history.list')
          return ok([
            { id: 'cs-adopt', commandId: 'plan.adoptVersion', docs: [{ col: 'planVersions', id: 'p1:v3' }, { col: 'plans', id: 'p1' }] },
            { id: 'cs-event', commandId: 'plan.declareEvent', docs: [{ col: 'planVersions', id: 'p1:v2' }, { col: 'plans', id: 'p1' }] },
          ]);
        if (id === 'plan.versions')
          return ok([
            { version: 1, parent: null, status: 'adopted' },
            { version: 2, parent: 1, status: 'proposed' },
            { version: 3, parent: 2, status: 'adopted' },
          ]);
        if (id === 'history.undo') undone.push(String(input.changeSetId));
        return ok({});
      },
    };
    const ex = new CoachExecutor({ bus: bus as never, now: () => new Date('2026-10-02T12:00:00Z'), newId: () => 'x', aiActorId: 'ai' });
    const card = {
      id: 'c1',
      class: 'edit',
      title: 'Proposal · declare an event',
      state: 'applied',
      createdAt: '2026-10-02T11:00:00.000Z',
      items: [],
      record: { kind: 'log', commandId: 'plan.declareEvent', input: {}, aiActor: { kind: 'ai', id: 'ai' }, changeSetId: 'cs-event' },
    } as unknown as CardView;
    const r = await ex.act(card, 'undo');
    expect(r.ok).toBe(true);
    expect(undone).toEqual(['cs-adopt', 'cs-event']);
  });
});
