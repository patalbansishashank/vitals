/* Card layouts keep DOM order and saved widths. Today uses equal-height rows with direct surface/corner gestures;
   other callers can use intrinsic height packing. Empty-rendering choices never reserve a visible slot. */
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { detectPlatform } from '@/platform/detect';
import { enter, fadeCue, motionAllowed, useFlip } from '@/app/motion';
import { cx } from './lib/cx';
import { MQ, useIsoLayoutEffect, useMediaQuery } from './lib/hooks';
import './cardgrid.css';

export type CardSize = 'hero' | 'wide' | 'card' | 'tile' | 'slim';
export type GridCols = 2 | 12;

export interface CardGridItem {
  id: string;
  size: CardSize;
  /** A render callback receives the effective content size without changing the saved width. */
  node: ReactNode | ((contentSize: CardSize) => ReactNode);
  edit?: { label: string; sizes: readonly CardSize[] };
}

export interface CardGridEditor {
  onResize(id: string, size: CardSize): void;
  /** Visible card ids in their new order; callers preserve unavailable choices in storage. */
  onReorder(ids: string[]): void;
}

export interface CardGridProps {
  items: ReadonlyArray<CardGridItem>;
  /** Desktop column count for specimens/tests. Phones remain full width regardless of this hint. */
  cols?: GridCols;
  /** Region name for assistive technology, when the cards are one group ("Today's cards"). */
  label?: string;
  /**
   * Cards in one row share the row's height (`align-items: stretch`). Off by default: cards keep their natural heights
   * and later cards pack below shorter neighbours. Enable for a row of tiles that should line up.
   */
  equalRows?: boolean;
  /** Present only in Edit cards mode. Editable content is reserved for dragging; the hero stays locked. */
  editor?: CardGridEditor;
  /** Makes editable cards keyboard focus targets. Has no effect without an editor. */
  keyboardEditing?: boolean;
  className?: string;
}

export interface PackedItem {
  id: string;
  span: number;
}

export interface HeightPlacement extends PackedItem {
  /** One-based CSS grid column and row lines. Rows are four CSS pixels high. */
  column: number;
  row: number;
  rows: number;
}

const ROW_PX = 4;

/** Sizes with distinct spans at this container width; Half and Full coincide on narrow screens. */
export function widthChoices(sizes: readonly CardSize[], cols: GridCols): CardSize[] {
  return sizes.filter((size, index) => sizes.findIndex((candidate) => BASE_SPAN[cols][candidate] === BASE_SPAN[cols][size]) === index);
}

/** Earliest non-overlapping placement, in DOM order. Full-width cards are natural barriers. */
export function packHeights(
  items: ReadonlyArray<{ id: string; span: number; height: number; preferredColumn?: number }>,
  cols: GridCols,
  gapPx: number,
): HeightPlacement[] {
  const gap = Math.max(0, Math.ceil(gapPx / ROW_PX));
  const nextFree = Array<number>(cols).fill(0);
  const out: HeightPlacement[] = [];
  let previous: { top: number; end: number; right: number } | null = null;
  for (const item of items) {
    const span = Math.max(1, Math.min(cols, Math.round(item.span)));
    const rows = Math.max(1, Math.ceil(item.height / ROW_PX));
    let best: { top: number; col: number } | null = null;
    for (let col = 0; col <= cols - span; col++) {
      let top = Math.max(...nextFree.slice(col, col + span), previous?.top ?? 0);
      // Equal-top cards read left to right, matching keyboard and screen-reader order.
      if (previous && top === previous.top && col < previous.right) top = previous.end + gap;
      const preference = item.preferredColumn ?? 1;
      if (!best || top < best.top || (top === best.top && (
        Math.abs(col + 1 - preference) < Math.abs(best.col + 1 - preference)
        || (Math.abs(col + 1 - preference) === Math.abs(best.col + 1 - preference) && col < best.col)
      ))) best = { top, col };
    }
    if (!best) continue;
    const end = best.top + rows;
    for (let col = best.col; col < best.col + span; col++) nextFree[col] = end + gap;
    out.push({ id: item.id, span, column: best.col + 1, row: best.top + 1, rows });
    previous = { top: best.top, end, right: best.col + span };
  }
  return out;
}

/** Columns an item of each size takes, before any widening. */
export const BASE_SPAN: Record<GridCols, Record<CardSize, number>> = {
  2: { hero: 2, wide: 2, card: 2, tile: 1, slim: 2 },
  12: { hero: 12, wide: 12, card: 6, tile: 3, slim: 12 },
};
/** The spans a card can grow through when its row has room: a tile, a card, a full row. */
const RUNGS: Record<GridCols, readonly number[]> = { 2: [1, 2], 12: [3, 6, 12] };

/**
 * Rows of `{ id, span }` for `items` on `cols` columns. Greedy in list order (an item that does not fit starts a new
 * row); then each row that ends with free columns bumps its items, last first, one rung up the ladder (phone 1 → 2,
 * desktop 3 → 6 → 12) while the bump fits the free columns, until the row is full or nothing fits. Hero, wide and slim are
 * always a full row. `widen=false` keeps each explicit width for CardGrid. Pure.
 */
export function packRows(items: ReadonlyArray<{ id: string; size: CardSize }>, cols: GridCols, widen = true): PackedItem[][] {
  const base = BASE_SPAN[cols];
  const rungs = RUNGS[cols];
  const rows: PackedItem[][] = [];
  let row: PackedItem[] = [];
  let used = 0;
  const close = () => {
    if (!row.length) return;
    let free = cols - used;
    let bumped = true;
    while (widen && free > 0 && bumped) {
      bumped = false;
      for (let i = row.length - 1; i >= 0; i--) {
        const item = row[i]!;
        const next = rungs.find((r) => r > item.span);
        if (next !== undefined && next - item.span <= free) {
          free -= next - item.span;
          item.span = next;
          bumped = true;
          break;
        }
      }
    }
    rows.push(row);
    row = [];
    used = 0;
  };
  for (const it of items) {
    const span = base[it.size] ?? base.card;
    if (used > 0 && used + span > cols) close();
    row.push({ id: it.id, span });
    used += span;
    if (used >= cols) close();
  }
  close();
  return rows;
}

export function CardGrid({ items, cols: forced, label, equalRows, editor, keyboardEditing = false, className }: CardGridProps) {
  const lg = useMediaQuery(MQ.lg);
  const mobile = !lg || detectPlatform() === 'android';
  const keyboardEnabled = Boolean(editor && keyboardEditing);
  const gridRef = useRef<HTMLDivElement>(null);
  const cleanupGesture = useRef<(() => void) | null>(null);
  const handoffFrame = useRef<number | null>(null);
  const handoffCell = useRef<HTMLElement | null>(null);
  const contextArmed = useRef(false);
  const touchGate = useRef<(() => boolean) | null>(null);
  const suppressClick = useRef<symbol | null>(null);
  const suppressTimer = useRef<number | null>(null);
  const [clickGuard, setClickGuard] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [draftSize, setDraftSize] = useState<{ id: string; size: CardSize } | null>(null);
  const [emptyIds, setEmptyIds] = useState<ReadonlySet<string>>(new Set());
  const [say, setSay] = useState('');
  const [containerCols, setContainerCols] = useState<GridCols | null>(null);
  const cols: GridCols = mobile ? 2 : forced ?? containerCols ?? 12;
  const singleColumn = cols === 2;
  const canResize = Boolean(editor && !singleColumn);
  const known = useRef<Set<string> | null>(null);

  const editable = items.filter((item) => item.edit && item.id !== 'hero' && item.size !== 'hero' && !emptyIds.has(item.id));
  const visibleIds = editable.map((item) => item.id);
  const editableIds = new Set(visibleIds);
  const shown = items;
  const layoutItems = shown.filter((item) => !emptyIds.has(item.id));

  // Use the actual card area rather than the viewport so narrow containers never produce cramped quarter cards.
  // A forced count is for specimens and tests.
  useIsoLayoutEffect(() => {
    if (forced) return;
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === 'undefined') return;
    const update = (width: number) => setContainerCols(width >= 900 ? 12 : 2);
    update(grid.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [forced]);

  // Mobile/narrow presentation is full width. Keep the saved desktop size intact for the next wide render.
  const rows = packRows(singleColumn ? layoutItems.map((item) => ({ ...item, size: 'wide' as const })) : layoutItems, cols, false);
  const spans = new Map(rows.flat().map((p) => [p.id, p.span]));
  const naturalColumns = new Map(rows.flatMap((row) => {
    let column = 1;
    return row.map((item) => {
      const entry: [string, number] = [item.id, column];
      column += item.span;
      return entry;
    });
  }));
  const sig = layoutItems.map((i) => `${i.id}:${i.size}`).join('|');
  const layoutKey = `${cols}|${sig}|${layoutItems.map((i) => spans.get(i.id)).join(',')}|${Boolean(editor)}`;
  const [heightLayout, setHeightLayout] = useState<{ key: string; signature: string; positions: Map<string, HeightPlacement> } | null>(null);
  const positions = !equalRows && heightLayout?.key === layoutKey ? heightLayout.positions : null;

  const itemIds = items.map((item) => item.id).join('|');
  useIsoLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const scan = () => {
      const next = new Set(Array.from(grid.querySelectorAll<HTMLElement>(':scope > [data-id]'))
        .filter((cell) => cell.querySelector(':scope > .lm-cardgrid__content:empty'))
        .map((cell) => cell.dataset.id!));
      setEmptyIds((before) => before.size === next.size && [...before].every((id) => next.has(id)) ? before : next);
    };
    scan();
    const observer = new MutationObserver(scan);
    for (const content of grid.querySelectorAll('.lm-cardgrid__content')) observer.observe(content, { childList: true });
    return () => observer.disconnect();
  }, [itemIds]);

  useIsoLayoutEffect(() => {
    if (equalRows) return;
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const cells = (Array.from(grid.children) as HTMLElement[]).filter((cell) => !emptyIds.has(cell.dataset.id ?? ''));
      if (cells.length !== layoutItems.length) return;
      const heights = cells.map((cell) => cell.getBoundingClientRect().height);
      // A selected component can return null after its wrapper was created. One zero-height cell must not make every
      // other card fall back to loose row packing; only a wholly unmeasurable grid waits for another observer tick.
      if (heights.some((height) => !Number.isFinite(height)) || heights.every((height) => height <= 0)) return;
      const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
      const packed = packHeights(layoutItems.map((item, index) => ({
        id: item.id,
        span: spans.get(item.id) ?? BASE_SPAN[cols][item.size],
        height: heights[index]!,
        preferredColumn: naturalColumns.get(item.id),
      })), cols, gap);
      const signature = packed.map((p) => `${p.id}:${p.column}:${p.row}:${p.rows}`).join('|');
      setHeightLayout((before) => before?.key === layoutKey && before.signature === signature
        ? before
        : { key: layoutKey, signature, positions: new Map(packed.map((p) => [p.id, p])) });
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    });
    observer.observe(grid);
    for (const cell of Array.from(grid.children)) if (!emptyIds.has((cell as HTMLElement).dataset.id ?? '')) observer.observe(cell);
    return () => { disposed = true; observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [layoutKey, cols, equalRows, emptyIds]);

  // An add, remove, reorder or saved-width change can FLIP. A container width crossing 900px is a reflow, not a move.
  useFlip(gridRef, sig, { selector: ':scope > [data-flip]:not([data-dragging])' });

  // a card that was not there enters (rise and fade); under reduced motion it gets the 100 ms cross-fade instead
  useIsoLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const was = known.current;
    known.current = new Set(layoutItems.map((i) => i.id));
    if (!was) return;
    const added = (Array.from(grid.children) as HTMLElement[]).filter((el) => el.dataset.id && !was.has(el.dataset.id));
    if (!added.length) return;
    if (motionAllowed()) enter(added);
    else added.forEach((el) => fadeCue(el));
  }, [sig]);

  // Register before the finger lands: the browser must know this region can cancel a touch move.
  // Changing touch-action after a hold cannot reclaim a gesture already handed to native scrolling.
  // Early movement stays native; only an activated, stationary hold owns subsequent touch moves.
  useIsoLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || !editor) return;
    const blockHeldScroll = (event: TouchEvent) => {
      if (!touchGate.current?.()) return;
      if (event.cancelable) event.preventDefault();
      else cleanupGesture.current?.();
    };
    grid.addEventListener('touchmove', blockHeldScroll, { passive: false });
    return () => grid.removeEventListener('touchmove', blockHeldScroll);
  }, [Boolean(editor)]);

  useIsoLayoutEffect(() => () => {
    cleanupGesture.current?.();
    if (suppressTimer.current !== null) window.clearTimeout(suppressTimer.current);
    if (handoffFrame.current !== null) cancelAnimationFrame(handoffFrame.current);
    if (handoffCell.current) { handoffCell.current.style.transform = ''; handoffCell.current.style.willChange = ''; }
  }, []);
  useIsoLayoutEffect(() => {
    // A gesture begun under different geometry or edit permissions cannot commit afterward.
    cleanupGesture.current?.();
    if (handoffFrame.current !== null) { cancelAnimationFrame(handoffFrame.current); handoffFrame.current = null; }
    if (handoffCell.current) {
      handoffCell.current.style.transform = '';
      handoffCell.current.style.willChange = '';
      handoffCell.current = null;
    }
    setDraggingId(null);
    setDropTargetId(null);
    setResizingId(null);
    setDraftSize(null);
  }, [Boolean(editor), cols, mobile]);
  useIsoLayoutEffect(() => {
    if (!keyboardEnabled) return;
    const grid = gridRef.current;
    if (!grid) return;
    const focused = document.activeElement as HTMLElement | null;
    if (focused && grid.contains(focused) && !focused.closest('[data-empty], [inert]')) return;
    grid.querySelector<HTMLElement>('[data-keyboard-card]:not([data-empty])')?.focus();
  }, [keyboardEnabled, emptyIds]);

  const suppressNextClick = () => {
    const mark = Symbol();
    suppressClick.current = mark;
    setClickGuard(true);
    if (suppressTimer.current !== null) window.clearTimeout(suppressTimer.current);
    suppressTimer.current = window.setTimeout(() => {
      if (suppressClick.current === mark) { suppressClick.current = null; setClickGuard(false); }
      suppressTimer.current = null;
    }, 700);
  };
  const bindGesture = (
    pointerId: number,
    move: (event: globalThis.PointerEvent) => void,
    finish: (event: globalThis.PointerEvent) => void,
    cancel: () => void,
    gateTouchScroll: () => boolean,
    allowOutsideDrop = false,
    onCleanup?: () => void,
  ) => {
    const grid = gridRef.current;
    let ended = false;
    const onMove = (event: globalThis.PointerEvent) => { if (event.pointerId === pointerId) move(event); };
    const onUp = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const rect = grid?.getBoundingClientRect();
      const outside = rect && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
      cleanup();
      if (outside && !allowOutsideDrop) cancel(); else finish(event);
    };
    const onCancel = (event: globalThis.PointerEvent) => { if (event.pointerId === pointerId) { cleanup(); cancel(); } };
    // Touch begins with implicit capture on the child. Taking grid capture emits a bubbling loss
    // from that child: it is a transfer to us, not cancellation of our newly activated hold.
    const onLost = (event: globalThis.PointerEvent) => {
      if (event.pointerId === pointerId && event.target === grid) { cleanup(); cancel(); }
    };
    const onBlur = () => { cleanup(); cancel(); };
    const onAdditionalPointer = (event: globalThis.PointerEvent) => {
      if (event.pointerType === 'touch' && event.pointerId !== pointerId) { cleanup(); cancel(); }
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // The page's existing Edit cards controller may also leave edit mode on this Escape.
      cleanup();
      cancel();
    };
    const abort = () => { cleanup(); cancel(); };
    const cleanup = () => {
      if (ended) return;
      ended = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      grid?.removeEventListener('lostpointercapture', onLost);
      window.removeEventListener('pointerdown', onAdditionalPointer);
      touchGate.current = null;
      onCleanup?.();
      contextArmed.current = false;
      if (grid?.hasPointerCapture?.(pointerId)) grid.releasePointerCapture(pointerId);
      if (cleanupGesture.current === abort) cleanupGesture.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    grid?.addEventListener('lostpointercapture', onLost);
    window.addEventListener('pointerdown', onAdditionalPointer);
    touchGate.current = gateTouchScroll;
    cleanupGesture.current = abort;
    return cleanup;
  };
  const closestCard = (x: number, y: number, ids: readonly string[], except: string, sourceX: number, sourceY: number) => {
    const grid = gridRef.current;
    if (!grid) return null;
    const cells = Array.from(grid.querySelectorAll<HTMLElement>(':scope > [data-id]'))
      .filter((cell) => cell.dataset.id !== except && ids.includes(cell.dataset.id ?? '') && !cell.hasAttribute('data-empty'));
    const nearest = cells.reduce<{ id: string; distance: number }>((best, cell) => {
      const rect = cell.getBoundingClientRect();
      const distance = Math.hypot(x - (rect.left + rect.right) / 2, y - (rect.top + rect.bottom) / 2);
      return distance < best.distance ? { id: cell.dataset.id!, distance } : best;
    }, { id: except, distance: Math.hypot(x - sourceX, y - sourceY) });
    return nearest.id === except ? null : nearest.id;
  };
  const beginReorder = (event: PointerEvent<HTMLDivElement>, item: CardGridItem) => {
    if (!editor || !editableIds.has(item.id) || event.button !== 0 || event.isPrimary === false || cleanupGesture.current) return;
    if ((event.target as Element).closest('.lm-cardgrid__corner')) return;
    // Capture before any child chart/control can claim the edit-mode gesture. The overlay also covers disabled inputs.
    event.stopPropagation();
    if (event.pointerType !== 'touch') event.preventDefault();
    const grid = gridRef.current;
    if (!grid) return;
    if (handoffFrame.current !== null) { cancelAnimationFrame(handoffFrame.current); handoffFrame.current = null; }
    if (handoffCell.current) { handoffCell.current.style.transform = ''; handoffCell.current.style.willChange = ''; handoffCell.current = null; setDraggingId(null); }
    const cell = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX, startY = event.clientY;
    const origin = cell.getBoundingClientRect();
    const gridBounds = grid.getBoundingClientRect();
    const scrollParent = findScrollParent(grid);
    let frame = 0;
    let lastFrame = 0;
    let currentX = startX, currentY = startY;
    let moved = false;
    const touch = event.pointerType === 'touch';
    contextArmed.current = touch;
    let active = false;
    let targetId: string | null = null;
    let timer = 0;
    const activate = () => {
      if (active) return;
      active = true;
      cell.getAnimations?.().forEach((animation) => animation.cancel());
      grid.setPointerCapture?.(pointerId);
      cell.style.willChange = 'transform';
      setDraggingId(item.id);
    };
    const reset = () => {
      suppressNextClick();
      if (timer) window.clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
      cell.style.transform = '';
      cell.style.willChange = '';
      setDraggingId(null);
      setDropTargetId(null);
    };
    const paintDrag = () => {
      const bounds = grid.getBoundingClientRect();
      const left = Math.max(bounds.left, Math.min(bounds.right - origin.width, origin.left + currentX - startX));
      // The original cell scrolls with the page. Compensate so the lifted card remains under the finger.
      const scrollDelta = gridBounds.top - bounds.top;
      cell.style.transform = `translate3d(${left - origin.left}px, ${currentY - startY + scrollDelta}px, 0)`;
      const sourceX = origin.left + origin.width / 2;
      const sourceY = origin.top + origin.height / 2 - scrollDelta;
      const nearest = closestCard(left + origin.width / 2, origin.top + origin.height / 2 + currentY - startY, visibleIds, item.id, sourceX, sourceY);
      if (nearest !== targetId) { targetId = nearest; setDropTargetId(nearest); }
    };
    const tick = (time: number) => {
      const bounds = scrollParent?.getBoundingClientRect();
      const top = Math.max(0, bounds?.top ?? 0) + 80;
      const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight) - 96;
      const speed = currentY < top ? -Math.min(1, (top - currentY) / 64)
        : currentY > bottom ? Math.min(1, (currentY - bottom) / 64) : 0;
      const elapsed = lastFrame ? Math.min(32, time - lastFrame) : 16;
      lastFrame = time;
      if (moved && speed) {
        if (scrollParent) scrollParent.scrollTop += speed * elapsed * 0.65;
        else window.scrollBy(0, speed * elapsed * 0.65);
        paintDrag();
      }
      frame = requestAnimationFrame(tick);
    };
    const cleanup = bindGesture(pointerId, (moving) => {
      const distance = Math.hypot(moving.clientX - startX, moving.clientY - startY);
      if (!active) {
        if (touch) { if (distance > 10) { cleanup(); reset(); } return; }
        if (distance < 6) return;
        activate();
      }
      moving.preventDefault();
      currentX = moving.clientX; currentY = moving.clientY;
      if (!moved && distance >= 6) { moved = true; frame = requestAnimationFrame(tick); }
      if (moved) paintDrag();
    }, () => {
      if (active) {
        const next = targetId ? moveVisible(visibleIds, item.id, visibleIds.indexOf(targetId)) : visibleIds;
        if (next.join('|') !== visibleIds.join('|')) {
          const floating = cell.getBoundingClientRect();
          editor.onReorder(next);
          handoffCell.current = cell;
          handoffFrame.current = requestAnimationFrame(() => {
            handoffFrame.current = null;
            handoffCell.current = null;
            cell.style.transform = '';
            cell.style.willChange = '';
            const placed = cell.getBoundingClientRect();
            if (motionAllowed() && typeof cell.animate === 'function') {
              const dx = floating.left - placed.left, dy = floating.top - placed.top;
              if (Math.hypot(dx, dy) > 1) cell.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)' });
            }
            setDraggingId(null);
          });
          setDropTargetId(null);
          setSay(`${item.edit?.label} moved to position ${next.indexOf(item.id) + 1} of ${next.length}.`);
        } else reset();
        suppressNextClick();
      } else reset();
    }, reset, () => active && touch, false, () => { if (timer) window.clearTimeout(timer); if (frame) cancelAnimationFrame(frame); });
    if (touch) timer = window.setTimeout(activate, 420);
  };
  const beginResize = (event: PointerEvent<HTMLButtonElement>, item: CardGridItem) => {
    if (!editor || !canResize || !editableIds.has(item.id) || !item.edit || event.button !== 0 || event.isPrimary === false || cleanupGesture.current) return;
    event.stopPropagation();
    const grid = gridRef.current;
    if (!grid) return;
    const cell = event.currentTarget.closest<HTMLElement>('.lm-cardgrid__cell');
    const guide = cell?.querySelector<HTMLElement>('.lm-cardgrid__resize-guide');
    const pointerId = event.pointerId;
    const startX = event.clientX, startY = event.clientY;
    const startSize = item.size;
    const sizes = widthChoices(item.edit.sizes, cols);
    const startSpan = BASE_SPAN[cols][startSize];
    const startIndex = sizes.findIndex((size) => BASE_SPAN[cols][size] === startSpan);
    const touch = event.pointerType === 'touch';
    let active = false;
    let timer = 0;
    let size = startSize;
    let axis: 'x' | 'y' | null = null;
    contextArmed.current = touch;
    const activate = () => { if (active) return; active = true; grid.setPointerCapture?.(pointerId); setResizingId(item.id); };
    const reset = () => {
      suppressNextClick();
      if (guide) { guide.style.width = ''; guide.style.left = ''; }
      setDraftSize(null);
      setResizingId(null);
    };
    if (!touch) { event.preventDefault(); activate(); }
    const cleanup = bindGesture(pointerId, (moving) => {
      if (!active) {
        if (Math.hypot(moving.clientX - startX, moving.clientY - startY) > 10) { cleanup(); reset(); }
        return;
      }
      moving.preventDefault();
      const dx = moving.clientX - startX, dy = moving.clientY - startY;
      const step = cols === 2 ? 72 : 96;
      const horizontalGrowthStep = Math.min(step, Math.max(56, (window.innerWidth - startX) * 1.4));
      // A diagonal at the screen edge must not lock to an unreachable horizontal rung.
      // Wait for vertical intent there; once chosen, keep the axis so the preview cannot jump.
      if (!axis && Math.max(Math.abs(dx), Math.abs(dy)) > 7) {
        const horizontalRoom = dx >= 0 ? window.innerWidth - startX : startX;
        const horizontalThreshold = 7 + (dx >= 0 ? horizontalGrowthStep : step) / 2;
        if (touch && horizontalRoom < horizontalThreshold) {
          if (Math.abs(dy) <= 7) return;
          axis = 'y';
        } else axis = touch && Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      }
      if (!axis) return;
      const travel = axis === 'y' ? dy : dx;
      const rect = grid.getBoundingClientRect();
      const growthStep = axis === 'y' ? step : horizontalGrowthStep;
      const beyondDeadband = Math.sign(travel) * Math.max(0, Math.abs(travel) - 7);
      const progress = Math.max(0, Math.min(sizes.length - 1, startIndex + beyondDeadband / (travel > 0 ? growthStep : step)));
      const lower = Math.floor(progress), upper = Math.ceil(progress);
      const span = BASE_SPAN[cols][sizes[lower]!] + (BASE_SPAN[cols][sizes[upper]!] - BASE_SPAN[cols][sizes[lower]!]) * (progress - lower);
      // Responsive sizes can share a rung. Returning to it must retain the exact saved desktop width.
      const nextIndex = Math.round(progress);
      const next = nextIndex === startIndex ? startSize : sizes[nextIndex]!;
      if (guide && cell) {
        const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
        const track = (rect.width - gap * (cols - 1)) / cols;
        const width = span * track + (span - 1) * gap;
        const cellLeft = cell.getBoundingClientRect().left - rect.left;
        guide.style.width = `${width}px`;
        guide.style.left = `${Math.max(0, Math.min(cellLeft, rect.width - width)) - cellLeft}px`;
      }
      if (next !== size) { size = next; setDraftSize({ id: item.id, size }); }
    }, () => {
      if (!active) return;
      if (size !== startSize) editor.onResize(item.id, size);
      reset();
      suppressNextClick();
    }, reset, () => active && touch, true, () => { if (timer) window.clearTimeout(timer); });
    if (touch) timer = window.setTimeout(activate, 420);
  };
  const resizeKey = (event: KeyboardEvent<HTMLButtonElement>, item: CardGridItem) => {
    if (!canResize || !editableIds.has(item.id)) return;
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const sizes = widthChoices(item.edit?.sizes ?? [], cols);
    const at = sizes.findIndex((size) => BASE_SPAN[cols][size] === BASE_SPAN[cols][item.size]);
    const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? Math.min(sizes.length - 1, at + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? Math.max(0, at - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? sizes.length - 1 : -1;
    if (next < 0 || next === at) return;
    editor?.onResize(item.id, sizes[next]!);
    setSay(`${item.edit?.label} width ${widthName(sizes[next]!, cols)}.`);
  };
  const cardKey = (event: KeyboardEvent<HTMLDivElement>, item: CardGridItem) => {
    if (!keyboardEnabled || !editableIds.has(item.id) || event.target !== event.currentTarget || !event.altKey || !item.edit) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const from = visibleIds.indexOf(item.id);
    const to = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? from - 1
      : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? from + 1
        : event.key === 'Home' ? 0 : event.key === 'End' ? visibleIds.length - 1 : -1;
    if (to < 0 || to >= visibleIds.length || to === from) return;
    editor?.onReorder(moveVisible(visibleIds, item.id, to));
    setSay(`${item.edit.label} moved to position ${to + 1} of ${visibleIds.length}.`);
  };

  return (
    <div ref={gridRef} className={cx('lm-cardgrid', className)} data-cols={cols} data-equal={equalRows || undefined} data-packed={positions ? true : undefined} data-rearrange={Boolean(editor) || undefined} role={label ? 'group' : undefined} aria-label={label}
      onPointerDownCapture={editor || clickGuard ? () => { suppressClick.current = null; setClickGuard(false); } : undefined}
      onClickCapture={editor || clickGuard ? (event) => {
        const editingContent = editor && (event.target as Element).closest('[data-editable]');
        if (!editingContent && (!suppressClick.current || event.detail === 0)) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = null;
        setClickGuard(false);
      } : undefined}
      onDragStartCapture={editor ? (event) => { if ((event.target as Element).closest('[data-editable]')) event.preventDefault(); } : undefined}
      onContextMenuCapture={editor || clickGuard ? (event) => { if (contextArmed.current || clickGuard) event.preventDefault(); } : undefined}>
      {shown.map((it) => {
        const span = spans.get(it.id) ?? (singleColumn ? cols : BASE_SPAN[cols][it.size]);
        const placed = positions?.get(it.id);
        const empty = emptyIds.has(it.id);
        const choices = canResize ? widthChoices(it.edit?.sizes ?? [], cols) : [];
        const editing = Boolean(editor && editableIds.has(it.id));
        const keyboardCard = keyboardEnabled && editing;
        const contentSize = it.size === 'wide' || (singleColumn && it.size === 'tile') ? 'card' : it.size;
        return (
          <div key={it.id} className="lm-cardgrid__cell" data-id={it.id} data-flip={it.id} data-size={it.size} data-span={span} data-empty={empty || undefined} data-dragging={draggingId === it.id || undefined} data-drop-target={dropTargetId === it.id || undefined} data-resizing={resizingId === it.id || undefined} data-editable={editing || undefined} data-keyboard-card={keyboardCard || undefined}
            role={keyboardCard ? 'group' : undefined}
            aria-label={keyboardCard ? `${it.edit!.label}, position ${visibleIds.indexOf(it.id) + 1} of ${visibleIds.length}. Alt and arrow keys move this card.` : undefined}
            tabIndex={keyboardCard ? 0 : undefined}
            onKeyDown={keyboardCard ? (event) => cardKey(event, it) : undefined}
            onPointerDownCapture={editing ? (event) => beginReorder(event, it) : undefined}
            style={{ gridColumn: placed ? `${placed.column} / span ${span}` : `span ${span}`, gridRow: placed ? `${placed.row} / span ${placed.rows}` : undefined }}>
            <div className="lm-cardgrid__content" inert={editing || undefined}>{typeof it.node === 'function' ? it.node(contentSize) : it.node}</div>
            {editing ? <div className="lm-cardgrid__drag-surface" aria-hidden="true" /> : null}
            {editing && it.edit && choices.length > 1 ? <><span className="lm-cardgrid__resize-guide" aria-hidden="true" /><button type="button" role="slider" className="lm-cardgrid__corner" aria-label={`Width of ${it.edit.label}`} aria-valuemin={1} aria-valuemax={choices.length} aria-valuenow={choices.findIndex((size) => BASE_SPAN[cols][size] === BASE_SPAN[cols][draftSize?.id === it.id ? draftSize.size : it.size]) + 1} aria-valuetext={`${widthName(draftSize?.id === it.id ? draftSize.size : it.size, cols)} width`} aria-orientation="horizontal" aria-description="Hold, then drag right or down to widen; left or up to narrow. Arrow keys change width."
                onKeyDown={(event) => resizeKey(event, it)}
                onPointerDown={(event) => beginResize(event, it)}>
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M10 17 17 10M14 17l3-3" />
                </svg>
              </button></> : null}
            {editor && it.id === 'hero' ? <span className="lm-sr" role="status">{say}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

const widthName = (size: CardSize, cols: GridCols) => {
  const span = BASE_SPAN[cols][size];
  return span === cols ? 'Full' : span * 2 === cols ? 'Half' : 'Quarter';
};
export function moveVisible(ids: readonly string[], id: string, to: number): string[] {
  const next = ids.filter((item) => item !== id);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, id);
  return next;
}

/** The app scrolls the document; embedded grids may live in their own scrolling region. */
function findScrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}
