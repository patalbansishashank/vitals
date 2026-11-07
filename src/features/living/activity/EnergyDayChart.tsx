/**
 * Energy through the day (§V4.1): the engine's realised day (actual through now, the plan for the rest) in 15-min
 * columns stacked by time state (sleep, resting, light, active, exercise, unknown); food digestion is its own thin band
 * ("modelled"); the hours ahead are the plan, drawn lighter; pending activities are hatched and marked "not counted yet" (only
 * with the provisional overlay on, D8; they are not in the figures). A toggle shows the active part alone (D15). The
 * share bar under it is the chart in words (kcal and minutes per state). Within an hour the split is a display model.
 * The picture's sentence follows the mode shown (UI audit #22); "Table" opens its twin: every 15 min with its kcal by
 * state, food digestion, the active part and whether it is the plan (UI audit #13, DATAVIZ §0.7).
 * Every figure, the scale, the table, its CSV and the spoken sentences follow the kcal/kJ preference (0.6.3 S31; the
 * engine's figures stay kcal).
 */
import { useId, useMemo, useState } from 'react';
import { KeyBank, ResponsivePanel, ShareBar, TwinKey, VizTwinTable, clockText, durationText, toCSV, toEnergyUnit, type EnergyUnitChoice, type ShareBarRow } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import type { EnergyDay, EnergyState } from '@/living/sensors/energyDay';
import { ACTIVITY_COPY as C } from '../copy';
import { STATE_LABEL, STATE_ORDER, energyColumns, energySplit, energyText, spokenActive, spokenEnergy, type EnergyColumn } from './model';
import './activity.css';

/** (r069 U1) The intensity roles (`tokens.css`): sleep's recovery hue, then waking effort climbing the effort ramp. */
const STATE_HUE: Record<EnergyState, string> = {
  sleep: 'var(--lm-intensity-sleep)',
  resting: 'var(--lm-intensity-resting)',
  light: 'var(--lm-intensity-light)',
  active: 'var(--lm-intensity-active)',
  exercise: 'var(--lm-intensity-exercise)',
  unknown: 'var(--lm-raised)',
};

export interface EnergyDayChartProps {
  day: EnergyDay;
  nowMs: number;
  soFar: number | null;
  /** Pending activities (hatched "not counted yet"). */
  provisional?: ReadonlyArray<{ id: string; window: { start: number; end: number }; kcal: number | null }>;
  /** (r068 V17) Today without a plan: the rest of the day is the likely day, never "as planned". */
  planless?: boolean;
}

export function EnergyDayChart({ day, nowMs, soFar, provisional = [], planless = false }: EnergyDayChartProps) {
  const [mode, setMode] = useState<'total' | 'active'>('total');
  const [table, setTable] = useState(false);
  const eu = useEnergyUnit();
  const t = (v: number) => energyText(v, eu);
  const uid = useId().replace(/:/g, '');
  const hatch = uid;
  const tableId = `echart-table-${uid}`;
  const cols = useMemo(() => energyColumns(day, nowMs), [day, nowMs]);
  const n = cols.length || 96;
  const H = 120;
  const TEF_H = 6;
  const plotH = H - TEF_H - 4;
  const max = Math.max(1, ...cols.map((c) => (mode === 'total' ? c.total - c.tef : c.active)));
  const from = cols[0]?.start ?? 0;
  const to = from + n * 15 * 60_000;
  const x = (t: number) => ((t - from) / (to - from)) * n;
  const nowX = nowMs > from && nowMs < to ? x(nowMs) : null;
  const ticks = [0, 6, 12, 18, 24].map((h) => ({ x: (h / 24) * n, t: from + h * 3_600_000 }));
  const split = energySplit(cols);
  const rows: ShareBarRow[] = [
    ...STATE_ORDER.filter((st) => split.byState[st].minutes >= 1).map((st) => ({
      id: st,
      label: STATE_LABEL[st],
      valueText: `${t(split.byState[st].kcal)} ${eu} · ${durationText(split.byState[st].minutes)}`,
      share: split.total > 0 ? split.byState[st].kcal / split.total : 0,
      hue: STATE_HUE[st],
      ...(st === 'unknown' ? { unknown: true } : {}),
    })),
    // (r068 S5) the rest of the day is its own line under the bar, not a row of what happened
  ];
  return (
    <div className="lv-echart">
      {/* (r068 S5) the view switch takes the width; the Table key sits at the end of the legend line (as on Today) */}
      <KeyBank label={C.chartTitle} size="sm" value={mode} options={[{ value: 'total', label: C.total }, { value: 'active', label: C.active }]} onChange={(v) => setMode(v)} />
      <p className="lv-echart__scale lm-num" aria-hidden="true">
        {t(max)} {C.perQuarter(eu)}
      </p>
      <svg className="lv-echart__plot" viewBox={`0 0 ${n} ${H}`} preserveAspectRatio="none" role="img" aria-label={mode === 'total' ? spokenEnergy(split, soFar, day.tef, eu) : spokenActive(cols, eu)}>
        <defs>
          <pattern id={`hatch-${hatch}`} width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2" height="2" className="lv-echart__hatchbg" />
            <line x1="0" y1="0" x2="0" y2="2" className="lv-echart__hatch" />
          </pattern>
        </defs>
        {cols.map((c, i) => {
          if (mode === 'active') {
            const h = (c.active / max) * plotH;
            return <rect key={c.start} x={i + 0.12} y={plotH - h} width={0.76} height={h} fill={STATE_HUE.active} data-future={c.future || undefined} className="lv-echart__seg" />;
          }
          if (c.future) {
            const h = ((c.total - c.tef) / max) * plotH;
            return <rect key={c.start} x={i + 0.12} y={plotH - h} width={0.76} height={h} className="lv-echart__plan" />;
          }
          let y = plotH;
          return (
            <g key={c.start} data-future={c.future || undefined} className="lv-echart__col">
              {c.parts.map((p) => {
                const h = (p.kcal / max) * plotH;
                y -= h;
                return <rect key={p.state} x={i + 0.12} y={y} width={0.76} height={h} fill={STATE_HUE[p.state]} data-unknown={p.state === 'unknown' || undefined} className="lv-echart__seg" />;
              })}
            </g>
          );
        })}
        {provisional.map((p) => (
          <rect key={p.id} x={x(p.window.start)} y={0} width={Math.max(0.6, x(p.window.end) - x(p.window.start))} height={plotH} fill={`url(#hatch-${hatch})`} className="lv-echart__pending" />
        ))}
        {mode === 'total'
          ? cols.map((c, i) => {
              const h = Math.min(TEF_H, (c.tef / Math.max(1, ...cols.map((k) => k.tef))) * TEF_H);
              return <rect key={`t${c.start}`} x={i + 0.12} y={H - h} width={0.76} height={h} className="lv-echart__tef" data-future={c.future || undefined} />;
            })
          : null}
        <line x1={0} x2={n} y1={plotH + 0.5} y2={plotH + 0.5} className="lv-echart__base" />
        {nowX !== null ? <line x1={nowX} x2={nowX} y1={0} y2={H} className="lv-echart__now" /> : null}
      </svg>
      <div className="lv-echart__axis" aria-hidden="true">
        {ticks.map((k) => (
          <span key={k.x} style={{ left: `${(k.x / n) * 100}%` }}>
            {clockText(k.t)}
          </span>
        ))}
      </div>
      <div className="lv-echart__foot">
        <ul className="lv-echart__legend">
          <li className="lm-num">
            <span className="lv-echart__key" data-kind="tef" aria-hidden="true" />
            {C.tef} {t(day.tef)} {eu}
          </li>
          {provisional.length ? (
            <li>
              <span className="lv-echart__key" data-kind="pending" aria-hidden="true" />
              {REVIEW_KEY}
            </li>
          ) : null}
        </ul>
        <TwinKey open={table} onToggle={() => setTable((t) => !t)} controls={tableId} />
      </div>
      {mode === 'total' ? (
        <>
          <ShareBar label={C.chartTitle} rows={rows} size="sm" shareOf="of the day" note={C.allocation} />
          {/* (r068 S5) what is still ahead is not part of what happened: its own line under the day so far */}
          {split.planned.minutes > 0 ? (
            <p className="lv-echart__ahead lm-num">
              <span className="lv-echart__ahead-key" aria-hidden="true" />
              <span>{planless ? C.restOfDayLikely : C.restOfDay}</span>
              <span className="lv-echart__ahead-v">
                {t(split.planned.kcal)} {eu} · {durationText(split.planned.minutes)}
              </span>
            </p>
          ) : null}
        </>
      ) : (
        <p className="lv-act__fact lm-num">{C.activeLine(t(day.active), eu)}</p>
      )}
      {table ? <EnergyTable id={tableId} cols={cols} unit={eu} /> : null}
    </div>
  );
}

const PLAN_WORD = 'plan';
/** (r068 S5) the review hatch, named in place: what it is and that it is not counted yet */
const REVIEW_KEY = 'Not counted yet';
const ABOVE_REST = 'Above your resting burn';

/** The chart's table twin: one row per 15 min (the plan's rows have no states: nothing has happened yet). */
function EnergyTable({ id, cols, unit }: { id: string; cols: readonly EnergyColumn[]; unit: EnergyUnitChoice }) {
  const cell = (v: number) => (v > 0.5 ? energyText(v, unit) : '');
  // the CSV keeps whole numbers in the display unit (its header names the unit: the caption does not travel with it)
  const num = (v: number) => Math.round(toEnergyUnit(v, unit));
  const stateOf = (c: EnergyColumn, st: (typeof STATE_ORDER)[number]) => c.parts.find((p) => p.state === st)?.kcal ?? 0;
  // the active column is movement above own rest (D15), not the "active" time state
  const head = [C.time, ...STATE_ORDER.map((st) => STATE_LABEL[st]), C.tef, ABOVE_REST, C.total, C.restOfDay];
  const csvHead = head.map((h, i) => (i > 0 && i < head.length - 1 ? `${h} (${unit})` : h));
  const csv = () => toCSV([csvHead, ...cols.map((c) => [clockText(c.start), ...STATE_ORDER.map((st) => (c.future ? '' : num(stateOf(c, st)))), num(c.tef), num(c.active), num(c.total), c.future ? PLAN_WORD : ''])]);
  return (
    <VizTwinTable id={id} title={`${C.chartTitle} table`} caption={`${C.chartTitle}, ${C.perQuarter(unit)}, estimated`} rows={cols.length} fileName="energy-through-the-day.csv" csv={csv} rowNoun={['quarter hour', 'quarter hours']}>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
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
            {STATE_ORDER.map((st) => (
              <td key={st} className="lm-num">
                {c.future ? '' : cell(stateOf(c, st))}
              </td>
            ))}
            <td className="lm-num">{cell(c.tef)}</td>
            <td className="lm-num">{cell(c.active)}</td>
            <td className="lm-num">{energyText(c.total, unit)}</td>
            <td>{c.future ? PLAN_WORD : ''}</td>
          </tr>
        ))}
      </tbody>
    </VizTwinTable>
  );
}

/** The chart in its panel (Today's energy card opens it). */
export function EnergyDayPanel({ open, onClose, ...props }: EnergyDayChartProps & { open: boolean; onClose: () => void }) {
  return (
    <ResponsivePanel open={open} onClose={onClose} title={C.chartTitle}>
      <div className="lv-apanel">
        <EnergyDayChart {...props} />
      </div>
    </ResponsivePanel>
  );
}
