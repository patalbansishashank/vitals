/* ==========================================================================
   <StackBar> (r071, AUDIT §5.2): one whole in parts, as ONE bar. It replaces the ShareBar rows used for a single whole
   (the night's stages, the heart-rate zones, the energy kinds, storage, a grade mix, a driver bar). One 10 px bar
   (6 px at `sm`), 2 px card-colour gaps, each part as wide as its share, never narrower than 6 px; under it the legend
   that names every part with its value: colour is never alone. The legend is a 2 x 2 grid on a phone and four columns
   from 1024.

   - Quiet: names and shares in words (none, a small part, some, a large part, most), no value anywhere.
   - Parts that do not add up to the whole leave the rest as the bare unlit track: a partial night is drawn partial.
   - Segments grow by their share on first view (700 ms, 60 ms apart); the gaps stay.
   ========================================================================== */
import { useRef, type CSSProperties } from 'react';
import { cx } from '../lib/cx';
import { useInView } from '@/app/motion';
import type { Domain } from '../domain';
import { clamp, speak } from './geometry';
import { shareText, type ShareBarRow } from './ShareBar';
import { InlineTwin, twinFileName, type TwinData } from './twin';
import './viz-base.css';
import './stack.css';

export interface StackBarProps {
  /** "Where it went so far" */
  label: string;
  /** The parts, in the order they are drawn. `hue` is a token colour, e.g. 'var(--lm-intensity-resting)'. */
  rows: ReadonlyArray<ShareBarRow>;
  /** What the parts add up to, said in the sentence and the table ("1,096 kcal"): the bar itself is the shares. */
  total?: number | string;
  size?: 'md' | 'sm';
  /** `below` the grid (default) · `inline` one wrapping line · `none` (a card that names the parts elsewhere). */
  legend?: 'below' | 'inline' | 'none';
  quiet?: boolean;
  animate?: boolean;
  /** Override the card's domain colours for this picture (the parts carry their own colours). */
  hue?: Domain;
  /** Draw the "Table" key and the table twin under the picture. */
  twin?: boolean;
  className?: string;
}

/* ------------------------------------------------------------------ pure model */

export interface StackSegment {
  id: string;
  label: string;
  valueText: string;
  share: number;
  hue: string;
  unknown: boolean;
}

export interface StackModel {
  /** The parts with a share: drawn in the bar. */
  segments: StackSegment[];
  /** Every part, in order: the legend lists them all, a zero included. */
  parts: StackSegment[];
  /** The unfilled remainder of the track (0 when the parts add up to the whole). */
  rest: number;
}

/** The shares clamped to 0..1, the parts that are drawn and the remainder of the track. Pure. */
export function stackModel(rows: ReadonlyArray<ShareBarRow>): StackModel {
  const parts = rows.map((r) => ({ id: r.id, label: r.label, valueText: r.valueText, share: Number.isFinite(r.share) ? clamp(r.share, 0, 1) : 0, hue: r.hue, unknown: Boolean(r.unknown) }));
  const segments = parts.filter((p) => p.share > 0);
  const sum = segments.reduce((s, p) => s + p.share, 0);
  const rest = sum < 0.995 ? 1 - sum : 0;
  return { segments, parts, rest };
}

/** The share in words (quiet mode): none, a small part, some, a large part, most. */
export function shareWord(share: number): string {
  const s = clamp(share, 0, 1);
  return s === 0 ? 'none' : s < 0.1 ? 'a small part' : s < 0.34 ? 'some' : s < 0.67 ? 'a large part' : 'most';
}

type SpokenInput = Pick<StackBarProps, 'label' | 'rows' | 'total' | 'quiet'>;

/**
 * "Where it went so far: resting 742, light 238, active 84, exercise 32; total 1 096 kcal". Quiet: "...: resting most,
 * light some". A part with no share is said too (zero is a fact). Pure.
 */
export function spokenStack(p: SpokenInput): string {
  const m = stackModel(p.rows);
  if (!m.parts.length) return `${p.label}: nothing to show`;
  const words = m.parts.map((r) => (p.quiet ? `${r.label.toLowerCase()} ${shareWord(r.share)}` : `${r.label.toLowerCase()} ${r.valueText}`));
  const total = !p.quiet && p.total !== undefined && p.total !== '' ? `; total ${p.total}` : '';
  return speak(`${p.label}: ${words.join(', ')}${total}`);
}

/** The Table twin: each part with its value and its share. Pure. */
export function stackTwin(p: SpokenInput): TwinData {
  const m = stackModel(p.rows);
  const byId = new Map(p.rows.map((r) => [r.id, r]));
  const rows: Array<Array<string | number>> = m.parts.map((r) => [r.label, r.valueText, shareText(byId.get(r.id)!)]);
  if (p.total !== undefined && p.total !== '') rows.push(['Total', String(p.total), '']);
  return { title: `${p.label} table`, caption: spokenStack(p), head: ['Part', 'Value', 'Share'], rows, fileName: twinFileName(p.label), rowNoun: ['part', 'parts'] };
}

/* ------------------------------------------------------------------ component */

export function StackBar(props: StackBarProps) {
  const { size = 'md', legend = 'below', quiet = false, animate = true, hue, twin = false, className } = props;
  const rows = props.rows;
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref);
  const pending = animate && !inView;
  const m = stackModel(rows);
  const spoken = spokenStack(props);
  return (
    <div ref={ref} className={cx('lmz lmz-stack', className)} data-size={size} data-legend={legend} data-hue={hue} data-reveal={pending ? 'pending' : undefined}>
      <div className="lmz-stack__plot" role="img" aria-label={spoken}>
        <div className="lmz-stack__bar" aria-hidden="true">
          {m.segments.map((s, i) => (
            <i
              key={s.id}
              className="lmz-stack__seg"
              data-unknown={s.unknown || undefined}
              style={{ flexGrow: Math.round(s.share * 1000), '--i': i, ...(s.unknown ? null : { background: s.hue }) } as CSSProperties}
            />
          ))}
          {m.rest > 0 ? <i className="lmz-stack__rest" style={{ flexGrow: Math.round(m.rest * 1000) }} /> : null}
        </div>
      </div>
      {legend !== 'none' && m.parts.length ? (
        <ul className="lmz-stack__legend" aria-hidden="true">
          {m.parts.map((r) => (
            <li key={r.id} className="lmz-stack__item">
              <span className="lm-mono lmz-stack__name" data-size="sm">
                <i className="lmz-stack__sw" data-unknown={r.unknown || undefined} style={r.unknown ? undefined : { background: r.hue }} />
                {r.label}
              </span>
              <b className="lmz-stack__value">{quiet ? shareWord(r.share) : r.valueText}</b>
            </li>
          ))}
        </ul>
      ) : null}
      {twin && !quiet ? <InlineTwin data={stackTwin(props)} /> : null}
    </div>
  );
}
