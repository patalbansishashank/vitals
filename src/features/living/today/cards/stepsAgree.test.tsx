/**
 * (r087 IA, problem 4) Today's Steps card and Ring's Movement over the same day: the same count and the same state word,
 * whoever's count it is (the ring's, the person's own entry, an import under another headline setting).
 */
import '@/features/ring/__tests__/clock';
import { screen, waitFor, within } from '@testing-library/react';
import { reviewSheetModel } from '@/living/activityCandidates';
import { ActivityDataProvider, type ActivityData, type TodayActivityView } from '../../activity/data';
import { renderLiving } from '../../testing';
import { commandsFixture, dayFixture, fixtureActivityData } from '../__screens__/fixtures';
import { StepsContent } from './ActivityCards';
import { setGaugeApi } from '@/features/ring/api';
import { makeGaugeFixture } from '@/features/ring/fixtures';
import { useSteps, useTimeline } from '@/features/ring/data';
import { calendarDate } from '@/features/ring/model';
import { MovementBody } from '@/features/ring/views/Movement';
import { resetPlanSteps, STEP_WORDS, type PlanSteps } from '@/features/ring/stepsHeadline';
import type { RingDay } from '@/features/ring/day';

const DATE = calendarDate(Date.now());
const NOW = Date.now();
const GOAL = 30_000;

/** Today's activity data over the Ring's own answers, with `steps` as today's plan steps model. */
function data(steps: PlanSteps | null): ActivityData {
  const f = dayFixture(DATE, NOW, 'pending');
  const base = fixtureActivityData(f, { quiet: false, commands: commandsFixture(f) });
  const view = steps
    ? ({ model: { steps: { ...steps, goal: { value: GOAL, source: 'plan' } } }, day: null } as unknown as TodayActivityView)
    : null;
  return {
    ...base,
    useToday: () => view,
    useTimeline: (date) => {
      const q = useTimeline(date);
      return q.status === 'ready' ? q.data : null;
    },
    useStepsDay: (date) => {
      const q = useSteps(date, date);
      return q.status === 'ready' ? (q.data.days.find((d) => d.date === date) ?? null) : null;
    },
  };
}

const plan = (fusedSoFar: number | null, lineages: readonly string[], o: Partial<PlanSteps> = {}): PlanSteps => ({
  fusedSoFar,
  lineages,
  headlinePolicy: 'atLeast',
  rxSteps: GOAL,
  remainingAwakeFrac: 0.4,
  prior: fusedSoFar === null ? GOAL * 0.9 : GOAL * 0.4,
  total: fusedSoFar === null ? GOAL * 0.9 : fusedSoFar + GOAL * 0.4,
  ...o,
});

const day = { goals: { steps: { value: GOAL, source: 'plan' } } } as unknown as RingDay;

function renderBoth(steps: PlanSteps | null) {
  renderLiving(
    <ActivityDataProvider value={data(steps)}>
      <div data-testid="today">
        <StepsContent
          date={DATE}
          isToday
          quiet={false}
          review={reviewSheetModel([], { quiet: false })}
          onOpenRow={() => undefined}
          nowMs={NOW}
          size="tile"
        />
      </div>
      <div data-testid="ring">
        <MovementBody date={DATE} day={day} />
      </div>
    </ActivityDataProvider>,
    { path: '/today', route: 'today', now: `${DATE}T12:00:00` },
  );
}

const count = (id: string) => within(screen.getByTestId(id)).getByRole('meter', { name: 'Steps' }).getAttribute('aria-valuenow');
const has = (id: string, word: string) => within(screen.getByTestId(id)).queryAllByText(word).length > 0;

async function agree(expected: number | null, word: string) {
  await waitFor(() => {
    expect(count('today')).toBe(expected === null ? null : String(expected));
    expect(count('ring')).toBe(count('today'));
  });
  expect(has('today', word)).toBe(true);
  expect(has('ring', word)).toBe(true);
}

describe('Today’s Steps and Ring’s Movement read one count and one word', () => {
  beforeEach(() => {
    window.scrollTo = (() => undefined) as typeof window.scrollTo;
    resetPlanSteps();
    setGaugeApi(makeGaugeFixture({ uploadedMinutesAgo: 4 }));
  });
  afterEach(() => setGaugeApi(null));

  it('the person’s own entry decides both, with the forecast word from the plan', async () => {
    renderBoth(plan(3000, ['user']));
    await agree(3000, STEP_WORDS.under);
    expect(within(screen.getByTestId('ring')).getByText(/From Your entry/)).toBeInTheDocument();
  });

  it('an import under “Placed in time” stays the plan’s count on both, not the server’s larger headline', async () => {
    renderBoth(plan(1234, ['ring:band'], { headlinePolicy: 'located', total: 31_000 }));
    await agree(1234, STEP_WORDS.onCourse);
  });

  it('without a plan entry both read the Ring pipeline, and the forecast adds only the awake share still ahead', async () => {
    renderBoth(plan(null, []));
    await waitFor(() => expect(count('ring')).not.toBeNull());
    const shown = Number(count('ring'));
    await agree(shown, shown + GOAL * 0.4 >= GOAL ? STEP_WORDS.onCourse : STEP_WORDS.under);
  });
});
