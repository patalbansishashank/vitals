import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from './lib/cx';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  help?: ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
}

/** 18 px checkbox for lists (won't-do list, consent). Never the only toggle in a settings row — use Switch. */
export function Checkbox({ checked, onChange, label, help, indeterminate = false, disabled, name, id, className }: CheckboxProps) {
  const auto = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const helpId = help ? `${id ?? auto}-help` : undefined;
  return (
    <label className={cx('lm-check', className)} data-disabled={disabled || undefined}>
      <input
        ref={ref}
        id={id ?? auto}
        className="lm-check__box"
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        aria-describedby={helpId}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="lm-check__text">
        <span>{label}</span>
        {help ? (
          <span className="lm-check__help" id={helpId}>
            {help}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export interface RadioOption<V extends string = string> {
  value: V;
  label: ReactNode;
  help?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<V extends string = string> {
  name?: string;
  value: V | undefined;
  onChange: (value: V) => void;
  options: ReadonlyArray<RadioOption<V>>;
  /** Group label (visible legend). */
  label?: ReactNode;
  className?: string;
}

/** Native radios in a fieldset: 18 px discs, ink when chosen. For 2–6 short options prefer KeyBank. */
export function RadioGroup<V extends string = string>({ name, value, onChange, options, label, className }: RadioGroupProps<V>) {
  const auto = useId();
  const groupName = name ?? auto;
  return (
    <fieldset className={cx('grid gap-3 border-0 p-0 m-0 min-w-0', className)}>
      {label !== undefined ? <legend className="lm-field__label mb-2 p-0">{label}</legend> : null}
      {options.map((o) => {
        const id = `${groupName}-${o.value}`;
        return (
          <label key={o.value} className="lm-check" data-disabled={o.disabled || undefined} htmlFor={id}>
            <input
              id={id}
              className="lm-check__box"
              type="radio"
              name={groupName}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              aria-describedby={o.help ? `${id}-help` : undefined}
              onChange={() => onChange(o.value)}
            />
            <span className="lm-check__text">
              <span>{o.label}</span>
              {o.help ? (
                <span className="lm-check__help" id={`${id}-help`}>
                  {o.help}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
