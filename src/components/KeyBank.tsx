import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { cx } from './lib/cx';
import { useControllableState } from './lib/hooks';
import { useField } from './Field';
import { Icon, type IconComponent } from './icons/Icon';

export type BankSize = 'sm' | 'md' | 'lg';

export interface KeyBankOption<V extends string = string> {
  value: V;
  /** Visible label (lowercase for instrument settings: "metric", "12 wk"). */
  label: ReactNode;
  icon?: IconComponent;
  /** Hide the text and use `label` (must be a string) as the accessible name. */
  iconOnly?: boolean;
  /** 6 px ink dot (e.g. stale results). */
  badge?: boolean;
  disabled?: boolean;
}

export interface KeyBankProps<V extends string = string> {
  options: ReadonlyArray<KeyBankOption<V>>;
  value?: V;
  defaultValue?: V;
  onChange?: (value: V) => void;
  /** Accessible group name (use `labelledBy` when a visible label exists). */
  label?: string;
  labelledBy?: string;
  /** id(s) of help text describing the group. */
  describedBy?: string;
  /** `sm` 26 px keys (chart toolbar) · `md` 32 (default) · `lg` 36 (touch, 44 overall). */
  size?: BankSize;
  /** Stretch keys to fill the row. */
  block?: boolean;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  id?: string;
}

/**
 * Braun push-button bank (segmented control) — a radio group. The selected key
 * is a raised cap with a yellow indicator light; arrows move and select,
 * Home/End jump. Up to 6 keys; more → Select.
 */
export function KeyBank<V extends string = string>({
  options,
  value: valueProp,
  defaultValue,
  onChange,
  label,
  labelledBy,
  describedBy,
  size = 'md',
  block = false,
  orientation = 'horizontal',
  className,
  id,
}: KeyBankProps<V>) {
  const field = useField();
  const [value, setValue] = useControllableState<V | undefined>(valueProp, defaultValue, onChange as (v: V | undefined) => void);
  const groupLabelledBy = labelledBy ?? (label ? undefined : field?.labelId);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const tabStop = selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : (enabled[0] ?? -1);

  const move = (from: number, delta: 1 | -1 | 'first' | 'last') => {
    if (enabled.length === 0) return;
    let target: number;
    if (delta === 'first') target = enabled[0]!;
    else if (delta === 'last') target = enabled[enabled.length - 1]!;
    else {
      const pos = enabled.indexOf(from);
      const next = (pos + delta + enabled.length) % enabled.length;
      target = enabled[next]!;
    }
    const opt = options[target];
    if (!opt) return;
    setValue(opt.value);
    refs.current[target]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    // APG radio group: every arrow moves and selects, wrapping at the ends.
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(index, -1);
        break;
      case 'Home':
        e.preventDefault();
        move(index, 'first');
        break;
      case 'End':
        e.preventDefault();
        move(index, 'last');
        break;
      default:
    }
  };

  return (
    <div
      id={id ?? field?.id}
      role="radiogroup"
      aria-label={groupLabelledBy ? undefined : label}
      aria-labelledby={groupLabelledBy}
      aria-describedby={[describedBy, field?.describedBy].filter(Boolean).join(' ') || undefined}
      aria-orientation={orientation}
      className={cx('lm-bank', className)}
      data-size={size}
      data-block={block || undefined}
      data-orientation={orientation}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={o.disabled || undefined}
            aria-label={o.iconOnly && typeof o.label === 'string' ? o.label : undefined}
            tabIndex={i === tabStop ? 0 : -1}
            className="lm-bank__key"
            data-selected={selected}
            onClick={() => {
              if (!o.disabled) setValue(o.value);
            }}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.icon ? <Icon icon={o.icon} size={size === 'sm' ? 16 : 18} /> : null}
            {o.iconOnly ? null : <span>{o.label}</span>}
            {o.badge ? <span className="lm-bank__badge" aria-label="changed" role="img" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface LinkBankItem {
  to: string;
  label: ReactNode;
  /** Match only the exact path (NavLink `end`). */
  end?: boolean;
  badge?: boolean;
  /** Accessible text for the badge, e.g. "results are out of date". */
  badgeLabel?: string;
}

export interface LinkBankProps {
  items: ReadonlyArray<LinkBankItem>;
  /** Navigation landmark name, e.g. "Simulator section". */
  label: string;
  size?: BankSize;
  block?: boolean;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

/**
 * Route sub-navigation drawn as a key bank ("schedule | results"). Links, not
 * radios: the active one carries aria-current="page" and the yellow light.
 */
export function LinkBank({ items, label, size = 'md', block, orientation = 'horizontal', className }: LinkBankProps) {
  return (
    <nav aria-label={label} className={cx('lm-bank', className)} data-size={size} data-block={block || undefined} data-orientation={orientation}>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end} className="lm-bank__key" replace={false}>
          <span>{it.label}</span>
          {it.badge ? <span className="lm-bank__badge" role="img" aria-label={it.badgeLabel ?? 'changed'} /> : null}
        </NavLink>
      ))}
    </nav>
  );
}
