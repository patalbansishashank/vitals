import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft } from 'lucide-react';
import { IconKey } from '@/components/Key';
import { MQ, useIsoLayoutEffect, useMediaQuery } from '@/components/lib/hooks';
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
  /** Completion scale at the content edge; a separate centered row below 768 px. */
  progress?: ReactNode;
  /**
   * Key parameters, desktop only (hidden < 1024 px): horizon bank, date span, last-run text. On desktop they sit at
   * the left of the action bar along the bottom of the content column.
   */
  params?: ReactNode;
  /**
   * Actions; the one primary action goes last (RunKey on Simulator, "Find plans" on Planner). Desktop: the right end
   * of the action bar along the bottom (a status-only line with nothing to press stays in the context bar). Below
   * 1024 px: the right of the context bar; there the Run key usually moves to <ActionBar>: wrap desktop-only actions
   * in `<span className="max-lg:hidden">`.
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
 * The contextual action bar itself, the same component at every width, always in the shell's action slot at the foot
 * of the screen: `foot` = the screen's <ActionBar> (below 1024 px, at the end of the page in the normal flow), `desk` = the TopBar's
 * params and actions along the bottom of the content column on desktop (where it wins over a `foot` bar).
 * Styles: `.lm-actionbar` in src/styles/shell.css.
 */
function ActionBarFrame({ place, children }: { place: 'foot' | 'desk'; children: ReactNode }) {
  return (
    <div className="lm-actionbar" data-place={place}>
      {children}
    </div>
  );
}

const CONTROL = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Whether the TopBar's params/actions hold anything to press. The desktop action bar opens only then ("only where
 * needed", IA §3.1); a status-only line ("saved on this device") stays in the context bar. Re-checked when their
 * content changes (e.g. the setup keys appearing on Your body).
 */
function useHoldsControls(nodes: Array<HTMLElement | null>): boolean {
  const [holds, setHolds] = useState(true);
  const [a, b] = nodes;
  useIsoLayoutEffect(() => {
    const els = [a, b].filter((n): n is HTMLElement => !!n);
    if (!els.length) return;
    const check = () => setHolds(els.some((n) => n.querySelector(CONTROL) !== null));
    check();
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(check);
    for (const n of els) mo.observe(n, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'tabindex'] });
    return () => mo.disconnect();
  }, [a, b]);
  return holds;
}

/**
 * The per-screen context bar (IA §3.2 "context bar", COMPONENTS §11). Feature
 * pages render it once at the top; it portals into the shell's slot, which is
 * fixed at the foot of the screen above the action bar and the tab bar below
 * 1024 px (title left, the "…" menu and actions right; the screen's own top bar stays above), and sticky at the
 * top of the main column on desktop. On desktop
 * the bar keeps the screen's identity and status (back, title, tabs, progress,
 * sync chip, ring key); its key parameters (left) and actions (right) go to the
 * action bar along the bottom of the content column, as on the phone.
 *
 *   <TopBar title="Your body" actions={<Engraved>saved on this device</Engraved>} />
 */
export function TopBar({ title, documentTitle, back, tabs, progress, params, actions, titleId, compactOnMobile = false }: TopBarProps) {
  const shell = useShell();
  const navigate = useNavigate();
  const desktop = useMediaQuery(MQ.lg);
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

  const [paramsNode, setParamsNode] = useState<HTMLDivElement | null>(null);
  const [actionsNode, setActionsNode] = useState<HTMLDivElement | null>(null);
  const holdsControls = useHoldsControls([paramsNode, actionsNode]);
  const paramsEl = params ? (
    <div className="lm-ctx__params" ref={setParamsNode}>
      {params}
    </div>
  ) : null;
  const actionsEl = actions ? (
    <div className="lm-ctx__actions" ref={setActionsNode}>
      {actions}
    </div>
  ) : null;
  // desktop, in the shell: parameters and actions leave the context bar for the action bar at the foot
  const deskBar = desktop && !!shell?.contextSlot && !!shell.actionSlot && !!(paramsEl || actionsEl) && holdsControls;

  // Below 1024 px the bar sits at the foot of the screen, above the action bar and the tab bar (CSS, `.lm-ctx[data-bottom]`);
  // it stays in the top slot, so the h1 keeps its place in the reading order. Compact screens keep the title in the top bar.
  const bottom = !desktop && !inlineTitle && !!shell?.contextSlot;
  const bar = (
    <div className="lm-ctx" data-compact={inlineTitle ? 'true' : undefined} data-bottom={bottom ? 'true' : undefined}>
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
      {deskBar ? null : paramsEl}
      {deskBar ? null : actionsEl}
      {/* desktop: the sync chip and the ring key at the right of the context bar (§15.4, ring-pages.md D2; phones have
          them in the top bar); shell only */}
      {shell?.contextSlot ? (
        <span className="inline-flex items-center gap-2 max-lg:hidden">
          <HeaderSync />
          <RingKey />
        </span>
      ) : null}
      {progress ? <div className="lm-ctx__progress">{progress}</div> : null}
    </div>
  );
  if (!shell?.contextSlot) return shell ? null : bar;
  return (
    <>
      {createPortal(bar, shell.contextSlot)}
      {deskBar && shell.actionSlot
        ? createPortal(
            <ActionBarFrame place="desk">
              {paramsEl}
              <div className="lm-ctx__grow" />
              {actionsEl}
            </ActionBarFrame>,
            shell.actionSlot,
          )
        : null}
    </>
  );
}

export interface ActionBarProps {
  children: ReactNode;
}

/**
 * Mobile contextual action bar (64 px), e.g. "painting with B · rest day [run]":
 * at the end of the page, in the normal flow (not fixed), above the tab bar's room.
 * On desktop the same bar runs along the bottom of the content column (fixed) and
 * carries the TopBar's parameters and actions (the desktop versions of these keys);
 * this one shows there only when the TopBar has none. The shell pads the page so
 * content never hides beneath the fixed bars.
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
  return createPortal(<ActionBarFrame place="foot">{children}</ActionBarFrame>, shell.actionSlot);
}
