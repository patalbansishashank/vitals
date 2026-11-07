/**
 * (r069 D4) Energy through the day by kind: one 15-min column per quarter hour, stacked resting · everyday movement · food
 * digestion · exercise (the engine's ledger grouped, `kindColumns`), today's quarters after now one lighter bar (the
 * likely rest of the day), a gold line at now, the day's activities as bands behind the columns and numbered on the time
 * axis (`ActivityLane`, the same marks as the steps chart). The legend names the kinds; "Table" opens the twin (every
 * quarter hour by kind, CSV). Figures follow the kcal/kJ preference. Never drawn in quiet mode (the page says why).
 */
import { useId, useMemo, useRef } from 'react';
import { useGrow, useInView } from '@/app/motion';
import { VizTwinTable, clockText, toCSV, toEnergyUnit, type EnergyUnitChoice } from '@/components';
import { ActivityLane, ActivityLegend, type DayMark } from '../activity/ActivityLane';
import { energyText } from '../activity/model';
import {
  ENERGY_PAGE_WORDS as W,
  KIND_HUE,
  KIND_LABEL,
  KIND_ORDER,
  kindSplit,
  peakColumn,
  spokenKinds,
  type KindColumn,
} from './model';

export interface EnergyKindChartProps {
  cols: readonly KindColumn[];
  marks: readonly DayMark[];
  /** Today: the now line. */
  nowMs?: number;
  unit: EnergyUnitChoice;
}

export function EnergyKindChart({ cols, marks, nowMs, unit }: EnergyKindChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  useGrow(ref, { selector: '.lv-ekind__column', start: inView, stagger: 8 });
  const hatch = useId().replace(/:/g, '');
  const n = cols.length || 96;
  const H = 120;
  const max = Math.max(1, ...cols.map((c) => c.total));
  const from = cols[0]?.start ?? 0;
  const to = from + n * 15 * 60_000;
  const x = (t: number) => ((t - from) / (to - from)) * n;
  const nowX = nowMs !== undefined && nowMs > from && nowMs < to ? x(nowMs) : null;
  const split = useMemo(() => kindSplit(cols), [cols]);
  const spoken = spokenKinds(split, peakColumn(cols), unit);
  return (
    <div className="lv-ekind" ref={ref}>
      <p className="lv-echart__scale lm-num" aria-hidden="true">
        {energyText(max, unit)} {W.perQuarter(unit)}
      </p>
      <div className="lv-sday__plotwrap">
        <svg
          className="lv-ekind__plot"
          viewBox={`0 0 ${n} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={spoken}
        >
          <defs>
            <pattern id={hatch} width="2" height="4" patternUnits="userSpaceOnUse">
              <rect width="2" height="4" fill={KIND_HUE.digestion} />
              <path d="M0 0L2 4" stroke="var(--lm-face)" strokeWidth="0.6" />
            </pattern>
          </defs>
          {marks.map((m) => (
            <rect
              key={m.id}
              x={x(m.start)}
              y={0}
              width={Math.max(0.3, x(m.end) - x(m.start))}
              height={H}
              className="lv-sday__band"
              data-pending={m.pending || undefined}
            />
          ))}
          {cols.map((c, i) => {
            if (c.future) {
              const h = (c.total / max) * H;
              return (
                <rect
                  key={c.start}
                  x={i + 0.12}
                  y={H - h}
                  width={0.76}
                  height={h}
                  className="lv-ekind__ahead lv-ekind__column"
                />
              );
            }
            let y = H;
            return (
              <g key={c.start} className="lv-ekind__column">
                {KIND_ORDER.map((k) => {
                  const h = (c.kinds[k] / max) * H;
                  if (!(h > 0)) return null;
                  y -= h;
                  return (
                    <rect
                      key={k}
                      x={i + 0.12}
                      y={y}
                      width={0.76}
                      height={h}
                      fill={k === 'digestion' ? `url(#${hatch})` : KIND_HUE[k]}
                      className="lv-ekind__seg"
                      data-kind={k}
                    />
                  );
                })}
              </g>
            );
          })}
          <line x1={0} x2={n} y1={H - 0.25} y2={H - 0.25} className="lv-echart__base" />
          {nowX !== null ? <line x1={nowX} x2={nowX} y1={0} y2={H} className="lv-echart__now" /> : null}
        </svg>
        <ActivityLane marks={marks} from={from} to={to} />
      </div>
      <div className="lv-echart__axis" aria-hidden="true">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {h === 24 && clockText(to) === '00:00' ? '24:00' : clockText(from + h * 3_600_000)}
          </span>
        ))}
      </div>
      <div className="lv-echart__foot">
        <ul className="lv-echart__legend" aria-label={`${W.throughTheDay}, key`}>
          {KIND_ORDER.map((k) => (
            <li key={k}>
              <span className="lv-echart__key" style={{ background: KIND_HUE[k] }} aria-hidden="true" />
              {KIND_LABEL[k]}
            </li>
          ))}
          {split.ahead > 0.5 ? (
            <li>
              <span className="lv-echart__key lv-ekind__aheadkey" aria-hidden="true" />
              {W.ahead}
            </li>
          ) : null}
        </ul>
      </div>
      <ActivityLegend marks={marks} quiet={false} />
    </div>
  );
}

/** The chart's twin: every quarter hour by kind (a quarter still ahead carries its likely total only). */
export function KindTable({
  id = 'energy-kind-table',
  cols,
  unit,
}: {
  id?: string;
  cols: readonly KindColumn[];
  unit: EnergyUnitChoice;
}) {
  const cell = (v: number) => (v > 0.5 ? energyText(v, unit) : '');
  const num = (v: number) => Math.round(toEnergyUnit(v, unit));
  const head = ['Time', ...KIND_ORDER.map((k) => KIND_LABEL[k]), 'Total', ''];
  const csvHead = ['Time', ...KIND_ORDER.map((k) => `${KIND_LABEL[k]} (${unit})`), `Total (${unit})`, 'Note'];
  const csv = () =>
    toCSV([
      csvHead,
      ...cols.map((c) => [
        clockText(c.start),
        ...KIND_ORDER.map((k) => (c.future ? '' : num(c.kinds[k]))),
        num(c.total),
        c.future ? 'likely' : '',
      ]),
    ]);
  return (
    <VizTwinTable
      id={id}
      title={W.table}
      caption={`${W.throughTheDay}, ${W.perQuarter(unit)}, estimated`}
      rows={cols.length}
      fileName="energy-by-kind.csv"
      csv={csv}
      rowNoun={['quarter hour', 'quarter hours']}
    >
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={`${h}${i}`} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {cols.map((c) => (
          <tr key={c.start} data-future={c.future || undefined}>
            <th scope="row" className="lm-num">
              {clockText(c.start)}
            </th>
            {KIND_ORDER.map((k) => (
              <td key={k} className="lm-num">
                {c.future ? '' : cell(c.kinds[k])}
              </td>
            ))}
            <td className="lm-num">{energyText(c.total, unit)}</td>
            <td>{c.future ? 'likely' : ''}</td>
          </tr>
        ))}
      </tbody>
    </VizTwinTable>
  );
}
