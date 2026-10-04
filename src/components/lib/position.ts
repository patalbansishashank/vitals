import { useCallback, useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { useIsoLayoutEffect } from './hooks';

export type Placement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top-start' | 'top-end' | 'top' | 'right' | 'left';

const MARGIN = 8;

/** Place a floating box next to an anchor rect, flipping and clamping inside the viewport. */
export function computePosition(
  anchor: DOMRect,
  floating: { width: number; height: number },
  placement: Placement,
  offset = 8,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): { top: number; left: number; placement: Placement } {
  let side = placement.split('-')[0] as 'top' | 'bottom' | 'left' | 'right';
  const align = (placement.split('-')[1] ?? 'center') as 'start' | 'end' | 'center';

  if (side === 'bottom' && anchor.bottom + offset + floating.height > viewport.height - MARGIN && anchor.top - offset - floating.height >= MARGIN) side = 'top';
  else if (side === 'top' && anchor.top - offset - floating.height < MARGIN && anchor.bottom + offset + floating.height <= viewport.height - MARGIN) side = 'bottom';
  else if (side === 'right' && anchor.right + offset + floating.width > viewport.width - MARGIN) side = 'left';
  else if (side === 'left' && anchor.left - offset - floating.width < MARGIN) side = 'right';

  let top: number;
  let left: number;
  if (side === 'top' || side === 'bottom') {
    top = side === 'bottom' ? anchor.bottom + offset : anchor.top - offset - floating.height;
    left =
      align === 'start'
        ? anchor.left
        : align === 'end'
          ? anchor.right - floating.width
          : anchor.left + anchor.width / 2 - floating.width / 2;
  } else {
    left = side === 'right' ? anchor.right + offset : anchor.left - offset - floating.width;
    top = anchor.top + anchor.height / 2 - floating.height / 2;
  }
  left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, viewport.width - floating.width - MARGIN));
  top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, viewport.height - floating.height - MARGIN));
  const resolved = (align === 'center' ? side : `${side}-${align}`) as Placement;
  return { top: Math.round(top), left: Math.round(left), placement: resolved };
}

/**
 * Keep `floatingRef` positioned against `anchorRef` while `open`: re-measures on
 * scroll (any ancestor), resize and size changes of either element.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  open: boolean,
  placement: Placement = 'bottom-start',
  offset = 8,
  matchWidth = false,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ top: -9999, left: -9999 });

  const update = useCallback(() => {
    const a = anchorRef.current;
    const f = floatingRef.current;
    if (!a || !f) return;
    const ar = a.getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    const width = matchWidth ? Math.max(fr.width, ar.width) : fr.width;
    const pos = computePosition(ar, { width, height: fr.height }, placement, offset);
    setStyle((prev) =>
      prev.top === pos.top && prev.left === pos.left && (!matchWidth || prev.minWidth === ar.width)
        ? prev
        : { top: pos.top, left: pos.left, ...(matchWidth ? { minWidth: ar.width } : null) },
    );
  }, [anchorRef, floatingRef, placement, offset, matchWidth]);

  useIsoLayoutEffect(() => {
    if (open) update();
  }, [open, update]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      if (anchorRef.current) ro.observe(anchorRef.current);
      if (floatingRef.current) ro.observe(floatingRef.current);
    }
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [open, update, anchorRef, floatingRef]);

  return style;
}
