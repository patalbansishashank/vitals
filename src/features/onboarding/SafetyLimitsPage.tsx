import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Faceplate, MQ, Page, useMediaQuery } from '@/components';
import { TopBar, type MenuEntry } from '@/app/shell';
import { paths } from '@/app/paths';
import { LIMITS_PAGE, MODE_LABEL } from './copy';
import { DisclaimerFull } from './Disclaimer';
import { SafetySummary } from './SafetySummary';
import { useSafetyAccess } from './useSafetyAccess';
import { useBodyContext } from '@/state/profileStore';
import './onboarding.css';

/**
 * /safety — "Safety & limits", a pushed page (Back in the header): the full disclaimer (dossier §4.6, edited to the
 * design voice), the safety limits for plans, stop-and-get-help, the help card and the privacy statement. Open to
 * everyone, including visitors who have not answered the safety questions and under-18s (like the Evidence library).
 * The person's mode is the header's fact line and "Review my answers" its ⋯ item; a mode other than Standard also
 * says what it changes (the general limits below cover Standard).
 */
export default function SafetyLimitsPage() {
  const access = useSafetyAccess(useBodyContext());
  const navigate = useNavigate();
  const answered = access.gate.status === 'ready' || access.gate.status === 'needs-consent';
  const mode = access.outcome.modeName;
  // from 1280 px the limits and the help sit beside the prose (one measure per column, the page's full width)
  const wide = useMediaQuery(MQ.xl);
  const menu = useMemo<MenuEntry[] | undefined>(
    () => (answered ? [{ id: 'safety-review', label: LIMITS_PAGE.review, onSelect: () => navigate(paths.welcome('screening', 'settings'), { state: { from: paths.safety } }) }] : undefined),
    [answered, navigate],
  );
  return (
    <>
      <TopBar title={LIMITS_PAGE.title} documentTitle={LIMITS_PAGE.documentTitle} back subtitle={answered ? MODE_LABEL[mode] : undefined} menu={menu} />
      <Page>
        <div className="lm-safety-page">
          {answered && mode !== 'standard' ? (
            <Faceplate title={LIMITS_PAGE.modeTitle}>
              <SafetySummary outcome={access.outcome} bare bodyNote={false} />
            </Faceplate>
          ) : null}
          <article className="lm-safety-page__article" aria-label={LIMITS_PAGE.title}>
            <DisclaimerFull headingAs="h2" size="sm" split={wide} />
          </article>
        </div>
      </Page>
    </>
  );
}
