import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedDay, SleepRecord } from '@/biometrics/core/types';
import { LivingClockContext, fixedClock } from '@/features/living/clock';
import { RingServiceProvider } from '@/features/ring/data';
import { createFakeRingService, type RingScenario } from '@/features/ring/fixtures';
import type { LocalDate } from '@/living';
import { SignalsSourceProvider, type SignalsSource } from '../data';
import type { TabProps } from '../tabs/types';
import SignalsPage from '../SignalsPage';

// The tabs are other files' work: stand-ins that show what the page hands them and drill on request.
vi.mock('../tabs/SleepTab', () => ({ SleepTab: (p: TabProps) => <StubTab name="sleep" {...p} /> }));
vi.mock('../tabs/HeartTab', () => ({ HeartTab: (p: TabProps) => <StubTab name="heart" {...p} /> }));
vi.mock('../tabs/ActivityTab', () => ({ ActivityTab: (p: TabProps) => <StubTab name="activity" {...p} /> }));

function StubTab({ name, window: w, today, onDrill }: TabProps & { name: string }) {
  return (
    <div data-testid="tab">
      {`${name} ${w.kind} ${w.start}..${w.last} anchor ${w.anchor} today ${today} slots ${w.slots.length}`}
      <button type="button" onClick={() => onDrill(w.kind === 'year' ? 'month' : 'day', w.kind === 'year' ? w.slots[2]!.start : w.slots[1]!.start)}>
        drill
      </button>
    </div>
  );
}

const NOW = '2026-10-04T09:00:00'; // Sunday
const nowMs = new Date(NOW).getTime();

function day(localDate: LocalDate, night = false): ResolvedDay {
  return {
    localDate,
    ...(night ? { mainSleep: { kind: 'sleep', is_main: true, asleep_s: 7 * 3600, time: { local_date: localDate } } as unknown as SleepRecord } : {}),
    sleeps: [],
    workouts: [],
    spots: [],
    sourceByMetric: {},
    tierByMetric: {},
    basisByMetric: {},
    corrections: [],
  };
}

interface FakeOpts {
  days?: ResolvedDay[];
  first?: LocalDate | null;
  dates?: LocalDate[];
  labels?: string[];
  lastReadAt?: number | null;
}

function fakeSource(o: FakeOpts = {}): SignalsSource & { infoCalls: Array<[LocalDate, LocalDate]> } {
  const days = o.days ?? [day('2026-10-01', true), day('2026-10-02', true), day('2026-10-03', true)];
  const infoCalls: Array<[LocalDate, LocalDate]> = [];
  return {
    infoCalls,
    subscribe: () => () => {},
    revision: () => 1,
    days: (from, to) => days.filter((d) => d.localDate >= from && d.localDate <= to),
    series: async () => [],
    baselines: async () => [],
    firstDate: () => (o.first === undefined ? '2026-09-01' : o.first),
    datesWithData: () => o.dates ?? days.map((d) => d.localDate),
    person: () => ({ goals: {}, vendorScores: false, tempUnit: 'C' }),
    sourceInfo(from, to) {
      infoCalls.push([from, to]);
      return { labels: o.labels ?? ['J-Style 2301', 'an Apple Health import'], lastReadAt: o.lastReadAt === undefined ? nowMs - 6 * 60_000 : o.lastReadAt };
    },
  };
}

function Loc() {
  const l = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="loc">{l.pathname + l.search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        history back
      </button>
    </>
  );
}

function renderPage(url: string, o: { ring?: RingScenario; source?: SignalsSource; now?: string } = {}) {
  const clock = fixedClock(o.now ?? NOW);
  const service = createFakeRingService(o.ring ?? 'connected', { now: clock.now().getTime() });
  const source = o.source ?? fakeSource();
  const user = userEvent.setup();
  render(
    <LivingClockContext.Provider value={clock}>
      <RingServiceProvider service={service} platform={{ platform: 'android', ble: 'capacitor', installedApp: true }}>
        <SignalsSourceProvider source={source}>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              <Route
                path="/signals"
                element={
                  <>
                    <SignalsPage />
                    <Loc />
                  </>
                }
              />
              <Route path="*" element={<Loc />} />
            </Routes>
          </MemoryRouter>
        </SignalsSourceProvider>
      </RingServiceProvider>
    </LivingClockContext.Provider>,
  );
  return { user, service, source };
}

const loc = () => screen.getByTestId('loc').textContent;
const tabText = () => screen.getByTestId('tab').textContent ?? '';
const labelKey = () => document.querySelector<HTMLButtonElement>('.sp-period__label')!;
const earlierKey = (p = 'day') => screen.getByRole('button', { name: `Previous ${p}` });
const laterKey = (p = 'day') => screen.getByRole('button', { name: `Next ${p}` });

describe('Body signals page: URL state', () => {
  it('reads tab, period and date from the URL and hands the tab its calendar window', () => {
    const { source } = renderPage('/signals?tab=heart&period=week&date=2026-10-02');
    expect(screen.getByRole('heading', { level: 1, name: 'Body signals' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'heart and recovery' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('radio', { name: 'week' })).toHaveAttribute('aria-checked', 'true');
    expect(labelKey()).toHaveTextContent('28 Sep – 4 Oct');
    expect(tabText()).toContain('heart week 2026-09-28..2026-10-04 anchor 2026-10-02 today 2026-10-04 slots 7');
    expect((source as ReturnType<typeof fakeSource>).infoCalls).toContainEqual(['2026-09-28', '2026-10-04']);
  });

  it('defaults: sleep, day, and the newest night as the reference day', () => {
    renderPage('/signals');
    expect(screen.getByRole('tab', { name: 'sleep' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('radio', { name: 'day' })).toHaveAttribute('aria-checked', 'true');
    // no night has ended today yet (the newest is the night to Sat 3 Oct): that night, not an empty "tonight"
    expect(labelKey()).toHaveTextContent('Night to Sat 3 Oct');
    expect(tabText()).toContain('sleep day 2026-10-03..2026-10-03');
    // the reference night is in view: no "today" key
    expect(screen.queryByRole('button', { name: 'Go to last night' })).not.toBeInTheDocument();
  });

  it('a night that ended this morning is "Last night"', () => {
    renderPage('/signals', { source: fakeSource({ days: [day('2026-10-03', true), day('2026-10-04', true)] }) });
    expect(labelKey()).toHaveTextContent('Last night');
  });

  it('a future date in the URL is clamped to today', () => {
    renderPage('/signals?tab=activity&date=2026-12-01');
    expect(labelKey()).toHaveTextContent('Today');
  });

  it('switching tab keeps period and date and pushes a history entry', async () => {
    const { user } = renderPage('/signals?tab=heart&period=week&date=2026-10-02');
    await user.click(screen.getByRole('tab', { name: 'activity' }));
    expect(loc()).toBe('/signals?tab=activity&period=week&date=2026-10-02');
    expect(tabText()).toContain('activity week 2026-09-28');
    await user.click(screen.getByRole('button', { name: 'history back' }));
    expect(loc()).toBe('/signals?tab=heart&period=week&date=2026-10-02');
    expect(screen.getByRole('tab', { name: 'heart and recovery' })).toHaveAttribute('aria-selected', 'true');
  });

  it('switching period keeps the date: day 2 Oct → week → month → day is 2 Oct again', async () => {
    const { user } = renderPage('/signals?tab=heart&date=2026-10-02');
    expect(labelKey()).toHaveTextContent('Fri 2 Oct');
    await user.click(screen.getByRole('radio', { name: 'week' }));
    expect(loc()).toBe('/signals?tab=heart&period=week&date=2026-10-02');
    expect(labelKey()).toHaveTextContent('28 Sep – 4 Oct');
    await user.click(screen.getByRole('radio', { name: 'month' }));
    expect(labelKey()).toHaveTextContent('October 2026');
    await user.click(screen.getByRole('radio', { name: 'year' }));
    expect(labelKey()).toHaveTextContent('2026');
    expect(tabText()).toContain('slots 12');
    await user.click(screen.getByRole('radio', { name: 'day' }));
    expect(loc()).toBe('/signals?tab=heart&date=2026-10-02');
    expect(labelKey()).toHaveTextContent('Fri 2 Oct');
    // and Back walks through the periods
    await user.click(screen.getByRole('button', { name: 'history back' }));
    expect(loc()).toBe('/signals?tab=heart&period=year&date=2026-10-02');
  });

  it('a drill from a tab sets period and date', async () => {
    const { user } = renderPage('/signals?tab=heart&period=week&date=2026-10-02');
    await user.click(screen.getByRole('button', { name: 'drill' }));
    expect(loc()).toBe('/signals?tab=heart&date=2026-09-29');
    expect(labelKey()).toHaveTextContent('Tue 29 Sep');
  });

  it('a drill from a year opens that month', async () => {
    const { user } = renderPage('/signals?tab=activity&period=year');
    await user.click(screen.getByRole('button', { name: 'drill' }));
    expect(loc()).toBe('/signals?tab=activity&period=month&date=2026-03-01');
    expect(labelKey()).toHaveTextContent('March 2026');
  });
});

describe('Body signals page: stepping and today', () => {
  it('› is disabled on the current period; ‹ steps back; "today" returns to the reference day', async () => {
    const { user } = renderPage('/signals?tab=heart');
    expect(labelKey()).toHaveTextContent('Today');
    expect(laterKey()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('button', { name: 'Go to today' })).not.toBeInTheDocument();
    await user.click(laterKey());
    expect(loc()).toBe('/signals?tab=heart');

    await user.click(earlierKey());
    expect(loc()).toBe('/signals?tab=heart&date=2026-10-03');
    expect(labelKey()).toHaveTextContent('Yesterday');
    expect(laterKey()).not.toHaveAttribute('aria-disabled');

    await user.click(screen.getByRole('button', { name: 'Go to today' }));
    expect(loc()).toBe('/signals?tab=heart');
    expect(labelKey()).toHaveTextContent('Today');
  });

  it('‹ goes to the canonical start of the previous week, › comes back', async () => {
    const { user } = renderPage('/signals?tab=activity&period=week&date=2026-10-02');
    await user.click(earlierKey('week'));
    expect(loc()).toBe('/signals?tab=activity&period=week&date=2026-09-21');
    expect(labelKey()).toHaveTextContent('21–27 Sep');
    await user.click(laterKey('week'));
    expect(loc()).toBe('/signals?tab=activity&period=week&date=2026-09-28');
    expect(laterKey('week')).toHaveAttribute('aria-disabled', 'true');
  });

  it('‹ stops at the period of the first record', () => {
    renderPage('/signals?tab=heart&period=week&date=2026-09-02', { source: fakeSource({ first: '2026-09-01' }) });
    expect(earlierKey('week')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Body signals page: calendar', () => {
  it('opens a month calendar: dots on days with data, future days disabled, arrows move, Enter picks', async () => {
    const { user } = renderPage('/signals?tab=heart&date=2026-10-02', { source: fakeSource({ dates: ['2026-10-01', '2026-10-02'] }) });
    await user.click(labelKey());
    const dialog = await screen.findByRole('dialog', { name: 'Go to date' });
    expect(within(dialog).getByRole('heading', { name: 'Go to date' })).toBeInTheDocument();
    expect(within(dialog).getByText('October 2026')).toBeInTheDocument();
    const oct1 = within(dialog).getByRole('button', { name: 'Thursday 1 October 2026, has readings' });
    expect(oct1.querySelector('.sp-cal__dot')).not.toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Saturday 3 October 2026, no readings' }).querySelector('.sp-cal__dot')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Monday 5 October 2026, after today' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Next month' })).toHaveAttribute('aria-disabled', 'true');
    // the selected day has focus; arrows move one day, Enter picks
    const oct2 = within(dialog).getByRole('button', { name: /^Friday 2 October 2026/ });
    await waitFor(() => expect(oct2).toHaveFocus());
    await user.keyboard('{ArrowLeft}');
    expect(oct1).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(loc()).toBe('/signals?tab=heart&date=2026-10-01');
    expect(screen.queryByRole('dialog', { name: 'Go to date' })).not.toBeInTheDocument();
    expect(labelKey()).toHaveTextContent('Thu 1 Oct');
  });

  it('a week period opens the calendar on its anchor and picking keeps the period', async () => {
    const { user } = renderPage('/signals?tab=sleep&period=week&date=2026-09-23');
    await user.click(labelKey());
    const dialog = await screen.findByRole('dialog', { name: 'Go to date' });
    expect(within(dialog).getByText('September 2026')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /^Wednesday 9 September/ }));
    expect(loc()).toBe('/signals?period=week&date=2026-09-09');
    expect(labelKey()).toHaveTextContent('7–13 Sep');
  });
});

describe('Body signals page: whole-page states', () => {
  /** A store still loading at start: answers nothing (as the real index does) until `finish()`. */
  function loadingSource(loaded: SignalsSource): SignalsSource & { finish: () => void } {
    let done = false;
    let rev = 0;
    const subs = new Set<() => void>();
    return {
      ...loaded,
      subscribe: (fn) => (subs.add(fn), () => void subs.delete(fn)),
      revision: () => rev,
      ready: () => done,
      days: (from, to) => (done ? loaded.days(from, to) : []),
      firstDate: () => (done ? loaded.firstDate() : null),
      datesWithData: () => (done ? loaded.datesWithData() : []),
      finish() {
        done = true;
        rev++;
        subs.forEach((fn) => fn());
      },
    };
  }

  it('stored records still loading: the loading rule, not "Nothing measured yet"; then the readings', () => {
    const source = loadingSource(fakeSource({ labels: ['an Apple Health import'], lastReadAt: null }));
    renderPage('/signals?tab=heart', { ring: 'none', source });
    expect(screen.getByRole('progressbar', { name: 'Loading screen' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nothing measured yet.' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    act(() => source.finish());
    expect(screen.queryByRole('progressbar', { name: 'Loading screen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nothing measured yet.' })).not.toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Body signals' })).toBeInTheDocument();
    expect(screen.getByText(/^From an Apple Health import/)).toBeInTheDocument();
  });

  it('a store that finishes loading empty: then the empty stage', () => {
    const source = loadingSource(fakeSource({ days: [], first: null, dates: [], labels: [], lastReadAt: null }));
    renderPage('/signals', { ring: 'none', source });
    expect(screen.queryByRole('heading', { name: 'Nothing measured yet.' })).not.toBeInTheDocument();
    act(() => source.finish());
    expect(screen.getByRole('heading', { name: 'Nothing measured yet.' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('a ready empty store shows the empty stage at once', () => {
    renderPage('/signals', { ring: 'none', source: { ...fakeSource({ days: [], first: null, dates: [], labels: [], lastReadAt: null }), ready: () => true } });
    expect(screen.getByRole('heading', { name: 'Nothing measured yet.' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('nothing measured and no ring: the pairing flow on top, the empty stage with Import a file', () => {
    renderPage('/signals', { ring: 'none', source: fakeSource({ days: [], first: null, dates: [], labels: [], lastReadAt: null }) });
    expect(screen.getByRole('heading', { name: 'Nothing measured yet.' })).toBeInTheDocument();
    expect(screen.getByText('Connect a ring or import a file to see your sleep, heart and activity here.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Connect your ring' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Look for rings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import a file' })).toHaveAttribute('href', '/settings#devices');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab')).not.toBeInTheDocument();
  });

  it('a ring but nothing stored yet: the page, not the empty stage', () => {
    renderPage('/signals?tab=heart', { ring: 'connected', source: fakeSource({ days: [], first: null, dates: [], labels: [] }) });
    expect(screen.queryByRole('heading', { name: 'Nothing measured yet.' })).not.toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Body signals' })).toBeInTheDocument();
    expect(earlierKey()).toHaveAttribute('aria-disabled', 'true');
  });

  it('data but no ring (an import): the page', () => {
    renderPage('/signals?tab=heart', { ring: 'none', source: fakeSource({ labels: ['an Apple Health import'], lastReadAt: null }) });
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByText(/^From an Apple Health import/)).toBeInTheDocument();
    expect(screen.queryByText(/read .* ago/)).not.toBeInTheDocument();
  });

  it('a ring not read since before the period: a line under the ring card', () => {
    renderPage('/signals?tab=heart', { ring: 'stale' });
    expect(screen.getByText(/Your ring hasn[’']t been read since Thu 1 Oct\./)).toBeInTheDocument();
    expect(document.querySelector('.rg-devices .rg-card')).not.toBeNull();
  });

  it('no ring line for a period before the last read, nor for a ring read just now', () => {
    renderPage('/signals?tab=heart&period=week&date=2026-09-23', { ring: 'stale' });
    expect(screen.queryByText(/hasn[’']t been read/)).not.toBeInTheDocument();
  });

  it('no ring line when the ring was read 6 minutes ago', () => {
    renderPage('/signals?tab=heart', { ring: 'connected' });
    expect(screen.queryByText(/hasn[’']t been read/)).not.toBeInTheDocument();
  });

  it('reading the ring in the background: the source line says so', () => {
    renderPage('/signals?tab=activity', { ring: 'syncing' });
    expect(document.querySelector('.sp-source')?.textContent).toMatch(/reading your ring · 34\s%/);
    expect(screen.queryByText(/read 6\smin ago/)).not.toBeInTheDocument();
  });
});

describe('Body signals page: the one ring page', () => {
  it('the ring card comes first, above the tabs, with a link to Ring settings; no back key to a Ring page', () => {
    renderPage('/signals?tab=heart', { ring: 'connected' });
    const card = document.querySelector('.rg-devices .rg-card')!;
    const tabs = screen.getByRole('tablist', { name: 'Body signals' });
    expect(card.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ring settings' })).toHaveAttribute('href', '/settings#devices');
    expect(document.body.textContent).not.toMatch(/Today from your ring|Use my ring data/);
  });
});

describe('Body signals page: source line', () => {
  it('names the sources of the period and when the ring was read', () => {
    renderPage('/signals?tab=sleep');
    const line = document.querySelector('.sp-source')!;
    expect(line.textContent).toMatch(/^From J-Style 2301 and an Apple Health import · read 6\smin ago$/);
  });

  it('heart and recovery explains how to use relative readings', () => {
    renderPage('/signals?tab=heart');
    expect(document.querySelector('.sp-source')!.textContent).toMatch(/read 6\smin ago · These readings are most useful as changes from your own normal\.$/);
  });

  it('activity has no relative-reading note; one source has no "and"', () => {
    renderPage('/signals?tab=activity', { source: fakeSource({ labels: ['J-Style 2301'] }) });
    const text = document.querySelector('.sp-source')!.textContent!;
    expect(text).toMatch(/^From J-Style 2301 · read/);
    expect(text).not.toMatch(/changes from your own normal/);
  });

  it('never names the ring by anything but its driver label', () => {
    renderPage('/signals?tab=heart', { ring: 'stale' });
    const text = document.body.textContent ?? '';
    for (const w of ['password', 'passcode', 'credential', 'PIN', 'MQTT', 'lease', 'GATT']) expect(text).not.toContain(w);
  });
});
