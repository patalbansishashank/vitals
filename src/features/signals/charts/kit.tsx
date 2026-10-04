/**
 * Shared pieces for every Body signals chart (design/screens/ring-pages.md §6.3, §6.4, §7, §7.2): the sizes per
 * width, the chart shell (engraved title, header readouts, the plot as one tab stop with a summary, the polite live
 * readout, the "table" key and its table twin, the loading / failed / no-data states), the missing stub and the
 * slot crosshair (pointer, touch drag after 8 px, ←/→, ⇧ seven, Home/End).
 */
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Engraved, Key, cx, useMediaQuery, MQ } from '@/components';
import { useDebouncedText } from '@/features/charts/living/TrendLane';
import './kit.css';

/* ------------------------------------------------------------------------------------------------ sizes (§6.4) */

export interface ChartSizes {
  main: number;
  secondary: number;
  lane: number;
  /** Width of the y tick column. */
  tickCol: number;
  /** Stage row height in the night view. */
  stageRow: number;
  wide: boolean;
}

export function useChartSizes(): ChartSizes {
  const md = useMediaQuery(MQ.md);
  const xl = useMediaQuery(MQ.xl);
  if (xl) return { main: 260, secondary: 160, lane: 72, tickCol: 32, stageRow: 20, wide: true };
  if (md) return { main: 220, secondary: 140, lane: 64, tickCol: 32, stageRow: 20, wide: false };
  return { main: 180, secondary: 120, lane: 56, tickCol: 26, stageRow: 18, wide: false };
}

/* ------------------------------------------------------------------------------------------------ marks (§7.2) */

/** A missing slot: a 4 px hollow stub at the baseline, dashed ink-3 ("no data"). */
export function MissingStub({ x, width, baseline, label }: { x: number; width: number; baseline: number; label?: string }) {
  return (
    <rect className="sg-missing" data-missing="true" x={x + 0.5} y={baseline - 4.5} width={Math.max(1, width - 1)} height={4}>
      {label ? <title>{label}</title> : null}
    </rect>
  );
}

/** Hatch pattern for unknown sleep (45°, 1 px ink-3 lines, 5 px pitch). Put once inside an <svg>; fill `url(#id)`. */
export function HatchDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="5" className="sg-hatch" />
      </pattern>
    </defs>
  );
}

/* ------------------------------------------------------------------------------------------------ crosshair */

/** Slot crosshair per CHART_SPEC §5.1. `slotAt(x)` maps a plot-relative x to a slot index. */
export function useSlotCrosshair(count: number, home: number) {
  const [slot, setSlot] = useState<number | null>(null);
  const down = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));
  return {
    slot: slot === null || count === 0 ? null : clamp(slot),
    set: (i: number | null) => setSlot(i === null ? null : clamp(i)),
    onKeyDown(e: KeyboardEvent<Element>, onEnter?: (i: number) => void): void {
      const cur = slot ?? home;
      let next: number;
      switch (e.key) {
        case 'ArrowLeft':
          next = cur - (e.shiftKey ? 7 : 1);
          break;
        case 'ArrowRight':
          next = cur + (e.shiftKey ? 7 : 1);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = count - 1;
          break;
        case 'Enter':
        case ' ':
          if (onEnter && slot !== null) {
            e.preventDefault();
            onEnter(clamp(slot));
          }
          return;
        case 'Escape':
          if (slot !== null) {
            e.preventDefault();
            setSlot(null);
          }
          return;
        default:
          return;
      }
      e.preventDefault();
      setSlot(clamp(next));
    },
    onFocus: () => setSlot((s) => s ?? clamp(home)),
    onBlur: () => setSlot(null),
    onPointerDown(e: PointerEvent<Element>): void {
      down.current = { x: e.clientX, y: e.clientY, dragging: e.pointerType === 'mouse' };
    },
    onPointerMove(e: PointerEvent<Element>, slotAt: (x: number) => number): void {
      if (e.pointerType !== 'mouse') {
        // touch: a horizontal drag after 8 px moves the crosshair; vertical scrolls the page
        const d = down.current;
        if (!d) return;
        if (!d.dragging) {
          if (Math.abs(e.clientX - d.x) < 8 || Math.abs(e.clientX - d.x) < Math.abs(e.clientY - d.y)) return;
          d.dragging = true;
        }
      }
      const r = e.currentTarget.getBoundingClientRect();
      setSlot(clamp(slotAt(e.clientX - r.left)));
    },
    onPointerUp(e: PointerEvent<Element>, slotAt: (x: number) => number, onTap?: (i: number) => void): void {
      const d = down.current;
      down.current = null;
      if (!d) return;
      const r = e.currentTarget.getBoundingClientRect();
      const i = clamp(slotAt(e.clientX - r.left));
      if (Math.abs(e.clientX - d.x) < 8 && Math.abs(e.clientY - d.y) < 8) {
        setSlot(i);
        onTap?.(i);
      }
    },
    onPointerLeave(e: PointerEvent<Element>): void {
      if (e.pointerType === 'mouse' && e.currentTarget !== document.activeElement) setSlot(null);
    },
  };
}

/* ------------------------------------------------------------------------------------------------ shell */

export type ChartStatus = 'loading' | 'ready' | 'failed';

export interface ChartShellProps {
  /** Engraved lowercase title above the plot ("heart rate through the day"). */
  title: string;
  /** Header readouts / coverage line (right of or under the title). */
  header?: ReactNode;
  /** Accessible summary of the plot (role="img"). */
  summary: string;
  /** The crosshair readout text (mirrored to a polite live region, debounced). */
  readout?: string | null;
  /** Reserved plot height (keeps the layout still while loading). */
  height: number;
  status?: ChartStatus;
  /** Previous frame shown at 40 % with a progress rule while a new period loads. */
  stale?: boolean;
  /** One line over the plot when the period has no data ("No sleep recorded this week."); frame and axes stay. */
  emptyLine?: string | null;
  onRetry?: () => void;
  /** The table twin; the "table" key toggles it. */
  table?: ReactNode;
  /** Lines under the plot (notes, tier line, time-in-zones bar). */
  footer?: ReactNode;
  className?: string;
  /** The plot (an <svg> or a group of them); rendered inside the focusable plot area by the chart itself. */
  children: ReactNode;
}

export const SHELL_COPY = {
  reading: 'reading…',
  failed: 'These readings couldn’t be loaded.',
  retry: 'Try again',
  table: 'table',
  hideTable: 'hide table',
} as const;

export function ChartShell({ title, header, summary, readout, height, status = 'ready', stale, emptyLine, onRetry, table, footer, className, children }: ChartShellProps) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const live = useDebouncedText(readout ?? '');
  return (
    <div className={cx('sg-chart', className)} data-status={status} data-stale={stale ? 'true' : undefined}>
      <div className="sg-chart__head">
        <Engraved as="p" className="sg-chart__title">
          {title}
        </Engraved>
        {header ? <div className="sg-chart__readouts">{header}</div> : null}
      </div>
      <div className="sg-chart__plot" style={{ minHeight: height }}>
        {stale ? <span className="sg-chart__rule" aria-hidden="true" /> : null}
        {status === 'failed' ? (
          <div className="sg-chart__state" role="alert">
            <p>{SHELL_COPY.failed}</p>
            {onRetry ? (
              <Key size="sm" onClick={onRetry}>
                {SHELL_COPY.retry}
              </Key>
            ) : null}
          </div>
        ) : status === 'loading' && !stale ? (
          <div className="sg-chart__state" aria-busy="true">
            <Engraved as="p">{SHELL_COPY.reading}</Engraved>
          </div>
        ) : (
          <div className="sg-chart__frame" aria-label={summary}>
            {children}
            {emptyLine ? <p className="sg-chart__empty">{emptyLine}</p> : null}
          </div>
        )}
      </div>
      {footer ? <div className="sg-chart__foot">{footer}</div> : null}
      {table ? (
        <div className="sg-chart__tablebar">
          <Key size="sm" variant="quiet" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((v) => !v)}>
            {showTable ? SHELL_COPY.hideTable : SHELL_COPY.table}
          </Key>
        </div>
      ) : null}
      {table && showTable ? <div id={tableId}>{table}</div> : null}
      <p className="lm-sr" aria-live="polite">
        {live}
      </p>
    </div>
  );
}

/** Plain table twin (caption visually hidden, numbers tabular). */
export function TwinTable({ caption, head, rows }: { caption: string; head: readonly string[]; rows: ReadonlyArray<ReadonlyArray<ReactNode>> }) {
  return (
    <div className="sg-twin" tabIndex={0} role="region" aria-label={caption}>
      <table className="sg-twin__table">
        <caption className="lm-sr">{caption}</caption>
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
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j} className="lm-num">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
