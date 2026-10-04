/**
 * App-shell API for feature screens:
 *   import { TopBar, ActionBar, GlobalNotice, showNotice, setNavBadge } from '@/app/shell';
 */
export { TopBar, ActionBar } from './TopBar';
export type { TopBarProps, ActionBarProps } from './TopBar';
export type { BackTarget } from './ShellContext';
export { GlobalNotice, showNotice, dismissNotice, useNoticeStore } from './notices';
export type { GlobalNoticeSpec } from './notices';
export { setNavBadge, useNavBadges, DESTINATIONS, LIVING_DESTINATIONS } from './nav';
export type { Destination, LivingDestination } from './nav';
export { useShellNav, enterPlanningTools, backToToday, PlanStrip, useChromeless } from './modeNav';
export { Wordmark } from './Chrome';
export { AppShell } from './AppShell';
export { NotFound, RouteError, RootError, PageFallback } from './RouteStates';
