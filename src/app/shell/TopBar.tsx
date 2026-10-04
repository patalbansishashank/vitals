import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft } from 'lucide-react';
import { IconKey } from '@/components/Key';
import { useNavigate } from 'react-router';
import { RingKey } from '@/features/ring/RingKey';
import { HeaderSync } from './HeaderSync';
import { useShell, type BackTarget } from './ShellContext';

export interface TopBarProps {
  /** Screen title (display width, 24 px) — or a switcher button (scenario switcher). Rendered in the page's h1. */
  title: ReactNode;
  /** Browser tab title; defaults to `title` when it is a string. "· Vitals" is appended. */
  documentTitle?: string;
  /** Nested routes: a back chevron (mobile top bar + desktop context bar). */
  back?: BackTarget | true;
  /** Local sub-navigation next to the title (e.g. <LinkBank> "schedule | results"). */
  tabs?: ReactNode;
  /** Key parameters, desktop only (hidden < 1024 px): horizon bank, date span, last-run text. */
  params?: ReactNode;
  /**
   * Right-aligned actions; the one primary action goes last (RunKey on Simulator,
   * "Find plans" on Planner). On mobile the Run key usually moves to <ActionBar>:
   * wrap desktop-only actions in `<span className="max-lg:hidden">`.
   */
  actions?: ReactNode;
  /** id for the h1 (for aria-labelledby on the page's main region). */
  titleId?: string;
  /**
   * Below 1024 px, show the title in the top bar itself (beside the back chevron)
   * and collapse the context bar — for screens whose body starts with their own
   * sticky strip (Settings anchor chips). Requires a string `title`.
   */
  compactOnMobile?: boolean;
}

/**
 * The per-screen context bar (IA §3.2 "context bar", COMPONENTS §11). Feature
 * pages render it once at the top; it portals into the shell's sticky slot:
 * under the mobile top bar, at the top of the main column on desktop.
 *
 *   <TopBar title="Your body" actions={<Engraved>saved on this device</Engraved>} />
 */
export function TopBar({ title, documentTitle, back, tabs, params, actions, titleId, compactOnMobile = false }: TopBarProps) {
  const shell = useShell();
  const navigate = useNavigate();
  const backTarget: BackTarget | null = back === true ? {} : (back ?? null);
  const docTitle = documentTitle ?? (typeof title === 'string' ? title : undefined);

  useEffect(() => {
    if (!docTitle) return;
    const prev = document.title;
    document.title = `${docTitle} · Vitals`;
    return () => {
      document.title = prev;
    };
  }, [docTitle]);

  const setMobileHeader = shell?.setMobileHeader;
  const backTo = backTarget?.to;
  const backLabel = backTarget?.label;
  const hasBack = backTarget !== null;
  const inlineTitle = compactOnMobile && typeof title === 'string' ? title : null;
  useEffect(() => {
    if (!setMobileHeader) return;
    setMobileHeader({ back: hasBack ? { to: backTo, label: backLabel } : null, title: inlineTitle });
    return () => setMobileHeader(null);
  }, [setMobileHeader, hasBack, backTo, backLabel, inlineTitle]);

  const bar = (
    <div className="lm-ctx" data-compact={inlineTitle ? 'true' : undefined}>
      {backTarget && !backTarget.mobileOnly ? (
        <IconKey
          className="lm-ctx__back"
          icon={ChevronLeft}
          label={backTarget.label ? `Back to ${backTarget.label}` : 'Back'}
          onClick={() => (backTarget.to ? navigate(backTarget.to) : window.history.length > 1 ? navigate(-1) : navigate('/'))}
        />
      ) : null}
      <div className="lm-ctx__title">
        <h1 className="lm-title" id={titleId}>
          {title}
        </h1>
      </div>
      {tabs}
      <div className="lm-ctx__grow" />
      {params ? <div className="lm-ctx__params">{params}</div> : null}
      {actions ? <div className="lm-ctx__actions">{actions}</div> : null}
      {/* desktop: the sync chip and the ring key at the right of the context bar (§15.4, ring-pages.md D2; phones have
          them in the top bar); shell only */}
      {shell?.contextSlot ? (
        <span className="inline-flex items-center gap-2 max-lg:hidden">
          <HeaderSync />
          <RingKey />
        </span>
      ) : null}
    </div>
  );
  if (!shell?.contextSlot) return shell ? null : bar;
  return createPortal(bar, shell.contextSlot);
}

export interface ActionBarProps {
  children: ReactNode;
}

/**
 * Mobile contextual action bar (56–64 px, above the tab bar), e.g. "painting
 * with B · rest day [run]". Hidden ≥ 1024 px, where the context bar carries the
 * primary action. The shell pads the page so content never hides beneath it.
 */
export function ActionBar({ children }: ActionBarProps) {
  const shell = useShell();
  const register = shell?.setActionBarCount;
  useEffect(() => {
    if (!register) return;
    register(1);
    return () => register(-1);
  }, [register]);
  if (!shell?.actionSlot) return null;
  return createPortal(<div className="lm-actionbar">{children}</div>, shell.actionSlot);
}
