import { useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { ChevronLeft, X } from 'lucide-react';
import { IconKey } from '@/components/Key';
import { LinkBank } from '@/components/KeyBank';
import type { MenuEntry } from '@/components/Menu';
import { StatusSlotProvider, useStatusSlot, type StatusSlotEntry } from '@/components/StatusCapsule';
import { MQ, useMediaQuery } from '@/components/lib/hooks';
import { HeaderMenu } from './HeaderMenu';
import { HeaderSync } from './HeaderSync';
import { planCapsuleOf, PlanStatus, useChromeless, useShellNav } from './modeNav';
import { BODY_ITEM, PLAN_ITEM, PLANNING_PATTERN, SIMULATE_ITEM, TODAY_PATH } from './nav';
import { useShell, type BackTarget } from './ShellContext';

export interface TopBarProps {
  /**
   * Screen title, rendered in the page's h1 in the top bar: the destination's name on a tab page ("Today", "Food";
   * `--lm-text-page`, 24/28 600), the screen's name on a pushed page (phones: title-m beside Back; desktop: the page
   * title after Back). May be a switcher button (scenario switcher). Never the date: that goes in `subtitle`.
   */
  title: ReactNode;
  /** Browser tab title; defaults to `title` when it is a string. "· Vitals" is appended. */
  documentTitle?: string;
  /**
   * The one fact line (the date on day pages: "Saturday, 17 October · day 16 of 90"), set in mono caps (r071: the
   * references' "WED, 28 OCT · 7:12" over the title), always one line and always ABOVE the title: on a phone tab page
   * its own full-width row above the title row (inside the bar), on a pushed page and on desktop stacked over the
   * title in the heading. Pass the short form where a DateControl follows ("Day 15 of 84"). Nothing else.
   */
  subtitle?: ReactNode;
  /**
   * A pushed (child) screen: a 48 px Back (phones: at the left, the title centred; desktop: before the title).
   */
  back?: BackTarget | true;
  /** Segmented sub-navigation directly under the title row, inside the bar (e.g. <LinkBank> "schedule | results"). */
  tabs?: ReactNode;
  /** Completion scale (setup chapters): its own row under the title. */
  progress?: ReactNode;
  /**
   * The page's status icons (`<StatusCapsule icon={ClipboardCheck} label="Weekly check-in ready" attention onClick={…} />`,
   * from `@/components` or `@/app/shell`; several in a fragment, most important first), at the right of the header
   * before the primary action and the ⋯. The one home of check-ins and waiting proposals. The bar shows at most two
   * status icons, its own (the running plan's on planning screens, sync) included, and one beside a primary key on a
   * phone: the ones that want attention first, then this order; the rest move into the ⋯.
   */
  status?: ReactNode;
  /** The page's one primary action as a pill (`<Key variant="solid" size="sm">`), just before the ⋯. Optional. */
  primary?: ReactNode;
  /**
   * The page's own actions, in the header's one ⋯ (`MenuItem` / `MenuEntry` from `@/components/Menu`, re-exported from
   * `@/app/shell`: `{ id, label, onSelect, disabled?, tone?: 'danger', hint? }`, or a `{ kind: 'divider' }` /
   * `{ kind: 'section', label }` to group them). Only these: global places live in the navigation (r068 U14), so a
   * page without items of its own shows no ⋯. Pages never render a top-level ⋯ of their own.
   */
  menu?: ReadonlyArray<MenuEntry>;
  /**
   * @deprecated Migration only: shown as the subtitle line on desktop when there is no `subtitle` (hidden below
   * 1024 px, as before). Move a fact into `subtitle` and controls into the page or the ⋯.
   */
  params?: ReactNode;
  /**
   * @deprecated Migration only: rendered at the right of the header, before `primary` and the ⋯. Move menu triggers
   * into `menu`, the one primary action into `primary`, and anything else next to what it acts on in the page.
   */
  actions?: ReactNode;
  /** id for the h1 (for aria-labelledby on the page's main region). */
  titleId?: string;
  /** Below 1024 px, use the pushed-page header (centred title-m) even without `back`. */
  compactOnMobile?: boolean;
}

/**
 * Where a Back without its own target goes: one step back in the app's history, or Today (home in every mode) when the
 * screen is the first one this session opened (the app restarted on it, a link opened it). `window.history.length`
 * counts entries from before the app and other sites, so it is no guide; the router's first entry has the key
 * "default". Before 0.6.3 this fell back to "/", which sent Planning mode to the last route: Settings opened the app
 * after an update, and its Back led to Settings again.
 */
export function backInHistory(locationKey: string, historyIndex: number | undefined = routerHistoryIndex()): -1 | string {
  return locationKey !== 'default' && historyIndex !== 0 ? -1 : TODAY_PATH;
}

/**
 * The browser router's own position in its history (it keeps `idx` in `history.state`): 0 when nothing of the app's
 * lies behind this screen, as after a first-run hand-over that replaced every step before it (/welcome → Your body).
 * Undefined where there is no browser router (tests, the screen harnesses), which leaves the decision to the key.
 */
function routerHistoryIndex(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : undefined;
}

/**
 * The planning steps' own switcher (r068 U14): Body · Simulate · Plan, a full-width row under the title of each step's
 * header on phones and tablets, where the dock has one key (Plan) for all three and no page linked to the others. The
 * desktop sidebar lists the three as rows, so the bar leaves it out from 1024 px. Not on the first-run setup steps,
 * which are a focused flow with their own progress row.
 */
export function PlanningSteps() {
  return (
    <LinkBank
      label="Planning step"
      className="lm-ctx__steps"
      items={[
        { to: BODY_ITEM.to, label: 'Body' },
        { to: SIMULATE_ITEM.to, label: 'Simulate' },
        { to: PLAN_ITEM.to, label: 'Plan' },
      ]}
    />
  );
}

/** A planning step's tab header below 1024 px, outside the first-run setup (`?setup=`, or a progress row). */
function showsPlanningSteps(pathname: string, search: string, wide: boolean, phoneLayout: 'tab' | 'pushed', progress: boolean): boolean {
  return !wide && phoneLayout === 'tab' && !progress && PLANNING_PATTERN.test(pathname) && !new URLSearchParams(search).has('setup');
}

function goBack(navigate: ReturnType<typeof useNavigate>, to: -1 | string): void {
  if (to === -1) void navigate(-1);
  else void navigate(to);
}

interface HeaderTrailProps extends Pick<TopBarProps, 'status' | 'actions' | 'primary' | 'menu'> {
  /** The header is a pushed screen's at the current width: no plan icon. */
  pushed?: boolean;
}

/** At most two status icons in a bar (SPEC §9); one beside a primary key on a phone, whose row has no room for two. */
function statusLimit(primary: boolean, md: boolean): number {
  return primary && !md ? 1 : 2;
}

/** The ⋯ entries for the status icons past the limit: each opens what its icon opens; one without an action is a heading. */
function overflowEntries(overflow: readonly StatusSlotEntry[]): MenuEntry[] {
  const acting = overflow.filter((e) => e.select);
  const still = overflow.filter((e) => !e.select);
  return [
    ...acting.map<MenuEntry>((e) => ({ id: `status-${e.id}`, label: e.label, onSelect: () => e.select?.() })),
    ...still.map<MenuEntry>((e) => ({ kind: 'section', id: `status-${e.id}`, label: e.label })),
  ];
}

/**
 * The right end of every header, on one line that never wraps: the status icons (the page's own, most important
 * first · the running plan's on planning screens · sync), then the keys (legacy actions · primary · ⋯), the ⋯ pinned
 * at the right end. At most two status icons show (one beside a primary key on a phone): the ones that want attention
 * first, then that order; the rest are listed first in the ⋯. Icons and keys never shrink: when the row is short the
 * title truncates, down to its floor (shell.css). The plan icon leaves pushed screens.
 */
function HeaderTrail({ status, actions, primary, menu, pushed = false }: HeaderTrailProps) {
  const nav = useShellNav();
  const { pathname } = useLocation();
  const md = useMediaQuery(MQ.md);
  const plan = pushed ? null : planCapsuleOf(nav, pathname);
  const slot = useStatusSlot(statusLimit(!!primary, md));
  const moved = useMemo(() => overflowEntries(slot.overflow), [slot.overflow]);
  return (
    <div className="lm-ctx__trail">
      <StatusSlotProvider value={slot.value}>
        <div className="lm-ctx__caps">
          {status ? <div className="lm-ctx__status">{status}</div> : null}
          {plan ? <PlanStatus plan={plan} /> : null}
          {/* sync: every screen, both modes (SUITE_SPEC §15.4); it renders nothing while sync is off */}
          <HeaderSync />
        </div>
      </StatusSlotProvider>
      {actions ? <div className="lm-ctx__actions">{actions}</div> : null}
      {primary ? <div className="lm-ctx__primary">{primary}</div> : null}
      <HeaderMenu items={menu} moved={moved} />
    </div>
  );
}

/**
 * The shell's own header while no screen has mounted a TopBar (a lazy screen loading, a screen without one): no title,
 * just the bar's status icons (sync). The navigation (dock and More, or the sidebar) keeps every place one tap away.
 */
export function ShellHeader() {
  return (
    <div className="lm-ctx" data-phone="tab" data-desk="tab" data-fallback="true">
      <div className="lm-ctx__row">
        <div className="lm-ctx__heading" />
        <HeaderTrail />
      </div>
    </div>
  );
}

/**
 * The screen's top bar (SPEC §4, §8.3; IA §3.2) — one per screen, a real bar at the top of the content column on every
 * breakpoint: sticky, 56 px (safe area added; 66 px with a phone tab page's fact row), the tintless frost and a 0.5 px bottom hairline once scrolled (the
 * hairline always shows on desktop; the shell draws both: `.lm-ctx-slot` in src/styles/shell.css). Feature pages render
 * it once; it portals into the shell's header slot, so the h1 leads the screen in the reading order.
 *
 * Desktop:     [Back] · title (24/28) with the fact line stacked above it · status icons · primary · ⋯ (the sidebar
 *              key lives in the sidebar's own head, r068 U13)
 * Phone tab:   title (24/28) · status icons · primary · ⋯; the fact line is its own full-width row above it (one
 *              line, mono caps), so neither the title row nor the date gives way
 * Phone pushed: 48 px Back · title (title-m) with the fact line above it · ⋯ (no navigation dock)
 * The ⋯:       the page's own actions only (r068 U14: places are in the dock's More page and the sidebar); none
 *              without them
 * Status:      at most two icons (one beside a primary key on a phone), those that want attention first; the rest
 *              open from the top of the ⋯. While a plan runs, a planning screen's tab header adds the plan's icon
 *              (it opens Plan details) after the page's own
 * Tabs:        a segmented row directly under the title row, inside the bar (above its hairline); below 1024 px a
 *              planning step's header (Body · Simulate · Plan) adds the step switcher above it (`PlanningSteps`)
 *
 *   <TopBar title="Today" subtitle="Saturday, 17 October" status={icon} menu={[{ id: 'away', label: 'I’m away…', onSelect }]} />
 */
export function TopBar({
  title,
  documentTitle,
  subtitle,
  back,
  tabs,
  progress,
  status,
  primary,
  menu,
  params,
  actions,
  titleId,
  compactOnMobile = false,
}: TopBarProps) {
  const shell = useShell();
  const navigate = useNavigate();
  const location = useLocation();
  const wide = useMediaQuery(MQ.lg);
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

  // the shell drops its fallback header while this one is mounted (layout effect: never both on screen)
  const registerHeader = shell?.setHeaderCount;
  useLayoutEffect(() => {
    if (!registerHeader) return;
    registerHeader(1);
    return () => registerHeader(-1);
  }, [registerHeader]);

  const phone = backTarget || compactOnMobile ? 'pushed' : 'tab';
  const desk = backTarget && !backTarget.mobileOnly ? 'pushed' : 'tab';
  // the layout at the current width (CSS lays out both; the ⋯, the plan icon and the fact line need to know which one shows)
  const pushedNow = (wide ? desk : phone) === 'pushed';
  // a phone tab page's fact line is its own row under the title row; elsewhere it sits with the title
  const factRow = !wide && phone === 'tab';
  const steps = showsPlanningSteps(location.pathname, location.search, wide, phone, !!progress);
  // a pushed screen shows Back and its title, without the navigation pill (as Lumen's pushed screens do; the desktop
  // sidebar stays, the phone dock goes and a focused flow's ActionBar docks in its place)
  useChromeless(phone === 'pushed');
  const sub = subtitle ? (
    <p className="lm-ctx__sub">{subtitle}</p>
  ) : params ? (
    <div className="lm-ctx__sub lm-ctx__params">{params}</div>
  ) : null;

  const bar = (
    <div className="lm-ctx" data-phone={phone} data-desk={desk}>
      <div className="lm-ctx__row">
        {backTarget ? (
          <IconKey
            className="lm-ctx__back"
            icon={backTarget.close ? X : ChevronLeft}
            label={backTarget.close ? (backTarget.label ? `Close ${backTarget.label}` : 'Close') : backTarget.label ? `Back to ${backTarget.label}` : 'Back'}
            onClick={() => (backTarget.to ? navigate(backTarget.to) : goBack(navigate, backInHistory(location.key)))}
          />
        ) : null}
        <div className="lm-ctx__heading">
          <h1 className="lm-title" id={titleId}>
            {title}
          </h1>
          {factRow ? null : sub}
        </div>
        <HeaderTrail status={status} actions={actions} primary={primary} menu={menu} pushed={pushedNow} />
      </div>
      {factRow ? sub : null}
      {steps ? (
        <div className="lm-ctx__tabs">
          <PlanningSteps />
        </div>
      ) : null}
      {tabs ? <div className="lm-ctx__tabs">{tabs}</div> : null}
      {progress ? <div className="lm-ctx__progress">{progress}</div> : null}
    </div>
  );
  if (!shell?.contextSlot) return shell ? null : bar;
  return createPortal(bar, shell.contextSlot);
}

export interface ActionBarProps {
  children: ReactNode;
}

/**
 * A row of the screen's keys, AFTER the screen's content in the page flow (a plain row: no bar, not fixed, not sticky)
 * — it portals into the shell's slot at the end of the content column, so where it is rendered in the JSX does not
 * matter. Only on a phone screen without the tab bar (`useChromeless`: the first-run intake, a focused child flow)
 * does the shell dock it at the bottom of the screen as that flow's toolbar. Never a bar above the tab bar, and no
 * fixed bar on desktop.
 *
 * Prefer the header for the one primary action (`<TopBar primary={…} />`) and keys inline next to what they act on;
 * keep <ActionBar> for a focused flow's step keys (Back · Skip · Next).
 */
export function ActionBar({ children }: ActionBarProps) {
  const shell = useShell();
  const register = shell?.setActionBarCount;
  useEffect(() => {
    if (!register) return;
    register(1);
    return () => register(-1);
  }, [register]);
  const row = (
    <div className="lm-actionbar" data-place="foot">
      {children}
    </div>
  );
  if (!shell) return row;
  if (!shell.actionSlot) return null;
  return createPortal(row, shell.actionSlot);
}
