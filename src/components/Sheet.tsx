import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { cx } from './lib/cx';
import { useFocusTrap, useRestoreFocus } from './lib/focus';
import { PortalContainerContext } from './lib/portal';
import { usePresence, useScrollLock } from './lib/overlay';
import { useIsoLayoutEffect, useLatest } from './lib/hooks';
import { IconKey } from './Key';

export type SheetDetent = 'peek' | 'half' | 'full';

const HEIGHT: Record<SheetDetent, string> = { peek: '35dvh', half: '60dvh', full: '92dvh' };
const ORDER: SheetDetent[] = ['peek', 'half', 'full'];

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  /** Sticky footer (e.g. "Reset to program B" · prev/next · Done). */
  footer?: ReactNode;
  /** Current detent. Uncontrolled starts at `defaultDetent` (half). */
  detent?: SheetDetent;
  defaultDetent?: SheetDetent;
  onDetentChange?: (d: SheetDetent) => void;
  /** Detents the handle can reach. Default half + full. Peek is non-modal (no scrim). */
  detents?: ReadonlyArray<SheetDetent>;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * Mobile bottom sheet: radius-xl top corners, drag handle, detents 35/60/92 %,
 * swipe down to step down or close, scrim except in peek. Content scrolls
 * inside; the header stays. Modal detents use native <dialog>.showModal().
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  detent: detentProp,
  defaultDetent = 'half',
  onDetentChange,
  detents = ['half', 'full'],
  initialFocus,
  className,
}: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [el, setEl] = useState<HTMLDialogElement | null>(null);
  const setRefs = useCallback((node: HTMLDialogElement | null) => {
    ref.current = node;
    setEl(node);
  }, []);
  const [inner, setInner] = useState<SheetDetent>(defaultDetent);
  const detent = detentProp ?? inner;
  const setDetent = (d: SheetDetent) => {
    if (detentProp === undefined) setInner(d);
    onDetentChange?.(d);
  };
  const modal = detent !== 'peek';
  const [mounted, phase] = usePresence(open, 320);
  const [dragY, setDragY] = useState<number | null>(null);
  const drag = useRef<{ id: number; y0: number } | null>(null);
  const titleId = useId();
  const close = useLatest(() => {
    if (open) onClose();
  });

  useScrollLock(open && modal);
  useRestoreFocus(open);
  useFocusTrap(ref, open && modal);

  useIsoLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!mounted) {
      if (d.open) {
        if (typeof d.close === 'function') d.close();
        else d.removeAttribute('open');
      }
      return;
    }
    const isModal = d.matches?.(':modal') ?? false;
    if (d.open && isModal === modal) return;
    if (d.open && typeof d.close === 'function') d.close();
    try {
      if (modal && typeof d.showModal === 'function') d.showModal();
      else if (!modal && typeof d.show === 'function') d.show();
      else d.setAttribute('open', '');
    } catch {
      d.setAttribute('open', '');
    }
  }, [mounted, modal]);

  useEffect(() => {
    if (!open) return;
    (initialFocus?.current ?? titleRef.current)?.focus({ preventScroll: true });
  }, [open, initialFocus]);

  const available = ORDER.filter((d) => detents.includes(d));

  const onGrabDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { id: e.pointerId, y0: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* unsupported */
    }
    setDragY(0);
  };
  const onGrabMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setDragY(Math.max(-80, e.clientY - d.y0));
  };
  const onGrabUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const dy = e.clientY - d.y0;
    setDragY(null);
    const i = available.indexOf(detent);
    if (dy > 70) {
      if (i <= 0) close.current();
      else setDetent(available[i - 1]!);
    } else if (dy < -50 && i < available.length - 1) {
      setDetent(available[i + 1]!);
    }
  };

  if (!mounted) return null;
  const style = {
    '--sheet-h': HEIGHT[detent],
    ...(dragY !== null ? { transform: `translateY(${dragY}px)` } : null),
  } as CSSProperties;

  return (
    <dialog
      ref={setRefs}
      className={cx('lm-sheet', className)}
      data-state={phase}
      data-detent={detent}
      data-dragging={dragY !== null || undefined}
      aria-modal={modal}
      aria-labelledby={titleId}
      style={style}
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close.current();
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && modal) close.current();
      }}
    >
      <PortalContainerContext.Provider value={el}>
        <div
          className="lm-sheet__grab"
          aria-hidden="true"
          onPointerDown={onGrabDown}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabUp}
          onPointerCancel={onGrabUp}
        />
        <div className="lm-panel__head">
          <h2 ref={titleRef} id={titleId} className="lm-panel__title" tabIndex={-1}>
            {title}
          </h2>
          {available.length > 1 ? (
            <button
              type="button"
              className="lm-sr"
              onClick={() => {
                const i = available.indexOf(detent);
                setDetent(available[(i + 1) % available.length]!);
              }}
            >
              {detent === 'full' ? 'Shrink sheet' : 'Expand sheet'}
            </button>
          ) : null}
          <IconKey icon={X} label="Close" onClick={() => close.current()} />
        </div>
        <div className="lm-panel__body">{children}</div>
        {footer ? <div className="lm-panel__foot">{footer}</div> : null}
      </PortalContainerContext.Provider>
    </dialog>
  );
}
