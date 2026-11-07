/**
 * The meal sheet selects the answer that matches what was logged, and its fact line says the same: As planned only for
 * an "As planned" log or food within the plan's tolerance, Partly for less, Skipped for a skipped meal, nothing when it
 * is not known. A logged entry with no row status is never shown as "As planned" by default.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LogEntrySummary, TodayView } from '@/living';
import { FIXTURE_TODAY } from '../../data/fixtures';
import { renderLiving } from '../../testing';
import { CONTRACT_DATE, todayViewFixture } from '../../today/__tests__/todayView.fixture';
import { MealSheet } from '../MealSheet';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

const ANSWERS = ['As planned', 'Partly', 'Skipped'] as const;

/** The fixture's lunch on CONTRACT_DATE (a lift day): 37 % of 2 050 kcal. */
const PLANNED = Math.round(2050 * 0.37);

const entry = (over: Partial<LogEntrySummary> = {}): LogEntrySummary => ({
  id: 'e1',
  kind: 'meal',
  clockH: 12.5,
  label: 'dal, rice, curd',
  energyKcal: { value: 640, sd: 60 },
  source: 'user',
  aiEstimated: false,
  ...over,
});

function lunchView(
  entries: LogEntrySummary[],
  o: { row?: boolean; dayMarked?: boolean; lunch?: 'partly' | 'not' } = {},
): TodayView {
  const v = todayViewFixture();
  const marks = {
    ...(o.dayMarked ? { all: 'asPlanned' as const } : {}),
    ...(o.lunch ? { meals: { lunch: o.lunch } } : {}),
  };
  return {
    ...v,
    logged: { ...v.logged, entries },
    ...(Object.keys(marks).length ? { marks } : {}),
    checklist: v.checklist
      .filter((c) => o.row !== false || c.id !== 'meal:lunch')
      .map((c) => (c.id === 'mark:all' ? { ...c, done: !!o.dayMarked } : c)),
  };
}

function mount(view: TodayView, quiet = false, onClose: () => void = () => undefined) {
  const h = renderLiving(
    <MealSheet
      date={CONTRACT_DATE}
      slot="lunch"
      quiet={quiet}
      onClose={onClose}
      onLogOther={() => undefined}
      onRecipe={() => undefined}
    />,
    {
      source: (stub) => ({
        ...stub.source,
        today: (d) => (d === CONTRACT_DATE ? view : stub.source.today(d)),
      }),
    },
  );
  const sheet = screen.getByRole('dialog', { name: 'Lunch' });
  const bank = within(sheet).getByRole('radiogroup', { name: 'How did lunch go?' });
  const checked = () =>
    ANSWERS.filter(
      (a) => within(bank).getByRole('radio', { name: a }).getAttribute('aria-checked') === 'true',
    );
  const fact = () =>
    (sheet.querySelector('.lv-sheet__fact')?.textContent ?? '').replace(/[\u2009\u202f\u00a0]/g, ' ');
  // r068 L9: the dish the sheet leads with
  const dish = () => sheet.querySelector('.lv-mealsheet__dish')?.textContent ?? '';
  return { h, sheet, bank, checked, fact, dish };
}

describe('MealSheet: the selected answer matches what was logged', () => {
  it('a logged entry with no row status is read by its amount: less than the plan is Partly, never As planned', () => {
    const s = mount(lunchView([entry()], { row: false }));
    expect(s.checked()).toEqual(['Partly']);
    expect(s.fact()).toBe(`≈ 640 / ${PLANNED} kcal`);
  });

  it('a logged entry with no row status and no energy selects nothing; the fact is what was logged', () => {
    const { energyKcal: _drop, ...noEnergy } = entry();
    void _drop;
    const s = mount(lunchView([noEnergy], { row: false }));
    expect(s.checked()).toEqual([]);
    // r068 L9: what was logged leads the sheet as its dish; the fact line under it says it was logged
    expect(s.dish()).toBe('Dal, rice, curd');
    expect(s.fact()).toBe('Logged');
  });

  it('food within the plan’s tolerance is As planned; more than the plan selects nothing', () => {
    let s = mount(lunchView([entry({ energyKcal: { value: PLANNED + 30, sd: 60 } })]));
    expect(s.checked()).toEqual(['As planned']);
    s.h.result.unmount();
    s = mount(lunchView([entry({ energyKcal: { value: 1100, sd: 100 } })]));
    expect(s.checked()).toEqual([]);
    expect(s.fact()).toBe(`≈ 1,100 / ${PLANNED} kcal`);
  });

  it('a meal logged with "As planned" is As planned, and says so in quiet mode', () => {
    const s = mount(
      lunchView([entry({ label: 'as planned', energyKcal: { value: PLANNED, sd: 70 } })]),
      true,
    );
    expect(s.checked()).toEqual(['As planned']);
    expect(s.fact()).toBe('As planned');
  });

  it('quiet mode: a smaller meal shows its words and Partly', () => {
    const s = mount(lunchView([entry()]), true);
    expect(s.checked()).toEqual(['Partly']);
    expect(s.dish()).toBe('Dal, rice, curd');
    expect(s.fact()).toBe('Partly');
  });

  it('with no food, the meal’s own answer: Skipped, Partly; a day marked as planned is As planned', () => {
    let s = mount(lunchView([], { lunch: 'not' }));
    expect(s.checked()).toEqual(['Skipped']);
    expect(s.fact()).toBe('Skipped');
    s.h.result.unmount();
    s = mount(lunchView([], { lunch: 'partly' }));
    expect(s.checked()).toEqual(['Partly']);
    expect(s.fact()).toBe('Partly');
    s.h.result.unmount();
    s = mount(lunchView([], { dayMarked: true }));
    expect(s.checked()).toEqual(['As planned']);
    expect(s.fact()).toBe('Marked as planned');
  });

  it('choosing the answer it already has logs nothing more; another answer replaces what the meal holds', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const s = mount(lunchView([entry()]), false, onClose);
    const answerMeal = vi.spyOn(s.h.stub.actions, 'answerMeal').mockResolvedValue({ ok: true });
    await user.click(within(s.bank).getByRole('radio', { name: 'Partly' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(answerMeal).not.toHaveBeenCalled();
    await user.click(within(s.bank).getByRole('radio', { name: 'As planned' }));
    // one action for the slot, naming the food the sheet shows: it is replaced, not added to
    await waitFor(() =>
      expect(answerMeal).toHaveBeenCalledWith(CONTRACT_DATE, {
        slot: 'lunch',
        mark: 'asPlanned',
        replaces: ['e1'],
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });
});

describe('MealSheet on the stand-in: an answer replaces what the meal held', () => {
  it('430 kcal typed, then As planned: one planned meal, not both; again changes nothing; Undo brings the 430 back', async () => {
    const user = userEvent.setup();
    let undo: (() => Promise<unknown>) | undefined;
    const h = renderLiving(
      <MealSheet
        date={FIXTURE_TODAY}
        slot="lunch"
        quiet={false}
        onClose={() => undefined}
        onLogOther={() => undefined}
        onRecipe={() => undefined}
        onAnswered={(_t, _m, u) => (undo = u)}
      />,
    );
    const lunch = h.stub.source.today(FIXTURE_TODAY)!.prescription!.meals.find((m) => m.slot === 'lunch')!;
    const meals = () => h.stub.inspect().entries.filter((e) => e.kind === 'meal');
    await act(async () => {
      await h.stub.actions.logMeal(FIXTURE_TODAY, {
        slot: 'lunch',
        clockH: lunch.clockH,
        components: [
          { name: 'dal', energyKcal: 300 },
          { name: 'rice', energyKcal: 130 },
        ],
      });
    });
    const bank = () =>
      within(screen.getByRole('dialog', { name: 'Lunch' })).getByRole('radiogroup', {
        name: 'How did lunch go?',
      });
    expect(within(bank()).getByRole('radio', { name: 'Partly' })).toHaveAttribute('aria-checked', 'true');
    const answerMeal = vi.spyOn(h.stub.actions, 'answerMeal');

    await user.click(within(bank()).getByRole('radio', { name: 'As planned' }));
    await waitFor(() => expect(meals()).toHaveLength(1));
    const [planned] = meals();
    expect(planned!.kind === 'meal' && planned!.totals.energyKcal.value).toBeCloseTo(lunch.energyKcal, 0);
    await waitFor(() =>
      expect(within(bank()).getByRole('radio', { name: 'As planned' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );

    // the answer it now has: nothing more is logged
    await user.click(within(bank()).getByRole('radio', { name: 'As planned' }));
    expect(answerMeal).toHaveBeenCalledTimes(1);
    expect(meals()).toHaveLength(1);

    await act(async () => {
      await undo?.();
    });
    const back = meals();
    expect(back).toHaveLength(1);
    expect(back[0]!.kind === 'meal' && back[0]!.components.map((c) => c.name)).toEqual(['dal', 'rice']);
    expect(back[0]!.kind === 'meal' && back[0]!.totals.energyKcal.value).toBeCloseTo(430, 0);
  });
});

it('keeps unknown food unknown, and labels a sum of only known foods as a lower bound', () => {
  const { energyKcal: _unknown, ...unknown } = entry({ id: 'unknown', label: 'another food' });
  void _unknown;
  const s = mount(lunchView([entry(), unknown]));
  expect(s.fact()).toBe(`At least 640 / ${PLANNED} kcal`);
  expect(within(s.sheet).getByRole('meter', { name: 'Meal against plan' })).toHaveAttribute(
    'aria-valuetext',
    expect.stringContaining('At least'),
  );
  expect(within(s.sheet).getByText(/known food only/)).toBeInTheDocument();
});

it('keeps a known zero distinct from unknown, and keeps the ratio but no amount in quiet mode', () => {
  let s = mount(lunchView([entry({ energyKcal: { value: 0, sd: 0 } })], { row: false }));
  expect(s.fact()).toBe(`0 / ${PLANNED} kcal`);
  expect(within(s.sheet).getByRole('meter', { name: 'Meal against plan' })).toHaveAttribute(
    'aria-valuenow',
    '0',
  );
  s.h.result.unmount();
  s = mount(lunchView([entry()]));
  expect(within(s.sheet).getByText(/Likely/)).toBeInTheDocument();
  s.h.result.unmount();
  s = mount(lunchView([entry()]), true);
  const meter = within(s.sheet).getByRole('meter', { name: 'Meal against plan' });
  expect(meter).not.toHaveAttribute('aria-valuenow');
  expect(meter.getAttribute('aria-valuetext')).not.toMatch(/\d|kcal/);
  expect(s.sheet.textContent).not.toMatch(/\d|kcal/);
});

it('does not call an explicit as-planned log inside the tolerance band when its amount is outside', () => {
  const s = mount(lunchView([entry({ label: 'as planned', energyKcal: { value: 1100, sd: 0 } })]));
  expect(s.checked()).toEqual(['As planned']);
  expect(within(s.sheet).queryByText('Within the plan’s range')).not.toBeInTheDocument();
  expect(within(s.sheet).getByText('Logged as planned')).toBeInTheDocument();
});
