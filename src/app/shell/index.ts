/**
 * App-shell API for feature screens:
 *   import { TopBar, StatusCapsule, ActionBar, showNotice, setNavBadge, type MenuItem } from '@/app/shell';
 *
 * One header per screen (`TopBar`: title, `subtitle`, `status`, `primary`, `menu` → the one ⋯), one banner slot under
 * it (`showNotice`, app-level states only), the screen, and an optional `ActionBar` row after it in the flow.
 */
export { TopBar, ActionBar, ShellHeader } from './TopBar';
export type { TopBarProps, ActionBarProps } from './TopBar';
/**
 * The entries of the header ⋯ (`<TopBar menu={entries} />`): the design system's Menu entries — `MenuItem`
 * ({ id, label, onSelect, disabled?, tone?, hint? }), or `{ kind: 'divider' }` / `{ kind: 'section', label }` to group.
 */
export type { MenuItem, MenuEntry } from '@/components/Menu';
/**
 * The header's status slot takes the design system's status icon
 * (`<TopBar status={<StatusCapsule icon={ClipboardCheck} label="Weekly check-in ready" attention onClick={…} />} />`).
 */
export { StatusCapsule } from '@/components/StatusCapsule';
export type { StatusCapsuleProps } from '@/components/StatusCapsule';
export { HeaderMenu, HEADER_MENU_LABEL } from './HeaderMenu';
export type { BackTarget } from './ShellContext';
export { GlobalNotice, showNotice, dismissNotice, useNoticeStore } from './notices';
export type { GlobalNoticeSpec } from './notices';
export { setNavBadge, useNavBadges, DESTINATIONS, LIVING_DESTINATIONS } from './nav';
export type { Destination, LivingDestination } from './nav';
export { useShellNav, enterPlanningTools, backToToday, PlanStatus, useChromeless } from './modeNav';
export { Wordmark } from './Chrome';
/** The chrome's tintless layered frost (top bar: `side="top"`; a bottom dock: `side="bottom"`); never on a card or sheet. */
export { Frost } from './Frost';
/** The desktop sidebar's state (expanded / collapsed, per device): read it, or toggle it (the top bar key, ⌘/Ctrl + B). */
export { useSidebarCollapsed, setSidebarCollapsed, toggleSidebar } from './sidebar';
export { AppShell } from './AppShell';
export { NotFound, RouteError, RootError, PageFallback } from './RouteStates';
export { MorePage } from './MorePage';
