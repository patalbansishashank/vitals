import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { cx } from './lib/cx';
import { useFocusTrap, useRestoreFocus } from './lib/focus';
import { PortalContainerContext } from './lib/portal';
import { REDUCED_EXIT_MS, usePresence, useScrollLock } from './lib/overlay';
import { useIsoLayoutEffect, useLatest } from './lib/hooks';
import { IconKey, Key } from './Key';
import { Tooltip } from './Tooltip';

/** `fit` sizes the sheet to its content (up to the full height), so a short sheet has no empty space under it. */
export type SheetDetent = 'peek' | 'fit' | 'half' | 'full';

const HEIGHT: Record<SheetDetent, string> = { peek: '35dvh', fit: 'auto', half: '60dvh', full: '92dvh' };
const ORDER: SheetDetent[] = ['peek', 'fit', 'half', 'full'];

/**
 * The panel grammar (r068 L1/L19), shared by Sheet, SidePanel and ResponsivePanel. The title is left-aligned, like a
 * page title.
 * - a panel that commits something: title · **Cancel** (stone text, closes) in the head, and the commit as a real
 *   filled primary key: full width at the foot of a phone sheet (where the thumb is), a small filled key after Cancel
 *   in a desktop side panel's head;
 * - a panel with nothing to commit (read-only, or every choice applies at once): title · ✕.
 * The panel draws the commit: no second Save in the body and no commit key in `footer`.
 */
export interface PanelConfirmProps {
  /** The commit. Giving it (or `doneForm`) turns the header into Cancel · title · verb; the verb calls this. */
  onDone?: () => void;
  /** The commit verb, verb first ("Save", "Log", "Pause"). Default "Done". */
  doneLabel?: ReactNode;
  /** Cancel label. Default "Cancel". */
  cancelLabel?: ReactNode;
  /** The verb is shown but cannot be used (nothing to save yet, or saving). It stays focusable. */
  doneDisabled?: boolean;
  /** Why the verb cannot be used yet ("Type your weight first."), as its tooltip. Implies `doneDisabled`. */
  doneDisabledReason?: string;
  /**
   * id of a `<form>` in the body. The verb becomes that form's submit button, so Enter in any of its fields commits
   * too; the form's `onSubmit` does the work and `onDone` is not called by the verb.
   */
  doneForm?: string;
}

/** True when the panel commits something (Cancel · title · verb), false for title · ✕. */
export const panelCommits = (p: PanelConfirmProps): boolean => Boolean(p.onDone || p.doneForm);

/** Only the confirm props, for passing them on (ResponsivePanel → Sheet / SidePanel). */
export function pickConfirm(p: PanelConfirmProps): PanelConfirmProps {
  const { onDone, doneLabel, cancelLabel, doneDisabled, doneDisabledReason, doneForm } = p;
  return { onDone, doneLabel, cancelLabel, doneDisabled, doneDisabledReason, doneForm };
}

export interface SheetProps extends PanelConfirmProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  /** Sticky footer for stepped flows only (Back · step · Next, "Reset to program B"). Never the commit: the sheet draws it at the foot. */
  footer?: ReactNode;
  /** Current detent. Uncontrolled starts at `defaultDetent` (fit when `detents` has it, else half, else the first). */
  detent?: SheetDetent;
  defaultDetent?: SheetDetent;
  onDetentChange?: (d: SheetDetent) => void;
  /** Detents the handle can reach. Default fit (content height) + full. Peek is non-modal (no scrim). */
  detents?: ReadonlyArray<SheetDetent>;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * Mobile bottom sheet: bg-2 surface, 24 px top corners, 32 × 4 drag handle, opens with a spring (components.css),
 * detents 35 % / content height / 60 % / 92 %, swipe down to step down or
 * close, scrim except in peek.
 * Header row (PanelHead): title · Cancel when the sheet commits (`onDone` /
 * `doneForm`; the commit is a full-width primary key at the foot), title · ✕
 * when it has nothing to commit. Content scrolls inside; the header and the
 * foot stay. Modal detents use native <dialog>.showModal().
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  detent: detentProp,
  defaultDetent: defaultDetentProp,
  onDetentChange,
  detents = ['fit', 'full'],
  initialFocus,
  className,
  ...confirm
}: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [el, setEl] = useState<HTMLDialogElement | null>(null);
  const setRefs = useCallback((node: HTMLDialogElement | null) => {
    ref.current = node;
    setEl(node);
  }, []);
  const defaultDetent = defaultDetentProp ?? (detents.includes('fit') ? 'fit' : detents.includes('half') ? 'half' : (detents[0] ?? 'half'));
  const [inner, setInner] = useState<SheetDetent>(defaultDetent);
  const detent = detentProp ?? inner;
  const setDetent = (d: SheetDetent) => {
    if (detentProp === undefined) setInner(d);
    onDetentChange?.(d);
  };
  const modal = detent !== 'peek';
  const [mounted, phase] = usePresence(open, 320, REDUCED_EXIT_MS);
  const [dragY, setDragY] = useState<number | null>(null);
  const drag = useRef<{ id: number; y0: number } | null>(null);
  const titleId = useId();
  const close = useLatest(() => {
    if (open) onClose();
  });

  useScrollLock(open && modal);
  useRestoreFocus(open, ref);
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
  const commits = panelCommits(confirm);
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
        <PanelHead
          title={title}
          titleId={titleId}
          titleRef={titleRef}
          onClose={() => close.current()}
          {...confirm}
          commitAt="foot"
          extra={
            available.length > 1 ? (
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
            ) : null
          }
        />
        <div className="lm-panel__body">{children}</div>
        {footer || commits ? (
          <div className="lm-panel__foot" data-commit={commits || undefined}>
            {footer}
            {commits ? <PanelDone {...confirm} place="foot" /> : null}
          </div>
        ) : null}
      </PortalContainerContext.Provider>
    </dialog>
  );
}

export interface PanelHeadProps extends PanelConfirmProps {
  title: ReactNode;
  titleId: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  /** Extra controls that sit in the row without a visible slot (the sheet's screen-reader detent key). */
  extra?: ReactNode;
  /**
   * Where the commit key sits: `head` (default; a desktop side panel: a small filled key after Cancel) or `foot` (a
   * phone sheet: the sheet draws it full width at its foot, so the head carries only title · Cancel).
   */
  commitAt?: 'head' | 'foot';
}

/**
 * The one header row of every sheet and side panel: title (left, title-m) · [Cancel] [commit] | ✕. Cancel is a stone
 * text key; the commit is a filled primary key (in the head on desktop, at the foot on phones). ✕ only when the panel
 * has nothing to commit.
 */
export function PanelHead({ title, titleId, titleRef, onClose, extra, commitAt = 'head', ...confirm }: PanelHeadProps) {
  const commits = panelCommits(confirm);
  return (
    <div className="lm-panel__head" data-confirm={commits || undefined}>
      <h2 ref={titleRef} id={titleId} className="lm-panel__title" tabIndex={-1}>
        {title}
      </h2>
      {extra}
      {commits ? (
        <div className="lm-panel__actions lm-panel__end">
          <button type="button" className="lm-panel__cancel" onClick={onClose}>
            {confirm.cancelLabel ?? 'Cancel'}
          </button>
          {commitAt === 'head' ? <PanelDone {...confirm} place="head" /> : null}
        </div>
      ) : (
        <IconKey icon={X} label="Close" className="lm-panel__end" onClick={onClose} />
      )}
    </div>
  );
}

/** The commit: a filled primary key, small in a side panel's head, full width at a sheet's foot. */
function PanelDone({ onDone, doneLabel, doneDisabled, doneDisabledReason, doneForm, place }: PanelConfirmProps & { place: 'head' | 'foot' }) {
  const inert = Boolean(doneDisabled || doneDisabledReason);
  const button = (
    <Key
      variant="primary"
      size={place === 'head' ? 'sm' : 'lg'}
      block={place === 'foot'}
      type={doneForm ? 'submit' : 'button'}
      form={doneForm}
      className="lm-panel__done"
      aria-disabled={inert || undefined}
      onClick={(e) => {
        if (inert) {
          e.preventDefault();
          return;
        }
        if (!doneForm) onDone?.();
      }}
    >
      {doneLabel ?? 'Done'}
    </Key>
  );
  return doneDisabledReason ? (
    <Tooltip content={doneDisabledReason} placement={place === 'head' ? 'bottom-end' : 'top'}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

