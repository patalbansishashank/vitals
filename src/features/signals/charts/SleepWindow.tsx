/**
 * When you slept (design/screens/ring-pages.md §7.3.5): a floating-bar actogram. y is clock time from 18:00 (top) to
 * 14:00 (bottom), extended in 4 h steps when a nap ends later; x is the nights of the week or month. Each night is a
 * 6 px bar from bed to wake; naps and other sessions are ink-3 bars in the slot of their date; the median bed and wake
 * are 1 px ink lines ("usually 23:45"). A missing night is a stub at the top; future nights draw nothing.
 */
import { useRef } from 'react';
import { useElementWidth } from '@/features/charts/core/hooks';
import { fmtDay } from '@/features/living/format';
import type { LocalDate } from '@/living';
import { coverageText, type PeriodKind } from '../models';
import { SLEEP_COPY as S, clockRange } from './copySleep';
import { ChartShell, MissingStub, TwinTable, useChartSizes, useSlotCrosshair } from './kit';
import { clockAt } from './ringData';
import { SlotTicks, bedWakeText } from './StageBars';
import { actoMinutes, actoSpanH, sixToClock, type NightColumn, type OtherSleep, type SleepStats } from './sleepModels';
import './sleep.css';

export interface SleepWindowProps {
  kind: 'week' | 'month';
  anchor: LocalDate;
  nights: readonly NightColumn[];
  stats: SleepStats;
  onDrill: (period: PeriodKind, date: LocalDate) => void;
}

const otherText = (o: OtherSleep): string =>
  `${o.kind === 'nap' ? S.nap : S.another} ${o.start !== null && o.end !== null ? clockRange(clockAt(o.start, o.offsetS), clockAt(o.end, o.offsetS)) : ''}`.trim();

function windowReadout(c: NightColumn): string {
  const parts = [S.nightTo(fmtDay(c.date))];
  if (!c.night) parts.push(S.noData);
  else {
    const bw = bedWakeText(c.night);
    parts.push(bw ? `${S.strip.inBed} ${bw}` : S.noTimes);
    if (c.night.provisional) parts.push(S.stillChanging);
  }
  for (const o of c.others) parts.push(otherText(o));
  return parts.join(' · ');
}

export function SleepWindow({ kind, anchor, nights, stats, onDrill }: SleepWindowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, 320) || 320;
  const sizes = useChartSizes();

  const spanH = actoSpanH(nights);
  const spanMin = spanH * 60;
  const h = sizes.secondary;
  const padL = sizes.tickCol, padR = 8, padT = 6, padB = kind === 'month' ? 18 : 30;
  const plotW = Math.max(40, width - padL - padR), plotH = h - padT - padB;
  const Y = (m: number) => padT + (Math.max(0, Math.min(spanMin, m)) / spanMin) * plotH;
  const n = Math.max(1, nights.length);
  const slotW = plotW / n;
  const colW = Math.min(24, slotW * 0.72);
  const cx = (i: number) => padL + slotW * (i + 0.5);
  const ticks: number[] = [];
  for (let m = 0; m <= spanMin; m += 240) ticks.push(m);

  const past = nights.filter((c) => !c.future).length;
  const anchorIdx = nights.findIndex((c) => c.date === anchor);
  const ch = useSlotCrosshair(past, anchorIdx >= 0 && anchorIdx < past ? anchorIdx : Math.max(0, past - 1));
  const slotAt = (x: number) => Math.floor((x - padL) / slotW);
  const drill = (i: number) => {
    const c = nights[i];
    if (c && !c.future) onDrill('day', c.date);
  };
  const cur = ch.slot === null ? null : (nights[ch.slot] ?? null);
  const readout = cur ? windowReadout(cur) : null;

  const usualBed = stats.medianBed !== null ? sixToClock(stats.medianBed) : null;
  const usualWake = stats.medianWake !== null ? sixToClock(stats.medianWake) : null;
  const summary = [
    S.title.window,
    coverageText(stats.recorded, stats.slots, 'nights'),
    usualBed && usualWake ? S.usualBedWake(usualBed, usualWake) : S.empty[kind],
  ].join('; ');

  return (
    <div ref={ref} className="sl-window">
      <ChartShell
        title={S.title.window}
        header={
          <span className="sl-head">
            <span>{coverageText(stats.recorded, stats.slots, 'nights')}</span>
            {usualBed && usualWake ? <span>{S.usualBedWake(usualBed, usualWake)}</span> : null}
          </span>
        }
        summary={summary}
        readout={readout}
        height={h + 18}
        emptyLine={stats.recorded === 0 && !nights.some((c) => c.others.length) ? S.empty[kind] : null}
        table={
          <TwinTable
            caption={S.tableWindow}
            head={[S.col.date, S.col.bed, S.col.up, S.col.other]}
            rows={nights
              .filter((c) => !c.future)
              .map((c) => {
                const timed = c.night && c.night.bed !== null && c.night.wake !== null;
                return [
                  c.night?.provisional ? `${fmtDay(c.date)} ${S.stillChangingTable}` : fmtDay(c.date),
                  timed ? clockAt(c.night!.bed!, c.night!.offsetS) : S.noData,
                  timed ? clockAt(c.night!.wake!, c.night!.offsetS) : S.noData,
                  c.others.map(otherText).join('; '),
                ];
              })}
          />
        }
      >
        <p className="sl-readout" aria-hidden="true">
          {readout ?? ' '}
        </p>
        <div
          className="sl-plot"
          role="img"
          aria-label={summary}
          tabIndex={past ? 0 : undefined}
          onKeyDown={(e) => ch.onKeyDown(e, drill)}
          onFocus={past ? ch.onFocus : undefined}
          onBlur={ch.onBlur}
          onPointerDown={ch.onPointerDown}
          onPointerMove={(e) => ch.onPointerMove(e, slotAt)}
          onPointerUp={(e) => ch.onPointerUp(e, slotAt, drill)}
          onPointerLeave={ch.onPointerLeave}
        >
          <svg className="sg-svg sl-svg" width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true" focusable="false">
            {ticks.map((m) => (
              <g key={m}>
                <line className="sg-grid" x1={padL} x2={padL + plotW} y1={Y(m)} y2={Y(m)} />
                <text className="sg-tick" x={padL - 5} y={Y(m) + 3.5} textAnchor="end">
                  {sixToClock(m).slice(0, 2)}
                </text>
              </g>
            ))}
            {nights.map((c, i) => {
              if (c.future) return null;
              const bars = c.others
                .filter((o) => o.start !== null && o.end !== null)
                .map((o) => {
                  const y1 = Y(actoMinutes(o.start!, o.offsetS, c.date)), y2 = Y(actoMinutes(o.end!, o.offsetS, c.date));
                  return <rect key={`o${o.start}`} className="sl-win-other" data-kind={o.kind} x={cx(i) - 3} y={y1} width={6} height={Math.max(2, y2 - y1)} rx={3} />;
                });
              if (!c.night) {
                return (
                  <g key={c.date}>
                    <MissingStub x={cx(i) - colW / 2} width={colW} baseline={padT + 4.5} label={`${fmtDay(c.date)}: ${S.noData}`} />
                    {bars}
                  </g>
                );
              }
              const nt = c.night;
              const y1 = nt.bed !== null ? Y(actoMinutes(nt.bed, nt.offsetS, c.date)) : null;
              const y2 = nt.wake !== null ? Y(actoMinutes(nt.wake, nt.offsetS, c.date)) : null;
              return (
                <g key={c.date}>
                  {y1 !== null && y2 !== null ? (
                    <rect
                      className="sl-win-night"
                      data-date={c.date}
                      data-provisional={nt.provisional ? 'true' : undefined}
                      opacity={nt.provisional ? 0.6 : undefined}
                      x={cx(i) - 3}
                      y={y1}
                      width={6}
                      height={Math.max(2, y2 - y1)}
                      rx={3}
                    />
                  ) : null}
                  {bars}
                </g>
              );
            })}
            {stats.medianBed !== null ? (
              <g className="sl-usual">
                <line x1={padL} x2={padL + plotW} y1={Y(stats.medianBed)} y2={Y(stats.medianBed)} />
                <text className="sg-label" x={padL + plotW} y={Y(stats.medianBed) - 3} textAnchor="end">
                  {S.usually(usualBed!)}
                </text>
              </g>
            ) : null}
            {stats.medianWake !== null ? (
              <g className="sl-usual">
                <line x1={padL} x2={padL + plotW} y1={Y(stats.medianWake)} y2={Y(stats.medianWake)} />
                <text className="sg-label" x={padL + plotW} y={Y(stats.medianWake) + 11} textAnchor="end">
                  {S.usually(usualWake!)}
                </text>
              </g>
            ) : null}
            <SlotTicks kind={kind} keys={nights.map((c) => c.date)} anchor={anchor} xAt={cx} y={padT + plotH + 13} />
            {ch.slot !== null ? <line className="sg-crosshair" x1={cx(ch.slot)} x2={cx(ch.slot)} y1={padT} y2={padT + plotH} /> : null}
          </svg>
        </div>
      </ChartShell>
    </div>
  );
}
