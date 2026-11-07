/**
 * The Signals card of the Ring overview (r071, AUDIT card 3): the first reading in the person's list is the card's hero
 * (the number, today's spark, its word and the range that word stands for), the others are rows (a reading on its scale, or
 * a plain value), "Measure now" and "Edit" are the foot's two keys, and Edit opens the card library (the same sheet Today
 * uses to add cards), grouped by what a signal is about. Quiet: words and the marker's place, no figure.
 */
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { HeartPulse } from 'lucide-react';
import { CardFoot, CardHead, CardLibrary, GradientCard, type LibraryItem } from '@/components';
import { useEnergyUnit, useQuietMode } from '@/state/settingsStore';
import { progressActualsAdapter, progressActualsRevision, subscribeProgressActuals } from '@/features/living/progress/v3Adapter';
import { RING_COPY as C } from '../copy';
import { useTimeline } from '../data';
import { useActivityDayZones } from '../dayZones';
import { useEnergyFigures } from '../planEnergy';
import type { RingDay } from '../day';
import { RING_DOMAIN } from '../domains';
import { signalsInfo } from '../info/overview';
import { calendarDate } from '../model';
import { MONITOR_DEFAULT, availableSources, entriesByGroup, entryOf, groupOf, offeredEntries, shownIds, type MonitorEntry } from '../monitor/catalogue';
import { setRingMonitor, useRingMonitor } from '../monitor/store';
import { entryText, entryValue, personal, type MonitorCtx } from '../monitor/values';
import { ringPaths } from '../paths';
import { statusWord } from '../signalWords';
import { useNow } from '../useGauge';
import { MeasureKey } from '../components/MeasureKey';
import { Loading, useUnitPrefs } from '../components/parts';
import { PlainRow, SignalHero, SignalRow, pickHero, signalStatus } from '../components/SignalRows';
import './overview.css';

// ---------------------------------------------------------------------------------------------------------------
// Signals

/** Where a non-reading entry's row leads. */
function entryLink(e: MonitorEntry, date: string): string {
  if (e.metric) return ringPaths.signal(e.metric, date);
  if (e.source === 'sleep') return ringPaths.tab('sleep', date);
  if (e.id === 'peakHr' || e.id === 'nonExerciseHr') return ringPaths.signal('hr', date);
  if (e.source === 'indices') return ringPaths.tab('scores', date);
  return ringPaths.tab('activity', date);
}

/**
 * (0.6.3 S23) The day's energy for the monitor: today's from Today's engine run (actual so far plus the plan's remainder:
 * "by bedtime"), an earlier day's total from Progress's realised history; null when neither has it.
 */
function useDayEnergy(date: string, today: string): MonitorCtx['energy'] {
  const f = useEnergyFigures(date);
  const rev = useSyncExternalStore(
    subscribeProgressActuals,
    progressActualsRevision,
    progressActualsRevision,
  );
  const past = useMemo(() => {
    if (date >= today) return null;
    try {
      return (
        progressActualsAdapter().progressActuals(date as never, date as never)?.[0]?.energyOut?.kcal ?? null
      );
    } catch {
      return null;
    }
    // `rev` re-reads when more history arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, today, rev]);
  if (date === today && f && (f.totalKcal !== null || f.activeKcal !== null))
    return { totalKcal: f.totalKcal, activeKcal: f.activeKcal, byBedtime: true };
  return past !== null ? { totalKcal: past, activeKcal: null, byBedtime: false } : null;
}

/** The signals the person monitors, in their order (the default set until they edit it). */
export function SignalsCard({ date, day, infoFooter }: { date: string; day: RingDay; infoFooter?: ReactNode }) {
  const prefs = useUnitPrefs();
  const quiet = useQuietMode().on;
  const now = useNow();
  const stored = useRingMonitor();
  const timeline = useTimeline(date);
  const zones = useActivityDayZones(date);
  const eu = useEnergyUnit();
  const today = calendarDate(now);
  const energy = useDayEnergy(date, today);
  // eligibility: the engine's day exists (Today's run), an approved activity in the load window
  const energyOn = useEnergyFigures(today) !== null || energy !== null;
  const loadOn = !!day.load && (day.load.load.status === 'inferred' || day.load.load.perBout.length > 0);
  const [open, setOpen] = useState(false);
  const offered = offeredEntries(availableSources({ timeline: timeline.status === 'ready', energy: energyOn, load: loadOn }), quiet);
  const ids = shownIds(stored, offered);
  const ctx: MonitorCtx = {
    daily: day.daily,
    baselines: day.baselines,
    night: day.night,
    scores: day.scores,
    steps: day.steps,
    zones,
    prefs,
    now,
    energy,
    energyUnit: eu,
    load: day.load,
  };
  const base = personal(day.baselines);
  const emptyChoice = stored !== null && stored.filter((id) => offered.some((e) => e.id === id)).length === 0;
  const facts = ids.map((id) => {
    const e = entryOf(id)!;
    const v = entryValue(id, ctx);
    const status = signalStatus(e, v, base);
    return { id, e, v, status, word: status ? statusWord(status, quiet) : null };
  });
  const hero = pickHero(facts, quiet);
  const rows = facts.filter((f) => f !== hero);
  const ready = day.q.status === 'ready';
  // the sheet: every signal this build offers, by group; it starts from what the card shows (the default set while the stored order is absent or empty)
  const items: LibraryItem[] = entriesByGroup(offered).map((e) => {
    const g = groupOf(e.id)!;
    const v = entryValue(e.id, ctx);
    return { id: e.id, label: e.label, icon: e.icon, hue: g.domain, group: g.group, valueText: entryText(v), calibrating: v.calibrating, default: MONITOR_DEFAULT.includes(e.id) };
  });
  return (
    <GradientCard
      as="section"
      domain={RING_DOMAIN.signals}
      glow="tr"
      head={<CardHead as="h2" icon={HeartPulse} title={C.signals} info={signalsInfo({ quiet, prefs, footer: infoFooter })} />}
      foot={
        ready ? (
          <CardFoot link={{ onClick: () => setOpen(true), label: emptyChoice ? C.addSignals : C.editSignals }}>
            {/* heart rate on demand: the card's one action, there while heart rate is among the signals (even with no reading yet: that is when it is needed) */}
            {ids.includes('hr') ? <MeasureKey /> : null}
          </CardFoot>
        ) : undefined
      }
    >
      {day.q.status === 'loading' ? <Loading lines={4} /> : null}
      {ready ? (
        <>
          {hero ? <SignalHero entry={hero.e} value={hero.v} status={hero.status} date={date} today={today} base={base} prefs={prefs} quiet={quiet} /> : null}
          <ul className="rgo-rows" data-after-hero={hero ? '' : undefined}>
            {rows.map(({ id, e, v, status }) =>
              e.metric && v.reading !== null ? (
                <SignalRow key={id} kind={e.metric} label={e.label} to={entryLink(e, date)} value={v.reading} base={base} age={v.age} prefs={prefs} status={v.chip} />
              ) : (
                <PlainRow key={id} label={e.label} to={entryLink(e, date)} value={v.text} unit={v.unit} chip={status ?? v.chip} />
              ),
            )}
          </ul>
        </>
      ) : null}
      {open ? (
        <CardLibrary
          open
          onOpenChange={setOpen}
          title="Edit signals"
          items={items}
          selected={ids.map((id) => ({ id }))}
          defaultSelected={MONITOR_DEFAULT.filter((id) => offered.some((e) => e.id === id)).map((id) => ({ id }))}
          onChange={(next) => setRingMonitor(next.map((s) => s.id))}
          onReset={() => setRingMonitor(null)}
          quiet={quiet}
        />
      ) : null}
    </GradientCard>
  );
}
