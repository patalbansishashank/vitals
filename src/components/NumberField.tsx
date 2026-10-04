import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cx } from './lib/cx';
import { formatNumber, parseNumber, EN_DASH } from './lib/format';
import { clamp, decimalsOf } from './lib/scale';
import { usePressAndHold } from './lib/hooks';
import { Icon } from './icons/Icon';
import { ErrorText, useField } from './Field';
import { KeyBank } from './KeyBank';
import { useSettingsStore, type UnitSystem } from '@/state/settingsStore';
import { cmToIn, inToCm, kgToLb, lbToKg } from '@/lib/units';

/* ---------------------------------------------------------------------------
   Shared draft/commit logic: typing edits a draft; Enter/blur validates and
   commits; Escape reverts. Arrow keys step, PgUp/PgDn step ×10.
   --------------------------------------------------------------------------- */

interface DraftOptions {
  value: number | null;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  step: number;
  decimals: number;
  /** Used in error messages: "Weight must be 30–300 kg". */
  name: string;
  unitText: string;
}

function useNumberDraft({ value, onCommit, min, max, step, decimals, name, unitText }: DraftOptions) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = draft ?? (value === null || !Number.isFinite(value) ? '' : formatNumber(value, decimals, { grouping: 'none' }));

  const rangeMsg = `${capitalise(name)} must be ${formatNumber(min, decimals, { grouping: 'none' })}${EN_DASH}${formatNumber(max, decimals, { grouping: 'none' })}${unitText ? ` ${unitText}` : ''}`;

  const commit = () => {
    if (draft === null) return;
    const n = parseNumber(draft);
    if (n === null) {
      setError(`Enter a number for ${name}.`);
      return;
    }
    if (n < min || n > max) {
      setError(`${rangeMsg}.`);
      return;
    }
    setError(null);
    setDraft(null);
    onCommit(Number(n.toFixed(decimals)));
  };

  const bump = (dir: 1 | -1, times = 1) => {
    const base = value ?? min;
    const next = clamp(Number((base + dir * step * times).toFixed(Math.max(decimals, decimalsOf(step)))), min, max);
    setDraft(null);
    setError(null);
    onCommit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit();
    } else if (e.key === 'Escape') {
      if (draft !== null || error) {
        e.preventDefault();
        e.stopPropagation();
        setDraft(null);
        setError(null);
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      bump(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : 1);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      bump(e.key === 'PageUp' ? 1 : -1, 10);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setDraft(null);
      setError(null);
      onCommit(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      setDraft(null);
      setError(null);
      onCommit(max);
    }
  };

  return { shown, draft, setDraft, error, setError, commit, bump, onKeyDown };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------------------------------------------------------------------------
   NumberField — a recessed well with a unit suffix
   --------------------------------------------------------------------------- */

export interface NumberFieldProps {
  /** Committed value (null = empty). */
  value: number | null;
  /** Called with a valid, in-range value on Enter/blur/arrow step. */
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Decimals shown and committed. Defaults to the step's decimals. */
  decimals?: number;
  /** Unit suffix inside the well ("kg", "yrs"). */
  unit?: ReactNode;
  /** Plain-text unit for messages/valuetext when `unit` is not a string. */
  unitText?: string;
  /** Name used in messages and the accessible label when not inside a Field ("weight"). */
  name: string;
  disabled?: boolean;
  inputMode?: 'decimal' | 'numeric';
  id?: string;
  className?: string;
}

/** Exact numeric entry with unit suffix. Use `Stepper` when ± keys help (age, height, weight). */
export function NumberField(props: NumberFieldProps) {
  const { value, onChange, min, max, step = 1, unit, name, disabled, inputMode = 'decimal', id, className } = props;
  const decimals = props.decimals ?? decimalsOf(step);
  const unitText = props.unitText ?? (typeof unit === 'string' ? unit : '');
  const field = useField();
  const auto = useId();
  const errId = `${id ?? field?.id ?? auto}-err`;
  const d = useNumberDraft({ value, onCommit: onChange, min, max, step, decimals, name, unitText });
  return (
    <div className={cx('grid gap-1.5 min-w-0', className)}>
      <NumWell
        id={id ?? field?.id}
        shown={d.shown}
        onInput={d.setDraft}
        onBlur={d.commit}
        onKeyDown={d.onKeyDown}
        unit={unit}
        invalid={Boolean(d.error) || Boolean(field?.invalid)}
        describedBy={[d.error ? errId : undefined, field?.describedBy].filter(Boolean).join(' ') || undefined}
        label={field ? undefined : name}
        disabled={disabled ?? field?.disabled}
        inputMode={inputMode}
        min={min}
        max={max}
        value={value}
        valueText={value !== null ? `${formatNumber(value, decimals, { grouping: 'none' })} ${unitText}`.trim() : undefined}
      />
      {d.error ? <ErrorText id={errId}>{d.error}</ErrorText> : null}
    </div>
  );
}

interface NumWellProps {
  id?: string;
  shown: string;
  onInput: (v: string) => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  unit?: ReactNode;
  invalid: boolean;
  describedBy?: string;
  label?: string;
  disabled?: boolean;
  inputMode: 'decimal' | 'numeric';
  min: number;
  max: number;
  value: number | null;
  valueText?: string;
}

function NumWell({ id, shown, onInput, onBlur, onKeyDown, unit, invalid, describedBy, label, disabled, inputMode, min, max, value, valueText }: NumWellProps) {
  return (
    <label className="lm-numfield" data-invalid={invalid || undefined}>
      <input
        id={id}
        type="text"
        role="spinbutton"
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        value={shown}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value ?? undefined}
        aria-valuetext={valueText}
        onChange={(e) => onInput(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onFocus={(e) => e.currentTarget.select()}
      />
      {unit !== undefined ? (
        <span className="lm-numfield__unit" aria-hidden="true">
          {unit}
        </span>
      ) : (
        <span style={{ width: 12 }} aria-hidden="true" />
      )}
    </label>
  );
}

/* ---------------------------------------------------------------------------
   Stepper — [−] [ well ] [+] with press-and-hold acceleration
   --------------------------------------------------------------------------- */

export type StepperProps = NumberFieldProps;

function StepKey({ dir, onStep, disabled, name }: { dir: 1 | -1; onStep: (d: 1 | -1) => void; disabled: boolean; name: string }) {
  const hold = usePressAndHold(() => onStep(dir), disabled);
  return (
    <button
      type="button"
      className="lm-stepper__btn"
      tabIndex={-1}
      aria-label={`${dir > 0 ? 'Increase' : 'Decrease'} ${name}`}
      disabled={disabled}
      {...hold}
    >
      <Icon icon={dir > 0 ? Plus : Minus} size={16} />
    </button>
  );
}

/**
 * Numeric stepper: − key · well field (value wide tabular + unit) · + key.
 * Holding a key repeats (400 ms, then 12/s, 30/s after 2 s). The ± keys clamp at
 * min/max; typed values outside the range show the error and are not committed.
 */
export function Stepper(props: StepperProps) {
  const { value, onChange, min, max, step = 1, unit, name, disabled, inputMode = 'decimal', id, className } = props;
  const decimals = props.decimals ?? decimalsOf(step);
  const unitText = props.unitText ?? (typeof unit === 'string' ? unit : '');
  const field = useField();
  const auto = useId();
  const errId = `${id ?? field?.id ?? auto}-err`;
  const d = useNumberDraft({ value, onCommit: onChange, min, max, step, decimals, name, unitText });
  const isDisabled = Boolean(disabled ?? field?.disabled);
  const v = value ?? min;
  return (
    <div className={cx('grid gap-1.5 min-w-0', className)}>
      <div className="lm-stepper">
        <StepKey dir={-1} onStep={(dir) => d.bump(dir)} disabled={isDisabled || v <= min} name={name} />
        <NumWell
          id={id ?? field?.id}
          shown={d.shown}
          onInput={d.setDraft}
          onBlur={d.commit}
          onKeyDown={d.onKeyDown}
          unit={unit}
          invalid={Boolean(d.error) || Boolean(field?.invalid)}
          describedBy={[d.error ? errId : undefined, field?.describedBy].filter(Boolean).join(' ') || undefined}
          label={field ? undefined : name}
          disabled={isDisabled}
          inputMode={inputMode}
          min={min}
          max={max}
          value={value}
          valueText={value !== null ? `${formatNumber(value, decimals, { grouping: 'none' })} ${unitText}`.trim() : undefined}
        />
        <StepKey dir={1} onStep={(dir) => d.bump(dir)} disabled={isDisabled || v >= max} name={name} />
      </div>
      {d.error ? <ErrorText id={errId}>{d.error}</ErrorText> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   MeasureStepper — metric/imperial aware. Values are ALWAYS metric (kg, cm);
   display and entry follow the unit system (settings store by default).
   --------------------------------------------------------------------------- */

export type Quantity = 'mass' | 'length' | 'height';

export interface MeasureStepperProps {
  quantity: Quantity;
  /** Canonical metric value: kg for mass, cm for length/height. */
  value: number | null;
  onChange: (metricValue: number) => void;
  /** Metric bounds. */
  min: number;
  max: number;
  name: string;
  /** Override the global unit system (defaults to Settings › Units › body). */
  system?: UnitSystem;
  /** Show a `kg | lb` / `cm | in` key bank beside the stepper that switches the global setting. */
  unitToggle?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const SPEC = {
  mass: { metric: { unit: 'kg', step: 0.1, decimals: 1 }, imperial: { unit: 'lb', step: 0.2, decimals: 1 } },
  length: { metric: { unit: 'cm', step: 0.5, decimals: 1 }, imperial: { unit: 'in', step: 0.25, decimals: 2 } },
  height: { metric: { unit: 'cm', step: 1, decimals: 0 }, imperial: { unit: 'in', step: 1, decimals: 0 } },
} as const;

const toDisplay = (q: Quantity, sys: UnitSystem, v: number) => (sys === 'metric' ? v : q === 'mass' ? kgToLb(v) : cmToIn(v));
const toMetric = (q: Quantity, sys: UnitSystem, v: number) => (sys === 'metric' ? v : q === 'mass' ? lbToKg(v) : inToCm(v));

/**
 * Stepper for body measurements. Stored values stay metric; imperial users see
 * lb / in, and height in imperial is entered as feet + inches in one well.
 */
export function MeasureStepper({ quantity, value, onChange, min, max, name, system, unitToggle, disabled, id, className }: MeasureStepperProps) {
  const globalSystem = useSettingsStore((s) => s.units);
  const setUnits = useSettingsStore((s) => s.setUnits);
  const sys = system ?? globalSystem;
  const spec = SPEC[quantity][sys];
  const toggle = unitToggle ? (
    <KeyBank
      size="sm"
      label={`${name} units`}
      value={sys}
      onChange={(s) => setUnits(s)}
      options={[
        { value: 'metric', label: SPEC[quantity].metric.unit },
        { value: 'imperial', label: quantity === 'height' ? 'ft in' : SPEC[quantity].imperial.unit },
      ]}
    />
  ) : null;

  let control: ReactNode;
  if (quantity === 'height' && sys === 'imperial') {
    control = (
      <FeetInchesStepper value={value} onChange={onChange} min={min} max={max} name={name} disabled={disabled} id={id} />
    );
  } else {
    const dMin = Number(toDisplay(quantity, sys, min).toFixed(spec.decimals));
    const dMax = Number(toDisplay(quantity, sys, max).toFixed(spec.decimals));
    control = (
      <Stepper
        id={id}
        name={name}
        value={value === null ? null : Number(toDisplay(quantity, sys, value).toFixed(spec.decimals))}
        onChange={(v) => onChange(clamp(toMetric(quantity, sys, v), min, max))}
        min={dMin}
        max={dMax}
        step={spec.step}
        decimals={spec.decimals}
        unit={spec.unit}
        disabled={disabled}
      />
    );
  }
  if (!toggle) return <div className={className}>{control}</div>;
  return (
    <div className={cx('flex items-start gap-2 min-w-0', className)}>
      <div className="flex-1 min-w-0">{control}</div>
      <div className="pt-[3px]">{toggle}</div>
    </div>
  );
}

function FeetInchesStepper({ value, onChange, min, max, name, disabled, id }: { value: number | null; onChange: (cm: number) => void; min: number; max: number; name: string; disabled?: boolean; id?: string }) {
  const field = useField();
  const auto = useId();
  const baseId = id ?? field?.id ?? auto;
  const totalIn = value === null ? null : Math.round(cmToIn(value));
  const ft = totalIn === null ? null : Math.floor(totalIn / 12);
  const inch = totalIn === null ? null : totalIn % 12;
  const minIn = Math.ceil(cmToIn(min));
  const maxIn = Math.floor(cmToIn(max));
  const [error, setError] = useState<string | null>(null);
  const [ftDraft, setFtDraft] = useState<string | null>(null);
  const [inDraft, setInDraft] = useState<string | null>(null);
  const lastValid = useRef(totalIn);
  useEffect(() => {
    lastValid.current = totalIn;
  }, [totalIn]);

  const rangeMsg = `${capitalise(name)} must be ${Math.floor(minIn / 12)} ft ${minIn % 12} in${EN_DASH}${Math.floor(maxIn / 12)} ft ${maxIn % 12} in.`;

  const commitTotal = (inches: number) => {
    if (inches < minIn || inches > maxIn) {
      setError(rangeMsg);
      return false;
    }
    setError(null);
    onChange(clamp(inToCm(inches), min, max));
    return true;
  };

  const commitDrafts = () => {
    if (ftDraft === null && inDraft === null) return;
    const f = ftDraft === null ? ft : parseNumber(ftDraft);
    const i = inDraft === null ? inch : parseNumber(inDraft);
    if (f === null || i === null || f === undefined || i === undefined) {
      setError(`Enter feet and inches for ${name}.`);
      return;
    }
    if (i < 0 || i >= 12) {
      setError('Inches must be 0–11.');
      return;
    }
    if (commitTotal(Math.round(f) * 12 + Math.round(i))) {
      setFtDraft(null);
      setInDraft(null);
    }
  };

  const bump = (dir: 1 | -1) => {
    const t = clamp((lastValid.current ?? minIn) + dir, minIn, maxIn);
    setFtDraft(null);
    setInDraft(null);
    commitTotal(t);
  };

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitDrafts();
    else if (e.key === 'Escape') {
      setFtDraft(null);
      setInDraft(null);
      setError(null);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      bump(e.key === 'ArrowUp' ? 1 : -1);
    }
  };

  const invalid = Boolean(error) || Boolean(field?.invalid);
  const errId = `${baseId}-err`;
  const describedBy = [error ? errId : undefined, field?.describedBy].filter(Boolean).join(' ') || undefined;
  const t = totalIn ?? minIn;
  return (
    <div className="grid gap-1.5 min-w-0">
      <div className="lm-stepper" role="group" aria-label={field ? undefined : name} aria-labelledby={field?.labelId}>
        <StepKey dir={-1} onStep={bump} disabled={Boolean(disabled) || t <= minIn} name={name} />
        <label className="lm-numfield" data-invalid={invalid || undefined}>
          <input
            id={baseId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={ftDraft ?? (ft === null ? '' : String(ft))}
            aria-label={`${name}, feet`}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            onChange={(e) => setFtDraft(e.target.value)}
            onBlur={commitDrafts}
            onKeyDown={keys}
            onFocus={(e) => e.currentTarget.select()}
          />
          <span className="lm-numfield__unit" aria-hidden="true">
            ft
          </span>
        </label>
        <label className="lm-numfield" data-invalid={invalid || undefined}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={inDraft ?? (inch === null ? '' : String(inch))}
            aria-label={`${name}, inches`}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            onChange={(e) => setInDraft(e.target.value)}
            onBlur={commitDrafts}
            onKeyDown={keys}
            onFocus={(e) => e.currentTarget.select()}
          />
          <span className="lm-numfield__unit" aria-hidden="true">
            in
          </span>
        </label>
        <StepKey dir={1} onStep={bump} disabled={Boolean(disabled) || t >= maxIn} name={name} />
      </div>
      {error ? <ErrorText id={errId}>{error}</ErrorText> : null}
    </div>
  );
}
