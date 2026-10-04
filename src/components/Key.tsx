import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cx } from './lib/cx';
import { Icon, type IconComponent } from './icons/Icon';
import { Spinner } from './Progress';
import { Tooltip } from './Tooltip';

export type KeyVariant = 'default' | 'solid' | 'quiet' | 'danger' | 'signal';
export type KeySize = 'sm' | 'md' | 'lg';

interface KeyOwnProps {
  /**
   * `default` raised cap · `solid` the single strongest non-run action in a view ·
   * `quiet` tertiary/inline · `danger` destructive · `signal` ONLY Run / Find plans.
   */
  variant?: KeyVariant;
  /** `sm` 32 · `md` 40 (default) · `lg` 48. Touch layouts get a 44 px hit area automatically. */
  size?: KeySize;
  /** Leading 20 px icon (16 px on `sm`). */
  icon?: IconComponent;
  /** Trailing icon (chevron for menus). */
  trailingIcon?: IconComponent;
  /** Trailing indicator light: `true` = lit (yellow), `false` = hollow. Omit for none. */
  indicator?: boolean;
  /** Shortcut hint, e.g. "⌘↵". */
  shortcut?: string;
  /** Toggle keys: renders the pressed cap and sets aria-pressed. */
  pressed?: boolean;
  /** Busy: a 12 px ring replaces the leading icon; the key keeps its width. */
  loading?: boolean;
  /** Pill shape (planner "Find plans" signal key). */
  shape?: 'default' | 'pill';
  /** Full-width. */
  block?: boolean;
}

function keyData(p: KeyOwnProps & { iconOnly?: boolean }) {
  return {
    'data-variant': p.variant ?? 'default',
    'data-size': p.size ?? 'md',
    'data-pressed': p.pressed ? 'true' : undefined,
    'data-loading': p.loading ? 'true' : undefined,
    'data-has-icon': p.icon ? 'true' : 'false',
    'data-icon-only': p.iconOnly ? 'true' : undefined,
    'data-shape': p.shape === 'pill' ? 'pill' : undefined,
    'data-block': p.block ? 'true' : undefined,
  } as const;
}

function KeyContent({ icon, trailingIcon, indicator, shortcut, loading, size, children }: KeyOwnProps & { children?: ReactNode }) {
  const iconSize = size === 'sm' ? 16 : 20;
  return (
    <>
      {icon ? loading ? <Spinner size={12} /> : <Icon icon={icon} size={iconSize} /> : null}
      <span className="lm-key__label">{children}</span>
      {trailingIcon ? <Icon icon={trailingIcon} size={16} /> : null}
      {shortcut ? <span className="lm-key__hint">{shortcut}</span> : null}
      {indicator !== undefined ? <span className="lm-key__dot" data-on={indicator} aria-hidden="true" /> : null}
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

/** The button. Braun key: raised cap, 1 px edge, presses in 80 ms. */
export function Key({
  variant,
  size,
  icon,
  trailingIcon,
  indicator,
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
      {...keyData({ variant, size, pressed, loading, icon, shape, block })}
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
      <KeyContent icon={icon} trailingIcon={trailingIcon} indicator={indicator} shortcut={shortcut} loading={loading} size={size}>
        {children}
      </KeyContent>
    </button>
  );
  return disabledReason ? <Tooltip content={disabledReason}>{button}</Tooltip> : button;
}

export type KeyLinkProps = KeyOwnProps & LinkProps;

/** A router link that looks like a Key ("Open in Simulator", "Back to results"). */
export function KeyLink({ variant, size, icon, trailingIcon, indicator, shortcut, shape, block, className, children, ...rest }: KeyLinkProps) {
  return (
    <Link className={cx('lm-key', className)} {...keyData({ variant, size, icon, shape, block })} {...rest}>
      <KeyContent icon={icon} trailingIcon={trailingIcon} indicator={indicator} shortcut={shortcut} size={size}>
        {children}
      </KeyContent>
    </Link>
  );
}

export type IconKeyProps = Omit<KeyProps, 'icon' | 'children' | 'trailingIcon' | 'shortcut' | 'indicator' | 'block' | 'shape' | 'variant'> & {
  icon: IconComponent;
  /** Required accessible name; also shown as the ink tooltip on hover/focus. */
  label: string;
  variant?: Exclude<KeyVariant, 'signal'>;
  /** Set false to suppress the label tooltip (e.g. when a visible caption sits beside the key). */
  tooltip?: boolean;
};

/** Square key with a single 20 px icon (16 px on `sm`). `label` is required. */
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
