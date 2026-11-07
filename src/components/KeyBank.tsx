import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { NavLink, useLocation } from 'react-router';
import { cx } from './lib/cx';
import { useControllableState, useIsoLayoutEffect } from './lib/hooks';
import { useField } from './Field';
import { Icon, type IconComponent } from './icons/Icon';

export type BankSize = 'sm' | 'md' | 'lg';

/**
 * One row of segments (lumen.md §7): a horizontal bank lays its keys out as one grid column each, never a second
 * row. Every column is at least its label and shares the spare width equally — as wide as the longest label when
 * the track sizes to its content, an equal share when the track is stretched (`block`, or a grid or field that
 * stretches it). When the row is tight, short labels give their spare room to long ones; only when the labels
 * themselves do not fit does the track scroll sideways (components.css). Vertical banks stay a column of keys.
 */
export function bankSegments(n: number, orientation: 'horizontal' | 'vertical' = 'horizontal'): { 'data-segments'?: number; style?: CSSProperties } {
  if (orientation === 'vertical' || n < 1) return {};
  return { 'data-segments': n, style: { '--lm-bank-n': n } as CSSProperties };
}

/**
 * A bank that has had to scroll (its labels are wider than the row) keeps the selected key in view, without
 * scrolling the page. `dep` is whatever changes the selection; put the returned ref on the track.
 */
export function useSelectedInView<T extends HTMLElement>(dep: unknown): RefObject<T | null> {
  const track = useRef<T>(null);
  useIsoLayoutEffect(() => {
    const t = track.current;
    if (!t || t.scrollWidth <= t.clientWidth + 1) return;
    const key = t.querySelector<HTMLElement>('[data-selected="true"], [aria-current="page"]');
    if (!key) return;
    const tr = t.getBoundingClientRect();
    const kr = key.getBoundingClientRect();
    if (kr.left < tr.left) t.scrollLeft -= tr.left - kr.left + 4;
    else if (kr.right > tr.right) t.scrollLeft += kr.right - tr.right + 4;
  }, [dep]);
  return track;
}

export interface KeyBankOption<V extends string = string> {
  value: V;
  /** Visible label, short ("Metric", "12 wk"). */
  label: ReactNode;
  icon?: IconComponent;
  /** Hide the text and use `label` (must be a string) as the accessible name. */
  iconOnly?: boolean;
  /** 6 px gold "changed" dot after the label (e.g. stale results); announced as "changed". */
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
  /** Segment height: `sm` 28 (dense toolbars; 40 on touch) · `md` 40 (default; 48 on touch) · `lg` 48. */
  size?: BankSize;
  /**
   * Fill the width it is given (r068 U2), segments equal. Default true for a horizontal bank; pass `fit` (or
   * `block={false}`) for the rare bank that must size to its labels (inside a field's row, a dense chart toolbar).
   */
  block?: boolean;
  /** Size the track to its labels instead of filling the row (the same as `block={false}`). */
  fit?: boolean;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  id?: string;
}

/**
 * Segmented control — a radio group drawn in the card's language (r068 U2): a rounded-rectangle well holding equal
 * segments; the selected one is the gold tile (gold wash, gold edge) with an ivory label. It fills the width it is
 * given (`fit` to size it to its labels). Arrows move and select, Home/End jump. Up to 6 segments; more → Select.
 * The segments hold one row: equal while they fit, sized to their labels when the row is tight, scrolling only as a
 * last resort.
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
  block = true,
  fit = false,
  orientation = 'horizontal',
  className,
  id,
}: KeyBankProps<V>) {
  const fill = block && !fit && orientation === 'horizontal';
  const field = useField();
  const [value, setValue] = useControllableState<V | undefined>(valueProp, defaultValue, onChange as (v: V | undefined) => void);
  const groupLabelledBy = labelledBy ?? (label ? undefined : field?.labelId);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const track = useSelectedInView<HTMLDivElement>(value);
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
      ref={track}
      id={id ?? field?.id}
      role="radiogroup"
      aria-label={groupLabelledBy ? undefined : label}
      aria-labelledby={groupLabelledBy}
      aria-describedby={[describedBy, field?.describedBy].filter(Boolean).join(' ') || undefined}
      aria-orientation={orientation}
      className={cx('lm-bank', className)}
      data-size={size}
      data-block={fill || undefined}
      data-orientation={orientation}
      {...bankSegments(options.length, orientation)}
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
  /** Fill the width it is given (default true; r068 U2). */
  block?: boolean;
  /** Size the track to its labels instead (the same as `block={false}`). */
  fit?: boolean;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

/**
 * Route sub-navigation drawn as the segmented track ("Schedule | Results"), full width by default.
 * Links, not radios: the active one carries aria-current="page" and the selected look.
 */
export function LinkBank({ items, label, size = 'md', block = true, fit = false, orientation = 'horizontal', className }: LinkBankProps) {
  const track = useSelectedInView<HTMLElement>(useLocation().pathname);
  const fill = block && !fit && orientation === 'horizontal';
  return (
    <nav ref={track} aria-label={label} className={cx('lm-bank', className)} data-size={size} data-block={fill || undefined} data-orientation={orientation} {...bankSegments(items.length, orientation)}>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end} className="lm-bank__key" replace={false}>
          <span>{it.label}</span>
          {it.badge ? <span className="lm-bank__badge" role="img" aria-label={it.badgeLabel ?? 'changed'} /> : null}
        </NavLink>
      ))}
    </nav>
  );
}
