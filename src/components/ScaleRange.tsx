import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx } from './lib/cx';
import { formatNumber, EN_DASH } from './lib/format';
import { clamp, decimalsOf, pct, snap } from './lib/scale';
import { useLatest } from './lib/hooks';
import { Numerals, WellLayers, defaultSteps, type ScaleLabel, type ScaleZone } from './scaleParts';

export interface ScaleRangeProps {
  label: ReactNode;
  /** [low, high] */
  value: readonly [number, number];
  onChange: (value: [number, number]) => void;
  onCommit?: (value: [number, number]) => void;
  min: number;
  max: number;
  step?: number;
  /** Smallest allowed distance between the thumbs (default one step). */
  minGap?: number;
  minorStep?: number;
  majorStep?: number;
  labels?: ReadonlyArray<ScaleLabel> | false;
  format?: (value: number) => ReactNode;
  unit?: string;
  /** Spoken value per thumb: (value, which) => "window starts 12:00". */
  valueText?: (value: number, which: 'low' | 'high') => string;
  /** Names for each thumb, e.g. ["shortest", "longest"]. */
  thumbLabels?: readonly [string, string];
  zones?: ReadonlyArray<ScaleZone>;
  size?: 'md' | 'sm';
  note?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

type Drag = { id: number; type: string; which: 0 | 1; startX: number; startValue: number; left: number; width: number; moved: boolean };

/**
 * Dual-thumb tuning scale (eating-window limits, sleep window, step ranges).
 * The selected span is a 4 px ink bar at the base of the well. Thumbs cannot
 * cross: the dragged thumb stops at the other one (no swap).
 */
export function ScaleRange({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  minGap,
  minorStep,
  majorStep,
  labels,
  format,
  unit,
  valueText,
  thumbLabels = ['from', 'to'],
  zones,
  size = 'md',
  note,
  disabled = false,
  id,
  className,
}: ScaleRangeProps) {
  const auto = useId();
  const baseId = id ?? `r${auto}`;
  const labelId = `${baseId}-label`;
  const wellRef = useRef<HTMLDivElement>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([null, null]);
  const drag = useRef<Drag | null>(null);
  const [raw, setRaw] = useState<[number, number] | null>(null);

  const { minor, major } = defaultSteps(min, max, minorStep, majorStep);
  const gap = minGap ?? step;
  const decimals = decimalsOf(step);
  const lo = snap(value[0], min, max, step);
  const hi = snap(value[1], min, max, step);
  const shownLo = raw ? raw[0] : lo;
  const shownHi = raw ? raw[1] : hi;
  const latest = useLatest({ lo, hi });

  const show = (v: number): ReactNode => (format ? format(v) : formatNumber(v, decimals));

  /** Move one thumb, stopping at the other. */
  const place = (which: 0 | 1, v: number): [number, number] => {
    const { lo: l, hi: h } = latest.current;
    if (which === 0) return [clamp(v, min, h - gap), h];
    return [l, clamp(v, l + gap, max)];
  };

  const emit = (which: 0 | 1, v: number, commit: boolean) => {
    const next = place(which, v);
    const s: [number, number] = [snap(next[0], min, max, step), snap(next[1], min, max, step)];
    if (s[0] !== latest.current.lo || s[1] !== latest.current.hi) onChange(s);
    if (commit) onCommit?.(s);
    return next;
  };

  const valueAt = (x: number, d: { left: number; width: number }) => min + clamp((x - d.left) / d.width, 0, 1) * (max - min);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0 || !wellRef.current) return;
    const r = wellRef.current.getBoundingClientRect();
    if (r.width <= 0) return;
    const at = valueAt(e.clientX, r);
    const which: 0 | 1 = Math.abs(at - lo) <= Math.abs(at - hi) ? (at > hi ? 1 : 0) : 1;
    const d: Drag = { id: e.pointerId, type: e.pointerType, which, startX: e.clientX, startValue: which === 0 ? lo : hi, left: r.left, width: r.width, moved: false };
    drag.current = d;
    inputs.current[which]?.focus({ preventScroll: true });
    try {
      wellRef.current.setPointerCapture(e.pointerId);
    } catch {
      /* unsupported */
    }
    if (e.pointerType !== 'touch') {
      e.preventDefault();
      d.moved = true;
      setRaw(emit(which, at, false));
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    let v: number;
    if (d.type === 'touch') {
      const dx = e.clientX - d.startX;
      if (!d.moved && Math.abs(dx) < 4) return;
      d.moved = true;
      v = d.startValue + (dx / d.width) * (max - min);
    } else v = valueAt(e.clientX, d);
    setRaw(emit(d.which, v, false));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setRaw(null);
    if (d.moved) onCommit?.([latest.current.lo, latest.current.hi]);
  };

  const onKeyDown = (which: 0 | 1) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) {
      if (/^(Arrow|Page|Home|End)/.test(e.key)) e.preventDefault();
      return;
    }
    const cur = which === 0 ? lo : hi;
    const k = e.shiftKey ? 10 : 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + step * k;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - step * k;
    else if (e.key === 'PageUp') next = cur + major;
    else if (e.key === 'PageDown') next = cur - major;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    emit(which, next, true);
  };

  const speak = (v: number, which: 'low' | 'high') =>
    valueText ? valueText(v, which) : `${formatNumber(v, decimals, { grouping: 'none' })}${unit ? ` ${unit}` : ''}`;
  const pLo = pct(shownLo, min, max);
  const pHi = pct(shownHi, min, max);
  const showNumerals = labels !== false && (size === 'md' || Boolean(labels));

  return (
    <div className={cx('lm-scale', className)} data-size={size} data-dragging={raw !== null || undefined} data-disabled={disabled || undefined} role="group" aria-labelledby={labelId}>
      <div className="lm-scale__top">
        <span className="lm-eng" id={labelId}>
          {label}
        </span>
        <output className="lm-scale__value" htmlFor={`${baseId}-lo ${baseId}-hi`} style={{ cursor: 'default' }}>
          {show(lo)}
          {EN_DASH}
          {show(hi)}
          {unit ? <span className="lm-unit">{unit}</span> : null}
        </output>
      </div>
      <div ref={wellRef} className="lm-scale__well" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
        <WellLayers min={min} max={max} minorStep={minor} majorStep={major} zones={zones} height={size === 'sm' ? 20 : 26} />
        <div className="lm-scale__span" style={{ left: `${pLo}%`, width: `${pHi - pLo}%` }} aria-hidden="true" />
        {([0, 1] as const).map((which) => {
          const p = which === 0 ? pLo : pHi;
          const v = which === 0 ? lo : hi;
          return (
            <div key={which} style={{ display: 'contents' }}>
              <div className="lm-scale__needle" style={{ left: `${p}%` }} aria-hidden="true" />
              <div className="lm-scale__cap" style={{ left: `${p}%` }} aria-hidden="true" />
              <input
                ref={(el) => {
                  inputs.current[which] = el;
                }}
                id={`${baseId}-${which === 0 ? 'lo' : 'hi'}`}
                className="lm-scale__input"
                type="range"
                min={min}
                max={max}
                step={step}
                value={v}
                disabled={disabled}
                aria-label={thumbLabels[which]}
                aria-describedby={labelId}
                aria-valuetext={speak(v, which === 0 ? 'low' : 'high')}
                onKeyDown={onKeyDown(which)}
                onChange={(e) => emit(which, Number(e.target.value), true)}
              />
            </div>
          );
        })}
      </div>
      {showNumerals ? <Numerals min={min} max={max} majorStep={major} labels={labels || undefined} /> : null}
      {note ? <div className="lm-scale__note">{note}</div> : null}
    </div>
  );
}
