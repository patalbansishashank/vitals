import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { Download } from 'lucide-react';
import { KeyLink } from '@/components/Key';
import { Toaster, dismissAllToasts } from '@/components/Toast';
import { MQ } from '@/components/lib/hooks';
import { isStorageAvailable } from '@/state/persistence';
import { vitalsWidgets } from '@/platform/widgets';
import { rememberRoute } from '../lastRoute';
import { syncSmoothScroll, usePageEntrance } from '../motion';
import { startRestoreNotice } from '../restoreNotice';
import { startSaveFailureNotices } from '../saveNotice';
import { Sidebar, TabBar } from './Chrome';
import { Frost } from './Frost';
import { OverlayScrollbar } from './OverlayScrollbar';
import { backToToday, useRouteChromeless, useShellNav } from './modeNav';
import { NoticesRegion, showNotice } from './notices';
import { PageFallback } from './RouteStates';
import { ShellContext, type ShellContextValue } from './ShellContext';
import { toggleSidebar, useSidebarCollapsed } from './sidebar';
import { ShellHeader } from './TopBar';
import { AndroidUpdateBanner } from './AndroidUpdateBanner';
import { useRouteFocus } from './useRouteFocus';

/** The agent surfaces (WebMCP, the Companion bridge): own chunk, mounted once. Their activity shows in the banner slot. */
const AgentSurfaces = lazy(() => import('@/agents/AgentSurfaces').then((m) => ({ default: m.AgentSurfaces })));
/** (0.6.6) The home-screen widgets' feed: own chunk, Android app only (src/features/widgets). */
const WidgetFeed = lazy(() => import('@/features/widgets/WidgetFeed').then((m) => ({ default: m.WidgetFeed })));
/** (0.6.3 A31) A Gauge recording's banner (Pause, Resume, Stop): own chunk, mounted once so it stays on every screen. */
const RecordBanner = lazy(() => import('@/features/living/activity/RecordBanner').then((m) => ({ default: m.RecordBanner })));

/** Tab bar hides while the on-screen keyboard is up (IA §3.1). */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: coarse)').matches) return;
    const onResize = () => setOpen(window.innerHeight - vv.height > 150);
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);
  return open;
}

/** Scroll distance (px) over which the header's frost comes in (Lumen: 0 at the top, full after 80 px). */
const FROST_RANGE = 80;
const FROST_STEPS = Array.from({ length: 21 }, (_, i) => i / 20);

/**
 * The top bar's frost (and, on phones, its bottom hairline) follows the scroll position without a scroll handler: an
 * 80 px sentinel at the top of the document is watched by an IntersectionObserver (21 thresholds), and the hidden share
 * of it becomes `--lm-frost` (0…1) on the header; CSS eases each step over 300 ms (instant under reduced motion).
 */
function useHeaderFrost(header: HTMLElement | null, sentinel: HTMLElement | null) {
  useEffect(() => {
    if (!header || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (!e) return;
        const frost = e.isIntersecting ? Math.min(1, Math.max(0, 1 - e.intersectionRatio)) : 1;
        header.style.setProperty('--lm-frost', frost.toFixed(2));
      },
      { threshold: FROST_STEPS },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [header, sentinel]);
}

/**
 * The sticky header's height, for everything that sticks below it (`--lm-header-h`, safe area included) and for the
 * older `--lm-topbar-h` offsets (the same without the top safe area), written on <html>; and the docked toolbar's
 * height on chromeless phone screens (`--lm-foot-h`), for the toasts.
 */
function useShellHeights(header: HTMLElement | null, foot: HTMLElement | null) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const stops: Array<() => void> = [];
    if (header) {
      const set = () => {
        const h = Math.ceil(header.getBoundingClientRect().height);
        const top = Number.parseFloat(getComputedStyle(header).paddingTop) || 0;
        root.style.setProperty('--lm-header-h', `${h}px`);
        root.style.setProperty('--lm-topbar-h', `${Math.max(0, Math.ceil(h - top))}px`);
      };
      set();
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(set);
        ro.observe(header);
        stops.push(() => ro.disconnect());
      }
      stops.push(() => {
        root.style.removeProperty('--lm-header-h');
        root.style.removeProperty('--lm-topbar-h');
      });
    }
    if (foot && typeof ResizeObserver !== 'undefined') {
      const set = () => root.style.setProperty('--lm-foot-h', `${Math.ceil(foot.getBoundingClientRect().height)}px`);
      set();
      const ro = new ResizeObserver(set);
      ro.observe(foot);
      stops.push(() => {
        ro.disconnect();
        root.style.removeProperty('--lm-foot-h');
      });
    }
    return () => stops.forEach((stop) => stop());
  }, [header, foot]);
}

/**
 * The frame every screen renders into (SPEC §4, §8; INFORMATION_ARCHITECTURE §3): ONE top bar at the top of the content
 * column on every breakpoint (the screen's TopBar: [sidebar key] · title + one fact line · status capsule · primary
 * pill · the one ⋯; sticky, with the scroll-driven frost and hairline), ONE banner slot under it, the screen, and the
 * screen's <ActionBar> row after it in the flow. Navigation: phones = a frosted dock with the floating icon pill (none on
 * chromeless screens); desktop ≥ 1024 px = the collapsible sidebar at the left (`data-sidebar` on .lm-app: expanded
 * ~240 px or a 64 px rail). No bar at the foot, no bar above the tab bar.
 * Also: skip link, toasts, scroll restoration, focus on navigation, ⌘/Ctrl 1…n = the pill's keys in order (Planning:
 * Today · Body · Simulate · Plan; the override: Body · Simulate · Plan · Evidence; Living: 1–5, 0 = Today) shortcuts,
 * ⌘/Ctrl + B (the sidebar, desktop), the mode-aware navigation (`./modeNav`), and the agent surfaces (SUITE_SPEC §7.3;
 * each stays off until turned on).
 */
export function AppShell() {
  const [headerEl, setHeaderEl] = useState<HTMLDivElement | null>(null);
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null);
  const [contextSlot, setContextSlot] = useState<HTMLDivElement | null>(null);
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);
  const [actionBars, setActionBars] = useState(0);
  const [chromelessCount, setChromeless] = useState(0);
  const [headers, setHeaders] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const keyboard = useKeyboardOpen();
  const nav = useShellNav();
  const sidebarCollapsed = useSidebarCollapsed();
  const [widgets] = useState(() => vitalsWidgets() !== null);

  const setActionBarCount = useCallback((delta: 1 | -1) => setActionBars((n) => Math.max(0, n + delta)), []);
  const setChromelessCount = useCallback((delta: 1 | -1) => setChromeless((n) => Math.max(0, n + delta)), []);
  const setHeaderCount = useCallback((delta: 1 | -1) => setHeaders((n) => Math.max(0, n + delta)), []);
  const ctx = useMemo<ShellContextValue>(
    () => ({ contextSlot, actionSlot, setActionBarCount, setChromelessCount, setHeaderCount }),
    [contextSlot, actionSlot, setActionBarCount, setChromelessCount, setHeaderCount],
  );
  // No tab bar for screens that ask (route `handle.chromeless` or `useChromeless`), e.g. the first-run intake.
  const routeChromeless = useRouteChromeless();
  const chromeless = routeChromeless || chromelessCount > 0;

  useHeaderFrost(headerEl, sentinelEl);
  useShellHeights(headerEl, actionSlot);
  // r068 U9: a new screen's cards rise into place (GSAP; none under reduced motion or in tests) and the smooth
  // scroller (Lenis, desktop pointers) drops any glide the old screen was still in, after scroll restoration
  usePageEntrance(mainRef, location.pathname);
  useLayoutEffect(() => {
    syncSmoothScroll();
  }, [location.pathname]);

  // A new screen opens: the last screen's confirmations go (layout effect, so a toast the new screen raises on mount stays)
  useLayoutEffect(() => {
    dismissAllToasts();
  }, [location.pathname]);
  useRouteFocus(mainRef, contextSlot, location.pathname);
  useEffect(() => {
    rememberRoute(location.pathname);
  }, [location.pathname]);

  // ⌘/Ctrl + 1…n jump to the pill's keys in order (IA §7): Planning 1…4 = Today · Body · Simulate · Plan (0.6.3: Today
  // leads), the override 1…4 = Body · Simulate · Plan · Evidence; Living mode: 1…5 = Today · Food · Train · Coach · Progress and
  // ⌘/Ctrl + 0 = Today from anywhere while a plan runs (in the planning override, the same as "Back to Today", IA §3.6);
  // ⌘/Ctrl + B expands or collapses the desktop sidebar (≥ 1024 px only: below that there is none).
  const planRuns = nav.plan !== null;
  const primary = nav.primary;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key === 'b' || e.key === 'B') {
        if (e.repeat || typeof window.matchMedia !== 'function' || !window.matchMedia(MQ.lg).matches) return;
        e.preventDefault();
        toggleSidebar();
        return;
      }
      const n = Number(e.key);
      if (n === 0 && e.key === '0' && planRuns) {
        e.preventDefault();
        backToToday(navigate);
        return;
      }
      const keys = primary;
      const dest = Number.isInteger(n) && n >= 1 && n <= keys.length ? keys[n - 1] : undefined;
      if (!dest) return;
      e.preventDefault();
      navigate(dest.to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, planRuns, primary]);

  // A change the device could not save is undone; say so (src/app/saveNotice.ts).
  useEffect(() => startSaveFailureNotices(), []);
  useEffect(() => startRestoreNotice(), []);

  // Private modes that refuse storage: say so once, globally (settings-data.md §8).
  useEffect(() => {
    if (!isStorageAvailable()) {
      // r068 S12: one line, and the way to keep the work as a key, not as directions in the text
      showNotice({
        id: 'storage-blocked',
        severity: 'caution',
        title: "This browser isn't saving data.",
        body: 'Everything resets when you close the tab.',
        actions: (
          <KeyLink to="/settings/data" size="sm" icon={Download}>
            Export
          </KeyLink>
        ),
      });
    }
  }, []);

  return (
    <ShellContext.Provider value={ctx}>
      <div
        className="lm-app"
        data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
        data-actionbar={actionBars > 0 || undefined}
        data-keyboard={keyboard || undefined}
        data-chromeless={chromeless || undefined}
      >
        <div className="lm-frost-sentinel" ref={setSentinelEl} style={{ height: FROST_RANGE }} aria-hidden="true" />
        <a className="lm-skip" href="#main">
          Skip to content
        </a>
        <Sidebar />
        <main id="main" ref={mainRef} className="lm-main" tabIndex={-1}>
          <div className="lm-ctx-slot" ref={setHeaderEl}>
            <Frost side="top" />
            <div className="lm-ctx-host" ref={setContextSlot} />
            {headers === 0 ? <ShellHeader /> : null}
          </div>
          <AndroidUpdateBanner />
          <NoticesRegion />
          <Suspense fallback={null}>
            <RecordBanner />
          </Suspense>
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
          {/* the screen's ActionBar portals its row in here; docked (a phone screen without the tab bar) the slot
              carries the dock's frost, shown only while it holds a row (src/styles/shell.css) */}
          <div className="lm-actionbar-slot" ref={setActionSlot} data-docked={chromeless || undefined}>
            {chromeless ? <Frost side="bottom" /> : null}
          </div>
        </main>
        {chromeless ? null : <TabBar />}
        <Toaster />
        <OverlayScrollbar />
        <Suspense fallback={null}>
          <AgentSurfaces />
        </Suspense>
        {widgets ? (
          <Suspense fallback={null}>
            <WidgetFeed />
          </Suspense>
        ) : null}
      </div>
      <ScrollRestoration />
    </ShellContext.Provider>
  );
}
