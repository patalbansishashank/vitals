/* ==========================================================================
   <Rail>, <RailRow>, <RailNode> (r071 0B, AUDIT §5.2): the day rail that Today's plan, Food's meals and Train's
   exercises share. A time, a node on a hairline spine, what the stop is and its targets, keys. It is the extraction
   of the `.lv-item` rail in src/features/living/living.css (lines 636-912), which stays where it is until the last
   page has moved here (closing sweep).

   Differences from the extracted rail, on purpose:
   - one node: a 28 px ring (44 px on request) inside a 44 px press target (was 40 x 44), instead of a 40 x 44 tick
     around a 28 px ring on Today and an 11 px status dot on Food and Train;
   - the spine is two hairlines per row, from the row's edge to the ring, so it runs unbroken whatever a row's height
     (no 100vh pseudo-elements, no overflow clip);
   - done is a gold disc with a check that draws itself (stroke-dashoffset 220 ms, the fill 140 ms); a partial stop is
     half gold, a skipped one is struck, one filled in for you is dashed; an exercise draws one ring segment per set;
   - the stop's title is the row's one tap target (a stretched button); its meta line is MonoMeta.
   Gold marks done (the action colour); a data hue only ever tints a glyph.
   ========================================================================== */
import type { CSSProperties, ReactNode } from 'react';
import { cx } from './lib/cx';
import { Icon, type IconComponent } from './icons/Icon';
import { MonoMeta } from './MonoMeta';
import type { Domain } from './domain';
import { DEG, arcPath } from './viz/geometry';
import './rail.css';

export type RailStatus = 'empty' | 'done' | 'partial' | 'skipped' | 'assumed';

export interface RailNodeProps {
  /** empty: a ring · done: gold with a check · partial: half gold · skipped: struck · assumed: dashed (filled in for you). */
  status: RailStatus;
  /** An exercise: one ring segment per set (2 to 12), `lit` of them gold. */
  segments?: number;
  /** Segments lit; defaults to all of them when `status` is done, else none. */
  lit?: number;
  /** A glyph inside the ring (a meal, a lift): tinted by `hue`. Hidden once the stop is done (the check shows). */
  glyph?: IconComponent;
  hue?: Domain;
  /** A short mono figure inside the ring (the set count). */
  number?: ReactNode;
  /** The ring's diameter: 28 (default) or 44. The press target is 44 px either way. */
  size?: 28 | 44;
  /** The accessible name: "Snack: log as planned". */
  label: string;
  /** Makes the node a button (the tick). Absent: a status mark with the same name. */
  onPress?: () => void;
}

export interface SegmentArc {
  index: number;
  a0: number;
  a1: number;
  lit: boolean;
}

/**
 * The arcs of a segmented ring, clockwise from 12 o'clock: `n` equal arcs with a gap between them, the first `lit`
 * lit. A gap of 16° (less when there are many segments). Pure; radians.
 */
export function segmentArcs(n: number, lit = 0): SegmentArc[] {
  const count = Math.max(2, Math.min(12, Math.round(n)));
  const gap = Math.min(16, (360 / count) * 0.45) * DEG;
  const step = (Math.PI * 2) / count;
  return Array.from({ length: count }, (_, i) => ({ index: i, a0: i * step + gap / 2, a1: (i + 1) * step - gap / 2, lit: i < lit }));
}

const R = 12.9; // ring radius inside the 28 box: the 1.5 px stroke stays inside it

/** The node of a rail row: the tick. */
export function RailNode({ status, segments, lit, glyph, hue, number, size = 28, label, onPress }: RailNodeProps) {
  const segmented = typeof segments === 'number' && segments >= 2;
  const litCount = segmented ? Math.max(0, Math.min(segments!, lit ?? (status === 'done' ? segments! : 0))) : 0;
  const arcs = segmented ? segmentArcs(segments!, litCount) : [];
  const inner = (
    <span className="lm-rail__ring" aria-hidden="true">
      {segmented ? (
        <svg className="lm-rail__arcs" viewBox="0 0 28 28">
          {arcs.map((a) => (
            <path key={a.index} d={arcPath(14, 14, R, a.a0, a.a1)} data-lit={a.lit || undefined} />
          ))}
        </svg>
      ) : null}
      <span className="lm-rail__fill" />
      {glyph ? <Icon icon={glyph} size={size === 44 ? 22 : 16} className="lm-rail__glyph" /> : number !== undefined && number !== null ? <span className="lm-rail__num">{number}</span> : null}
      <svg className="lm-rail__check" viewBox="0 0 24 24" focusable="false">
        <path d="M6.5 12.6l3.7 3.7 7.3-8.1" pathLength={1} />
      </svg>
    </span>
  );
  const common = {
    className: 'lm-rail__node',
    'data-status': status,
    'data-size': size,
    'data-segmented': segmented || undefined,
    'data-hue': hue,
  } as const;
  return onPress ? (
    <button type="button" {...common} aria-label={label} onClick={onPress}>
      {inner}
    </button>
  ) : (
    <span {...common} role="img" aria-label={label}>
      {inner}
    </span>
  );
}

export interface RailProps {
  children: ReactNode;
  /** Where the time sits: before the node (default, as the extracted rail) or at the row's end (a list card). */
  timeAt?: 'start' | 'end';
  /** Region name: "Today's plan". */
  label?: string;
  className?: string;
}

/**
 * The rail: a list of `RailRow`s on one hairline spine. A rail where no row has a time drops the time column (CSS
 * `:has`), so its nodes line up with the card's text edge instead of sitting behind an empty gutter.
 */
export function Rail({ children, timeAt = 'start', label, className }: RailProps) {
  return (
    <ul className={cx('lm-rail', className)} role="list" data-time-at={timeAt} aria-label={label}>
      {children}
    </ul>
  );
}

export interface RailRowProps {
  /** "17:30": mono, tabular. */
  time?: string;
  /** A `<RailNode />`. */
  node: ReactNode;
  /** The stop: the dish, the lift, "Weigh in". 16/500; when `onOpen` is given it is the row's one tap target. */
  title: ReactNode;
  /** The facts under it, in mono caps: a string, or several facts that are joined with " · ". */
  meta?: ReactNode | ReadonlyArray<ReactNode>;
  /** Keys at the row's end (a status, "Log"): they sit above the stretched title button. */
  trailing?: ReactNode;
  /** Opens the stop's sheet. Makes the title a button whose target is the whole row. */
  onOpen?: () => void;
  /** A gold-soft wash: the row a jump landed on. */
  highlight?: boolean;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

export function RailRow({ time, node, title, meta, trailing, onOpen, highlight, id, className, style }: RailRowProps) {
  const metaItems = Array.isArray(meta) ? (meta as ReadonlyArray<ReactNode>) : undefined;
  const hasMeta = metaItems ? metaItems.some((m) => m !== null && m !== undefined && m !== false && m !== '') : meta !== undefined && meta !== null && meta !== false && meta !== '';
  return (
    <li className={cx('lm-rail__row', className)} id={id} style={style} data-highlight={highlight || undefined} data-open={onOpen ? true : undefined}>
      {time ? <span className="lm-rail__time">{time}</span> : null}
      {node}
      <div className="lm-rail__body">
        {onOpen ? (
          <button type="button" className="lm-rail__title" onClick={onOpen}>
            {title}
          </button>
        ) : (
          <span className="lm-rail__title">{title}</span>
        )}
        {hasMeta ? (
          <MonoMeta as="div" className="lm-rail__meta" tone="hue" items={metaItems} size="sm">
            {metaItems ? undefined : (meta as ReactNode)}
          </MonoMeta>
        ) : null}
      </div>
      {trailing ? <div className="lm-rail__trail">{trailing}</div> : null}
    </li>
  );
}
