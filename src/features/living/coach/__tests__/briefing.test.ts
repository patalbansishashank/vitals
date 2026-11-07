/** "What the Coach knows": today's logs count in "Last 7 days" (they are part of what the Coach receives). */
import type { TodayView } from '@/living';
import { buildCoachBriefing } from '../briefing';

const today = (entries: number) =>
  ({
    date: '2026-10-01',
    quietMode: false,
    plan: null,
    prescription: null,
    trendWeight: null,
    biometrics: null,
    adherence: { today: null, a7: null, a28: null, daysLogged7: 0, spark: [] },
    logged: {
      entries: Array.from({ length: entries }, (_, i) => ({
        id: `e${i}`,
        kind: 'meal',
        label: 'meal',
        source: 'user',
        aiEstimated: false,
      })),
      items: [],
      totals: {},
    },
  }) as unknown as TodayView;

const weekLines = (m: ReturnType<typeof buildCoachBriefing>) =>
  m.sections.find((s) => s.id === 'week')!.lines;

describe('buildCoachBriefing › Last 7 days', () => {
  it('counts what was logged today (steps, weight, meals) even with nothing before', () => {
    const lines = weekLines(buildCoachBriefing({ today: today(3), week: [] }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('Thu 1 Oct · 3 logged');
  });

  it('lists today first, then the earlier days, without counting today twice', () => {
    const lines = weekLines(
      buildCoachBriefing({
        today: today(2),
        week: [
          { date: '2026-10-01', score: null, entries: [1] },
          { date: '2026-09-30', score: { score: 80 }, entries: [1, 2] },
        ],
      }),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/2 logged$/);
    // one fact per day: how much was logged (the score is in the plan's 7-day adherence)
    expect(lines[1]).toBe('Wed 30 Sep · 2 logged');
  });

  it('says nothing is known when nothing was logged', () => {
    expect(weekLines(buildCoachBriefing({ today: today(0), week: [] }))).toEqual([
      'Nothing logged in the last 7 days.',
    ]);
  });
});

it('the briefing’s recent picture uses seven chronological days without duplicating today', () => {
  const model = buildCoachBriefing({
    today: today(3),
    week: [
      { date: '2026-10-01', score: null, entries: [1] },
      { date: '2026-09-30', score: null, entries: [1, 2] },
    ],
  });
  const viz = model.sections.find((section) => section.id === 'week')!.viz;
  expect(viz?.kind).toBe('week');
  if (viz?.kind !== 'week') throw new Error('No recent-days picture');
  expect(viz.dates).toEqual([
    '2026-09-25',
    '2026-09-26',
    '2026-09-27',
    '2026-09-28',
    '2026-09-29',
    '2026-09-30',
    '2026-10-01',
  ]);
  expect(viz.values).toEqual([null, null, null, null, null, 2, 3]);
});
