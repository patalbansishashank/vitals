import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconKey, NumberField } from '@/components';
import type { UnitSystem } from '@/state/settingsStore';
import { cmToIn, inToCm } from '@/lib/units';
import { roundTo } from '../units';

export interface OptionalNumberProps {
  /** Stored value in engine units (null = not given). */
  value: number | null;
  onChange: (value: number | null) => void;
  /** Engine-unit bounds. */
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  unit: string;
  name: string;
  /** Engine unit → display unit, and back (identity by default). */
  toDisplay?: (v: number) => number;
  toEngine?: (v: number) => number;
  id?: string;
}

/**
 * An optional exact value: a NumberField (empty = not given; typing commits on Enter/blur; out-of-range entries show
 * the range and are not committed) plus a clear key once a value exists.
 */
export function OptionalNumber({ value, onChange, min, max, step = 0.1, decimals, unit, name, toDisplay = (v) => v, toEngine = (v) => v, id }: OptionalNumberProps) {
  const d = decimals ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
  const lo = roundTo(Math.min(toDisplay(min), toDisplay(max)), 10 ** -d);
  const hi = roundTo(Math.max(toDisplay(min), toDisplay(max)), 10 ** -d);
  return (
    <div className="lm-body-optional">
      <NumberField
        id={id}
        name={name}
        value={value === null ? null : roundTo(toDisplay(value), 10 ** -d)}
        onChange={(x) => {
          // drift guard: the same displayed number is not a change
          if (value !== null && roundTo(toDisplay(value), 10 ** -d) === x) return;
          onChange(toEngine(x));
        }}
        min={lo}
        max={hi}
        step={step}
        decimals={d}
        unit={unit}
      />
      {value !== null ? <IconKey size="sm" icon={X} label={`Clear ${name}`} onClick={() => onChange(null)} /> : null}
    </div>
  );
}

/** Optional length in the user's units (cm or in, 0.1 / 0.25 resolution); stored in cm. */
export function OptionalLength({ units, ...rest }: Omit<OptionalNumberProps, 'unit' | 'toDisplay' | 'toEngine' | 'step' | 'decimals'> & { units: UnitSystem }) {
  return units === 'metric' ? (
    <OptionalNumber {...rest} unit="cm" step={0.5} decimals={1} />
  ) : (
    <OptionalNumber {...rest} unit="in" step={0.25} decimals={2} toDisplay={cmToIn} toEngine={inToCm} />
  );
}

/** A key-bank label that may wrap onto two lines in narrow columns ("prefer not to say" in the 320 px column). */
export function wrapLabel(text: string): ReactNode {
  return <span className="lm-body-wrap">{text}</span>;
}

/** Key-bank options with wrapping labels. */
export function wrapOptions<V extends string>(options: ReadonlyArray<{ value: V; label: string }>): Array<{ value: V; label: ReactNode }> {
  return options.map((o) => ({ value: o.value, label: wrapLabel(o.label) }));
}
