import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { dismissNotice, PageFallback, showNotice } from '@/app/shell';
import { useActivePlanStore } from './activePlan';
import { GUARD_COPY } from './copy';
import { useAppMode, useLivePlanReady } from './mode';

/**
 * Route guard for Living screens (IA §2.1): without a live plan, Today, Food, Train and Plan details send the person to
 * the Planner with a one-line notice; the Coach and Progress work in both modes. Arriving on a Living-only screen clears
 * the planning override (the return key and "Back to Today" land here); turning the override on while a Living screen
 * is still mounted does not (the shell navigates away first).
 */
export function LivingGuard({ need, clearsOverride = true, children }: { need: 'plan' | 'none'; clearsOverride?: boolean; children?: ReactNode }) {
  const { plan } = useAppMode();
  const ready = useLivePlanReady();
  const { pathname } = useLocation();
  const entered = useRef<string | null>(null);
  // while the plan documents load, "no plan" is not known yet: wait instead of sending the person to the Planner
  const missing = ready && need === 'plan' && !plan;
  useEffect(() => {
    if (missing) showNotice({ id: 'living-no-plan', severity: 'info', title: GUARD_COPY.noPlan, dismissible: true });
    else if (plan) dismissNotice('living-no-plan');
  }, [missing, plan]);
  useEffect(() => {
    if (entered.current === pathname) return;
    entered.current = pathname;
    const s = useActivePlanStore.getState();
    if (clearsOverride && s.planningOverride) s.setPlanningOverride(false);
  }, [pathname, clearsOverride]);
  if (missing) return <Navigate to="/plan" replace />;
  if (!ready && need === 'plan') return <PageFallback />;
  return <>{children ?? <Outlet />}</>;
}
