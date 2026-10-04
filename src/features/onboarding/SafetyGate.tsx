import { useState, type ReactNode } from 'react';
import { Checkbox, Faceplate, Key, KeyLink, Notice } from '@/components';
import { paths } from '@/app/paths';
import { DISCLAIMER, GATE, HARD_STOP, MESSAGES, SUMMARY } from './copy';
import { FastingTierControls } from './FastingTierControls';
import { HelpCard } from './HelpCard';
import { SafetySummary } from './SafetySummary';
import { useSafetyAccess, type SafetyBodyContext } from './useSafetyAccess';
import './onboarding.css';

export interface SafetyGateProps {
  feature: 'planner' | 'simulator';
  /** Body facts from Your body (the Planner should always pass them). */
  context?: SafetyBodyContext;
  /** Planner: show the safety summary + opt-in tier controls above the children (default true). */
  summary?: boolean;
  children: ReactNode;
}

/**
 * Safety gate for feature pages.
 * - **Simulator**: always usable once screened (the Simulator may simulate anything); in any mode other
 *   than Standard a notice says the Simulator flags what isn't advised. Blocked only for under-18s.
 * - **Planner**: blocked → the gate outcome and a way to the Simulator; clinician-first → the "talk to your
 *   clinician" acknowledgement first (dossier §4.2 Warn); otherwise the safety summary with the fasting
 *   opt-in controls, then the Planner.
 * The route guard already sends unscreened visitors to /welcome; the fallbacks here keep the gate honest
 * when a page is rendered elsewhere (tests, embeds).
 */
export function SafetyGate({ feature, context, summary = true, children }: SafetyGateProps) {
  const access = useSafetyAccess(context);
  const [checked, setChecked] = useState(false);
  const { outcome } = access;

  if (access.gate.status === 'blocked') {
    return (
      <Faceplate title={GATE.adultsTitle}>
        <div className="grid gap-4">
          <p className="m-0 text-base text-ink">{GATE.adultsBody}</p>
          <div>
            <KeyLink to={paths.evidence}>{HARD_STOP.evidenceLink}</KeyLink>
          </div>
        </div>
      </Faceplate>
    );
  }
  if (!access.ready) {
    return (
      <Faceplate title={GATE.unscreenedTitle}>
        <div className="grid gap-4">
          <p className="m-0 text-base text-ink">{GATE.unscreenedBody}</p>
          <div>
            <KeyLink to={paths.welcome()} variant="solid">
              {GATE.unscreenedAction}
            </KeyLink>
          </div>
        </div>
      </Faceplate>
    );
  }

  if (feature === 'simulator') {
    return (
      <>
        {outcome.modeName !== 'standard' ? (
          <Notice severity="info" title={GATE.simulatorNotice(access.modeLabel)} className="mb-4">
            <KeyLink to={paths.safety} size="sm" variant="quiet">
              {DISCLAIMER.resultsLink}
            </KeyLink>
          </Notice>
        ) : null}
        {children}
      </>
    );
  }

  if (access.plannerAccess === 'blocked') {
    const reasons = outcome.messages.filter((m) => m.severity !== 'info');
    return (
      <Faceplate title={GATE.plannerOffTitle}>
        <div className="grid gap-4">
          {reasons.map((m) => (
            <p key={m.id} className="m-0 text-base leading-[1.5] text-ink">
              {MESSAGES[m.id].body}
            </p>
          ))}
          <p className="m-0 text-sm leading-[1.5] text-ink-2">{GATE.plannerOffBody}</p>
          {outcome.restrictions.includes('R1') ? (
            <div className="border-t border-line pt-4">
              <HelpCard />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <KeyLink to={paths.simulate} variant="solid">
              {GATE.openSimulator}
            </KeyLink>
            <KeyLink to={paths.welcome('screening', 'settings')}>{SUMMARY.review}</KeyLink>
          </div>
        </div>
      </Faceplate>
    );
  }

  if (access.pendingAcknowledgements.includes('clinician-first')) {
    return (
      <Faceplate title={GATE.clinicianTitle}>
        <div className="grid gap-4">
          <p className="m-0 max-w-[64ch] text-base leading-[1.5] text-ink">{GATE.clinicianBody}</p>
          <SafetySummary outcome={outcome} bare />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <Checkbox checked={checked} onChange={setChecked} label={GATE.clinicianCheck} />
            <Key variant="solid" disabledReason={checked ? undefined : GATE.clinicianBlocked} onClick={() => access.acknowledge('clinician-first')}>
              {GATE.clinicianContinue}
            </Key>
          </div>
        </div>
      </Faceplate>
    );
  }

  return (
    <>
      {summary ? (
        <div className="mb-4">
          <SafetySummary outcome={outcome} review>
            {outcome.fasting.optInTiers.length > 0 || outcome.fasting.shortWindowAvailable ? <FastingTierControls context={context} /> : null}
          </SafetySummary>
        </div>
      ) : null}
      {children}
    </>
  );
}
