import { Faceplate, Page } from '@/components';
import { TopBar } from '@/app/shell';
import { LIMITS_PAGE } from './copy';
import { DisclaimerFull } from './Disclaimer';
import { SafetySummary } from './SafetySummary';
import { useSafetyAccess } from './useSafetyAccess';
import { useBodyContext } from '@/state/profileStore';
import './onboarding.css';

/**
 * /safety — "Safety & limits": the full disclaimer (dossier §4.6, edited to the design voice), the Planner's
 * safety limits, stop-and-get-help, the help card and the privacy statement. Open to everyone, including
 * visitors who have not answered the safety questions and under-18s (like the Evidence library).
 */
export default function SafetyLimitsPage() {
  const access = useSafetyAccess(useBodyContext());
  const answered = access.gate.status === 'ready' || access.gate.status === 'needs-consent';
  return (
    <>
      <TopBar title={LIMITS_PAGE.title} documentTitle={LIMITS_PAGE.documentTitle} />
      <Page width="narrow">
        <div className="grid gap-4 pb-10">
          <p className="m-0 max-w-[60ch] text-md leading-[1.6] text-ink-2">{LIMITS_PAGE.intro}</p>
          {answered ? <SafetySummary outcome={access.outcome} title={LIMITS_PAGE.modeTitle} review /> : null}
          <Faceplate as="article" title={LIMITS_PAGE.fullTitle}>
            <DisclaimerFull headingAs="h3" />
          </Faceplate>
        </div>
      </Page>
    </>
  );
}
