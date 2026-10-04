import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { cx } from './lib/cx';
import { useFocusTrap, useRestoreFocus } from './lib/focus';
import { PortalContainerContext } from './lib/portal';
import { usePresence, useScrollLock } from './lib/overlay';
import { useIsoLayoutEffect, useLatest } from './lib/hooks';
import { IconKey } from './Key';

export interface DialogProps {
  open: boolean;
  /** Esc, scrim press and the close key call this (unless `dismissible` is false). */
  onClose: () => void;
  /** Title (17/600). Destructive dialogs ask a question: "Reset everything?" */
  title: ReactNode;
  children?: ReactNode;
  /** Right-aligned keys. Destructive: the action verb on the key ("Delete everything"), never "OK". */
  footer?: ReactNode;
  /** false for the first-run consent: no Esc, no scrim close, no close key. */
  dismissible?: boolean;
  /** `alertdialog` for destructive confirmations. */
  role?: 'dialog' | 'alertdialog';
  size?: 'default' | 'wide';
  /** Element to focus on open (e.g. the confirmation field). Default: the title. */
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * Modal dialog on native <dialog> (top layer, inert page, ::backdrop scrim),
 * plus a focus trap and Escape handling that also work where showModal is
 * missing. Only for destructive confirmation, import preview and first-run
 * consent — never a first resort.
 */
export function Dialog({ open, onClose, title, children, footer, dismissible = true, role = 'dialog', size = 'default', initialFocus, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [el, setEl] = useState<HTMLDialogElement | null>(null);
  const setRefs = useCallback((node: HTMLDialogElement | null) => {
    ref.current = node;
    setEl(node);
  }, []);
  const [mounted, phase] = usePresence(open, 200);
  const titleId = useId();
  const bodyId = useId();
  const close = useLatest(() => {
    if (dismissible && open) onClose();
  });

  useScrollLock(open);
  useRestoreFocus(open);
  useFocusTrap(ref, open);

  useIsoLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (mounted && !d.open) {
      if (typeof d.showModal === 'function') {
        try {
          d.showModal();
        } catch {
          d.setAttribute('open', '');
        }
      } else d.setAttribute('open', '');
    }
    if (!mounted && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [mounted]);

  useEffect(() => {
    if (!open) return;
    const target = initialFocus?.current ?? titleRef.current;
    target?.focus({ preventScroll: true });
  }, [open, initialFocus]);

  if (!mounted) return null;
  return (
    <dialog
      ref={setRefs}
      className={cx('lm-dialog', className)}
      data-state={phase}
      data-size={size}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={children ? bodyId : undefined}
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
        if (e.target === e.currentTarget) close.current();
      }}
    >
      <PortalContainerContext.Provider value={el}>
        <div className="lm-dialog__head">
          <h2 ref={titleRef} id={titleId} className="lm-dialog__title" tabIndex={-1}>
            {title}
          </h2>
          {dismissible ? <IconKey icon={X} label="Close" size="sm" onClick={() => close.current()} className="-mr-2 -mt-1" /> : null}
        </div>
        {children ? (
          <div className="lm-dialog__body" id={bodyId}>
            {children}
          </div>
        ) : null}
        {footer ? <div className="lm-dialog__foot">{footer}</div> : null}
      </PortalContainerContext.Provider>
    </dialog>
  );
}
