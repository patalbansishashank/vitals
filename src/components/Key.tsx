import type { ComponentPropsWithRef, ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link, type LinkProps } from 'react-router';
import { cx } from './lib/cx';
import { Icon, type IconComponent } from './icons/Icon';
import { Spinner } from './Progress';
import { Tooltip } from './Tooltip';

/**
 * Ember variants (SPEC §5, r071). The original five keep working and map onto the new looks:
 * `solid` / `signal` / `primary` → the gold PILL (label 15/600, an optional arrow) · `default` / `outlined` → the
 * neutral tile (6 % ink fill, 1 px strong hairline, ivory label) · `quiet` / `text` → gold text button (icon-only: a
 * stone icon) · `action` → gold text on a 16 % gold tile · `danger` → outlined in rose.
 */
export type KeyVariant = 'default' | 'solid' | 'quiet' | 'danger' | 'signal' | 'primary' | 'action' | 'text' | 'outlined';
export type KeySize = 'sm' | 'md' | 'lg';

interface KeyOwnProps {
  /**
   * `primary` (alias `solid`, `signal`): the one gold PILL per view (48 px `lg`, 40 `md`, 32 `sm`) ·
   * `outlined` (alias `default`, the default): the neutral tile, 1 px strong hairline, ivory label ·
   * `action`: an inline verb on a row (gold text on a soft gold tile, 32 px; 28 on `sm`) ·
   * `text` (alias `quiet`): gold text button; icon-only it is a stone icon ·
   * `danger`: destructive, outlined in rose.
   */
  variant?: KeyVariant;
  /** `sm` 32 · `md` 40 (default) · `lg` 48 (full-width primaries in sheets). Touch layouts get a 44 px hit area (48 on icon keys). */
  size?: KeySize;
  /** Leading 20 px icon (16 px on `sm`). */
  icon?: IconComponent;
  /** Trailing icon (chevron for menus). On a primary key it is 18 px at stroke 2.25. */
  trailingIcon?: IconComponent;
  /**
   * The primary pill's arrow (r071: "Add task →"): shorthand for `trailingIcon={ArrowRight}`, an icon, never the glyph
   * (the arrow U+2192 is in neither Geist file). Use it where the key goes on or adds ("Log snack", "Start"), not on
   * every key.
   */
  arrow?: boolean;
  /**
   * @deprecated The indicator light is gone (Ember has no indicator dots); this renders nothing. Show an on/off state
   * with `pressed` instead.
   */
  indicator?: boolean;
  /** Shortcut hint, e.g. "⌘↵". */
  shortcut?: string;
  /** Toggle keys: the selected treatment (gold wash, gold edge, ink text) and aria-pressed. */
  pressed?: boolean;
  /** Busy: a 12 px ring replaces the leading icon; the key keeps its width. */
  loading?: boolean;
  /** @deprecated Every key is a pill now; kept so existing callers compile. */
  shape?: 'default' | 'pill';
  /** Full-width. */
  block?: boolean;
}

const isPrimary = (v: KeyVariant | undefined): boolean => v === 'primary' || v === 'solid' || v === 'signal';

function keyData(p: KeyOwnProps & { iconOnly?: boolean }) {
  return {
    'data-variant': p.variant ?? 'default',
    'data-size': p.size ?? 'md',
    'data-pressed': p.pressed ? 'true' : undefined,
    'data-loading': p.loading ? 'true' : undefined,
    'data-has-icon': p.icon ? 'true' : 'false',
    'data-trailing': p.trailingIcon || p.arrow ? 'true' : undefined,
    'data-icon-only': p.iconOnly ? 'true' : undefined,
    'data-shape': p.shape === 'pill' ? 'pill' : undefined,
    'data-block': p.block ? 'true' : undefined,
  } as const;
}

function KeyContent({ icon, trailingIcon, arrow, shortcut, loading, size, variant, children }: Omit<KeyOwnProps, 'indicator'> & { children?: ReactNode }) {
  const iconSize = size === 'sm' ? 16 : 20;
  const trailing = trailingIcon ?? (arrow ? ArrowRight : undefined);
  const primary = isPrimary(variant);
  return (
    <>
      {icon ? loading ? <Spinner size={12} /> : <Icon icon={icon} size={iconSize} /> : null}
      <span className="lm-key__label">{children}</span>
      {trailing ? <Icon icon={trailing} size={primary ? 18 : 16} {...(primary ? { strokeWidth: 2.25 } : {})} /> : null}
      {shortcut ? <span className="lm-key__hint">{shortcut}</span> : null}
      {loading && !icon ? (
        <span className="lm-key__spinner-overlay" aria-hidden="true">
          <Spinner size={12} />
        </span>
      ) : null}
    </>
  );
}

export type KeyProps = KeyOwnProps &
  Omit<ComponentPropsWithRef<'button'>, 'disabled'> & {
    /**
     * Disabled. Prefer `disabledReason`: the key stays focusable with
     * aria-disabled and the reason is announced (COMPONENTS universal rules).
     */
    disabled?: boolean;
    /** Keeps the key focusable and explains why it cannot be used (sets aria-disabled + title). */
    disabledReason?: string;
  };

/** The button. Primary is the gold pill, the rest are rounded rectangles; no bevel, no shadow; press scales .98. */
export function Key({
  variant,
  size,
  icon,
  trailingIcon,
  arrow,
  indicator: _indicator,
  shortcut,
  pressed,
  loading,
  shape,
  block,
  disabled,
  disabledReason,
  type = 'button',
  className,
  children,
  onClick,
  title,
  ...rest
}: KeyProps) {
  const soft = Boolean(disabledReason) || Boolean(loading);
  const button = (
    <button
      type={type}
      className={cx('lm-key', className)}
      {...keyData({ variant, size, pressed, loading, icon, trailingIcon, arrow, shape, block })}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-busy={loading || undefined}
      disabled={disabled && !disabledReason ? true : undefined}
      aria-disabled={soft ? true : undefined}
      title={title}
      onClick={(e) => {
        if (soft || disabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      <KeyContent icon={icon} trailingIcon={trailingIcon} arrow={arrow} shortcut={shortcut} loading={loading} size={size} variant={variant}>
        {children}
      </KeyContent>
    </button>
  );
  return disabledReason ? <Tooltip content={disabledReason}>{button}</Tooltip> : button;
}

export type KeyLinkProps = KeyOwnProps & LinkProps;

/** A router link that looks like a Key ("Open in Simulator", "Back to results"). */
export function KeyLink({ variant, size, icon, trailingIcon, arrow, indicator: _indicator, shortcut, shape, block, className, children, ...rest }: KeyLinkProps) {
  return (
    <Link className={cx('lm-key', className)} {...keyData({ variant, size, icon, trailingIcon, arrow, shape, block })} {...rest}>
      <KeyContent icon={icon} trailingIcon={trailingIcon} arrow={arrow} shortcut={shortcut} size={size} variant={variant}>
        {children}
      </KeyContent>
    </Link>
  );
}

export type IconKeyProps = Omit<KeyProps, 'icon' | 'children' | 'trailingIcon' | 'arrow' | 'shortcut' | 'indicator' | 'block' | 'shape' | 'variant'> & {
  icon: IconComponent;
  /** Required accessible name; also shown as the tooltip on hover/focus. */
  label: string;
  /** `quiet` (default): a stone icon with a 48 px target · `action`: gold icon on a soft gold disc · `primary`: gold disc. */
  variant?: Exclude<KeyVariant, 'signal'>;
  /** Set false to suppress the label tooltip (e.g. when a visible caption sits beside the key). */
  tooltip?: boolean;
};

/** Round key with a single 20 px icon (16 px on `sm`). `label` is required. */
export function IconKey({ icon, label, size, variant = 'quiet', loading, pressed, disabled, disabledReason, tooltip, type = 'button', className, onClick, title, ...rest }: IconKeyProps) {
  const soft = Boolean(disabledReason) || Boolean(loading);
  const button = (
    <button
      type={type}
      className={cx('lm-key', className)}
      {...keyData({ variant, size, pressed, loading, icon, iconOnly: true })}
      aria-label={label}
      title={title}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-busy={loading || undefined}
      disabled={disabled && !disabledReason ? true : undefined}
      aria-disabled={soft ? true : undefined}
      onClick={(e) => {
        if (soft || disabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {loading ? <Spinner size={12} /> : <Icon icon={icon} size={size === 'sm' ? 16 : 20} />}
    </button>
  );
  return disabledReason ? (
    <Tooltip content={disabledReason}>{button}</Tooltip>
  ) : (
    <Tooltip content={label} role="label" disabled={tooltip === false}>
      {button}
    </Tooltip>
  );
}

export type IconKeyLinkProps = Omit<LinkProps, 'children'> & {
  icon: IconComponent;
  label: string;
  size?: KeySize;
  variant?: Exclude<KeyVariant, 'signal'>;
};

/** IconKey as a router link (top-bar settings key). */
export function IconKeyLink({ icon, label, size, variant = 'quiet', className, ...rest }: IconKeyLinkProps) {
  return (
    <Tooltip content={label} role="label">
      <Link className={cx('lm-key', className)} {...keyData({ variant, size, icon, iconOnly: true })} aria-label={label} {...rest}>
        <Icon icon={icon} size={size === 'sm' ? 16 : 20} />
      </Link>
    </Tooltip>
  );
}
