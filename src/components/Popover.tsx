import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cx } from './lib/cx';
import { Portal } from './lib/portal';
import { useAnchoredPosition, type Placement } from './lib/position';
import { getTabbables } from './lib/focus';

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element the popover hangs from (usually its trigger). */
  anchorRef: RefObject<HTMLElement | null>;
  placement?: Placement;
  /** Gap to the anchor in px (default 8). */
  offset?: number;
  /** At least as wide as the anchor (select lists). */
  matchWidth?: boolean;
  /** ARIA role of the surface. `dialog` (default) moves focus inside; `listbox` keeps focus on the trigger. */
  role?: 'dialog' | 'menu' | 'listbox';
  /** Accessible name for dialog popovers. */
  label?: string;
  /** Move focus into the popover on open (default: true for dialog/menu). */
  autoFocus?: boolean;
  padding?: 'default' | 'roomy';
  id?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Raised floating surface (menus, date picker, conflict explanations): radius md,
 * shadow pop, 8 px from its anchor, portaled so it escapes overflow. Closes on
 * Escape (focus returns to the anchor) and on outside press.
 */
export function Popover({
  open,
  onOpenChange,
  anchorRef,
  placement = 'bottom-start',
  offset = 8,
  matchWidth = false,
  role = 'dialog',
  label,
  autoFocus,
  padding = 'default',
  id,
  className,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const style = useAnchoredPosition(anchorRef, ref, open, placement, offset, matchWidth);
  const focusInside = autoFocus ?? role !== 'listbox';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onOpenChange(false);
        anchorRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange, anchorRef]);

  useEffect(() => {
    if (!open || !focusInside || !ref.current) return;
    const first = getTabbables(ref.current)[0] ?? ref.current.querySelector<HTMLElement>('[role="menuitem"]');
    (first ?? ref.current).focus({ preventScroll: true });
  }, [open, focusInside]);

  if (!open) return null;
  return (
    <Portal>
      <div
        ref={ref}
        id={id}
        role={role}
        aria-label={label}
        aria-modal={role === 'dialog' ? false : undefined}
        tabIndex={-1}
        className={cx('lm-popover', className)}
        data-padding={padding}
        style={style}
        onBlur={(e) => {
          if (role !== 'dialog') return;
          const next = e.relatedTarget as Node | null;
          if (next && !ref.current?.contains(next) && !anchorRef.current?.contains(next)) onOpenChange(false);
        }}
      >
        {children}
      </div>
    </Portal>
  );
}

/** State + trigger wiring for a popover: spread `triggerProps` on the trigger key. */
export function usePopover(initial = false) {
  const [open, setOpen] = useState(initial);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return {
    open,
    setOpen,
    anchorRef,
    triggerProps: {
      ref: anchorRef,
      onClick: toggle,
      'aria-expanded': open,
      'aria-haspopup': 'dialog' as const,
    },
  };
}
