import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './lib/cx';
import { Icon, type IconComponent } from './icons/Icon';
import { KeyLink, Key } from './Key';
import { MonoMeta } from './MonoMeta';
import { OverflowText } from './OverflowText';
import './card.css';

export type StateTone = 'neutral' | 'caution' | 'danger';

export interface StateWordProps {
  /** "On plan", "Goal met", "Behind": what the picture means, in a word or two. */
  word: string;
  /** A glyph for the state; without one a 6 px dot in the card's hue is the mark. Never colour alone: the word is always there. */
  icon?: IconComponent;
  tone?: StateTone;
  /** Ivory word instead of the domain tint. */
  ink?: boolean;
  className?: string;
}

/** A state as a mark plus a word, in mono meta. The word stands where a card used to print a fact sentence. */
export function StateWord({ word, icon, tone = 'neutral', ink = false, className }: StateWordProps) {
  return (
    <span className={cx('lm-stateword', className)} data-tone={tone}>
      {icon ? <Icon icon={icon} size={14} className="lm-stateword__mark" /> : <i className="lm-stateword__dot" aria-hidden="true" />}
      <MonoMeta tone={ink ? 'ink' : 'hue'} className="lm-stateword__word">
        <OverflowText text={word} />
      </MonoMeta>
    </span>
  );
}

export interface CardFootProps {
  /** The state word on the left. */
  state?: { word: string; icon?: IconComponent; tone?: StateTone };
  /** The range or the goal on the right, as mono meta: "BY BEDTIME 2,595", "60-100". */
  right?: ReactNode;
  /** The card's one navigation, replacing Details and Open. */
  link?: { to?: string; onClick?: () => void; label: string };
  /** A bank or a key: the one control of the card (a KeyBank, one primary key). */
  children?: ReactNode;
  /** `hue` (default) tints the foot with the card's domain; `ink` is ivory, for a foot that sits in a glow's core (a bottom glow). */
  tone?: 'hue' | 'ink';
  className?: string;
}

/**
 * The card foot (r071): a state word on the left, a range on the right, optionally the card's one navigation and its
 * one control. It is the foot a metric card uses instead of the Faceplate footer and the fact lines ("Goal met", "Excellent").
 */
export function CardFoot({ state, right, link, children, tone = 'hue', className }: CardFootProps) {
  const footRef = useRef<HTMLElement>(null);
  const [stacked, setStacked] = useState(false);
  // Query updates can create fresh state/link objects without changing any displayed fact.
  // Keep the size observer until those facts change rather than forcing layout on each parent render.
  useLayoutEffect(() => {
    const foot = footRef.current;
    if (!foot || right === undefined || right === null || right === false) return;
    const stateNode = foot.querySelector<HTMLElement>(':scope > .lm-stateword');
    const extraNode = foot.querySelector<HTMLElement>(':scope > .lm-cardfoot__extra');
    const linkNode = foot.querySelector<HTMLElement>(':scope > .lm-cardfoot__link');
    const rightNode = foot.querySelector<HTMLElement>(':scope > .lm-cardfoot__right');
    if (!rightNode || (!stateNode && !extraNode && !linkNode)) return;
    const measure = () => {
      const fact = rightNode.querySelector<HTMLElement>('.lm-overflow__item');
      const rightWidth = fact?.scrollWidth ?? rightNode.scrollWidth;
      const extraWidth = extraNode?.firstElementChild?.scrollWidth ?? extraNode?.scrollWidth ?? 0;
      const leftWidth = (stateNode?.scrollWidth ?? 0) + extraWidth + (linkNode?.scrollWidth ?? 0);
      const gaps = 12 * [stateNode, extraNode, linkNode].filter(Boolean).length;
      setStacked(leftWidth + rightWidth + gaps > foot.clientWidth + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(foot);
    if (stateNode) observer.observe(stateNode);
    if (extraNode) observer.observe(extraNode);
    if (linkNode) observer.observe(linkNode);
    observer.observe(rightNode);
    return () => observer.disconnect();
  }, [state?.word, state?.icon, state?.tone, right, link?.to, link?.label, children]);
  if (!state && right === undefined && !link && !children) return null;
  return (
    <footer ref={footRef} className={cx('lm-cardfoot', className)} data-tone={tone} data-stacked={stacked || undefined}>
      {state ? <StateWord word={state.word} icon={state.icon} tone={state.tone} ink={tone === 'ink'} /> : null}
      {children ? <div className="lm-cardfoot__extra">{children}</div> : null}
      {link ? (
        <span className="lm-cardfoot__link">
          {link.to ? (
            <KeyLink to={link.to} variant="text" size="sm">
              {link.label}
            </KeyLink>
          ) : (
            <Key variant="text" size="sm" onClick={link.onClick}>
              {link.label}
            </Key>
          )}
        </span>
      ) : null}
      {right !== undefined && right !== null && right !== false ? (
        <MonoMeta tone={tone === 'ink' ? 'ink' : 'hue'} className="lm-cardfoot__right">
          {typeof right === 'string' || typeof right === 'number' ? <OverflowText text={String(right)} /> : right}
        </MonoMeta>
      ) : null}
    </footer>
  );
}
