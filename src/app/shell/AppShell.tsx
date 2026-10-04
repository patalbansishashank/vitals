import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { Toaster } from '@/components/Toast';
import { isStorageAvailable } from '@/state/persistence';
import { rememberRoute } from '../lastRoute';
import { startSaveFailureNotices } from '../saveNotice';
import { MobileTopBar, NavRail, TabBar } from './Chrome';
import { DESTINATIONS } from './nav';
import { backToToday, PlanStrip, useRouteChromeless, useShellNav } from './modeNav';
import { NoticesRegion, showNotice } from './notices';
import { PageFallback } from './RouteStates';
import { ShellContext, type MobileHeader, type ShellContextValue } from './ShellContext';

/** The agent surfaces (WebMCP, the Companion bridge) and their "An agent is using Vitals" light: own chunk, mounted once. */
const AgentSurfaces = lazy(() => import('@/agents/AgentSurfaces').then((m) => ({ default: m.AgentSurfaces })));
const AgentActivityIndicator = lazy(() => import('@/features/settings/agents/AgentActivityIndicator').then((m) => ({ default: m.AgentActivityIndicator })));

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

/**
 * The frame every screen renders into (INFORMATION_ARCHITECTURE §3):
 * desktop = 76 px rail + sticky context bar; mobile = top bar + context bar +
 * bottom tab bar (+ optional action bar). Also: skip link, global notices,
 * toasts, scroll restoration, focus on navigation, ⌘/Ctrl 1–4 (Living: 1–5, 0 = Today) shortcuts,
 * the mode-aware navigation and the planning override's plan strip (`./modeNav`), and the agent surfaces with their
 * activity light and Stop key (SUITE_SPEC §7.3; each surface stays off until the person turns it on).
 */
export function AppShell() {
  const [contextSlot, setContextSlot] = useState<HTMLDivElement | null>(null);
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);
  const [mobileHeader, setMobileHeader] = useState<MobileHeader | null>(null);
  const [actionBars, setActionBars] = useState(0);
  const [chromelessCount, setChromeless] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const keyboard = useKeyboardOpen();
  const lastPath = useRef(location.pathname);
  const nav = useShellNav();

  const setActionBarCount = useCallback((delta: 1 | -1) => setActionBars((n) => Math.max(0, n + delta)), []);
  const setChromelessCount = useCallback((delta: 1 | -1) => setChromeless((n) => Math.max(0, n + delta)), []);
  const ctx = useMemo<ShellContextValue>(
    () => ({ contextSlot, actionSlot, setMobileHeader, setActionBarCount, setChromelessCount }),
    [contextSlot, actionSlot, setActionBarCount, setChromelessCount],
  );
  // No tab bar for screens that ask (route `handle.chromeless` or `useChromeless`), e.g. the first-run intake.
  const routeChromeless = useRouteChromeless();
  const chromeless = routeChromeless || chromelessCount > 0;

  // Remember the destination; after client-side navigation move focus to the new screen's title.
  useEffect(() => {
    rememberRoute(location.pathname);
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    const findH1 = () => contextSlot?.querySelector<HTMLElement>('h1') ?? mainRef.current?.querySelector<HTMLElement>('h1') ?? null;
    // The previous screen stays on screen while a lazy screen loads (and redirects render twice), so wait — up to
    // about a second — for a title that is not the old one; focusing the old title would drop focus to <body> the
    // moment it unmounts.
    const old = findH1();
    let frames = 0;
    let id = 0;
    const settle = () => {
      const h1 = findH1();
      if ((!h1 || h1 === old) && frames++ < 60) {
        id = window.requestAnimationFrame(settle);
        return;
      }
      if (h1 && h1.isConnected) {
        h1.tabIndex = -1;
        h1.focus({ preventScroll: true });
      } else mainRef.current?.focus({ preventScroll: true });
    };
    id = window.requestAnimationFrame(settle);
    return () => window.cancelAnimationFrame(id);
    // only on path changes (query-string view state must not steal focus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // ⌘/Ctrl + 1…4 jump to destinations (IA §7); Living mode: 1…5 = Today · Food · Train · Coach · Progress and
  // ⌘/Ctrl + 0 = Today from anywhere while a plan runs (also the return key in the planning override, IA §3.6).
  const living = nav.mode === 'living';
  const planRuns = nav.plan !== null;
  const primary = nav.primary;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const n = Number(e.key);
      if (n === 0 && e.key === '0' && planRuns) {
        e.preventDefault();
        backToToday(navigate);
        return;
      }
      const keys = living ? primary : DESTINATIONS;
      const dest = Number.isInteger(n) && n >= 1 && n <= keys.length ? keys[n - 1] : undefined;
      if (!dest) return;
      e.preventDefault();
      navigate(dest.to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, living, planRuns, primary]);

  // A change the device could not save is undone; say so (src/app/saveNotice.ts).
  useEffect(() => startSaveFailureNotices(), []);

  // Private modes that refuse storage: say so once, globally (settings-data.md §8).
  useEffect(() => {
    if (!isStorageAvailable()) {
      showNotice({
        id: 'storage-blocked',
        severity: 'caution',
        title: "This browser isn't saving data.",
        body: 'Everything resets when you close the tab. Export from Settings › Your data to keep your work.',
      });
    }
  }, []);

  return (
    <ShellContext.Provider value={ctx}>
      <div className="lm-app" data-actionbar={actionBars > 0 || undefined} data-keyboard={keyboard || undefined} data-chromeless={chromeless || undefined}>
        <a className="lm-skip" href="#main">
          Skip to content
        </a>
        <NavRail />
        <MobileTopBar header={mobileHeader} />
        <main id="main" ref={mainRef} className="lm-main" tabIndex={-1}>
          <div className="lm-ctx-slot" ref={setContextSlot} />
          {nav.override && nav.plan ? <PlanStrip plan={nav.plan} /> : null}
          <NoticesRegion />
          <Suspense fallback={null}>
            <AgentActivityIndicator className="mx-4 my-2" />
          </Suspense>
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
        <div className="lm-actionbar-slot" ref={setActionSlot} />
        {chromeless ? null : <TabBar />}
        <Toaster />
        <Suspense fallback={null}>
          <AgentSurfaces />
        </Suspense>
      </div>
      <ScrollRestoration />
    </ShellContext.Provider>
  );
}
