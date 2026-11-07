import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cx } from './lib/cx';

export type FaceplateVariant = 'plain' | 'inset' | 'flush';

export type FaceplateProps<T extends ElementType = 'section'> = {
  /** Rendered element. `section` by default; use `div` when it is not a landmark-worthy region. */
  as?: T;
  /** `plain` (default) card material · `inset` flat well (#11100F) · `flush` no padding (charts, rasters, strips). */
  variant?: FaceplateVariant;
  /** Card heading (title-m 16/500, sentence case). Renders a FaceplateHeader when given. */
  title?: ReactNode;
  /** Heading level for `title`. Default h2. */
  titleAs?: 'h2' | 'h3' | 'h4';
  /**
   * One fact line under the title (body-s, stone): a number, a date or a state ("6 of 7 days logged").
   * Never helper text or a restated label — leave it out when there is no fact.
   */
  caption?: ReactNode;
  /** Right-aligned header actions: text keys, action pills, a segmented control, a switch. */
  actions?: ReactNode;
  /** Footer content, 16 px under the body. */
  footer?: ReactNode;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'title' | 'children'>;

/**
 * The plain titled card (Ember material): charcoal with fine grain and a faint gold wash from the top right, a 0.5 px gold
 * hairline, 20 px corners, no shadow, 18 px padding (24 from 1024), with an optional header (title, a fact caption, actions)
 * and footer. `data-domain="energy"` (heart, steps, food, recovery, body, sleep, videos, plan) opts the card into ONE soft
 * glow in that domain's hue.
 *
 * It is the same material as `GradientCard`, not a second one: both draw the `.lm-face` / `.lm-material` recipe of
 * src/styles/components.css (the domain wiring and the glow are declared there once). `GradientCard` adds what a card on
 * Today has: the domain icon, title and (i) head, the foot, the whole-card open target and the glow's fade-in. `Faceplate`
 * stays the card for sections, forms, tools and every page that is not a metric card, and its markup does not change.
 * Never nest cards: inside one, structure comes from `Section`, `Rule` and space.
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

/**
 * Title (+ fact caption under it) and right-aligned actions; 12 px of space to the body, no divider.
 * Title and caption form one label block so the row can centre it against the actions and,
 * when the two do not fit side by side, stack the actions under it on the same left edge.
 */
export function FaceplateHeader({ title, titleAs = 'h2', titleId, caption, actions, className }: FaceplateHeaderProps) {
  const H = titleAs;
  return (
    <div className={cx('lm-face-head', className)}>
      {title !== undefined || caption !== undefined ? (
        <div className="lm-face-head__label">
          {title !== undefined ? (
            <H className="lm-h3" id={titleId}>
              {title}
            </H>
          ) : null}
          {caption !== undefined ? <span className="lm-eng">{caption}</span> : null}
        </div>
      ) : null}
      {actions !== undefined ? <div className="lm-face-head__actions">{actions}</div> : null}
    </div>
  );
}

/** A 0.5 px gold hairline inside a card. */
export function Rule({ className, ...rest }: ComponentPropsWithoutRef<'hr'>) {
  return <hr className={cx('lm-rule', className)} {...rest} />;
}

export interface SectionProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** Sub-group label (14/500, ink, sentence case). No trailing rule. */
  label?: ReactNode;
  /** Content at the right end of the label row (e.g. a Switch "Use measurement"). */
  aside?: ReactNode;
  labelAs?: 'h3' | 'h4' | 'div';
}

/** A titled group inside a card ("Where it sits", "Muscle"): label, then content. */
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
 * Secondary line / caption: body-s (12/18, 350), stone. Plain sentence case — no
 * small caps, no engraved costume. Only for facts (a number, a date, a state).
 */
export function Engraved({ as = 'span', className, ...rest }: EngravedProps) {
  const C = as as ElementType;
  return <C className={cx('lm-eng', className)} {...rest} />;
}

/** Plain well behind the body figure and chart placeholders (the perforated dot grid is gone). */
export function Stage({ className, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cx('lm-stage', className)} {...rest} />;
}

export interface KeyValueListProps extends ComponentPropsWithoutRef<'dl'> {
  items: ReadonlyArray<{ key: ReactNode; value: ReactNode; id?: string }>;
}

/** Two-column definition list (Habits, About): label stone left, value ink right, tabular. */
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
