/**
 * (r069 D3) Steps through the day: where the day's counted steps happened, in 15-minute bars from the fused minute
 * timeline (the steps the day's total is made of, ring or phone per minute, never both), with the day's activities on the
 * time axis (`ActivityLane`: approved, detected and logged by hand). Its head says the total the bars add up to and when
 * the steps were last updated (`lastCountedAt`, the same time the card shows), so the figure, the bars and "Updated" agree.
 * A ring day total higher than what is placed in time is said under it, never added to the bars. "Table" opens its twin.
 * Quiet mode (0.6.3 INT): no figures and no clock axis; the activities stay, by part of the day.
 */
import { useId, useState } from 'react';
import { TwinKey, VizTwinTable, clockText, formatNumber, toCSV } from '@/components';
import { ActivityLane, ActivityLegend, type DayMark } from './ActivityLane';
import { binsTotal, type StepsBin } from './stepsTime';
import './activity.css';

export const STEPS_DAY_WORDS = {
  title: 'Steps through the day',
  counted: (n: string) => `${n} steps counted`,
  updated: (t: string) => `updated ${t}`,
  none: 'No steps counted yet',
  perBin: 'steps per 15 min',
  noTime: (n: string, total: string) => `The ring also counted ${n} steps it could not place in time, so the day shows at least ${total}.`,
  quiet: 'Steps through the day are figures, so they stay hidden in quiet mode.',
  table: 'Steps through the day table',
} as const;

export interface StepsDayChartProps {
  bins: readonly StepsBin[];
  marks: readonly DayMark[];
  /** Today: the bars after now are empty, a gold line marks now. */
  nowMs?: number;
  /** The end of the last counted minute ("updated 16:23"). */
  updatedAt: number | null;
  /** The day's headline when it is more than the steps placed in time ("at least"). */
  headline?: number | null;
  quiet: boolean;
  /** A containing card may already show the counted total; keep its freshness line. */
  showTotal?: boolean;
}

/** "Steps through the day: 9 898 counted, most at 14:00 (1 120 in 15 min); activities: …" (unknown never spoken as 0). */
export function spokenStepsDay(bins: readonly StepsBin[], marks: readonly DayMark[]): string {
  const total = binsTotal(bins);
  let peak: StepsBin | null = null;
  for (const b of bins) if (b.steps !== null && (!peak || b.steps > (peak.steps ?? 0))) peak = b;
  const acts = marks.length ? `; activities: ${marks.map((m) => `${m.label} ${clockText(m.start)} to ${clockText(m.end)}`).join(', ')}` : '';
  if (total === null) return `${STEPS_DAY_WORDS.title}: no step reading${acts}.`;
  const at = peak && (peak.steps ?? 0) > 0 ? `, most at ${clockText(peak.start)} (${formatNumber(peak.steps!, 0)} in 15 min)` : '';
  return `${STEPS_DAY_WORDS.title}: ${formatNumber(total, 0)} counted${at}${acts}.`;
}

export function StepsDayChart({ bins, marks, nowMs, updatedAt, headline = null, quiet, showTotal = true }: StepsDayChartProps) {
  const [table, setTable] = useState(false);
  const tableId = `sday-table-${useId().replace(/:/g, '')}`;
  const n = bins.length || 96;
  const from = bins[0]?.start ?? 0;
  const to = from + n * 15 * 60_000;
  const total = binsTotal(bins);
  if (quiet)
    return (
      <div className="lv-sday">
        <p className="lv-act__fact">{STEPS_DAY_WORDS.quiet}</p>
        <ActivityLegend marks={marks} quiet />
      </div>
    );
  const max = Math.max(1, ...bins.map((b) => b.steps ?? 0));
  const H = 64;
  const x = (t: number) => ((t - from) / (to - from)) * n;
  const nowX = nowMs !== undefined && nowMs > from && nowMs < to ? x(nowMs) : null;
  const over = headline !== null && total !== null && headline > total ? headline : null;
  const head = total === null ? STEPS_DAY_WORDS.none : STEPS_DAY_WORDS.counted(formatNumber(total, 0));
  return (
    <div className="lv-sday">
      {showTotal || updatedAt !== null ? <p className="lv-sday__head lm-num">
        {showTotal ? <span className="lv-sday__total">{head}</span> : null}
        {updatedAt !== null ? <span className="lv-sday__updated">{showTotal ? ' · ' : ''}{STEPS_DAY_WORDS.updated(clockText(updatedAt))}</span> : null}
      </p> : null}
      <p className="lv-echart__scale lm-num" aria-hidden="true">
        {formatNumber(max, 0)} {STEPS_DAY_WORDS.perBin}
      </p>
      <div className="lv-sday__plotwrap">
        <svg className="lv-sday__plot" viewBox={`0 0 ${n} ${H}`} preserveAspectRatio="none" role="img" aria-label={spokenStepsDay(bins, marks)}>
          {marks.map((m) => (
            <rect key={m.id} x={x(m.start)} y={0} width={Math.max(0.3, x(m.end) - x(m.start))} height={H} className="lv-sday__band" data-pending={m.pending || undefined} />
          ))}
          {bins.map((b, i) => {
            const future = nowMs !== undefined && b.start >= nowMs;
            if (b.steps === null) return future ? null : <rect key={b.start} x={i + 0.15} y={H - 1} width={0.7} height={1} className="lv-sday__none" />;
            const h = Math.max(b.steps > 0 ? 1.5 : 0, (b.steps / max) * (H - 2));
            return <rect key={b.start} x={i + 0.15} y={H - h} width={0.7} height={h} className="lv-sday__bar" />;
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
      <ActivityLegend marks={marks} quiet={false} />
      {over !== null && total !== null ? <p className="lv-act__fact lm-num">{STEPS_DAY_WORDS.noTime(formatNumber(over - total, 0), formatNumber(over, 0))}</p> : null}
      <div className="lv-schart__foot">
        <TwinKey open={table} onToggle={() => setTable((t) => !t)} controls={tableId} />
      </div>
      {table ? <StepsDayTable id={tableId} bins={bins} marks={marks} nowMs={nowMs} /> : null}
    </div>
  );
}

/** The twin: each quarter hour's counted steps and the activity it falls in. */
function StepsDayTable({ id, bins, marks, nowMs }: { id: string; bins: readonly StepsBin[]; marks: readonly DayMark[]; nowMs: number | undefined }) {
  const shown = bins.filter((b) => nowMs === undefined || b.start < nowMs);
  const actOf = (b: StepsBin) =>
    marks
      .filter((m) => m.start < b.start + 15 * 60_000 && m.end > b.start)
      .map((m) => m.label)
      .join(', ');
  const head = ['Time', 'Steps', 'Activity'];
  const csv = () => toCSV([head, ...shown.map((b) => [clockText(b.start), b.steps ?? '', actOf(b)])]);
  return (
    <VizTwinTable id={id} title={STEPS_DAY_WORDS.table} caption={`${STEPS_DAY_WORDS.title}, every 15 min; a dash is no reading`} rows={shown.length} fileName="steps-through-the-day.csv" csv={csv} rowNoun={['quarter hour', 'quarter hours']}>
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
        {shown.map((b) => (
          <tr key={b.start}>
            <th scope="row" className="lm-num">
              {clockText(b.start)}
            </th>
            <td className="lm-num">{b.steps === null ? '—' : formatNumber(b.steps, 0)}</td>
            <td>{actOf(b)}</td>
          </tr>
        ))}
      </tbody>
    </VizTwinTable>
  );
}
