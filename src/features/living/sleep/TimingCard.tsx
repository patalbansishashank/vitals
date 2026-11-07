/**
 * Timing (r071, AUDIT card 24): WHEN the night happened, drawn: the window bar from 20:00 to 12:00 with last night as the
 * bright band, the person's usual window behind it as an outline, the moments it began and ended as ticks; the midpoint is
 * the one number. The three small facts that used to be tiles are one line of mono caps, and the words that used to be
 * four sentences are the foot (how far from usual) and the (i). "Add lights-out time" is the card's one verb.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Clock3, MoonStar } from 'lucide-react';
import { CardFoot, CardHead, ChartTwin, GradientCard, HeroNumber, Key, MonoMeta, WindowBar, formatNumber } from '@/components';
import { circDiffMin, localClockMin } from '@/living/sensors';
import { clockOf } from '@/features/ring/model';
import type { GaugeBaselines } from '@/features/ring/types';
import { SLEEP_COPY as C } from './copy';
import { EntryPanel } from './EntryPanel';
import { timingInfo } from './info';
import { continuityShown, timingTwin, timingWindows, usualRangeText, vsPlanWords, vsUsualClock, vsUsualWords, type NightView } from './model';
import { CalibratingChip, FactRow } from './parts';
import './sleep.css';

/** How the night's own clock sits against the person's usual one: "39 min later than usual" (quiet: "later than usual"), null while the usual forms. */
function clockVsUsual(iso: string | null | undefined, usual: GaugeBaselines['usualOnset'] | undefined, quiet: boolean): string | null {
  const min = localClockMin(iso);
  if (min === null || !usual || usual.minutes === null || usual.suppressed) return null;
  const d = circDiffMin(min, usual.minutes);
  const w = quiet ? vsUsualWords(d) : vsUsualClock(d);
  return w ? lowerFirst(w) : null;
}

const lowerFirst = (t: string): string => t.charAt(0).toLowerCase() + t.slice(1);
const lowerWord = (t: string | null): string | null => (t ? lowerFirst(t) : null);

export function TimingCard({ v, baselines, date, quiet, infoFooter }: { v: NightView; baselines: GaugeBaselines | null; date: string; quiet: boolean; infoFooter?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const m = v.metrics;
  const w = useMemo(() => timingWindows(v, baselines), [v, baselines]);
  const twin = useMemo(() => (quiet ? undefined : <ChartTwin data={timingTwin(v, baselines)} />), [quiet, v, baselines]);
  if (!m) return null;
  const j = v.joined;
  const mid = m.midpoint ? clockOf(m.midpoint) : null;
  const midWord = v.learning ? null : j?.vsUsual.midpointMin != null ? (quiet ? vsUsualWords : vsUsualClock)(j.vsUsual.midpointMin) : null;
  const usualText = v.learning ? null : usualRangeText(baselines);
  const usualNights = Math.max(baselines?.usualOnset?.n ?? 0, baselines?.usualWake?.n ?? 0) || null;
  const continuity = continuityShown(m);
  const lat = j?.latency;
  // how far each moment was from the plan's sleep window when the plan sets one, else from the person's usual one
  const plan = j?.vsPlan;
  const onsetWord = plan ? (quiet ? lowerWord(vsPlanWords(plan.onsetMin)) : plan.text.onset) : v.learning ? null : clockVsUsual(m.onset, baselines?.usualOnset, quiet);
  const wakeWord = plan ? (quiet ? lowerWord(vsPlanWords(plan.wakeMin)) : plan.text.wake) : v.learning ? null : clockVsUsual(m.finalWake, baselines?.usualWake, quiet);
  // the two ends are named by their clock, the midpoint is a bare notch between them
  const marks = [
    ...(m.onset ? [{ t: Date.parse(m.onset), label: clockOf(m.onset) }] : []),
    ...(m.finalWake ? [{ t: Date.parse(m.finalWake), label: clockOf(m.finalWake) }] : []),
    ...(w.midpoint ? [{ t: w.midpoint, label: '' }] : []),
  ].filter((k) => Number.isFinite(k.t));
  const figures = quiet
    ? []
    : [
        m.leadingWakeMin != null ? `Settle ${formatNumber(m.leadingWakeMin, 0)} min` : null,
        continuity ? `Continuity ${continuity.text}\u00a0%` : null,
        m.wakeUps != null ? `Wake-ups ${formatNumber(m.wakeUps, 0)}${m.wasoMin != null ? ` (${formatNumber(Math.round(m.wasoMin), 0)} min)` : ''}` : null,
      ];
  const own = !quiet && lat?.status === 'attested' ? [lat.latencyMin !== null ? `${C.latency} ${formatNumber(lat.latencyMin, 0)} min` : null, lat.efficiencyPct !== null ? `${C.efficiency} ${formatNumber(lat.efficiencyPct, 0)}\u00a0%` : null, C.fromYourTimes] : [];
  const info = timingInfo({ usualText, usualNights, quiet, twin, footer: infoFooter });
  const detail = [onsetWord ? `${C.fellAsleep} ${onsetWord}` : null, wakeWord ? `${C.woke} ${wakeWord}` : null, ...figures].filter((f): f is string => !!f);
  return (
    <>
      <GradientCard
        as="section"
        domain="sleep"
        head={<CardHead as="h2" icon={Clock3} title={C.timing} info={{ ...info, terms: [...(info.terms ?? []), ...(detail.length ? [{ term: 'This night', text: detail.join(' · ') }] : [])] }} />}
        foot={
          <>
            <CardFoot state={midWord ? { word: midWord } : undefined} right={usualText && !quiet ? C.usualWord(usualText) : undefined} />
            <div className="sl-actions">
              <Key variant="action" size="sm" icon={MoonStar} onClick={() => setOpen(true)}>
                {lat?.status === 'attested' ? C.changeTimes : C.addLightsOut}
              </Key>
            </div>
          </>
        }
      >
        {v.learning ? <CalibratingChip learning={v.learning} quiet={quiet} /> : null}
        {mid && !quiet ? (
          <div className="sl-timing__hero">
            <HeroNumber value={mid} size="time" label={`Sleep midpoint ${mid}`} />
            <MonoMeta tone="hue">{C.midpoint}</MonoMeta>
          </div>
        ) : null}
        <WindowBar label="Sleep timing" axis={w.axis} usual={w.usual ?? undefined} actual={w.actual ?? undefined} marks={marks} quiet={quiet} />
        <FactRow items={own} />
      </GradientCard>
      {open ? <EntryPanel open onClose={() => setOpen(false)} date={date} onset={m.onset} wake={m.finalWake} /> : null}
    </>
  );
}
