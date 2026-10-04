/**
 * Body signals › Sleep (design/screens/ring-pages.md §6.5–6.8 order table, §7.3). A night belongs to its wake date.
 *
 * day:          night summary strip → night stages + overnight lanes (one crosshair) → stage minutes → naps
 * week / month: stacked stage bars → when you slept → numbers
 * year:         monthly stage bars → numbers
 *
 * Every period faceplate counts coverage over the slots up to today; missing nights are stubs and never enter an
 * average; future slots draw nothing.
 */
import { useMemo } from 'react';
import { Faceplate } from '@/components';
import { addDays } from '@/living/dates';
import type { LocalDate } from '@/living';
import { NORMAL_DAYS } from '../charts/heartModels';
import { useBaselines, useDays, useSeries, useSignalsPerson } from '../data';
import type { PeriodWindow } from '../models';
import { NapList } from '../charts/NapList';
import { NightChannels } from '../charts/NightChannels';
import { NightSummary, PeriodNumbers } from '../charts/NightSummary';
import { SleepWindow } from '../charts/SleepWindow';
import { StageBars } from '../charts/StageBars';
import { StageMinutes } from '../charts/StageMinutes';
import {
  MIN_MS,
  datesTouched,
  monthColumns,
  nightColumns,
  sleepDayMap,
  sleepStats,
  spo2Band,
  tempNormalC,
} from '../charts/sleepModels';
import '../charts/sleep.css';
import type { TabProps } from './types';

export function SleepTab(props: TabProps) {
  const { window: w } = props;
  if (w.kind === 'day') return <SleepDayView key={w.start} {...props} />;
  if (w.kind === 'year') return <SleepYearView {...props} />;
  return <SleepPeriodView {...props} />;
}

const NO_DATES: LocalDate[] = [];

function SleepDayView({ window: w }: TabProps) {
  const date = w.start;
  const days = useDays(date, date);
  // the same window and rule as the Heart tab's normal (heartModels.tempNormal), so both tabs agree
  const prior = useDays(addDays(date, -NORMAL_DAYS), date);
  const person = useSignalsPerson();
  const baselines = useBaselines();
  const sd = useMemo(() => sleepDayMap(days).get(date) ?? null, [days, date]);
  const night = sd?.night ?? null;

  const from = night?.bed != null ? night.bed - 30 * MIN_MS : null;
  const to = night?.wake != null ? night.wake + 30 * MIN_MS : null;
  const offsetS = night?.offsetS ?? 0;
  const dates = useMemo(() => (from !== null && to !== null ? datesTouched(from, to, offsetS) : NO_DATES), [from, to, offsetS]);
  const hr = useSeries('hr', from, to, dates);
  const spo2 = useSeries('spo2', from, to, dates);
  const temp = useSeries('skin_temp', from, to, dates);
  const normal = useMemo(() => tempNormalC(baselines, prior), [baselines, prior]);
  const band = useMemo(() => spo2Band(baselines), [baselines]);

  return (
    <div className="sl-tab" data-period="day">
      <NightSummary night={night} vendorSleep={sd?.vendorSleep ?? null} showVendor={person.vendorScores} />
      <Faceplate>
        <NightChannels
          night={night}
          date={date}
          hr={hr}
          spo2={spo2}
          temp={temp}
          tempNormalC={normal}
          tempUnit={person.tempUnit}
          spo2Band={band}
        />
      </Faceplate>
      {night || sd?.others.length ? (
        <div className="sl-pair">
          {night ? (
            <Faceplate>
              <StageMinutes night={night} />
            </Faceplate>
          ) : null}
          {sd?.others.length ? (
            <Faceplate>
              <NapList others={sd.others} />
            </Faceplate>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function usePeriodDays(w: PeriodWindow) {
  const days = useDays(w.start, w.last);
  return useMemo(() => sleepDayMap(days), [days]);
}

function SleepPeriodView({ window: w, onDrill }: TabProps) {
  const kind = w.kind as 'week' | 'month';
  const byDate = usePeriodDays(w);
  const person = useSignalsPerson();
  const cols = useMemo(() => nightColumns(w, byDate), [w, byDate]);
  const stats = useMemo(() => {
    const past = cols.filter((c) => !c.future);
    return sleepStats(
      past.map((c) => c.night),
      past.length,
      past.reduce((a, c) => a + c.others.length, 0),
    );
  }, [cols]);
  return (
    <div className="sl-tab" data-period={kind}>
      <Faceplate>
        <StageBars kind={kind} anchor={w.anchor} nights={cols} goalH={person.goals.sleepH} stats={stats} onDrill={onDrill} />
      </Faceplate>
      <div className="sl-pair">
        <Faceplate>
          <SleepWindow kind={kind} anchor={w.anchor} nights={cols} stats={stats} onDrill={onDrill} />
        </Faceplate>
        <Faceplate>
          <PeriodNumbers kind={kind} stats={stats} />
        </Faceplate>
      </div>
    </div>
  );
}

function SleepYearView({ window: w, today, onDrill }: TabProps) {
  const byDate = usePeriodDays(w);
  const person = useSignalsPerson();
  const months = useMemo(() => monthColumns(w, byDate, today), [w, byDate, today]);
  const stats = useMemo(() => {
    const nights = [];
    let naps = 0;
    for (const m of months) {
      if (m.future) continue;
      for (let i = 0; i < m.days; i++) {
        const d = byDate.get(addDays(m.start, i));
        nights.push(d?.night ?? null);
        naps += d?.others.length ?? 0;
      }
    }
    return sleepStats(nights, nights.length, naps);
  }, [months, byDate]);
  return (
    <div className="sl-tab" data-period="year">
      <Faceplate>
        <StageBars kind="year" anchor={w.anchor} months={months} goalH={person.goals.sleepH} stats={stats} onDrill={onDrill} />
      </Faceplate>
      <Faceplate>
        <PeriodNumbers kind="year" stats={stats} />
      </Faceplate>
    </div>
  );
}
