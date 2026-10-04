/**
 * Night stages (E29, moved from Progress; extended per design/screens/ring-pages.md §7.3.2): the stage lanes of one
 * night with minutes per stage. Rows top → bottom awake, REM, light, deep, unknown; the unknown row is always there so
 * rows never shift between nights; unknown is hatched and never folded into light; segments sit at true time (at least
 * 1 px wide) and time no stage covers stays blank (no connectors across gaps).
 *
 * `NightStages({ night })` stands alone (Progress's score details); `StageRows` is the same drawing for the Body signals
 * channel stack (`NightChannels`).
 */
import { memo, useId, useRef } from 'react';
import { useElementWidth } from '@/features/charts/core/hooks';
import { fmtHours } from '@/features/living/format';
import { RING_COPY as C } from './copy';
import { SLEEP_COPY } from './copySleep';
import { HatchDefs, useChartSizes } from './kit';
import { NIGHT_STAGES, clockAt, type NightModel, type NightStage } from './ringData';
import './ring.css';

export const STAGE_ROW: Record<NightStage, number> = { awake: 0, rem: 1, light: 2, deep: 3, unknown: 4 };

/** No deep, light or REM minutes: the ring knew when you slept but not the stages. */
export const onlyUnknownStages = (night: NightModel): boolean => night.minutes.deep + night.minutes.light + night.minutes.rem === 0;

/** A hatch id safe inside url(#…). */
export function useHatchId(prefix = 'sl-hatch'): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export interface StageRowsProps {
  model: NightModel | null;
  /** True time → x. */
  X: (t: number) => number;
  /** Plot left / right (grid lines run between them). */
  left: number;
  right: number;
  top: number;
  rowH: number;
  /** Id of a `HatchDefs` pattern in the same svg. */
  hatchId: string;
  /** Provisional night: segments at 60 %. */
  dim?: boolean;
}

/** The five stage rows: hairline, engraved name in the gutter, segments at true time. */
export function StageRows({ model, X, left, right, top, rowH, hatchId, dim }: StageRowsProps) {
  return (
    <g className="lv-ring-rows">
      {NIGHT_STAGES.map((s) => (
        <g key={s}>
          <line className="lv-ring-grid" x1={left} x2={right} y1={top + STAGE_ROW[s] * rowH + rowH - 0.5} y2={top + STAGE_ROW[s] * rowH + rowH - 0.5} />
          <text className="lv-ring-tick" x={left - 6} y={top + STAGE_ROW[s] * rowH + rowH - 5} textAnchor="end">
            {C.stage[s]}
          </text>
        </g>
      ))}
      <g opacity={dim ? 0.6 : undefined}>
        {(model?.segments ?? []).map((g) => (
          <rect
            key={`${g.start}-${g.stage}`}
            className="lv-ring-stage"
            data-stage={g.stage}
            x={X(g.start)}
            y={top + STAGE_ROW[g.stage] * rowH + 2}
            width={Math.max(1, X(g.end) - X(g.start))}
            height={rowH - 4}
            style={g.stage === 'unknown' ? { fill: `url(#${hatchId})` } : undefined}
          />
        ))}
      </g>
    </g>
  );
}

export const NightStages = memo(function NightStages({ night }: { night: NightModel }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, 320) || 320;
  const { stageRow: rowH } = useChartSizes();
  const hatchId = useHatchId();
  const padL = 64, padR = 8, top = 4;
  const h = top + rowH * 5 + 22;
  const span = night.end - night.start;
  const X = (t: number) => padL + ((t - night.start) / span) * (width - padL - padR);
  const hours: number[] = [];
  const firstHour = Math.ceil((night.start + night.offsetS * 1000) / 3_600_000) * 3_600_000 - night.offsetS * 1000;
  const step = span > 10 * 3_600_000 ? 2 : 1;
  for (let t = firstHour; t <= night.end; t += step * 3_600_000) hours.push(t);
  const bed = clockAt(night.start, night.offsetS), wake = clockAt(night.end, night.offsetS);
  const onlyUnknown = onlyUnknownStages(night);
  const summary = `${C.bedWake(bed, wake)}. ${NIGHT_STAGES.map((s) => `${C.stage[s]} ${night.minutes[s]} min`).join(', ')}${night.uncovered ? `. ${C.uncovered(night.uncovered)}` : ''}.`;
  return (
    <div ref={ref} className="lv-ring-night">
      <p className="lv-ring-lines">
        <span>{C.bedWake(bed, wake)}</span> · <span>{C.asleep(fmtHours(night.asleepMin / 60))}</span>
      </p>
      <svg className="lv-ring-svg" width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={summary}>
        <HatchDefs id={hatchId} />
        <StageRows model={night} X={X} left={padL} right={width - padR} top={top} rowH={rowH} hatchId={hatchId} />
        {hours.map((t) => (
          <text key={t} className="lv-ring-tick" x={X(t)} y={h - 6} textAnchor="middle">
            {clockAt(t, night.offsetS).slice(0, 2)}
          </text>
        ))}
      </svg>
      <table className="lv-prog-table lv-ring-table">
        <caption className="lm-sr">{C.stagesCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{C.stageCol}</th>
            <th scope="col">{C.minutesCol}</th>
          </tr>
        </thead>
        <tbody>
          {(['deep', 'light', 'rem', 'awake', 'unknown'] as const).map((s) => (
            <tr key={s} data-stage={s}>
              <th scope="row">
                <i className="lv-ring-key" data-stage={s} aria-hidden="true" /> {C.stage[s]}
                {s === 'unknown' ? <span className="lv-ring-note"> · {C.stageHelp.unknown}</span> : null}
              </th>
              <td className="lm-num">{night.minutes[s]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {night.uncovered ? <p className="lv-ring-note">{C.uncovered(night.uncovered)}</p> : null}
      {onlyUnknown ? <p className="lv-ring-note">{SLEEP_COPY.onlyUnknown}</p> : null}
      {night.provisional ? <p className="lv-ring-note">{C.provisional}</p> : null}
    </div>
  );
});
