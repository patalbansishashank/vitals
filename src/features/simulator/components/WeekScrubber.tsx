/**
 * <WeekScrubber> — for long horizons (≥ 13 weeks): the whole schedule as one row of week ticks, each tinted with the
 * week's true energy balance (R-MAINT) and marked when it holds a fast. Drag, click or use the arrow keys to jump the
 * calendar (and the summary strip) to a week. A tuning-scale in the Braun grammar: printed ticks, a needle on the
 * current week, numerals every 4 weeks.
 */
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { rowDays } from '../lib/calendar';
import { balanceLabel, energyFill, energyStep } from '../lib/energy';
import type { ScheduleModel } from '../useScheduleModel';

export interface WeekScrubberProps {
  model: ScheduleModel;
  /** Mean energy per calendar row, % of maintenance at this plan's activity. */
  rowPct: readonly number[];
  focusDay: number;
  /** Jump to a calendar row (0-based week). */
  onJump: (row: number) => void;
}

export function WeekScrubber({ model, rowPct, focusDay, onJump }: WeekScrubberProps) {
  const g = model.grid;
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const rows = g.rows;
  const cur = Math.min(rows - 1, Math.max(0, Math.floor((Math.min(focusDay, g.nDays - 1) + g.offset) / 7)));

  const rowAt = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return cur;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(rows - 1, Math.floor(((clientX - r.left) / Math.max(1, r.width)) * rows)));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onJump(rowAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const r = rowAt(e.clientX);
    if (r !== cur) onJump(r);
  };
  const end = () => {
    dragging.current = false;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    let next: number;
    if (step) next = cur + step * (e.shiftKey ? 4 : 1);
    else if (e.key === 'PageDown') next = cur + 4;
    else if (e.key === 'PageUp') next = cur - 4;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = rows - 1;
    else return;
    e.preventDefault();
    onJump(Math.max(0, Math.min(rows - 1, next)));
  };

  const weekText = (r: number) => {
    const pct = rowPct[r];
    const days = rowDays(g, r);
    const fast = days.some((d) => model.cells[d]?.zero || (model.cells[d]?.fast?.span.hours ?? 0) >= 20);
    return `week ${r + 1} of ${rows}${pct !== undefined && Number.isFinite(pct) ? `, ${balanceLabel(pct)}` : ''}${fast ? ', with a fast' : ''}`;
  };

  return (
    <div className="sim-scrub">
      <span className="lm-eng sim-scrub__label" id="sim-scrub-label">
        weeks
      </span>
      <div
        ref={trackRef}
        className="sim-scrub__track"
        role="slider"
        tabIndex={0}
        aria-labelledby="sim-scrub-label"
        aria-valuemin={1}
        aria-valuemax={rows}
        aria-valuenow={cur + 1}
        aria-valuetext={weekText(cur)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        style={{ gridTemplateColumns: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: rows }, (_, r) => {
          const pct = rowPct[r] ?? 100;
          const days = rowDays(g, r);
          const fast = days.some((d) => model.cells[d]?.zero || (model.cells[d]?.fast?.span.hours ?? 0) >= 20);
          return (
            <span
              key={r}
              className="sim-scrub__wk"
              data-on={r === cur || undefined}
              data-fast={fast || undefined}
              style={{ background: energyFill(energyStep(pct)) }}
              title={weekText(r)}
            />
          );
        })}
        <span className="sim-scrub__needle" aria-hidden="true" style={{ left: `${((cur + 0.5) / rows) * 100}%` }} />
      </div>
      <div className="sim-scrub__nums" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${rows}, minmax(0, 1fr))` }}>
        {Array.from({ length: rows }, (_, r) => (
          <span key={r}>{r === 0 || (r + 1) % 4 === 0 ? r + 1 : ''}</span>
        ))}
      </div>
    </div>
  );
}
