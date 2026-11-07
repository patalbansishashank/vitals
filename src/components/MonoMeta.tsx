import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cx } from './lib/cx';
import { OverflowText } from './OverflowText';
import './mono.css';

function plainText(value: ReactNode): string | null {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!Array.isArray(value)) return null;
  if (!value.every((part) => part === null || part === undefined || part === false || typeof part === 'string' || typeof part === 'number')) return null;
  return value.map((part) => part === null || part === undefined || part === false ? '' : String(part)).join('');
}

export interface MonoMetaProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  children?: ReactNode;
  /** Several facts on one line, joined with " · ". Text-only facts travel as one line if they overflow. Wins over `children`. */
  items?: ReadonlyArray<ReactNode>;
  /** `muted` stone (default) · `ink` ivory · `hue` the card's domain tint. */
  tone?: 'muted' | 'ink' | 'hue';
  /** `md` follows the role (11 px, 12 px from 1024) · `sm` stays 11 px. */
  size?: 'sm' | 'md';
  as?: 'span' | 'p' | 'div';
}

/**
 * Mono meta (RESEARCH §2.4): Geist Mono 500, UPPERCASE by CSS (the DOM stays sentence case), +0.08em. Only for facts:
 * a date, a range, a unit, a state, a legend label, a time, a tick. Never above a heading (the kicker ban), never a
 * sentence. It is the fact line meant to replace `.lm-fact`, `Engraved` and the Faceplate caption on a metric card.
 */
export function MonoMeta({ children, items, tone = 'muted', size = 'md', as, className, ...rest }: MonoMetaProps) {
  const C: ElementType = as ?? 'span';
  const list = items?.filter((i) => i !== null && i !== undefined && i !== false && i !== '');
  const textItems = list?.map(plainText);
  const joined = textItems && textItems.every((it): it is string => it !== null) ? textItems.join(' · ') : null;
  const flat = plainText(children);
  return (
    <C className={cx('lm-mono', className)} data-tone={tone} data-size={size} {...rest}>
      {list
        ? joined !== null ? <OverflowText text={joined} /> : list.map((it, i) => {
            const fact = plainText(it);
            return <span key={i} className="lm-mono__item">{fact !== null ? <OverflowText text={fact} /> : it}</span>;
          })
        : flat !== null ? <OverflowText text={flat} /> : children}
    </C>
  );
}
