import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cx } from './lib/cx';

export type FaceplateVariant = 'plain' | 'inset' | 'flush';

export type FaceplateProps<T extends ElementType = 'section'> = {
  /** Rendered element. `section` by default; use `div` when it is not a landmark-worthy region. */
  as?: T;
  /** `plain` (default) · `inset` recessed well, no shadow · `flush` no padding (charts, rasters, strips). */
  variant?: FaceplateVariant;
  /** Header title (15/600). Renders a FaceplateHeader when given. */
  title?: ReactNode;
  /** Heading level for `title`. Default h2. */
  titleAs?: 'h2' | 'h3' | 'h4';
  /** Engraved caption beside the title (lowercase, 12 px). */
  caption?: ReactNode;
  /** Right-aligned header actions (quiet keys, key banks, switches). */
  actions?: ReactNode;
  /** Footer content above a hairline rule. */
  footer?: ReactNode;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'title' | 'children'>;

/**
 * The only container: a panel screwed onto the chassis. Never nest faceplates —
 * inside one, structure comes from hairline rules (`Rule`, `Section`) and space.
 */
export function Faceplate<T extends ElementType = 'section'>({
  as,
  variant = 'plain',
  title,
  titleAs = 'h2',
  caption,
  actions,
  footer,
  className,
  children,
  ...rest
}: FaceplateProps<T>) {
  const Comp: ElementType = as ?? 'section';
  return (
    <Comp className={cx('lm-face', className)} data-variant={variant} {...rest}>
      {title !== undefined || actions !== undefined ? (
        <FaceplateHeader title={title} titleAs={titleAs} caption={caption} actions={actions} />
      ) : null}
      {children}
      {footer !== undefined ? <div className="lm-face-foot">{footer}</div> : null}
    </Comp>
  );
}

export interface FaceplateHeaderProps {
  title?: ReactNode;
  titleAs?: 'h2' | 'h3' | 'h4';
  titleId?: string;
  caption?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Title + engraved caption + right-aligned actions, separated from the body by a hairline. */
export function FaceplateHeader({ title, titleAs = 'h2', titleId, caption, actions, className }: FaceplateHeaderProps) {
  const H = titleAs;
  return (
    <div className={cx('lm-face-head', className)}>
      {title !== undefined ? (
        <H className="lm-h3" id={titleId}>
          {title}
        </H>
      ) : null}
      {caption !== undefined ? <span className="lm-eng">{caption}</span> : null}
      {actions !== undefined ? <div className="lm-face-head__actions">{actions}</div> : null}
    </div>
  );
}

/** A 1 px hairline divider inside a faceplate. */
export function Rule({ className, ...rest }: ComponentPropsWithoutRef<'hr'>) {
  return <hr className={cx('lm-rule', className)} {...rest} />;
}

export interface SectionProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** Sub-group label (13/600) followed by a hairline that runs to the edge. */
  label?: ReactNode;
  /** Content placed after the hairline (e.g. a Switch "use measurement"). */
  aside?: ReactNode;
  labelAs?: 'h3' | 'h4' | 'div';
}

/** A titled group inside a faceplate ("Where it sits", "Muscle"): label + hairline, then content. */
export function Section({ label, aside, labelAs = 'h3', className, children, ...rest }: SectionProps) {
  const L = labelAs;
  return (
    <div className={cx('lm-section', className)} {...rest}>
      {label !== undefined ? (
        <L className="lm-section-label">
          <span>{label}</span>
          {aside !== undefined ? <span className="lm-section-label__aside">{aside}</span> : null}
        </L>
      ) : null}
      {children}
    </div>
  );
}

export interface EngravedProps extends ComponentPropsWithoutRef<'span'> {
  as?: 'span' | 'label' | 'p' | 'div';
  htmlFor?: string;
}

/**
 * The instrument label: lowercase 12/16, weight 500, ink-2. Author the text in
 * lowercase (screen readers and copy-paste match what is seen).
 */
export function Engraved({ as = 'span', className, ...rest }: EngravedProps) {
  const C = as as ElementType;
  return <C className={cx('lm-eng', className)} {...rest} />;
}

/** Perforated dot-grid stage (Braun speaker grille) for the avatar and empty states. */
export function Stage({ className, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cx('lm-stage', className)} {...rest} />;
}

export interface KeyValueListProps extends ComponentPropsWithoutRef<'dl'> {
  items: ReadonlyArray<{ key: ReactNode; value: ReactNode; id?: string }>;
}

/** Two-column definition list (Habits, About): label ink-2 left, value right, tabular. */
export function KeyValueList({ items, className, ...rest }: KeyValueListProps) {
  return (
    <dl className={cx('lm-kv', className)} {...rest}>
      {items.map((it, i) => (
        <div key={it.id ?? i} style={{ display: 'contents' }}>
          <dt>{it.key}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
