import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { cx } from './lib/cx';
import { formatNumber, parseNumber } from './lib/format';
import { clamp, decimalsOf, pct, snap } from './lib/scale';
import { useLatest } from './lib/hooks';
import { Icon } from './icons/Icon';
import { Tooltip } from './Tooltip';
import { Numerals, WellLayers, defaultSteps, type ScaleLabel, type ScaleZone } from './scaleParts';

export type { ScaleZone, ScaleLabel, ZoneTone } from './scaleParts';

export interface ScaleSliderProps {
  /** Engraved caption, lowercase ("body fat"). */
  label: ReactNode;
  value: number;
  /** Fires continuously while dragging (every frame) and on every key step. */
  onChange: (value: number) => void;
  /** Fires once when a gesture ends (pointer release, key step, typed entry). Use for expensive work. */
  onCommit?: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Printed scale: minor tick every `minorStep`, major (and PgUp/PgDn step) every `majorStep`. */
  minorStep?: number;
  majorStep?: number;
  /** Numerals under the scale. Default: major ticks (md only). `false` hides them. */
  labels?: ReadonlyArray<ScaleLabel> | false;
  /** Readout content for a value (without unit). Default: fixed decimals of `step`. */
  format?: (value: number) => ReactNode;
  /** Unit after the readout ("%", "kg"); set one step smaller in ink-2. */
  unit?: string;
  /** aria-valuetext, spoken with units: "23.4 percent body fat, likely 20 to 27". */
  valueText?: (value: number) => string;
  /** Background zones printed in the well (energy tints, caution/danger regions). */
  zones?: ReadonlyArray<ScaleZone>;
  /** Likely-range underlay (4 px bar at the base of the well). */
  likelyRange?: readonly [number, number];
  /** Labelled reference tick ("maintenance", "typical"). */
  reference?: { value: number; label?: string };
  /** `md` 28 px well with numerals (default) · `sm` 22 px, no numerals by default. */
  size?: 'md' | 'sm';
  /** Help line under the scale. */
  note?: ReactNode;
  /** Value is driven by something else (e.g. a waist measurement): dimmed, lock icon, not draggable. */
  locked?: boolean;
  lockedReason?: string;
  disabled?: boolean;
  /** Double-click the readout (or press Enter on the slider) to type an exact value. Default true. */
  editable?: boolean;
  id?: string;
  className?: string;
}

type Drag = { id: number; type: string; startX: number; startValue: number; left: number; width: number; moved: boolean };

/**
 * The tuning-scale slider — a radio tuning window turned into a control
 * (signature, COMPONENTS §3). A native range input underneath provides the
 * semantics; the well draws the printed scale, zones, likely range, needle and cap.
 *
 * Pointer: jump-to-pointer with mouse/pen; relative drag on touch (no accidental
 * jumps, vertical scroll still works). Keyboard: ←/→ step, ⇧ ×10, PgUp/PgDn major,
 * Home/End, Enter to type. Horizontal wheel adjusts while focused.
 */
export function ScaleSlider({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  minorStep,
  majorStep,
  labels,
  format,
  unit,
  valueText,
  zones,
  likelyRange,
  reference,
  size = 'md',
  note,
  locked = false,
  lockedReason,
  disabled = false,
  editable = true,
  id,
  className,
}: ScaleSliderProps) {
  const auto = useId();
  const inputId = id ?? `s${auto}`;
  const noteId = note ? `${inputId}-note` : undefined;
  const wellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag | null>(null);
  const wheelAcc = useRef(0);
  const [raw, setRaw] = useState<number | null>(null);
  const [rider, setRider] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editError, setEditError] = useState(false);

  const { minor, major } = defaultSteps(min, max, minorStep, majorStep);
  const decimals = decimalsOf(step);
  const inert = disabled || locked;
  const snapped = snap(value, min, max, step);
  const pos = pct(raw ?? snapped, min, max);

  const show = (v: number): ReactNode => (format ? format(v) : formatNumber(v, decimals));
  const speak = (v: number): string => {
    if (valueText) return valueText(v);
    const base = `${formatNumber(v, decimals, { grouping: 'none' })}${unit ? ` ${unit}` : ''}`;
    return likelyRange ? `${base}, likely ${formatNumber(likelyRange[0], decimals)} to ${formatNumber(likelyRange[1], decimals)}` : base;
  };

  const latest = useLatest({ value: snapped, onChange, onCommit, inert, step, min, max });

  const emit = (v: number, commit: boolean) => {
    const s = snap(v, min, max, step);
    if (s !== latest.current.value) onChange(s);
    if (commit) onCommit?.(s);
  };

  /* ---- pointer ------------------------------------------------------------ */
  const valueAt = (clientX: number, d: Drag) => min + clamp((clientX - d.left) / d.width, 0, 1) * (max - min);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (inert || e.button !== 0 || !wellRef.current) return;
    const r = wellRef.current.getBoundingClientRect();
    if (r.width <= 0) return;
    const d: Drag = { id: e.pointerId, type: e.pointerType, startX: e.clientX, startValue: snapped, left: r.left, width: r.width, moved: false };
    drag.current = d;
    inputRef.current?.focus({ preventScroll: true });
    try {
      wellRef.current.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported (tests) */
    }
    if (e.pointerType !== 'touch') {
      e.preventDefault();
      d.moved = true;
      const v = valueAt(e.clientX, d);
      setRaw(v);
      setRider(true);
      emit(v, false);
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
      v = clamp(d.startValue + (dx / d.width) * (max - min), min, max);
    } else {
      v = valueAt(e.clientX, d);
    }
    setRaw(v);
    emit(v, false);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setRaw(null);
    setRider(false);
    if (d.moved) onCommit?.(latest.current.value);
  };

  /* ---- wheel (horizontal, while focused) --------------------------------- */
  useEffect(() => {
    const well = wellRef.current;
    if (!well) return;
    const onWheel = (e: WheelEvent) => {
      const l = latest.current;
      if (l.inert || document.activeElement !== inputRef.current) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      wheelAcc.current += e.deltaX;
      const steps = Math.trunc(wheelAcc.current / 12);
      if (steps !== 0) {
        wheelAcc.current -= steps * 12;
        const next = snap(l.value + steps * l.step, l.min, l.max, l.step);
        if (next !== l.value) {
          l.onChange(next);
          l.onCommit?.(next);
        }
      }
    };
    well.addEventListener('wheel', onWheel, { passive: false });
    return () => well.removeEventListener('wheel', onWheel);
  }, [latest]);

  /* ---- keyboard ------------------------------------------------------------ */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (inert) {
      // a locked scale must not move through the native range's default key handling either
      if (/^(Arrow|Page|Home|End)/.test(e.key)) e.preventDefault();
      return;
    }
    let next: number;
    const k = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = snapped + step * k;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = snapped - step * k;
        break;
      case 'PageUp':
        next = snapped + major;
        break;
      case 'PageDown':
        next = snapped - major;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      case 'Enter':
        if (editable) {
          e.preventDefault();
          startEdit();
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    emit(next, true);
  };

  /* ---- typed entry ---------------------------------------------------------- */
  const startEdit = () => {
    if (inert || !editable) return;
    setEditError(false);
    setEditing(formatNumber(snapped, decimals, { grouping: 'none' }));
  };
  const finishEdit = (commit: boolean) => {
    if (editing === null) return;
    if (commit) {
      const n = parseNumber(editing);
      if (n === null) {
        setEditError(true);
        return;
      }
      emit(clamp(n, min, max), true);
    }
    setEditing(null);
    setEditError(false);
    inputRef.current?.focus({ preventScroll: true });
  };

  const showNumerals = labels !== false && (size === 'md' || Boolean(labels));

  const wellHeight = size === 'sm' ? 20 : 26;
  const lockIcon = locked ? (
    <span className="lm-scale__lock">
      <Icon icon={Lock} size={16} label={lockedReason ?? 'Locked'} />
    </span>
  ) : null;

  return (
    <div
      className={cx('lm-scale', className)}
      data-size={size}
      data-dragging={raw !== null || undefined}
      data-locked={locked || undefined}
      data-disabled={disabled || undefined}
    >
      <div className="lm-scale__top">
        <label className="lm-eng" htmlFor={inputId}>
          {label}
        </label>
        {lockIcon && lockedReason ? <Tooltip content={lockedReason}>{lockIcon}</Tooltip> : lockIcon}
        {editing !== null ? (
          <input
            className="lm-scale__edit"
            autoFocus
            inputMode="decimal"
            aria-label={`Type a value${unit ? ` in ${unit}` : ''}`}
            aria-invalid={editError || undefined}
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={() => finishEdit(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                finishEdit(true);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finishEdit(false);
              }
            }}
          />
        ) : (
          <output
            className="lm-scale__value"
            htmlFor={inputId}
            onDoubleClick={startEdit}
            title={editable && !inert ? 'Double-click to type a value' : undefined}
          >
            {show(snapped)}
            {unit ? <span className="lm-unit">{unit}</span> : null}
          </output>
        )}
      </div>
      <div
        ref={wellRef}
        className="lm-scale__well"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <WellLayers min={min} max={max} minorStep={minor} majorStep={major} zones={zones} likelyRange={likelyRange} reference={reference} height={wellHeight} />
        <div className="lm-scale__needle" style={{ left: `${pos}%` }} aria-hidden="true" />
        <div className="lm-scale__cap" style={{ left: `${pos}%` }} aria-hidden="true" />
        {rider ? (
          <div className="lm-scale__rider" style={{ left: `${pos}%` }} aria-hidden="true">
            {show(snap(raw ?? snapped, min, max, step))}
            {unit ? <span className="lm-unit">{unit}</span> : null}
          </div>
        ) : null}
        <input
          ref={inputRef}
          id={inputId}
          className="lm-scale__input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={snapped}
          disabled={disabled}
          aria-disabled={locked || undefined}
          aria-valuetext={speak(snapped)}
          aria-describedby={noteId}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            // assistive-technology increments arrive here
            if (inert) return;
            emit(Number(e.target.value), true);
          }}
        />
      </div>
      {showNumerals ? <Numerals min={min} max={max} majorStep={major} labels={labels || undefined} reference={reference} /> : null}
      {note ? (
        <div className="lm-scale__note" id={noteId}>
          {note}
        </div>
      ) : null}
    </div>
  );
}
