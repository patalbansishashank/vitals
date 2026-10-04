/** The Coach's briefing carries the supplements: taking with dose, at home (suggest first), not for me (never). */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBriefing, gatherBriefingData } from '@/ai/coach/briefing';
import type { CoachBus } from '@/ai/coach/tools';
import { addDays } from '@/living/dates';
import { allCommands, commandBus, dispatch, getCommand, settleCommits } from '..';
import { freshState } from '../__tests__/harness';

beforeEach(() => {
  freshState({ cleared: true });
});

describe('Coach briefing: supplements', () => {
  it('reads supplements.get and adds a section and visible lines for both states', { timeout: 30_000 }, async () => {
    await dispatch('supplements.set', { supplementId: 'creatine_monohydrate', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['morning'], stance: 'taking' });
    await settleCommits();
    await dispatch('supplements.set', { supplementId: 'whey', state: 'onHand' });
    await settleCommits();
    await dispatch('supplements.set', { supplementId: 'caffeine', state: 'notForMe' });
    await settleCommits();
    const data = await gatherBriefingData({ ...commandBus, getCommand, commandIds: () => allCommands().map((d) => d.id) } as unknown as CoachBus, new Date('2026-10-02T08:00:00Z'), '2026-10-02', addDays);
    expect(data.supplements).toMatchObject({ stance: 'taking' });
    const b = buildBriefing(data);
    const text = b.sections.find((s) => s.id === 'supplements')?.text ?? '';
    expect(text).toContain('Takes now: Creatine monohydrate (5 g · morning)');
    expect(text).toContain('Has at home, not taking (suggest using these before anything that must be bought): Whey protein');
    expect(text).toContain('Does not want (never suggest): Caffeine');
    expect(b.visible.about).toEqual(expect.arrayContaining(['Supplements you take: Creatine monohydrate (5 g · morning).', 'Supplements you have at home: Whey protein.']));
  });

  it('adds nothing when the question is unanswered', () => {
    const b = buildBriefing({ now: '2026-10-02T08:00:00Z', today: '2026-10-02', supplements: { stance: null, rows: [] } });
    expect(b.sections.some((s) => s.id === 'supplements')).toBe(false);
  });
});
