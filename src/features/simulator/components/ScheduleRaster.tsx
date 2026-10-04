/**
 * <ScheduleRaster> — the calendar painter (COMPONENTS §5, simulator-schedule.md §7). Weeks as rows, days as columns,
 * a chronobiology actogram. Arm a program key and drag to paint; drag with nothing armed to select (⌥ = rectangle);
 * ⇧-click extends; a click without movement opens the day editor and never repaints.
 *
 * Touch: tap opens the day editor, or paints the cell when a program is armed (tap-to-paint); long-press (350 ms)
 * then drag paints (armed) or selects a range. Vertical movement before the long-press completes scrolls.
 *
 * Keyboard (role="grid", roving tabindex): arrows move, ⇧+arrows extend, Space toggles, P paints the selection with
 * the armed program, Enter opens the editor, Delete clears, A–Z arm a program, 0 disarms, ⌘C/⌘V copy/paste weeks.
 */
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Glyphs, Icon, cx } from '@/components';
import type { ScheduleModel, CellModel } from '../useScheduleModel';
import {
  WEEKDAYS_SHORT,
  colOf,
  dayAt,
  linearRange,
  rectRange,
  rowOf,
  type CalendarGrid,
} from '../lib/calendar';
import { balanceLabel, energyFill } from '../lib/energy';
import { formatFastHours, type DayFast } from '../lib/fasts';
import { phaseWeeks, type Phase } from '../lib/phases';
import { useEnergyUnit } from '@/state/settingsStore';

export type RasterCommand =
  | { kind: 'paintSelection' }
  | { kind: 'clearSelection' }
  | { kind: 'copyWeek'; row: number }
  | { kind: 'pasteWeeks' }
  | { kind: 'arm'; program: number | null };

export interface ScheduleRasterProps {
  model: ScheduleModel;
  armed: number | null;
  selection: ReadonlySet<number>;
  anchor: number;
  focusDay: number;
  editorDay: number | null;
  /** Selection changed (days, new anchor). */
  onSelect: (days: number[], anchor: number) => void;
  onFocusDay: (day: number) => void;
  onOpenDay: (day: number) => void;
  /** Paint days during a stroke (optimistic); `stroke` is the undo coalescing key. */
  onPaint: (days: number[], stroke: string) => void;
  onStrokeEnd: (stroke: string) => void;
  onCommand: (cmd: RasterCommand) => void;
  onSelectPhase: (p: Phase) => void;
  onRenamePhase?: (p: Phase, name: string) => void;
  /** Mean energy per row (week label ledger, desktop). */
  rowPct?: readonly number[];
  children?: ReactNode;
}

type Drag = {
  id: number;
  touch: boolean;
  start: number;
  last: number;
  mode: 'pending' | 'paint' | 'select';
  rect: boolean;
  moved: boolean;
  stroke: string;
  painted: Set<number>;
  x0: number;
  y0: number;
  timer: number | null;
};

const LONG_PRESS_MS = 350;
const TOUCH_SLOP = 8;
let strokeSeq = 0;

/** Cells on the straight line between two cells in grid coordinates (fast drags never skip cells). */
function lineCells(g: CalendarGrid, a: number, b: number): number[] {
  const r0 = rowOf(g, a);
  const c0 = colOf(g, a);
  const r1 = rowOf(g, b);
  const c1 = colOf(g, b);
  const n = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const d = dayAt(g, Math.round(r0 + (r1 - r0) * t), Math.round(c0 + (c1 - c0) * t));
    if (d >= 0 && !out.includes(d)) out.push(d);
  }
  return out;
}

function dayFromPoint(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-day]');
  if (!el) return null;
  const d = Number(el.dataset.day);
  return Number.isFinite(d) ? d : null;
}

export function ScheduleRaster(p: ScheduleRasterProps) {
  const { model, selection, focusDay, editorDay } = p;
  const g = model.grid;
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef(p);
  useLayoutEffect(() => {
    latest.current = p;
  });
  const [renaming, setRenaming] = useState<number | null>(null);

  // Keep keyboard focus on the focused cell when it moves.
  useEffect(() => {
    const grid = gridRef.current;
    if (
      !grid ||
      !grid.contains(document.activeElement) ||
      !(document.activeElement as HTMLElement)?.dataset.day
    )
      return;
    grid.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus({ preventScroll: false });
  }, [focusDay]);

  // A long-press stroke must not scroll the page (non-passive touchmove).
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onTouchMove = (e: TouchEvent) => {
      const d = drag.current;
      if (d && d.mode !== 'pending') e.preventDefault();
    };
    grid.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => grid.removeEventListener('touchmove', onTouchMove);
  }, []);

  const apply = (d: Drag, day: number) => {
    const P = latest.current;
    if (d.mode === 'paint' && P.armed !== null) {
      const cells = lineCells(g, d.last, day).filter((x) => !d.painted.has(x));
      if (!d.painted.has(d.start)) cells.unshift(d.start);
      for (const c of cells) d.painted.add(c);
      if (cells.length) P.onPaint(cells, d.stroke);
      P.onSelect([...d.painted], d.start);
    } else if (d.mode === 'select') {
      P.onSelect(d.rect ? rectRange(g, d.start, day) : linearRange(d.start, day), d.start);
    }
    d.last = day;
    P.onFocusDay(day);
  };

  const begin = (d: Drag, mode: 'paint' | 'select') => {
    d.mode = mode;
    if (mode === 'select') latest.current.onSelect([d.start], d.start);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const day = dayFromPoint(e.clientX, e.clientY);
    if (day === null) return;
    const P = latest.current;
    const touch = e.pointerType === 'touch';
    if (!touch && e.shiftKey) {
      e.preventDefault();
      P.onSelect(e.altKey ? rectRange(g, P.anchor, day) : linearRange(P.anchor, day), P.anchor);
      P.onFocusDay(day);
      return;
    }
    const d: Drag = {
      id: e.pointerId,
      touch,
      start: day,
      last: day,
      mode: 'pending',
      rect: e.altKey,
      moved: false,
      stroke: `stroke:${++strokeSeq}`,
      painted: new Set(),
      x0: e.clientX,
      y0: e.clientY,
      timer: null,
    };
    drag.current = d;
    if (touch) {
      d.timer = window.setTimeout(() => {
        d.timer = null;
        if (drag.current !== d) return;
        begin(d, latest.current.armed !== null ? 'paint' : 'select');
        try {
          gridRef.current?.setPointerCapture(d.id);
        } catch {
          /* ignore */
        }
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(8);
        apply(d, day);
      }, LONG_PRESS_MS);
    } else {
      e.preventDefault(); // no text selection while dragging
      try {
        gridRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (P.armed === null) begin(d, 'select');
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.touch && d.mode === 'pending') {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > TOUCH_SLOP) cancel();
      return;
    }
    const day = dayFromPoint(e.clientX, e.clientY);
    if (day === null || day === d.last) return;
    if (!d.touch && d.mode === 'pending') begin(d, latest.current.armed !== null ? 'paint' : 'select');
    d.moved = true;
    apply(d, day);
  };

  const cancel = () => {
    const d = drag.current;
    if (d?.timer) window.clearTimeout(d.timer);
    if (d && d.painted.size > 0) latest.current.onStrokeEnd(d.stroke);
    drag.current = null;
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.timer) window.clearTimeout(d.timer);
    drag.current = null;
    const P = latest.current;
    if (d.mode === 'pending' || (!d.moved && d.painted.size <= 1 && !d.touch)) {
      // a tap / click: touch + armed paints the cell; otherwise open the editor (a click never repaints)
      if (d.touch && P.armed !== null && d.mode === 'pending') {
        P.onPaint([d.start], d.stroke);
        P.onStrokeEnd(d.stroke);
        P.onSelect([d.start], d.start);
        P.onFocusDay(d.start);
        return;
      }
      if (d.painted.size > 0) P.onStrokeEnd(d.stroke);
      P.onSelect([d.start], d.start);
      P.onFocusDay(d.start);
      P.onOpenDay(d.start);
      return;
    }
    if (d.painted.size > 0) P.onStrokeEnd(d.stroke);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.dataset.day) return;
    const P = latest.current;
    const n = g.nDays;
    const cur = Number(target.dataset.day);
    const mod = e.metaKey || e.ctrlKey;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowLeft':
        next = cur - 1;
        break;
      case 'ArrowRight':
        next = cur + 1;
        break;
      case 'ArrowUp':
        next = cur - 7;
        break;
      case 'ArrowDown':
        next = cur + 7;
        break;
      case 'Home':
        next = mod ? 0 : Math.max(0, cur - colOf(g, cur));
        break;
      case 'End':
        next = mod ? n - 1 : Math.min(n - 1, cur + 6 - colOf(g, cur));
        break;
      case ' ': {
        e.preventDefault();
        const s = new Set(P.selection);
        if (s.has(cur) && s.size > 1) s.delete(cur);
        else s.add(cur);
        P.onSelect([...s], cur);
        return;
      }
      case 'Enter':
        e.preventDefault();
        P.onOpenDay(cur);
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        P.onCommand({ kind: 'clearSelection' });
        return;
      case 'Escape':
        if (P.selection.size > 1) {
          e.preventDefault();
          P.onSelect([cur], cur);
        }
        return;
      default:
        break;
    }
    if (next !== null) {
      e.preventDefault();
      next = Math.max(0, Math.min(n - 1, next));
      if (e.shiftKey) P.onSelect(linearRange(P.anchor, next), P.anchor);
      else P.onSelect([next], next);
      P.onFocusDay(next);
      return;
    }
    if (mod && !e.altKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      P.onCommand({ kind: 'copyWeek', row: rowOf(g, cur) });
      return;
    }
    if (mod && !e.altKey && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      P.onCommand({ kind: 'pasteWeeks' });
      return;
    }
    if (mod || e.altKey) return;
    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      P.onCommand({ kind: 'paintSelection' });
      return;
    }
    if (e.key === '0') {
      e.preventDefault();
      P.onCommand({ kind: 'arm', program: null });
      return;
    }
    if (/^[a-zA-Z]$/.test(e.key)) {
      const idx = P.model.schedule.programs.findIndex((pr) => pr.id === e.key.toUpperCase());
      if (idx >= 0) {
        e.preventDefault();
        P.onCommand({ kind: 'arm', program: idx });
      }
    }
  };

  const rows: ReactNode[] = [];
  for (let r = 0; r < g.rows; r++) {
    const slots: ReactNode[] = [];
    for (let c = 0; c < 7; c++) {
      const d = dayAt(g, r, c);
      if (d < 0) {
        slots.push(
          <div key={`b${c}`} className="sim-cell sim-cell--blank" role="gridcell" aria-hidden="true" />,
        );
        continue;
      }
      const cell = model.cells[d]!;
      const f = model.fasts[d] ?? null;
      const prev = c > 0 ? model.fasts[d - 1] : null;
      const next = c < 6 ? model.fasts[d + 1] : null;
      const joinL = !!f && f.from <= 0 && !!prev && prev.span === f.span;
      const joinR = !!f && f.to >= 24 && !!next && next.span === f.span;
      slots.push(
        <RasterCell
          key={d}
          cell={cell}
          fast={f}
          joinL={joinL}
          joinR={joinR}
          selected={selection.has(d)}
          editing={editorDay === d}
          tabbable={d === focusDay}
        />,
      );
    }
    const pctRow = p.rowPct?.[r];
    rows.push(
      <div key={r} role="row" className="sim-raster__row" aria-rowindex={r + 2}>
        <div role="rowheader" className="sim-raster__wk">
          <button
            type="button"
            className="sim-raster__wkbtn"
            onClick={(e) => {
              const all: number[] = [];
              for (let c = 0; c < 7; c++) {
                const d = dayAt(g, r, c);
                if (d >= 0) all.push(d);
              }
              if (e.shiftKey)
                latest.current.onSelect([...new Set([...latest.current.selection, ...all])], all[0]!);
              else latest.current.onSelect(all, all[0]!);
              latest.current.onFocusDay(all[0]!);
            }}
            aria-label={`Select week ${r + 1}`}
          >
            <span className="sim-raster__wkno">wk {r + 1}</span>
            {pctRow !== undefined && Number.isFinite(pctRow) ? (
              <span className="sim-raster__wkpct">{Math.round(pctRow)} %</span>
            ) : null}
          </button>
        </div>
        {slots}
      </div>,
    );
  }

  const allDays = () => Array.from({ length: g.nDays }, (_, i) => i);

  return (
    <div className="sim-raster" style={{ gridTemplateRows: `auto repeat(${g.rows}, auto) auto` }}>
      {model.phases.map((ph, i) => (
        <PhaseLabel
          key={`${ph.startDay}-${i}`}
          phase={ph}
          renaming={renaming === i}
          onStartRename={p.onRenamePhase ? () => setRenaming(i) : undefined}
          onRename={(name) => {
            setRenaming(null);
            if (name && name !== ph.name) p.onRenamePhase?.(ph, name);
          }}
          onSelect={() => p.onSelectPhase(ph)}
        />
      ))}
      <div
        ref={gridRef}
        className="sim-raster__grid"
        role="grid"
        style={{ gridRow: `1 / span ${g.rows + 1}` }}
        aria-label={`${model.schedule.horizonDays}-day schedule`}
        aria-rowcount={g.rows + 1}
        aria-colcount={8}
        aria-multiselectable="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancel}
        onKeyDown={onKeyDown}
      >
        <div role="row" className="sim-raster__row sim-raster__head" aria-rowindex={1}>
          <div role="columnheader" className="sim-raster__corner">
            <button
              type="button"
              className="sim-raster__all"
              onClick={() => p.onSelect(allDays(), 0)}
              aria-label="Select all days"
            >
              <span aria-hidden="true">all</span>
            </button>
          </div>
          {WEEKDAYS_SHORT.map((w, i) => (
            <div key={w} role="columnheader" className="sim-raster__dow" data-weekend={i >= 5 || undefined}>
              {w}
            </div>
          ))}
        </div>
        {rows}
      </div>
      {p.children ? (
        <div className="sim-raster__foot" style={{ gridRow: g.rows + 2 }}>
          {p.children}
        </div>
      ) : null}
    </div>
  );
}

/** Auto names of energy regimes (lib/phases `autoName`); such blocks are shown by their true balance. */
const REGIME_NAMES = new Set(['deficit', 'maintenance', 'surplus']);

function PhaseLabel({
  phase,
  renaming,
  onStartRename,
  onRename,
  onSelect,
}: {
  phase: Phase;
  renaming: boolean;
  onStartRename?: () => void;
  onRename: (name: string) => void;
  onSelect: () => void;
}) {
  const unit = useEnergyUnit();
  const style = { gridRow: `${phase.row0 + 2} / ${phase.row1 + 3}` } as CSSProperties;
  const sub = phaseWeeks(phase);
  // true planned balance against maintenance at this plan's activity (R-MAINT), not the habitual week; an auto-named
  // regime block ("deficit") is simply named by it ("deficit 20 %")
  const regime = !phase.explicit && REGIME_NAMES.has(phase.name);
  const shownName = regime ? balanceLabel(phase.pct) : phase.name;
  const bal = regime ? null : balanceLabel(phase.pct);
  const balLong = `${balanceLabel(phase.pct, phase.balanceKcal, unit)} a day at this plan’s activity`;
  if (renaming) {
    return (
      <div className="sim-phase" style={style} data-explicit={phase.explicit || undefined}>
        <input
          className="sim-phase__input"
          defaultValue={phase.name}
          aria-label="Block name"
          maxLength={40}
          autoFocus
          onBlur={(e) => onRename(e.currentTarget.value.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRename(e.currentTarget.value.trim());
            if (e.key === 'Escape') onRename(phase.name);
          }}
        />
        <span className="sim-phase__sub">{sub}</span>
        {bal ? <span className="sim-phase__sub sim-phase__bal">{bal}</span> : null}
      </div>
    );
  }
  return (
    <div className="sim-phase" style={style} data-explicit={phase.explicit || undefined}>
      <button
        type="button"
        className="sim-phase__btn"
        onClick={onSelect}
        onDoubleClick={onStartRename}
        title={`${regime ? '' : `${phase.name} · `}${sub} · ${balLong}${onStartRename ? ' · double-click to rename' : ''}`}
      >
        <span className="sim-phase__name">{shownName}</span>
        <span className="sim-phase__sub">{sub}</span>
        {bal ? <span className="sim-phase__sub sim-phase__bal">{bal}</span> : null}
      </button>
    </div>
  );
}

interface CellProps {
  cell: CellModel;
  fast: DayFast | null;
  joinL: boolean;
  joinR: boolean;
  selected: boolean;
  editing: boolean;
  tabbable: boolean;
}

const RasterCell = memo(function RasterCell({
  cell,
  fast,
  joinL,
  joinR,
  selected,
  editing,
  tabbable,
}: CellProps) {
  const full = !!fast?.full || cell.zero;
  const partial = !!fast && !full;
  const style: CSSProperties = full ? {} : { background: energyFill(cell.step) };
  const label = full
    ? fast?.isLabelDay || !fast
      ? formatFastHours(fast?.span.hours ?? 24)
      : 'fast'
    : `${Math.round(cell.pct)}%`;
  return (
    <div
      role="gridcell"
      className={cx('sim-cell', full && 'sim-cell--fast')}
      data-day={cell.day}
      data-sel={selected || undefined}
      data-edit={editing || undefined}
      data-join-l={joinL || undefined}
      data-join-r={joinR || undefined}
      data-flag={cell.flag ?? undefined}
      aria-selected={selected}
      aria-label={cell.ariaLabel}
      tabIndex={tabbable ? 0 : -1}
      style={style}
    >
      <span className="sim-cell__top" aria-hidden="true">
        <span className="sim-cell__letter">{cell.letter}</span>
        <span className="sim-cell__pct">{label}</span>
      </span>
      <span className="sim-cell__glyphs" aria-hidden="true">
        {fast?.isStart ? <Icon icon={Glyphs.FastClock} size={16} /> : null}
        {cell.lift || cell.cardio ? (
          // training source (R-DETRAIN): sessions of the usual week carry a dotted underline, custom ones do not
          <span className="sim-cell__train" data-source={cell.training}>
            {cell.lift ? <Icon icon={Glyphs.DumbbellPlate} size={16} /> : null}
            {cell.cardio ? <Icon icon={Glyphs.Footsteps} size={16} /> : null}
          </span>
        ) : null}
        {cell.highSteps && !cell.cardio ? <Icon icon={Glyphs.Footsteps} size={16} /> : null}
        {cell.shortWindow && !fast ? <Icon icon={Glyphs.SleepArc} size={16} /> : null}
      </span>
      {cell.shares && !full ? (
        <span className="sim-cell__bar" aria-hidden="true">
          <i style={{ flexGrow: cell.shares[0], background: 'var(--lm-macro-protein)' }} />
          <i style={{ flexGrow: cell.shares[1], background: 'var(--lm-macro-carbs)' }} />
          <i style={{ flexGrow: cell.shares[2], background: 'var(--lm-macro-fat)' }} />
        </span>
      ) : null}
      {partial && fast ? (
        <span
          className="sim-cell__band"
          aria-hidden="true"
          data-join-l={fast.from <= 0 || undefined}
          data-join-r={fast.to >= 24 || undefined}
          style={{ left: `${(fast.from / 24) * 100}%`, right: `${100 - (fast.to / 24) * 100}%` }}
        />
      ) : null}
      {cell.flag ? (
        <span className="sim-cell__flag" data-severity={cell.flag} aria-hidden="true">
          <Icon icon={cell.flag === 'caution' ? Glyphs.CautionMark : Glyphs.DangerMark} size={16} />
        </span>
      ) : null}
      {cell.override ? <span className="sim-cell__ov" aria-hidden="true" /> : null}
    </div>
  );
});
