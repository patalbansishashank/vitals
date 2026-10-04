import type { ReactNode } from 'react';
import { Engraved, Faceplate, KeyLink, energyInText, type EnergyUnitChoice } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import { paths } from '@/app/paths';
import { LOCK_TEXT, MESSAGES, MODE_ALSO_CLINICIAN_FIRST, MODE_LABEL, modeSummary, SUMMARY } from './copy';
import { HelpCard } from './HelpCard';
import type { PlannerLock, ScreeningOutcome } from './safetyRules';
import './onboarding.css';

/** Plain-language lines for the planner locks, in lock order. */
export function lockLines(locks: readonly PlannerLock[], unit: EnergyUnitChoice = 'kcal'): string[] {
  // With "no deficit", the deficit and loss-rate caps are moot — don't list them beside it.
  const noDeficit = locks.some((l) => l.id === 'no-deficit');
  return locks.filter((l) => !(noDeficit && (l.id === 'deficit-cap' || l.id === 'rate-cap'))).map((l) => energyInText(LOCK_TEXT[l.id](l.value), unit));
}

export interface SafetySummaryProps {
  outcome: ScreeningOutcome;
  /** Title of the faceplate (default "Your safety settings"). */
  title?: ReactNode;
  titleAs?: 'h2' | 'h3';
  /** Show "Review my answers". */
  review?: boolean;
  /** Extra content under the limits (e.g. the fasting tier controls). */
  children?: ReactNode;
  /** Render without the faceplate (inside another faceplate or a popover). */
  bare?: boolean;
}

/**
 * The gate outcome in plain words (design §6.2 "Safety summary"): the mode, what it changes in plans, and
 * the help card in gentle mode. Used on the consent step, the Planner gate, Settings and /safety.
 */
export function SafetySummary({ outcome, title = SUMMARY.title, titleAs = 'h2', review = false, children, bare = false }: SafetySummaryProps) {
  const lines = lockLines(outcome.plannerLocks, useEnergyUnit());
  const bodyNotes = outcome.messages.filter((m) => m.source === 'body');
  const content = (
    <div className="grid gap-4">
      <p className="lm-safety-mode">
        <strong>{MODE_LABEL[outcome.modeName]}.</strong> {modeSummary(outcome.modeName, outcome.fasting)}
        {outcome.restrictions.includes('R1') && outcome.restrictions.includes('R2') ? ` ${MODE_ALSO_CLINICIAN_FIRST}` : ''}
      </p>
      {bodyNotes.map((m) => (
        <p key={m.id} className="m-0 text-sm text-ink">
          <strong className="font-semibold">{MESSAGES[m.id].title}</strong> {MESSAGES[m.id].body}
        </p>
      ))}
      {lines.length > 0 ? (
        <div className="grid gap-1">
          <Engraved as="p" className="m-0">
            {outcome.plannerAccess === 'full' ? SUMMARY.standardLabel : SUMMARY.changesLabel}
          </Engraved>
          <ul className="lm-safety-list">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {!outcome.bodyRulesApplied && outcome.hardStop !== 'BLOCK_APP' ? <p className="m-0 text-xs text-ink-2">{SUMMARY.bodyPending}</p> : null}
      {outcome.restrictions.includes('R1') ? (
        <div className="border-t border-line pt-4">
          <HelpCard headingAs={titleAs === 'h2' ? 'h3' : 'h4'} />
        </div>
      ) : null}
      {children}
      {review ? (
        <div>
          <KeyLink to={paths.welcome('screening', 'settings')} size="sm">
            {SUMMARY.review}
          </KeyLink>
        </div>
      ) : null}
    </div>
  );
  if (bare) return content;
  return (
    <Faceplate title={title} titleAs={titleAs}>
      {content}
    </Faceplate>
  );
}
