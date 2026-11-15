/**
 * (r087) Activity is one place with three tabs (Train · Movement · Energy). The tab row carries the selection from one
 * tab to the next in each page's own address form, and never sends a measured page to a day still ahead.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { resetActivePlan } from '@/features/living/activePlan';
import { LivingClockContext, fixedClock, type LivingClock } from '@/features/living/clock';
import { dayPeriod, periodOf, rangePeriod } from '@/features/living/period';
import { ACTIVITY_COPY, ActivityTabs, activityDocumentTitle, activityTabLinks } from '../ActivityTabs';

const TODAY = '2026-11-15';

describe('activityTabLinks', () => {
  it('today opens every tab at its bare address', () => {
    expect(activityTabLinks(dayPeriod(TODAY), TODAY, true)).toEqual({ train: '/train', movement: '/activity', energy: '/energy' });
  });

  it('an earlier day travels to all three: in the path for Train, as ?date= for Movement and Energy', () => {
    expect(activityTabLinks(dayPeriod('2026-11-10'), TODAY, true)).toEqual({
      train: '/train/2026-11-10',
      movement: '/activity?date=2026-11-10',
      energy: '/energy?date=2026-11-10',
    });
  });

  it('without a plan Train has no days to pick between: it opens on today, the other two keep the day', () => {
    expect(activityTabLinks(dayPeriod('2026-11-10'), TODAY, false)).toEqual({
      train: '/train',
      movement: '/activity?date=2026-11-10',
      energy: '/energy?date=2026-11-10',
    });
  });

  it('a week, month, year or range stays whole between Movement and Energy; Train, one day, opens on today', () => {
    const week = periodOf('week', '2026-11-04');
    expect(activityTabLinks(week, TODAY, true)).toEqual({
      train: '/train',
      movement: `/activity?period=week&date=${week.from}`,
      energy: `/energy?period=week&date=${week.from}`,
    });
    const range = rangePeriod('2026-10-01', '2026-10-20');
    expect(activityTabLinks(range, TODAY, true).energy).toBe('/energy?period=range&from=2026-10-01&to=2026-10-20');
    expect(activityTabLinks(periodOf('year', TODAY), TODAY, true).movement).toBe('/activity?period=year&date=2026-01-01');
  });

  it('a plan day still ahead (Train previews it) opens the measured tabs on today, never on a day with no readings yet', () => {
    expect(activityTabLinks(dayPeriod('2026-11-18'), TODAY, true)).toEqual({ train: '/train/2026-11-18', movement: '/activity', energy: '/energy' });
  });
});

// From midnight to the rollover hour the app is still on Sunday the 15th while the calendar, Movement's clock, says
// Monday the 16th: a bare address would open a different day on the other side.
describe('activityTabLinks between midnight and the rollover', () => {
  const SMALL_HOURS = { app: TODAY, calendar: '2026-11-16' } as const;

  it('Train and Energy on their today open Movement on that same day, written out', () => {
    expect(activityTabLinks(dayPeriod(TODAY), TODAY, true, SMALL_HOURS)).toEqual({ train: '/train', movement: `/activity?date=${TODAY}`, energy: '/energy' });
  });

  it('Movement on the calendar’s today opens the other two on theirs: Energy has no later day, Train no plan day picked', () => {
    expect(activityTabLinks(dayPeriod('2026-11-16'), '2026-11-16', true, SMALL_HOURS)).toEqual({ train: '/train', movement: '/activity', energy: '/energy' });
  });

  it('Movement on the day before, the app’s today, opens Train and Energy at their bare address', () => {
    expect(activityTabLinks(dayPeriod(TODAY), '2026-11-16', true, SMALL_HOURS)).toEqual({ train: '/train', movement: `/activity?date=${TODAY}`, energy: '/energy' });
  });

  it('a plan day ahead on Train opens Movement no later than the calendar’s today', () => {
    expect(activityTabLinks(dayPeriod('2026-11-16'), TODAY, true, SMALL_HOURS)).toEqual({ train: '/train/2026-11-16', movement: '/activity', energy: '/energy' });
    expect(activityTabLinks(dayPeriod('2026-11-18'), TODAY, true, SMALL_HOURS)).toEqual({ train: '/train/2026-11-18', movement: '/activity', energy: '/energy' });
  });

  it('an earlier day and a longer period travel as they are', () => {
    expect(activityTabLinks(dayPeriod('2026-11-10'), TODAY, true, SMALL_HOURS)).toEqual({ train: '/train/2026-11-10', movement: '/activity?date=2026-11-10', energy: '/energy?date=2026-11-10' });
    const week = periodOf('week', TODAY);
    expect(activityTabLinks(week, TODAY, true, SMALL_HOURS)).toEqual({ train: '/train', movement: `/activity?period=week&date=${week.from}`, energy: `/energy?period=week&date=${week.from}` });
  });
});

describe('ActivityTabs', () => {
  beforeEach(() => resetActivePlan());
  afterEach(() => vi.useRealTimers());

  function tabsAt(path: string, period = dayPeriod(TODAY), clock?: LivingClock) {
    const row = <ActivityTabs period={period} today={TODAY} />;
    render(<MemoryRouter initialEntries={[path]}>{clock ? <LivingClockContext.Provider value={clock}>{row}</LivingClockContext.Provider> : row}</MemoryRouter>);
    return screen.getByRole('navigation', { name: ACTIVITY_COPY.tabsLabel });
  }

  // the row reads both clocks itself: the page only knows its own
  it('at 01:30 the app day is still the 15th and the calendar the 16th: Movement gets the day written out', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T01:30:00'));
    const nav = tabsAt('/energy', dayPeriod(TODAY), fixedClock('2026-11-16T01:30'));
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/train', `/activity?date=${TODAY}`, '/energy']);
  });

  it('at noon the two clocks agree and today opens every tab at its bare address', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00'));
    const nav = tabsAt('/energy', dayPeriod(TODAY), fixedClock('2026-11-15T12:00'));
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/train', '/activity', '/energy']);
  });

  it('draws Train · Movement · Energy as links and marks the tab the address is on', () => {
    const nav = tabsAt('/activity');
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Train', 'Movement', 'Energy']);
    expect(within(nav).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent)).toEqual(['Movement']);
  });

  it.each([
    ['/train', 'Train'],
    ['/train/2026-11-10', 'Train'],
    ['/energy', 'Energy'],
  ])('on %s the current tab is %s', (path, name) => {
    const nav = tabsAt(path);
    expect(within(nav).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent)).toEqual([name]);
  });

  it('names each page for the browser tab: the place, then the tab', () => {
    expect(activityDocumentTitle('train')).toBe('Activity · Train');
    expect(activityDocumentTitle('movement')).toBe('Activity · Movement');
    expect(activityDocumentTitle('energy')).toBe('Activity · Energy');
  });
});
