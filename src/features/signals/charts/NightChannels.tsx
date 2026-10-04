/**
 * The night as a channel stack (design/screens/ring-pages.md §7.3.2; CHART_SPEC §4, §5.1): the stage rows and the
 * overnight heart-rate, blood-oxygen and skin-temperature lanes on one clock axis (30 min before bed to 30 min after
 * wake) with one crosshair through all of them. The crosshair stops on 5-minute buckets; the table twin lists the same
 * buckets, so a readout never holds a value the table lacks. A lane with no readings collapses to one 24 px line; a gap
 * in a line is a gap (no interpolation). Blood oxygen and skin temperature are tier C (ring-pages.md D6): drawn as
 * change from the person's normal around a zero line labelled "your normal"; the absolute blood oxygen is in the table
 * only. Until the blood-oxygen normal has formed (14 nights) its lane shows the absolute line.
 */
import { useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Key, formatNumber, formatSigned } from '@/components';
import { useElementWidth } from '@/features/charts/core/hooks';
import { addDays } from '@/living/dates';
import type { LocalDate } from '@/living';
import { RING_COPY } from './copy';
import { SLEEP_COPY as S, durShort } from './copySleep';
import { CHART_NAV_HELP, ChartShell, HatchDefs, TwinTable, useChartSizes, useSlotCrosshair } from './kit';
import { StageRows, onlyUnknownStages, useHatchId } from './NightStages';
import { clockAt, localOffsetS, runsOf, type SeriesPoint } from './ringData';
import { BUCKET_MS, HOUR_MS, MIN_MS, gapThresholdMs, laneScale, nightBuckets, type NightBucket, type SleepNight } from './sleepModels';
import './sleep.css';

export interface LaneData {
  status: 'loading' | 'ready' | 'failed';
  points: readonly SeriesPoint[];
  stale?: boolean;
  retry?: () => void;
}

export interface NightChannelsProps {
  /** The main night of the date; null = no night recorded. */
  night: SleepNight | null;
  /** Wake date (frames the empty state). */
  date: LocalDate;
  hr: LaneData;
  spo2: LaneData;
  /** Absolute skin temperature samples (°C); drawn as change from `tempNormalC`. */
  temp: LaneData;
  /** The person's normal skin temperature (°C); null = not known (the lane says so). */
  tempNormalC: number | null;
  tempUnit: 'C' | 'F';
  /** The person's normal blood oxygen (%), only once it has 14 nights; the lane is drawn as change from it. */
  spo2NormalPct: number | null;
  header?: ReactNode;
}

type LaneKey = 'hr' | 'spo2' | 'temp';

interface LaneLayout {
  key: LaneKey;
  top: number;
  /** Total rows height (label row + plot, or the collapsed row). */
  height: number;
  /** A one-line row instead of a plot. */
  note: string | null;
  points: SeriesPoint[];
  plotTop: number;
  plotH: number;
  lo: number;
  hi: number;
  ticks: number[];
  Y: (v: number) => number;
}

const PAD_L = 64, PAD_R = 8, TOP_ROW = 16, AXIS_ROW = 18, LABEL_ROW = 16, COLLAPSED = 24, GAP = 10;

const inRange = (pts: readonly SeriesPoint[], a: number, b: number) => pts.filter((p) => p.t >= a && p.t <= b);

export function NightChannels({ night, date, hr, spo2, temp, tempNormalC, tempUnit, spo2NormalPct, header }: NightChannelsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, 320) || 320;
  const sizes = useChartSizes();
  const hatchId = useHatchId();
  const timed = night !== null && night.bed !== null && night.wake !== null;

  // x: 30 min either side of the night; without one, an empty 22:00 → 08:00 frame at the browser's offset
  const fallbackOffset = localOffsetS(Date.parse(`${date}T00:00:00Z`));
  const offsetS = timed ? night.offsetS : fallbackOffset;
  const x0 = timed ? night.bed! - 30 * MIN_MS : Date.parse(`${addDays(date, -1)}T22:00:00Z`) - fallbackOffset * 1000;
  const x1 = timed ? night.wake! + 30 * MIN_MS : x0 + 10 * HOUR_MS;
  const plotW = Math.max(40, width - PAD_L - PAD_R);
  const X = (t: number) => PAD_L + ((t - x0) / (x1 - x0)) * plotW;

  const k = tempUnit === 'F' ? 1.8 : 1;
  const spo2Abs = useMemo(() => inRange(spo2.points, x0, x1), [spo2.points, x0, x1]);
  const spo2Rel = spo2NormalPct !== null;
  const pts = useMemo(
    () => ({
      hr: inRange(hr.points, x0, x1),
      spo2: spo2NormalPct === null ? spo2Abs : spo2Abs.map((p) => ({ t: p.t, v: p.v - spo2NormalPct })),
      temp: tempNormalC === null ? [] : inRange(temp.points, x0, x1).map((p) => ({ t: p.t, v: (p.v - tempNormalC) * k })),
    }),
    [hr.points, spo2Abs, spo2NormalPct, temp.points, x0, x1, tempNormalC, k],
  );

  /* ---------------------------------------------------------------- vertical layout */
  const rowH = sizes.stageRow, laneH = sizes.lane;
  const stagesTop = TOP_ROW;
  let y = stagesTop + rowH * 5 + GAP;
  const lanes: LaneLayout[] = [];
  if (timed) {
    const inputs: Record<LaneKey, LaneData> = { hr, spo2, temp };
    for (const key of ['hr', 'spo2', 'temp'] as const) {
      const d = inputs[key];
      const p = pts[key];
      const showing = p.length > 0 && (d.status === 'ready' || d.stale);
      let note: string | null = null;
      if (!showing) {
        if (d.status === 'failed') note = S.laneFailed;
        else if (d.status === 'loading') note = S.laneReading;
        else if (key === 'temp' && tempNormalC === null && temp.points.length > 0) note = S.tempNoNormal;
        else note = S.laneEmpty[key];
      }
      if (note) {
        // while reading, the lane keeps its full height (no layout shift); an empty lane collapses to one line
        const height = d.status === 'loading' ? LABEL_ROW + laneH : COLLAPSED;
        const at = y;
        lanes.push({ key, top: at, height, note, points: [], plotTop: at, plotH: 0, lo: 0, hi: 1, ticks: [], Y: () => at });
        y += height + 4;
        continue;
      }
      const vals = p.map((q) => q.v);
      const sc =
        key === 'hr'
          ? laneScale(vals, { minSpan: 10 })
          : key === 'spo2'
            ? laneScale(vals, { include: spo2Rel ? [0] : [], minSpan: 4 })
            : laneScale(vals, { include: [0], minSpan: 0.5 * k });
      const plotTop = y + LABEL_ROW;
      const top = plotTop + 2, bottom = plotTop + laneH - 2;
      lanes.push({
        key, top: y, height: LABEL_ROW + laneH, note: null, points: p, plotTop, plotH: laneH, ...sc,
        Y: (v: number) => bottom - ((v - sc.lo) / (sc.hi - sc.lo)) * (bottom - top),
      });
      y += LABEL_ROW + laneH + 4;
    }
  }
  const lanesBottom = y - 4;
  const h = y + AXIS_ROW;

  /* ---------------------------------------------------------------- crosshair */
  // the buckets hold the absolute blood oxygen (the table's column); the readout and the dot take the change
  const buckets = useMemo(() => (timed ? nightBuckets(x0, x1, night, { ...pts, spo2: spo2Abs }) : []), [timed, x0, x1, night, pts, spo2Abs]);
  const home = Math.max(0, buckets.findIndex((b) => b.inNight));
  const ch = useSlotCrosshair(buckets.length, home);
  const slotAt = (x: number) => Math.floor(((x - PAD_L) / plotW) * buckets.length);
  const cur: NightBucket | null = ch.slot === null ? null : (buckets[ch.slot] ?? null);
  const readout = cur ? bucketReadout(cur, night, tempUnit, spo2NormalPct) : null;
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      // ⇧ moves 30 minutes (six 5-minute stops)
      e.preventDefault();
      ch.set((ch.slot ?? home) + (e.key === 'ArrowLeft' ? -6 : 6));
      return;
    }
    ch.onKeyDown(e);
  };

  /* ---------------------------------------------------------------- ticks */
  const span = x1 - x0;
  const every2 = span > 10 * HOUR_MS;
  const hours: number[] = [];
  for (let t = Math.ceil((x0 + offsetS * 1000) / HOUR_MS) * HOUR_MS - offsetS * 1000; t <= x1; t += HOUR_MS) {
    // over 10 hours: every 2 h, on even clock hours
    if (!every2 || new Date(t + offsetS * 1000).getUTCHours() % 2 === 0) hours.push(t);
  }

  const bedC = timed ? clockAt(night.bed!, offsetS) : null;
  const upC = timed ? clockAt(night.wake!, offsetS) : null;
  const unitWord = (key: LaneKey) => (key === 'hr' ? S.unit.hr : key === 'spo2' ? S.unit.spo2 : S.unit[tempUnit]);
  const relative = (key: LaneKey) => key === 'temp' || (key === 'spo2' && spo2Rel);
  const tickText = (key: LaneKey, v: number) => (relative(key) ? (v === 0 ? '0' : formatSigned(v, key === 'temp' ? 1 : 0)) : formatNumber(v, 0));
  const hasGaps = lanes.some((l) => l.points.length > 1 && runsOf(l.points, gapThresholdMs(l.points)).length > 1);
  const failed = [hr, spo2, temp].filter((d) => d.status === 'failed' && d.retry);

  const summary = nightSummary(night, lanes, tempUnit, spo2Rel);
  const emptyLine = night === null ? S.empty.day : !timed ? S.noTimes : null;

  return (
    <div ref={ref} className="sl-channels">
      <ChartShell
        title={S.title.stages}
        header={header}
        summary={summary}
        readout={readout}
        height={h + 18}
        stale={[hr, spo2, temp].some((d) => d.stale)}
        emptyLine={emptyLine}
        table={timed ? <NightTables night={night} buckets={buckets} tempUnit={tempUnit} /> : undefined}
        footer={
          night || failed.length ? (
            <>
              {night?.model && onlyUnknownStages(night.model) ? <p className="sl-note">{S.onlyUnknown}</p> : null}
              {night?.model?.uncovered ? <p className="sl-note">{S.uncovered(night.model.uncovered)}</p> : null}
              {hasGaps ? <p className="sl-note">{S.gapNote}</p> : null}
              {failed.length ? (
                <Key size="sm" onClick={() => failed.forEach((d) => d.retry?.())}>
                  {S.retryLanes}
                </Key>
              ) : null}
            </>
          ) : undefined
        }
      >
        <p className="sl-readout" aria-hidden="true">
          {readout ?? ' '}
        </p>
        <div
          className="sl-plot"
          role="img"
          aria-label={summary}
          aria-description={CHART_NAV_HELP}
          tabIndex={timed ? 0 : undefined}
          onKeyDown={timed ? onKeyDown : undefined}
          onFocus={timed ? ch.onFocus : undefined}
          onBlur={ch.onBlur}
          onPointerDown={ch.onPointerDown}
          onPointerMove={(e) => ch.onPointerMove(e, slotAt)}
          onPointerUp={(e) => ch.onPointerUp(e, slotAt)}
          onPointerLeave={ch.onPointerLeave}
        >
        <svg className="sg-svg sl-svg" width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true" focusable="false">
          <HatchDefs id={hatchId} />
          {hours.map((t) => (
            <line key={`g${t}`} className="sg-grid" x1={X(t)} x2={X(t)} y1={stagesTop} y2={lanesBottom} />
          ))}
          {timed ? (
            <g className="sl-bedup">
              <line className="sg-axis" x1={X(night.bed!)} x2={X(night.bed!)} y1={stagesTop - 2} y2={stagesTop + rowH * 5} />
              <line className="sg-axis" x1={X(night.wake!)} x2={X(night.wake!)} y1={stagesTop - 2} y2={stagesTop + rowH * 5} />
              <text className="sg-label sl-eng" x={X(night.bed!)} y={11} textAnchor="start">
                {S.bed(bedC!)}
              </text>
              <text className="sg-label sl-eng" x={X(night.wake!)} y={11} textAnchor="end">
                {S.up(upC!)}
              </text>
            </g>
          ) : null}
          <StageRows model={night?.model ?? null} X={X} left={PAD_L} right={PAD_L + plotW} top={stagesTop} rowH={rowH} hatchId={hatchId} dim={night?.provisional} />
          {lanes.map((l) =>
            l.note && l.height === COLLAPSED ? (
              <text key={l.key} className="sg-label sl-lane-note" data-lane={l.key} data-collapsed="true" x={0} y={l.top + 16}>
                {l.note}
              </text>
            ) : l.note ? (
              <g key={l.key} className="sl-lane" data-lane={l.key} data-status="loading">
                <text className="sg-label sl-eng" x={0} y={l.top + 11}>
                  {`${S.lane[l.key]} · ${unitWord(l.key)}`}
                </text>
                <text className="sg-label sl-eng" x={PAD_L + plotW / 2} y={l.top + LABEL_ROW + laneH / 2 + 4} textAnchor="middle">
                  {l.note}
                </text>
              </g>
            ) : (
              <g key={l.key} className="sl-lane" data-lane={l.key}>
                <text className="sg-label sl-eng" x={0} y={l.top + 11}>
                  {`${S.lane[l.key]} · ${unitWord(l.key)}`}
                </text>
                {l.ticks.map((v) => (
                  <g key={v}>
                    <line className={relative(l.key) && v === 0 ? 'sg-axis' : 'sg-grid'} x1={PAD_L} x2={PAD_L + plotW} y1={l.Y(v)} y2={l.Y(v)} />
                    <text className="sg-tick" x={PAD_L - 6} y={l.Y(v) + 3.5} textAnchor="end">
                      {tickText(l.key, v)}
                    </text>
                  </g>
                ))}
                {relative(l.key) ? (
                  <>
                    {!l.ticks.includes(0) ? <line className="sg-axis" x1={PAD_L} x2={PAD_L + plotW} y1={l.Y(0)} y2={l.Y(0)} /> : null}
                    <text className="sg-label sl-normal" x={PAD_L + plotW} y={l.Y(0) - 3} textAnchor="end">
                      {S.yourNormal}
                    </text>
                  </>
                ) : null}
                <LaneLine lane={l} X={X} />
                {l.key === 'hr' ? <Lowest lane={l} X={X} right={PAD_L + plotW} /> : null}
              </g>
            ),
          )}
          {hours.map((t) => (
            <text key={`t${t}`} className="sg-tick" x={X(t)} y={h - 5} textAnchor="middle">
              {clockAt(t, offsetS).slice(0, 2)}
            </text>
          ))}
          {cur ? (
            <g className="sl-cross" aria-hidden="true">
              <line className="sg-crosshair" x1={X(cur.t + BUCKET_MS / 2)} x2={X(cur.t + BUCKET_MS / 2)} y1={stagesTop} y2={lanesBottom} />
              {lanes.map((l) => {
                const raw = l.note ? null : cur[l.key];
                const v = raw !== null && l.key === 'spo2' && spo2NormalPct !== null ? raw - spo2NormalPct : raw;
                return v === null ? null : <circle key={l.key} className="sl-dot" data-lane={l.key} cx={X(cur.t + BUCKET_MS / 2)} cy={l.Y(v)} r={4} />;
              })}
            </g>
          ) : null}
        </svg>
        </div>
      </ChartShell>
    </div>
  );
}

function LaneLine({ lane, X }: { lane: LaneLayout; X: (t: number) => number }) {
  const runs = runsOf(lane.points, gapThresholdMs(lane.points));
  return (
    <g className="sl-line" data-lane={lane.key}>
      {runs.map((r) =>
        r.length === 1 ? (
          <circle key={r[0]!.t} className="sl-point" cx={X(r[0]!.t)} cy={lane.Y(r[0]!.v)} r={1.5} />
        ) : (
          <polyline key={r[0]!.t} points={r.map((p) => `${X(p.t).toFixed(1)},${lane.Y(p.v).toFixed(1)}`).join(' ')} />
        ),
      )}
    </g>
  );
}

function Lowest({ lane, X, right }: { lane: LaneLayout; X: (t: number) => number; right: number }) {
  const low = lane.points.reduce<SeriesPoint | null>((a, p) => (a === null || p.v < a.v ? p : a), null);
  if (!low) return null;
  const x = X(low.t), yy = lane.Y(low.v);
  const nearRight = x > right - 60;
  return (
    <g className="sl-lowest">
      <circle className="sl-lowest__dot" cx={x} cy={yy} r={3} />
      <text className="sg-label" x={nearRight ? x - 6 : x + 6} y={Math.min(yy + 12, lane.plotTop + lane.plotH)} textAnchor={nearRight ? 'end' : 'start'}>
        {S.lowest(Math.round(low.v))}
      </text>
    </g>
  );
}

function bucketReadout(b: NightBucket, night: SleepNight | null, unit: 'C' | 'F', spo2NormalPct: number | null): string {
  const parts: string[] = [b.clock];
  if (b.stage) parts.push(RING_COPY.stage[b.stage]);
  else if (b.inNight) parts.push(S.noStage);
  if (b.hr !== null) parts.push(S.bpm(b.hr));
  if (b.spo2 !== null) parts.push(spo2NormalPct === null ? S.pct(b.spo2) : S.pctChange(formatSigned(b.spo2 - spo2NormalPct, 0)));
  if (b.temp !== null) parts.push(S.temp(formatSigned(b.temp, 1), unit));
  if (night?.provisional && b.inNight) parts.push(S.stillChanging);
  return parts.join(' · ');
}

function nightSummary(night: SleepNight | null, lanes: readonly LaneLayout[], unit: 'C' | 'F', spo2Rel: boolean): string {
  if (!night) return S.empty.day;
  const parts: string[] = [];
  if (night.bed !== null && night.wake !== null) parts.push(S.inBed(clockAt(night.bed, night.offsetS), clockAt(night.wake, night.offsetS)));
  parts.push(S.asleepDur(durShort(night.asleepMin)));
  const shown = night.hasStages ? (['deep', 'light', 'rem', 'unknown'] as const) : (['unknown'] as const);
  parts.push(shown.map((k) => S.stageDur(RING_COPY.stage[k], durShort(night.stack[k]))).join(', '));
  for (const l of lanes) {
    if (l.note) {
      parts.push(l.note);
      continue;
    }
    const vs = l.points.map((p) => p.v);
    const lo = Math.min(...vs), hi = Math.max(...vs);
    if (l.key === 'hr') parts.push(`${S.lane.hr} ${S.lowest(Math.round(lo))} ${S.unit.hr}`);
    if (l.key === 'spo2' && spo2Rel) parts.push(`${S.lane.spo2} ${formatSigned(lo, 0)} to ${S.pctChange(formatSigned(hi, 0))} from ${S.yourNormal}`);
    else if (l.key === 'spo2') parts.push(`${S.lane.spo2} ${formatNumber(lo, 0)} to ${S.pct(Math.round(hi))}`);
    if (l.key === 'temp') parts.push(`${S.lane.temp} ${formatSigned(lo, 1)} to ${S.temp(formatSigned(hi, 1), unit)} from ${S.yourNormal}`);
  }
  if (night.provisional) parts.push(S.stillChanging);
  return `${parts.join('; ')}.`;
}

function NightTables({ night, buckets, tempUnit }: { night: SleepNight; buckets: readonly NightBucket[]; tempUnit: 'C' | 'F' }) {
  const segs = night.model?.segments ?? [];
  const tag = night.provisional ? ` ${S.stillChangingTable}` : '';
  const nd = S.noData;
  return (
    <>
      <TwinTable
        caption={`${S.tableStages}${tag}`}
        head={[S.col.stage, S.col.start, S.col.end, S.col.minutes]}
        rows={segs.map((g) => [RING_COPY.stage[g.stage], clockAt(g.start, night.offsetS), clockAt(g.end, night.offsetS), String(Math.round((g.end - g.start) / MIN_MS))])}
      />
      <TwinTable
        caption={S.tableBuckets}
        head={[S.col.time, S.col.stage, S.col.bpm, S.col.pctCol, S.unit[tempUnit]]}
        rows={buckets
          .filter((b) => b.inNight)
          .map((b) => [
            b.clock,
            b.stage ? RING_COPY.stage[b.stage] : S.noStage,
            b.hr === null ? nd : String(b.hr),
            b.spo2 === null ? nd : String(b.spo2),
            b.temp === null ? nd : formatSigned(b.temp, 1),
          ])}
      />
    </>
  );
}
