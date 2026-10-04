import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from './lib/cx';
import { MQ, useLatest, useMediaQuery } from './lib/hooks';
import { useRestoreFocus } from './lib/focus';
import { usePresence } from './lib/overlay';
import { Portal } from './lib/portal';
import { IconKey } from './Key';
import { Sheet, type SheetDetent } from './Sheet';

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /**
   * `overlay` (default): fixed 392 px drawer from the right with the drawer
   * shadow and no scrim. `docked`: in-flow sticky panel for a grid column
   * (pushes content, ≥ 1280 px layouts).
   */
  mode?: 'overlay' | 'docked';
  /** Region name if `title` is not plain text. */
  label?: string;
  className?: string;
}

/**
 * Desktop side panel / drawer (day editor, Explain). Non-modal: the page stays
 * usable. Esc closes; focus moves to the title on open and back to the
 * invoking control on close.
 */
export function SidePanel({ open, onClose, title, children, footer, mode = 'overlay', label, className }: SidePanelProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [mounted, phase] = usePresence(open, mode === 'overlay' ? 320 : 0);
  const titleId = useId();
  const close = useLatest(onClose);
  useRestoreFocus(open);

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
      className={cx('lm-sidepanel', className)}
      data-mode={mode}
      data-state={phase}
      aria-labelledby={label ? undefined : titleId}
      aria-label={label}
    >
      <div className="lm-panel__head">
        <h2 ref={titleRef} id={titleId} className="lm-panel__title" tabIndex={-1}>
          {title}
        </h2>
        <IconKey icon={X} label="Close" onClick={() => close.current()} />
      </div>
      <div className="lm-panel__body">{children}</div>
      {footer ? <div className="lm-panel__foot">{footer}</div> : null}
    </aside>
  );
  return mode === 'overlay' ? <Portal>{panel}</Portal> : panel;
}

/** Alias: COMPONENTS.md calls the desktop surface a Drawer. */
export const Drawer = SidePanel;

export interface ResponsivePanelProps extends Omit<SidePanelProps, 'mode'> {
  /** Dock in-flow at ≥ 1280 px instead of overlaying (the feature puts it in a grid column). */
  dockAtXl?: boolean;
  /** Sheet options below 1024 px. */
  detents?: ReadonlyArray<SheetDetent>;
  defaultDetent?: SheetDetent;
}

/**
 * One API, the right surface: bottom Sheet below 1024 px, overlay SidePanel from
 * 1024 px, optionally docked at ≥ 1280 px (IA §3: "sheets, not pages" on mobile,
 * "panels instead of sheets" on desktop).
 */
export function ResponsivePanel({ dockAtXl = false, detents, defaultDetent, ...props }: ResponsivePanelProps) {
  const lg = useMediaQuery(MQ.lg);
  const xl = useMediaQuery(MQ.xl);
  if (!lg) {
    return (
      <Sheet open={props.open} onClose={props.onClose} title={props.title} footer={props.footer} detents={detents} defaultDetent={defaultDetent} className={props.className}>
        {props.children}
      </Sheet>
    );
  }
  return <SidePanel {...props} mode={dockAtXl && xl ? 'docked' : 'overlay'} />;
}
