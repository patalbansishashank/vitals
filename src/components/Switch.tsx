import { useId, type ReactNode } from 'react';
import { cx } from './lib/cx';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label on the left. Omit when an external label is linked via `labelledBy`. */
  label?: ReactNode;
  /** `engraved` lowercase caption (default) or `sentence` 15 px text. */
  labelStyle?: 'engraved' | 'sentence';
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Slide switch: 36 × 20 well, raised thumb; on = ink track with a yellow light at the left end. */
export function Switch({ checked, onChange, label, labelStyle = 'engraved', labelledBy, describedBy, disabled, id, className }: SwitchProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label className={cx('lm-switch', className)} data-disabled={disabled || undefined} htmlFor={inputId}>
      {label !== undefined ? <span className={labelStyle === 'engraved' ? 'lm-eng' : undefined}>{label}</span> : null}
      <input
        id={inputId}
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="lm-switch__track" aria-hidden="true" />
    </label>
  );
}
