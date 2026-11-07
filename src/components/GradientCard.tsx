import { useCallback, useId, useRef, type ComponentPropsWithoutRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './lib/cx';
import { useInView } from '@/app/motion';
import { CardContext, type CardContextValue } from './cardContext';
import type { CardSize } from './CardGrid';
import type { Domain } from './domain';
import './card.css';

/** Where the glow sits: a corner, the bottom edge, nowhere, or an exact position, size and core alpha. */
export type CardGlow = 'tl' | 'tr' | 'bl' | 'br' | 'bottom' | 'none' | { pos: string; size: string; a: number };

export interface GradientCardProps extends Omit<ComponentPropsWithoutRef<'article'>, 'children' | 'title'> {
  /** Picks the hue and the glow (RESEARCH §3.2, §3.3). Default `neutral`: today's gold-wash card, no glow. */
  domain?: Domain;
  /** Overrides the domain's own glow position. A glow encodes the domain, never the value. */
  glow?: CardGlow;
  /** `hero` and `slim` are one row wide, `card` is half a row from 1024, `tile` a quarter. CardGrid reads the same word. */
  size?: CardSize;
  /** `plain` (default) · `inset` a flat well, no glow · `flush` no padding (a chart or raster that bleeds). */
  variant?: 'plain' | 'inset' | 'flush';
  /** A `<CardHead/>`: icon, title and the (i). Nothing else belongs in a head. */
  head?: ReactNode;
  /** A `<CardFoot/>`: the state word on the left, the range on the right. */
  foot?: ReactNode;
  /** The whole card opens this route through the title (a stretched link); the (i) and keys sit above it. */
  href?: string;
  /** The whole card runs this through the title (a stretched button). */
  onOpen?: () => void;
  /** Accessible name of the open target, when "Open {title}" is not enough. */
  openLabel?: string;
  as?: 'section' | 'article' | 'li' | 'div';
  /** The glow fades in once on first view (900 ms). False, reduced motion and tests: the final glow at once. */
  animate?: boolean;
  children?: ReactNode;
}

/**
 * The card (r071): the Ember charcoal face with its fine grain, a 0.5 px gold hairline, radius 20, and ONE eased radial
 * glow in the card's domain hue over the grain (a card never carries a second gradient layer, never animates a
 * gradient, and keeps small text off the glow's core). `data-domain` gives every picture inside the same five role
 * variables (--lm-hue, --lm-ink-h, --lm-deep, --lm-dim, --lm-tone-2), so a `GlowLine` or `RadialTicks` in the card
 * wears the card's hue without a prop. Never nest cards: inside one, structure is space.
 *
 *   <GradientCard domain="steps" size="tile" head={<CardHead icon={Footprints} title="Steps" info={…} />} foot={<CardFoot … />}>
 *     <HeroNumber value={7605} size="num" label="7,605 steps" />
 *     <RadialTicks … />
 *   </GradientCard>
 */
export function GradientCard({
  domain = 'neutral',
  glow,
  size = 'card',
  variant = 'plain',
  head,
  foot,
  href,
  onOpen,
  openLabel,
  as: Tag = 'article',
  animate = true,
  className,
  style,
  children,
  onKeyDown,
  ...rest
}: GradientCardProps) {
  const titleId = useId();
  const ref = useRef<HTMLElement | null>(null);
  const inView = useInView(ref);
  // the glow is held at 0 until the card is 20 % in view, then fades in once (where motion can run: the material's own `data-glow`)
  const pending = animate && !inView;
  const openInfo = useRef<(() => void) | null>(null);
  const registerInfo = useCallback((open: () => void) => {
    openInfo.current = open;
    return () => {
      if (openInfo.current === open) openInfo.current = null;
    };
  }, []);
  const ctx: CardContextValue = { titleId, href, onOpen, openLabel, registerInfo };
  const glowStyle: CSSProperties | undefined = glow && typeof glow === 'object' ? ({ '--lm-glow-pos': glow.pos, '--lm-glow-size': glow.size, '--lm-glow-a': glow.a } as CSSProperties) : undefined;
  const Root = Tag as 'article';
  return (
    <CardContext.Provider value={ctx}>
      <Root
        ref={ref as never}
        data-enter=""
        data-open={href || onOpen ? '' : undefined}
        data-domain={domain}
        data-size={size}
        data-variant={variant}
        // where the glow sits (card.css moves it) and, until the first view, that it is held at 0 (card.css; the glow itself is the material's)
        data-glow={typeof glow === 'string' ? glow : glow ? 'custom' : undefined}
        data-reveal={pending ? 'pending' : undefined}
        aria-labelledby={head && !rest['aria-label'] ? titleId : undefined}
        className={cx('lm-material', 'lm-gcard', className)}
        style={glowStyle ? { ...glowStyle, ...style } : style}
        onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
          (onKeyDown as ((e: KeyboardEvent<HTMLElement>) => void) | undefined)?.(e);
          // T opens the (i) panel at the Table twin, when the focus is inside this card and not in a field or a panel
          if (e.defaultPrevented || !openInfo.current || (e.key !== 't' && e.key !== 'T') || e.metaKey || e.ctrlKey || e.altKey) return;
          if ((e.target as Element).closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"], aside')) return;
          e.preventDefault();
          openInfo.current();
        }}
        {...(rest as object)}
      >
        {head}
        {children !== undefined && children !== null && children !== false ? <div className="lm-gcard__body">{children}</div> : null}
        {foot}
      </Root>
    </CardContext.Provider>
  );
}
