import { Navigate, Outlet, useLocation } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { useSafetyStore } from '@/state/safetyStore';
import { nowIso } from './clock';
import { gateRedirect } from './gate';

/**
 * Layout route around the instrument (Your body, Simulator, Planner and "/"): first-run visitors go to
 * /welcome, under-18s to the hard stop, imported or outdated answers to review, outdated consent to the
 * consent step. Evidence, Settings and Safety & limits sit outside this route and stay open to everyone.
 * The original destination travels in location state (`from`) so the flow can return there.
 */
export function OnboardingGate() {
  const location = useLocation();
  const s = useSafetyStore(
    useShallow((st) => ({
      answers: st.answers,
      answeredAt: st.answeredAt,
      questionSetVersion: st.questionSetVersion,
      acknowledgements: st.acknowledgements,
      pendingReview: st.pendingReview,
    })),
  );
  const to = gateRedirect(s, nowIso());
  if (to) {
    const from = location.pathname === '/' ? undefined : `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={to} replace state={from ? { from } : undefined} />;
  }
  return <Outlet />;
}
