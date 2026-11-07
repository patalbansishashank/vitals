import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from './lib/cx';
import { MQ, useLatest, useMediaQuery } from './lib/hooks';
import { useRestoreFocus } from './lib/focus';
import { REDUCED_EXIT_MS, usePresence } from './lib/overlay';
import { Portal } from './lib/portal';
import { PanelHead, Sheet, pickConfirm, type PanelConfirmProps, type SheetDetent } from './Sheet';

export interface SidePanelProps extends PanelConfirmProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /**
   * `overlay` (default): fixed 392 px drawer from the right on the sheet's bg-2
   * surface with a 0.5 px hairline edge and no shadow; it covers the page without
   * changing its width. `docked`: in-flow sticky panel on the card material for an
   * explicitly built grid column; ResponsivePanel never chooses this mode.
   */
  mode?: 'overlay' | 'docked';
  /** Region name if `title` is not plain text. */
  label?: string;
  className?: string;
  /**
   * Overlay only, opt-in (r068 V-G-1, G10): dim the page beside the panel, so the panel reads as the one thing in
   * focus; a click on the dimmed page closes the panel, as a sheet's scrim does. For a reading or editing panel over
   * prose and cards. Without it the page beside the panel stays live.
   */
  scrim?: boolean;
}

/**
 * Desktop side panel / drawer (day editor, Explain). Non-modal: the page stays
 * usable. The same header row as the Sheet (PanelHead): Cancel · title · verb
 * when it commits, title · ✕ when it has nothing to commit. Esc closes; focus
 * moves to the title on open and back to the invoking control on close.
 */
export function SidePanel({ open, onClose, title, children, footer, mode = 'overlay', label, className, scrim = false, ...confirm }: SidePanelProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const [mounted, phase] = usePresence(open, mode === 'overlay' ? 320 : 0, mode === 'overlay' ? REDUCED_EXIT_MS : 0);
  const titleId = useId();
  const close = useLatest(onClose);
  useRestoreFocus(open, rootRef);

  useEffect(() => {
    if (!open) return;
    titleRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!mounted) return null;
  const panel = (
    <aside
      ref={rootRef}
      className={cx('lm-sidepanel', className)}
      data-mode={mode}
      data-state={phase}
      aria-labelledby={label ? undefined : titleId}
      aria-label={label}
    >
      <PanelHead title={title} titleId={titleId} titleRef={titleRef} onClose={() => close.current()} {...pickConfirm(confirm)} />
      <div className="lm-panel__body">{children}</div>
      {footer ? <div className="lm-panel__foot">{footer}</div> : null}
    </aside>
  );
  if (mode !== 'overlay') return panel;
  // The portal overlays the page without changing its layout; an optional scrim dims it and closes on a tap.
  return (
    <Portal>
      {scrim ? <div className="lm-scrim lm-sidepanel__scrim" data-state={phase} aria-hidden="true" onClick={() => close.current()} /> : null}
      {panel}
    </Portal>
  );
}

/** Alias: COMPONENTS.md calls the desktop surface a Drawer. */
export const Drawer = SidePanel;

export interface ResponsivePanelProps extends Omit<SidePanelProps, 'mode'> {
  /** @deprecated Accepted for older callers; desktop panels always overlay the page. */
  dockAtXl?: boolean;
  /** Sheet options below 1024 px. */
  detents?: ReadonlyArray<SheetDetent>;
  defaultDetent?: SheetDetent;
}

/**
 * One API, the right surface: bottom Sheet below 1024 px, overlay SidePanel from
 * 1024 px, always covering the page without changing its width on desktop.
 */
export function ResponsivePanel({ detents, defaultDetent, ...props }: ResponsivePanelProps) {
  const lg = useMediaQuery(MQ.lg);
  if (!lg) {
    return (
      <Sheet
        open={props.open}
        onClose={props.onClose}
        title={props.title}
        footer={props.footer}
        detents={detents}
        defaultDetent={defaultDetent}
        className={props.className}
        {...pickConfirm(props)}
      >
        {props.children}
      </Sheet>
    );
  }
  return <SidePanel {...props} mode="overlay" />;
}
