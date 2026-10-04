import type { ReactNode } from 'react';
import { cx } from './lib/cx';
import { useReducedMotion } from './lib/hooks';
import { formatNumber } from './lib/format';
import { clamp } from './lib/scale';
import { Icon } from './icons/Icon';
import { CautionMark, DangerMark } from './icons/glyphs';

export interface SpinnerProps {
  /** 12 (inside keys), 16 or 20 px. */
  size?: 12 | 16 | 20;
  /** Accessible label; omit when the surrounding control already says it is busy. */
  label?: string;
  className?: string;
}

/** A thin ring spinner. Use inside keys and small regions — never centred on a page of content. */
export function Spinner({ size = 16, label, className }: SpinnerProps) {
  const r = size / 2 - 1.5;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className={cx('lm-spinner', className)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle className="lm-spinner__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={1.5} />
      <circle
        className="lm-spinner__arc"
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={1.5}
        strokeDasharray={`${c * 0.28} ${c}`}
      />
    </svg>
  );
}

export interface ProgressRuleProps {
  /** Omit for indeterminate; 0–1 for determinate. */
  value?: number;
  /** Announced label, e.g. "Running 84 days". */
  label?: string;
  /** Text shown instead of the moving rule when motion is reduced. Default "Running…". */
  reducedText?: ReactNode;
  className?: string;
}

/**
 * The 2 px working rule at the top of a region (chart frame, optimiser card).
 * The parent must be `position: relative`. With reduced motion an indeterminate
 * rule becomes static text.
 */
export function ProgressRule({ value, label = 'Working', reducedText = 'Running…', className }: ProgressRuleProps) {
  const reduced = useReducedMotion();
  const determinate = value !== undefined;
  if (!determinate && reduced) {
    return (
      <div className={cx('lm-progress-rule', className)} data-static="true" role="status">
        <span className="lm-progress-text">{reducedText}</span>
      </div>
    );
  }
  return (
    <div
      className={cx('lm-progress-rule', className)}
      data-mode={determinate ? 'determinate' : 'indeterminate'}
      role="progressbar"
      aria-label={label}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      aria-valuenow={determinate ? Math.round(clamp(value, 0, 1) * 100) : undefined}
    >
      {determinate ? <div className="lm-progress-rule__bar" style={{ width: `${clamp(value, 0, 1) * 100}%` }} /> : null}
    </div>
  );
}

export interface MeterProps {
  value: number;
  max: number;
  /** Visible text beside the track, e.g. "1.8 of 5 MB". */
  valueText: string;
  /** Accessible name, e.g. "Storage used". */
  label: string;
  /** Fraction at which the meter turns caution (default .8) and danger (default .95). */
  cautionAt?: number;
  dangerAt?: number;
  /** Advice shown under the track in the caution/danger levels. */
  advice?: ReactNode;
  className?: string;
}

/** A measured quantity with known bounds (storage). Ink fill; caution/danger add a mark and advice. */
export function Meter({ value, max, valueText, label, cautionAt = 0.8, dangerAt = 0.95, advice, className }: MeterProps) {
  const f = max > 0 ? clamp(value / max, 0, 1) : 0;
  const level = f >= dangerAt ? 'danger' : f >= cautionAt ? 'caution' : 'ok';
  return (
    <div className={cx('lm-meter', className)} data-level={level}>
      <div className="lm-meter__row">
        <div
          className="lm-meter__track"
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={valueText}
        >
          <div className="lm-meter__fill" style={{ width: `${f * 100}%` }} />
        </div>
        <span className="lm-meter__text">{valueText}</span>
      </div>
      {level !== 'ok' && advice ? (
        <div className="lm-inline-warn" data-severity={level}>
          <Icon icon={level === 'danger' ? DangerMark : CautionMark} size={16} />
          <span>{advice}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Convenience: "1.8 of 5 MB". */
export function formatOf(value: number, max: number, unit: string, decimals = 1): string {
  return `${formatNumber(value, decimals)} of ${formatNumber(max, 0)} ${unit}`;
}
