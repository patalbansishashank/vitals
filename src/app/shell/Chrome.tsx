import type { CSSProperties, ReactElement } from 'react';
import { Link, useLocation } from 'react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Icon, type IconComponent } from '@/components/icons/Icon';
import { Tooltip } from '@/components/Tooltip';
import { RingMark } from '@/components/brand/RingMark';
import { Frost } from './Frost';
import { capitalise, isCurrent, MORE_ITEM, PLANNING_PATTERN, SETTINGS_ITEM, useNavBadges, type NavItem } from './nav';
import { moreIsCurrent, useShellNav } from './modeNav';
import { SIDEBAR_ID, SIDEBAR_LABEL, sidebarShortcut, toggleSidebar, useSidebarCollapsed } from './sidebar';
import './modeNav.css';

/** The ring mark beside the lowercase "vitals" wordmark (welcome screens; the app itself shows the mark in the sidebar). */
export function Wordmark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="lm-wordmark" aria-label="Vitals, home">
      <RingMark />
      <span aria-hidden="true">vitals</span>
    </Link>
  );
}

const BADGE_LABEL: Partial<Record<NavItem['id'], string>> = { coach: 'a proposal is waiting' };
/** The words of the planning override's way back (⌘/Ctrl + 0). */
export const BACK_TO_TODAY = 'Back to Today';

/** A destination's badge words, or null (no dot). */
function badgeWords(item: NavItem, badges: Partial<Record<string, boolean>>): string | null {
  return badges[item.id] ? (BADGE_LABEL[item.id] ?? 'results out of date') : null;
}

/**
 * One dock key: the icon (22 px; stroke 2 when current) over its label (label-s; dark on the ivory capsule when
 * current: the capsule is the dock's one thumb, `.lm-tabbar__thumb`), and the optional badge dot. The accessible name
 * stays the destination's name ("today"), plus the badge's words.
 */
function DockKey({ item, current, badge }: { item: NavItem; current: boolean; badge: string | null }) {
  return (
    <Link to={item.to} className="lm-navkey" aria-current={current ? 'page' : undefined} aria-label={badge ? `${item.label}, ${badge}` : item.label}>
      <span className="lm-navkey__icon">
        <Icon icon={item.icon} size={22} strokeWidth={current ? 2 : 1.5} />
        {badge ? <span className="lm-navkey__stale" aria-hidden="true" /> : null}
      </span>
      <span className="lm-navkey__label" aria-hidden="true">
        {capitalise(item.label)}
      </span>
    </Link>
  );
}

/** A sidebar row's icon (20 px; ivory and a heavier stroke when current) with the optional badge dot. */
function RowIcon({ icon, current = false, badge = false }: { icon: IconComponent; current?: boolean; badge?: boolean }) {
  return (
    <span className="lm-side__icon">
      <Icon icon={icon} size={20} strokeWidth={current ? 2 : 1.5} />
      {badge ? <span className="lm-side__dot" aria-hidden="true" /> : null}
    </span>
  );
}

/**
 * A sidebar row's tooltip: the row's name, to the right, only while the sidebar is collapsed (expanded, the label is on
 * the row). `role="label"`: the row already carries the same name.
 */
function RowTip({ name, collapsed, children }: { name: string; collapsed: boolean; children: ReactElement }) {
  return (
    <Tooltip content={name} placement="right" role="label" disabled={!collapsed}>
      {children}
    </Tooltip>
  );
}

/**
 * A destination row: icon + label, 40 px (selected = an ivory tint, ivory icon, 600 ivory label). Its accessible name is the
 * destination's name as it has always been ("today"; plus the badge's words when one shows), so the dock and the
 * sidebar name a destination alike; the label draws it capitalised.
 */
function SideLink({ item, badge, collapsed, current }: { item: NavItem; badge: string | null; collapsed: boolean; current: boolean }) {
  const name = capitalise(item.label);
  return (
    <li>
      <RowTip name={name} collapsed={collapsed}>
        <Link to={item.to} className="lm-side__row" aria-current={current ? 'page' : undefined} aria-label={badge ? `${item.label}, ${badge}` : item.label}>
          <RowIcon icon={item.icon} current={current} badge={!!badge} />
          <span className="lm-side__label">{name}</span>
        </Link>
      </RowTip>
    </li>
  );
}

/**
 * Desktop navigation (≥ 1024 px; website and the Electron app alike; SPEC §8.2, r068 U14): a full-height sidebar at the
 * left in the Ember material (bg-2 with grain, a 0.5 px hairline on its right edge).
 *
 * - Head: the brand mark and "Vitals" (home) and, at its right end, the sidebar's own key (U13).
 * - One stable list in labelled groups, the same in both modes (a place that needs a plan is left out without one,
 *   never moved): Today · Food · Train (Activities without a plan) · Ring / Planning: Body · Simulate · Plan ·
 *   Progress · Coach / Library: Evidence. Settings sits alone at the foot, as desktop apps keep it.
 * - The header ⋯ carries only the page's own actions.
 *
 * Expanded it is ~240 px; collapsed (its own key, Ctrl/⌘ + B; kept per device, `./sidebar`) it is a 64 px rail of the
 * same rows as icons, each with its name as a tooltip, and the group labels become hairlines. The width eases over
 * 200 ms (none under reduced motion; src/styles/shell.css). Below 1024 px it is not shown: the phone dock holds the keys.
 */
export function Sidebar() {
  const badges = useNavBadges((s) => s.badges);
  const nav = useShellNav();
  const { pathname } = useLocation();
  const collapsed = useSidebarCollapsed();
  return (
    <nav id={SIDEBAR_ID} className="lm-sidebar" aria-label="Main" data-collapsed={collapsed || undefined}>
      <div className="lm-side__head">
        {collapsed ? null : (
          <Link to="/" className="lm-side__brand" aria-label="Vitals, home">
            <RingMark size={22} />
            <span className="lm-side__name" aria-hidden="true">
              Vitals
            </span>
          </Link>
        )}
        <SidebarToggle />
      </div>
      <div className="lm-side__groups">
        {nav.groups.map((g) => (
          <div key={g.id} className="lm-side__group" role="group" aria-label={g.label ?? 'Places'} data-group={g.id}>
            {g.label ? (
              <span className="lm-side__group-label" aria-hidden="true">
                {g.label}
              </span>
            ) : null}
            <ul className="lm-side__list">
              {g.items.map((d) => (
                <SideLink key={`${g.id}:${d.id}:${d.label}`} item={d} badge={badgeWords(d, badges)} collapsed={collapsed} current={isCurrent(d, pathname)} />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <ul className="lm-side__list lm-side__foot" data-group="app">
        <SideLink item={SETTINGS_ITEM} badge={null} collapsed={collapsed} current={isCurrent(SETTINGS_ITEM, pathname)} />
      </ul>
    </nav>
  );
}

/**
 * The sidebar key (desktop only; r068 U13): at the right end of the sidebar's head, where polished desktop apps keep
 * the control for the panel it folds. Expanded it shows "fold" (PanelLeftClose); collapsed, the rail's head is this
 * one key, showing the ring mark until hovered or focused, then "unfold" (PanelLeftOpen). One accessible name
 * ("Sidebar") with the state in aria-expanded; the tooltip says what a press does and the shortcut.
 */
export function SidebarToggle() {
  const collapsed = useSidebarCollapsed();
  return (
    <Tooltip content={`${collapsed ? 'Expand' : 'Collapse'} sidebar · ${sidebarShortcut()}`} placement={collapsed ? 'right' : 'bottom'} role="label">
      <button
        type="button"
        className="lm-side__toggle"
        aria-label={SIDEBAR_LABEL}
        aria-expanded={!collapsed}
        aria-controls={SIDEBAR_ID}
        aria-keyshortcuts="Control+B Meta+B"
        onClick={toggleSidebar}
      >
        <span className="lm-side__toggle-mark" aria-hidden="true">
          <RingMark size={22} />
        </span>
        <Icon className="lm-side__toggle-icon" icon={collapsed ? PanelLeftOpen : PanelLeftClose} size={20} />
      </button>
    </Tooltip>
  );
}

/**
 * Phone navigation (< 1024 px; r068 U14, r071): a frosted dock across the bottom edge (safe area included; the shell's
 * layered frost, fading in over its top 24 px) holding the floating pill of five labelled keys: the mode's four
 * destinations, then More (`/more`, every other place). Destinations only, never an action. A place inside More with
 * a badge (a proposal waiting on the Coach) puts its dot on the More key.
 *
 * The current key is an ivory capsule on ONE gliding thumb (`.lm-tabbar__thumb`): it is translated to the key's index
 * (`--lm-tabbar-i`) in 280 ms with the one damped overshoot and jumps under reduced motion. The thumb remounts with
 * the mode (the key set changes), so a mode switch cross-fades the keys instead of sliding the thumb across them.
 */
export function TabBar() {
  const badges = useNavBadges((s) => s.badges);
  const nav = useShellNav();
  const { pathname } = useLocation();
  const moreBadge =
    nav.more
      .flatMap((g) => g.items)
      .map((i) => badgeWords(i, badges))
      .find((w) => w !== null) ?? null;
  const keys = nav.primary.length + 1;
  const index = [...nav.primary.map((d) => isCurrent(d, pathname)), moreIsCurrent(nav, pathname)].findIndex(Boolean);
  const bar = { '--lm-tabbar-n': keys, '--lm-tabbar-i': Math.max(index, 0) } as CSSProperties;
  return (
    <div className="lm-dock">
      <Frost side="bottom" />
      <nav className="lm-tabbar" aria-label="Main" style={bar} data-thumb={index < 0 ? 'none' : undefined}>
        <span key={nav.mode} className="lm-tabbar__thumb" aria-hidden="true" />
        {nav.primary.map((d) => (
          <DockKey
            key={`${nav.mode}:${d.id}:${d.label}`}
            item={d}
            current={isCurrent(d, pathname)}
            // the Planning dock's Plan key stands for all three steps: any step's dot (stale results on Simulate) shows on it
            badge={d.match === PLANNING_PATTERN ? (['body', 'simulate', 'plan'] as const).map((id) => badgeWords({ ...d, id }, badges)).find((w) => w !== null) ?? null : badgeWords(d, badges)}
          />
        ))}
        <DockKey item={MORE_ITEM} current={moreIsCurrent(nav, pathname)} badge={moreBadge} />
      </nav>
    </div>
  );
}
