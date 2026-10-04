/**
 * Body signals (`/signals`; design/screens/ring-pages.md §6): what the ring and any import measured over a day, a
 * week, a month or a year. Tabs sleep · heart and recovery · activity, sticky under the top bar with the period bar
 * below them (one toolbar row at ≥ 1280 px). The URL is the state (`?tab=&period=&date=`): every change pushes, so Back
 * walks through them and a link can open last Tuesday's night. Without a date the tab's reference day is shown (today,
 * or for sleep the newest night). Whole-page states: nothing measured and no ring (an empty stage), a ring that has not
 * been read since before the period (a line and Open Ring), a read running (the source line says so). The tabs draw
 * their own chart states.
 */
import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyStage, InlineWarning, KeyLink, Page, Tab, TabList, TabPanel, Tabs } from '@/components';
import { TopBar } from '@/app/shell';
import { paths } from '@/app/paths';
import { useLivingClock } from '@/features/living/clock';
import { useRings, type RingStatus } from '@/features/ring/data';
import { useSettingsStore } from '@/state/settingsStore';
import { addDays } from '@/living/dates';
import type { LocalDate } from '@/living';
import { DevFixtureGate } from './DevFixtureGate';
import { useDays, useSignalsRevision, useSignalsSource } from './data';
import { SIGNALS_PAGE_COPY as C } from './copyPage';
import {
  dayText,
  localDateOfMs,
  parseSignalsQuery,
  periodWindow,
  referenceDay,
  SIGNALS_TABS,
  signalsSearch,
  type DateStyle,
  type PeriodKind,
  type SignalsQuery,
  type SignalsTab,
} from './models';
import { PeriodBar } from './PeriodBar';
import { SourceLine } from './SourceLine';
import { ActivityTab } from './tabs/ActivityTab';
import { HeartTab } from './tabs/HeartTab';
import { SleepTab } from './tabs/SleepTab';
import type { TabProps } from './tabs/types';
import './signals.css';

/** How far back the sleep tab looks for its reference night. */
const NIGHT_LOOKBACK_DAYS = 14;

const TAB_VIEW: Record<SignalsTab, (p: TabProps) => ReactNode> = { sleep: SleepTab, heart: HeartTab, activity: ActivityTab };

export default function SignalsPage() {
  return (
    <>
      <TopBar title={C.title} back={{ to: paths.ring, label: C.backTo }} compactOnMobile />
      <DevFixtureGate>
        <SignalsBody />
      </DevFixtureGate>
    </>
  );
}

const lastReadOf = (rings: readonly RingStatus[]): number | null => {
  const t = rings.map((r) => (r.lastSyncAt ? Date.parse(r.lastSyncAt) : NaN)).filter(Number.isFinite);
  return t.length ? Math.max(...t) : null;
};

function SignalsBody() {
  const clock = useLivingClock();
  const nowMs = clock.now().getTime();
  // body signals are calendar days (a night belongs to the date it ends), not the plan's rolled-over day
  const today = localDateOfMs(nowMs);
  const source = useSignalsSource();
  const rev = useSignalsRevision(source);
  const rings = useRings();
  const dateStyle = useSettingsStore((s) => s.dateStyle) as DateStyle;
  const [params, setParams] = useSearchParams();
  const q = parseSignalsQuery(params, today);

  const recent = useDays(addDays(today, -(NIGHT_LOOKBACK_DAYS - 1)), today);
  const nightDates = useMemo(() => recent.filter((d) => d.mainSleep).map((d) => d.localDate), [recent]);
  const refDay = referenceDay(q.tab, today, nightDates);
  const anchor = q.date ?? refDay;
  const win = useMemo(() => periodWindow(q.period, anchor, today), [q.period, anchor, today]);

  const firstDate = useMemo(() => {
    void rev;
    return source.firstDate();
  }, [source, rev]);
  const withData = useMemo(() => {
    void rev;
    return new Set(source.datesWithData());
  }, [source, rev]);
  const info = useMemo(() => {
    void rev;
    return source.sourceInfo(win.start, win.last);
  }, [source, rev, win.start, win.last]);

  /** Push a new state (tab, period and date changes each get a history entry). */
  const go = (next: Partial<SignalsQuery>) => {
    const merged: SignalsQuery = { ...q, ...next };
    setParams(new URLSearchParams(signalsSearch(merged)));
  };

  if (firstDate === null && rings.length === 0) {
    return (
      <Page>
        <EmptyStage
          title={C.emptyTitle}
          action={
            <>
              <KeyLink to={paths.ring} variant="solid">
                {C.connectRing}
              </KeyLink>{' '}
              <KeyLink to={paths.settings('devices')} variant="quiet">
                {C.importFile}
              </KeyLink>
            </>
          }
        >
          {C.emptyBody}
        </EmptyStage>
      </Page>
    );
  }

  const syncing = rings.find((r) => r.state === 'syncing');
  const ringRead = lastReadOf(rings);
  const readDay = ringRead !== null ? localDateOfMs(ringRead) : null;
  const notReadSince = !syncing && readDay !== null && readDay < win.start ? readDay : null;
  const lastReadAt = ringRead !== null || info.lastReadAt !== null ? Math.max(ringRead ?? -Infinity, info.lastReadAt ?? -Infinity) : null;
  const reading = syncing ? (syncing.syncProgress !== undefined ? Math.round(syncing.syncProgress * 100) : null) : false;
  const View = TAB_VIEW[q.tab];

  return (
    <Tabs value={q.tab} onChange={(t) => go({ tab: t as SignalsTab })}>
      <div className="sp-toolbar">
        <div className="sp-toolbar__inner">
          <TabList label={C.tabsLabel} className="sp-tabs">
            {SIGNALS_TABS.map((t) => (
              <Tab key={t} value={t}>
                {C.tabs[t]}
              </Tab>
            ))}
          </TabList>
          <PeriodBar
            tab={q.tab}
            window={win}
            today={today}
            referenceDay={refDay}
            firstDate={firstDate}
            datesWithData={withData}
            dateStyle={dateStyle}
            onPeriod={(period: PeriodKind) => go({ period })}
            onDate={(date: LocalDate | null) => go({ date })}
          />
        </div>
      </div>
      <Page>
        <TabPanel value={q.tab} className="sp-panel">
          {notReadSince ? (
            <InlineWarning
              severity="caution"
              className="sp-ringline"
              action={
                <KeyLink to={paths.ring} size="sm" variant="quiet">
                  {C.openRing}
                </KeyLink>
              }
            >
              {C.notReadSince(dayText(notReadSince, dateStyle, notReadSince.slice(0, 4) !== today.slice(0, 4)))}
            </InlineWarning>
          ) : null}
          <div className="sp-grid">
            <View key={q.tab} window={win} today={today} onDrill={(period, date) => go({ period, date })} />
          </div>
          <SourceLine tab={q.tab} labels={info.labels} lastReadAt={lastReadAt} reading={reading} dateStyle={dateStyle} />
        </TabPanel>
      </Page>
    </Tabs>
  );
}
