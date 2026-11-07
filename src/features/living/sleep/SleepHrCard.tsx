/**
 * Sleep heart rate (r071, AUDIT card 26): the night's heart rate as ONE line (`GlowLine`): the sleeping low as the number,
 * its word against the person's usual, the trace with the awake stretches hatched and the lowest five minutes marked, and
 * one line of facts under it. A night too sparse to draw says so in words instead of a line that is not there. The table of
 * readings is in the (i). Quiet: the line without labels, "lowest" in a part of the night, no figure.
 */
import { useMemo, type ReactNode } from 'react';
import { HeartPulse } from 'lucide-react';
import { CardFoot, CardHead, ChartTwin, GlowLine, GradientCard, HeroNumber, MonoMeta, formatNumber, lineTwin } from '@/components';
import { partOfDay } from '@/features/ring/quiet';
import { minutesText } from '@/features/ring/model';
import type { GaugeBaselines } from '@/features/ring/types';
import { SLEEP_COPY as C } from './copy';
import { sleepHrInfo } from './info';
import { avgReadings, hrTrendFact, sleepHrLine, usualLowHrRange, type NightView } from './model';
import { CalibratingChip, FactRow } from './parts';
import './sleep.css';

export function SleepHrCard({ v, baselines, quiet, infoFooter }: { v: NightView; baselines: GaugeBaselines | null; quiet: boolean; infoFooter?: ReactNode }) {
  const m = v.metrics;
  const line = useMemo(() => sleepHrLine(v), [v]);
  const drawn = v.onset !== null && v.wake !== null && v.hr.points.length > 0 && !v.hr.sparse;
  const label = 'Heart rate overnight';
  const twin = useMemo(() => (drawn && !quiet ? <ChartTwin data={lineTwin({ label, unit: 'bpm', series: line.series, from: v.onset!, to: v.wake!, decimals: 0 })} /> : undefined), [drawn, quiet, line, v.onset, v.wake]);
  if (!m) return null;
  const lowWord = v.joined?.vsUsual.lowHrWord ?? null;
  const avg = m.avgSleepHr ?? m.sampledMeanSleepHr?.bpm ?? null;
  const sampled = m.avgSleepHr == null && m.sampledMeanSleepHr != null;
  // A.1.1 #17: n always shown, for the time-weighted average as for the sampled one (Codex UI #28)
  const readings = sampled ? m.sampledMeanSleepHr!.n : avgReadings(m);
  const usual = v.learning ? null : usualLowHrRange(baselines);
  const trend = v.hr.trend && drawn ? hrTrendFact(v.hr.trend) : null;
  const low = v.hr.low;
  // quiet: the word against the usual stands where the number would
  const quietLow = lowWord ?? (v.learning ? 'Still learning' : 'Resting low');
  return (
    <GradientCard
      as="section"
      domain="heart"
      head={<CardHead as="h2" icon={HeartPulse} title={C.sleepHr} info={sleepHrInfo({ readings, usualText: usual, quiet, twin, footer: infoFooter })} />}
      foot={<CardFoot state={trend ? { word: trend } : undefined} right={usual && !quiet ? C.usualWord(`${usual} bpm`) : undefined} />}
    >
      <div className="sl-hr__hero">
        <HeroNumber
          value={m.nightlyLowHrP10 ?? null}
          unit="bpm"
          size="num-l"
          label={quiet ? quietLow : m.nightlyLowHrP10 != null ? `${C.lowHr} ${formatNumber(m.nightlyLowHrP10, 0)} beats per minute` : `${C.lowHr}: no reading`}
          quietWord={quiet ? quietLow : undefined}
        />
        <FactRow items={[C.lowHr, quiet ? null : lowWord]} tone="hue" />
      </div>
      {v.learning ? <CalibratingChip learning={v.learning} quiet={quiet} /> : null}
      {drawn ? (
        <GlowLine
          label={label}
          unit="bpm"
          series={line.series}
          from={v.onset!}
          to={v.wake!}
          spans={line.spans}
          marks={line.marks}
          band="iqr"
          smoothing="night"
          yTicks={3}
          xTicks="hours"
          endDot="static"
          height={140}
          quiet={quiet}
        />
      ) : (
        <MonoMeta as="p" className="sl-hr__none">
          {v.hr.points.length === 0 ? 'No heart rate overnight' : C.tooFew}
        </MonoMeta>
      )}
      <FactRow
        items={
          quiet
            ? [low && drawn ? `Lowest ${partOfDay(low.t)}` : null]
            : [
                avg !== null ? `${sampled ? 'Sampled avg' : 'Avg'} ${formatNumber(avg, 0)} bpm` : null,
                avg !== null ? (readings !== null ? C.readings(readings) : C.readingsUnknown) : null,
                m.timeToLowMin != null ? `${C.timeToLow} ${minutesText(m.timeToLowMin)}` : null,
              ]
        }
      />
    </GradientCard>
  );
}
