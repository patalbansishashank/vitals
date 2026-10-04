/**
 * Containers for the ring views. `RingDetailExtras` adds the matching view to a score detail: the night stages on the
 * sleep details, the heart-rate day chart on the resting-HR detail, and the overnight blood-oxygen and skin-temperature
 * charts on the night-vitals details. `ActivitySection` is the Progress faceplate with steps per day and workouts.
 * Data: stored records by kind through ./ringData.ts; nothing renders when the person has no such data at all.
 */
import { useMemo, useState } from 'react';
import { Faceplate, Key, KeyBank } from '@/components';
import { useToday } from '../../clock';
import { fmtDay } from '../../format';
import { RING_COPY as C } from './copy';
import { DayLine, NightStages, StepsBars, WorkoutsTable } from './RingViews';
import { localOffsetS, nightDates, nightModel, stepsDays, useResolvedDays, useSeriesWindow, useWorkouts, type NightModel } from './ringData';
import { addDays } from '@/living/dates';
import type { LocalDate } from '@/living';

const NIGHT_WINDOW = 60;
const SLEEP_IDS = /^sleep\./;
const RHR_IDS = new Set(['hr.rhr_night']);
const NIGHT_VITAL_IDS = new Set(['spo2.night', 'temp.deviation']);

/** Which ring view a score detail carries, if any. */
export function ringViewFor(scoreId: string): 'night' | 'hr' | 'vitals' | null {
  if (SLEEP_IDS.test(scoreId)) return 'night';
  if (RHR_IDS.has(scoreId)) return 'hr';
  if (NIGHT_VITAL_IDS.has(scoreId)) return 'vitals';
  return null;
}

function NightNav({ dates, value, onChange }: { dates: readonly LocalDate[]; value: LocalDate; onChange: (d: LocalDate) => void }) {
  const i = dates.indexOf(value);
  return (
    <div className="lv-ring-nav" role="group" aria-label={C.nightNav}>
      <Key size="sm" variant="quiet" disabled={i < 0 || i >= dates.length - 1} onClick={() => onChange(dates[i + 1]!)}>
        {C.earlier}
      </Key>
      <span className="lv-ring-nav__day">{fmtDay(value)}</span>
      <Key size="sm" variant="quiet" disabled={i <= 0} onClick={() => onChange(dates[i - 1]!)}>
        {C.later}
      </Key>
    </div>
  );
}

/** The night the views show: the newest main night unless the person picked another. */
function useNight(): { dates: LocalDate[]; date: LocalDate | null; setDate: (d: LocalDate) => void; night: NightModel | null; dayOf: (d: LocalDate) => ReturnType<typeof useResolvedDays>[number] | undefined } {
  const today = useToday();
  const days = useResolvedDays(today, NIGHT_WINDOW);
  const dates = useMemo(() => nightDates(days), [days]);
  const [picked, setDate] = useState<LocalDate | null>(null);
  const date = picked && dates.includes(picked) ? picked : (dates[0] ?? null);
  const day = date ? days.find((d) => d.localDate === date) : undefined;
  const night = useMemo(() => (day?.mainSleep ? nightModel(day.mainSleep) : null), [day]);
  return { dates, date, setDate, night, dayOf: (d) => days.find((x) => x.localDate === d) };
}

function NightFace() {
  const { dates, date, setDate, night } = useNight();
  return (
    <Faceplate title={date && date !== dates[0] ? C.nightOf(fmtDay(date)) : C.night} actions={date ? <NightNav dates={dates} value={date} onChange={setDate} /> : undefined}>
      {night ? <NightStages night={night} /> : <p className="lv-prog-state">{C.noNight}</p>}
    </Faceplate>
  );
}

function HrDayFace({ restingFallback }: { restingFallback?: number }) {
  const today = useToday();
  const days = useResolvedDays(today, NIGHT_WINDOW);
  const withRest = useMemo(() => days.filter((d) => d.daily?.resting_hr_bpm !== undefined || d.mainSleep).map((d) => d.localDate).sort().reverse(), [days]);
  const dates = withRest.length ? withRest : [today];
  const [picked, setPicked] = useState<LocalDate | null>(null);
  const date = picked && dates.includes(picked) ? picked : dates[0]!;
  const from = Date.parse(`${date}T00:00:00Z`) - localOffsetS(Date.parse(`${date}T12:00:00Z`)) * 1000;
  // the next midnight, not +24 h: a day with a clock change is 23 or 25 hours long
  const next = addDays(date, 1);
  const to = Date.parse(`${next}T00:00:00Z`) - localOffsetS(Date.parse(`${next}T12:00:00Z`)) * 1000;
  const s = useSeriesWindow('hr', from, to, [date]);
  const day = days.find((d) => d.localDate === date);
  const rest = day?.daily?.resting_hr_bpm ?? (date === dates[0] ? restingFallback : undefined);
  return (
    <Faceplate title={C.hrDay} actions={<NightNav dates={dates} value={date} onChange={setPicked} />}>
      <DayLine
        points={s.points}
        status={s.status}
        from={from}
        to={to}
        offsetS={localOffsetS(from + 12 * 3_600_000)}
        unit="bpm"
        title={fmtDay(date)}
        hue="cardio"
        empty={C.hrDayEmpty}
        {...(rest !== undefined ? { reference: { value: Math.round(rest), label: C.resting(Math.round(rest)) } } : {})}
      />
    </Faceplate>
  );
}

function NightVitalsFace() {
  const { dates, date, setDate, night } = useNight();
  const from = night ? night.start : null, to = night ? night.end : null;
  const span = night ? [...new Set([new Date(night.start + night.offsetS * 1000).toISOString().slice(0, 10), night.date])] : [];
  const spo2 = useSeriesWindow('spo2', from, to, span);
  const temp = useSeriesWindow('skin_temp', from, to, span);
  return (
    <Faceplate title={C.nightVitals} actions={date ? <NightNav dates={dates} value={date} onChange={setDate} /> : undefined}>
      {night ? (
        <>
          <DayLine points={spo2.points} status={spo2.status} from={night.start} to={night.end} offsetS={night.offsetS} unit="%" title={C.spo2} hue="recovery" empty={C.spo2Empty} />
          <DayLine points={temp.points} status={temp.status} from={night.start} to={night.end} offsetS={night.offsetS} unit="°C" decimals={1} title={C.skinTemp} hue="recovery" empty={C.tempEmpty} />
        </>
      ) : (
        <p className="lv-prog-state">{C.noNight}</p>
      )}
    </Faceplate>
  );
}

export function RingDetailExtras({ scoreId, lastNight, unit }: { scoreId: string; lastNight?: number; unit?: string }) {
  const view = ringViewFor(scoreId);
  if (view === 'night') return <NightFace />;
  if (view === 'hr') return <HrDayFace {...(lastNight !== undefined && unit === 'bpm' ? { restingFallback: lastNight } : {})} />;
  if (view === 'vitals') return <NightVitalsFace />;
  return null;
}

type StepsRange = '7d' | '28d';
const WORKOUT_DAYS = 90;

export function ActivitySection({ id = 'activity' }: { id?: string }) {
  const today = useToday();
  const [range, setRange] = useState<StepsRange>('7d');
  const n = range === '7d' ? 7 : 28;
  const days = useResolvedDays(today, 28);
  const steps = useMemo(() => stepsDays(days, today, n), [days, today, n]);
  const workouts = useWorkouts(today, WORKOUT_DAYS);
  return (
    <>
      <Faceplate
        id={id}
        className="lv-prog-face"
        title={C.steps}
        actions={
          <KeyBank<StepsRange>
            size="sm"
            label={C.stepsRangeLabel}
            value={range}
            onChange={setRange}
            options={(['7d', '28d'] as const).map((r) => ({ value: r, label: C.stepsRange[r] }))}
          />
        }
      >
        <StepsBars days={steps} today={steps[steps.length - 1] ?? null} />
      </Faceplate>
      <Faceplate id={`${id}-workouts`} className="lv-prog-face" title={C.workouts}>
        <WorkoutsTable rows={workouts} />
      </Faceplate>
    </>
  );
}
