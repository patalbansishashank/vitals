/* ==========================================================================
   <DayDisc> (DATAVIZ P9, SPEC A.3.2, D17): the Day score and its three
   sub-scores. Three arcs of 112° with 8° gaps on a 92 px radius, 36 dots
   each; lit dots stone, unlit the chart axis; lit = round(score / 100 × 36).
   The score centred (32/38 500), the band word under it, arc names outside
   the arcs, upright. No dot field, glow or particles. A missing sub-score
   is a dashed outline with what it needs; the centre says "based on 2 of 3".
   The target is a TickStrip under the disc. Quiet: no digits, arcs in three
   steps, the band word only. role="img" plus a table twin.
   ========================================================================== */
import { useId, useState } from 'react';
import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';
import { DEG, arcPath, isNum, polar } from './geometry';
import { TickStrip } from './TickStrip';
import { TwinKey, TwinTable, toCSV } from './TwinTable';
import './viz.css';

export type DayArcId = 'recovery' | 'activity' | 'sleep';

export interface DayArc {
  id: DayArcId;
  label: string;
  score: number | null;
  confidence?: 'low' | 'medium' | 'high';
  /** "needs 3 more nights" */
  needs?: string;
}

export interface DayDiscProps {
  label: string;
  score: number | null;
  arcs: DayArc[];
  target?: number | null;
  /** "based on 2 of 3" */
  basedOn?: string;
  /** "Good" */
  band?: string;
  size?: 'full' | 'compact';
  state?: 'normal' | 'learning' | 'stale' | 'none';
  quiet?: boolean;
  /** Show the "Table" key and its twin (default true; never in the compact form). */
  twin?: boolean;
  /** (r068) The "Recovery · low confidence" chips under the disc (default true). A caller listing the parts says it there. */
  chips?: boolean;
  /** (r068) The target TickStrip under the disc (default true). A caller with its own target line turns it off. */
  targetStrip?: boolean;
  className?: string;
}

export const DISC_DOTS = 36;
export const DISC_R = 92;
const ARC_SPAN = 112 * DEG;
const CENTRE: Record<DayArcId, number> = { recovery: 0, activity: 120 * DEG, sleep: 240 * DEG };
const VB = 260;
const C = VB / 2;

/** Lit dots of an arc. Quiet: three steps (a third, two thirds, all). */
export function litDots(score: number | null, quiet = false): number {
  if (!isNum(score)) return 0;
  const s = Math.max(0, Math.min(100, score));
  if (quiet) return s <= 0 ? 0 : s < 34 ? 12 : s < 67 ? 24 : 36;
  return Math.round((s / 100) * DISC_DOTS);
}

/** Dot centres of an arc, clockwise from its start. */
export function arcDots(id: DayArcId, r = DISC_R, cx = C, cy = C): Array<[number, number]> {
  const a0 = CENTRE[id] - ARC_SPAN / 2;
  return Array.from({ length: DISC_DOTS }, (_, k) => polar(cx, cy, r, a0 + ((k + 0.5) / DISC_DOTS) * ARC_SPAN));
}

/** Equal thirds, renormalised over the sub-scores present (day-index/1). */
export function arcWeights(arcs: readonly DayArc[]): Map<DayArcId, number> {
  const live = arcs.filter((a) => isNum(a.score));
  return new Map(arcs.map((a) => [a.id, isNum(a.score) && live.length ? 1 / live.length : 0]));
}

const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/**
 * Quiet mode's words-only form of a line (SPEC A.3.2, DATAVIZ §0.6): "based on 2 of 3" → "based on two of three",
 * "needs 3 more nights" → "needs three more nights"; a number past twelve becomes "several". No digit survives.
 */
export function quietWords(text: string): string {
  return text.replace(/\d+(?:[.,]\d+)?/g, (m) => {
    const n = Number(m.replace(',', '.'));
    return Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n]! : 'several';
  });
}

/** The completeness line as shown: the caller's, or "based on N of M"; words only in quiet mode. */
function basedLine(p: Pick<DayDiscProps, 'arcs' | 'basedOn' | 'quiet'>, always: boolean): string | undefined {
  const live = p.arcs.filter((a) => isNum(a.score)).length;
  const based = p.basedOn ?? (always || live < p.arcs.length ? `based on ${live} of ${p.arcs.length}` : undefined);
  return based !== undefined && p.quiet ? quietWords(based) : based;
}

/** "Day score 84 of 100: recovery 71, activity 92, sleep 88; target 70; based on 3 of 3". */
export function spokenDisc(p: Pick<DayDiscProps, 'label' | 'score' | 'arcs' | 'target' | 'basedOn' | 'band' | 'state' | 'quiet'>): string {
  const based = basedLine(p, true)!;
  if (!isNum(p.score) || p.state === 'none') return `${p.label}: no score yet; ${based}`;
  if (p.quiet) return `${p.label}${p.band ? `, ${p.band.toLowerCase()}` : ''}; ${based}`;
  const arcs = p.arcs.map((a) => `${a.label.toLowerCase()} ${isNum(a.score) ? formatNumber(a.score) : a.needs ?? 'not yet'}`).join(', ');
  const parts = [`${p.label} ${formatNumber(p.score)} of 100: ${arcs}`];
  if (isNum(p.target)) parts.push(`target ${formatNumber(p.target)}`);
  parts.push(based);
  if (p.state === 'stale') parts.push('stale');
  return parts.join('; ');
}

function labelPlace(id: DayArcId, r: number): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
  const [x, y] = polar(C, C, r, CENTRE[id]);
  if (id === 'recovery') return { x, y: y - 2, anchor: 'middle' };
  return { x, y: y + 10, anchor: id === 'activity' ? 'start' : 'end' };
}

export function DayDisc(props: DayDiscProps) {
  const { label, score, arcs, target, basedOn, band, size = 'full', state = 'normal', quiet = false, twin = true, chips = true, targetStrip = true, className } = props;
  const id = useId();
  const [table, setTable] = useState(false);
  const sc = state === 'none' || !isNum(score) ? null : score;
  const none = sc === null;
  const based = basedLine({ arcs, basedOn, quiet }, false);
  const spoken = spokenDisc(props);
  const compact = size === 'compact';
  const weights = arcWeights(arcs);
  const lowConf = arcs.filter((a) => a.confidence === 'low' && isNum(a.score));
  return (
    <div className={cx('lmv lmv-disc', className)} data-size={size} data-state={state}>
      <div className="lmv-disc__figure" role="img" aria-label={spoken}>
        <svg className="lmv-disc__svg lmc-lv-svg" viewBox={compact ? `${C - 100} ${C - 100} 200 200` : `0 0 ${VB} ${VB}`} aria-hidden="true">
          {arcs.map((a) => {
            const lit = none ? 0 : litDots(a.score, quiet);
            const a0 = CENTRE[a.id] - ARC_SPAN / 2;
            const missing = !isNum(a.score);
            const place = labelPlace(a.id, DISC_R + 16);
            return (
              <g key={a.id} data-arc={a.id} data-missing={missing || undefined} data-low={(!missing && a.confidence === 'low') || undefined}>
                {missing ? (
                  <path className="lmv-disc__missing" d={arcPath(C, C, DISC_R, a0, a0 + ARC_SPAN)} />
                ) : (
                  arcDots(a.id).map(([x, y], k) => <circle key={k} cx={x} cy={y} r={compact ? 3.2 : 2} data-lit={k < lit || undefined} />)
                )}
                {compact ? null : (
                  <text className="lmv-disc__name" x={place.x} y={place.y} textAnchor={place.anchor}>
                    {a.label}
                    {missing && a.needs ? (
                      <tspan className="lmv-disc__needs" x={place.x} dy={14}>
                        {quiet ? quietWords(a.needs) : a.needs}
                      </tspan>
                    ) : null}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="lmv-disc__centre" aria-hidden="true">
          {quiet ? null : (
            <span className="lmv-disc__score">
              {sc === null ? '—' : formatNumber(sc)}
              {state === 'stale' ? <span className="lmv-stale-dot" /> : null}
            </span>
          )}
          {!compact && band && !none ? <span className="lmv-disc__band">{band}</span> : null}
          {!compact && none ? <span className="lmv-disc__band">No score yet</span> : null}
          {!compact && based ? <span className="lmv-disc__based">{based}</span> : null}
        </div>
      </div>
      {!compact && chips && lowConf.length ? (
        <div className="lmv-disc__chips">
          {lowConf.map((a) => (
            <span key={a.id} className="lm-chip lmv-chip" data-kind="qualifier">
              {a.label} · low confidence
            </span>
          ))}
        </div>
      ) : null}
      {!compact && targetStrip && isNum(target) ? (
        <TickStrip
          className="lmv-disc__target"
          label={`${label} against the target`}
          value={sc}
          goal={target}
          domain={[0, 100]}
          valueText={sc === null ? '—' : formatNumber(sc)}
          goalText={`target ${formatNumber(target)}`}
          goalWord="Target"
          statusText={sc === null ? undefined : sc >= target ? 'Target met' : `${formatNumber(target - sc)} below target`}
          state={sc === null ? 'future' : state === 'learning' ? 'learning' : 'normal'}
          quiet={quiet}
          quietText={sc === null ? '' : sc >= target ? 'at or above the target' : 'below the target'}
        />
      ) : null}
      {!compact && twin && !quiet && !none ? (
        <div className="lmv-disc__foot">
          <TwinKey open={table} onToggle={() => setTable((o) => !o)} controls={`${id}-twin`} />
        </div>
      ) : null}
      {table && !compact ? (
        <TwinTable
          id={`${id}-twin`}
          title={`${label} table`}
          caption={spoken}
          rows={arcs.length}
          rowNoun={['score', 'scores']}
          fileName="vitals-day-score.csv"
          csv={() => toCSV([['part', 'score', 'weight %', 'confidence'], ...arcs.map((a) => [a.label, isNum(a.score) ? a.score : '', Math.round((weights.get(a.id) ?? 0) * 100), a.confidence ?? ''])])}
        >
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col">Score</th>
              <th scope="col">Weight</th>
              <th scope="col">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {arcs.map((a) => (
              <tr key={a.id}>
                <th scope="row">{a.label}</th>
                <td>{isNum(a.score) ? formatNumber(a.score) : '—'}</td>
                <td>{`${Math.round((weights.get(a.id) ?? 0) * 100)}\u00a0%`}</td>
                <td>{a.confidence ? `${a.confidence[0]!.toUpperCase()}${a.confidence.slice(1)}` : (a.needs ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </TwinTable>
      ) : null}
    </div>
  );
}
