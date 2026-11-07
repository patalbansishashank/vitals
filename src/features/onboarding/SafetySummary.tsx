import type { ReactNode } from 'react';
import { Engraved, Faceplate, KeyLink, energyInText, formatNumber, type EnergyUnitChoice } from '@/components';
import type { ConstraintUnit } from '@/lib/bodyContracts';
import type { RenalBound, RenalScope } from './renalScope';
import { useEnergyUnit } from '@/state/settingsStore';
import { paths } from '@/app/paths';
import { LOCK_TEXT, MESSAGES, MODE_ALSO_CLINICIAN_FIRST, MODE_LABEL, modeSummary, SUMMARY } from './copy';
import { HelpCard } from './HelpCard';
import type { PlannerLock, ScreeningOutcome } from './safetyRules';
import './onboarding.css';

/**
 * D4-02: a "yes" to fainting / chest pain / dizziness is not yet a resolved, dated symptom: exercise progression waits
 * for review (no new exercise prescription or step increase is certified from it). A short status, no diagnosis.
 */
export const EXERCISE_REVIEW = 'Exercise · Review';

/**
 * Whether the current screening leaves exercise in review (D4-02): the legacy yes / prefer-not answer not yet clarified,
 * or the screening's exercise gate (`no-exercise-prescription`: unresolved concerning exertional symptoms without a
 * covering reviewed envelope, or the context still incomplete).
 */
export const exerciseInReview = (outcome: Pick<ScreeningOutcome, 'flags'> & Partial<Pick<ScreeningOutcome, 'plannerLocks'>>): boolean =>
  outcome.flags.includes('exercise-symptoms') || (outcome.plannerLocks ?? []).some((l) => l.id === 'no-exercise-prescription');

/** Entered-bound units as the line reads them ("g/kg/d" → "g/kg/day"). */
const BOUND_UNIT: Readonly<Partial<Record<ConstraintUnit, string>>> = { 'g/kg/d': 'g/kg/day', 'g/d': 'g/day', 'mg/d': 'mg/day', 'mL/d': 'mL/day' };
const BOUND_NAME: Readonly<Record<string, string>> = { proteinPerKg: 'protein', proteinPerDay: 'protein', sodiumPerDay: 'sodium', potassiumPerDay: 'potassium', fluidPerDay: 'fluid' };

/** "protein ≤ 0.8 g/kg/day (56 g/day)": an entered clinician bound exactly as entered, with today's g/day when known. */
export function renalBoundText(b: Pick<RenalBound, 'def' | 'perDay'>): string {
  const d = b.def;
  const unit = BOUND_UNIT[d.unit] ?? d.unit;
  const dec = d.unit === 'g/kg/d' ? 1 : 0;
  const per = b.perDay ? ` (${formatNumber(b.perDay.value, 0)} g/day)` : '';
  return `${BOUND_NAME[d.quantity] ?? d.quantity} ${d.comparator === 'cap' ? '≤' : '≥'} ${formatNumber(d.value, dec)} ${unit}${per}`;
}

/**
 * D4-07: the kidney nutrition status in one line — "Kidney nutrition · Entered · protein ≤ 0.8 g/kg/day · sodium ≤ 2 000
 * mg/day", "Kidney nutrition · Review" or "· Incomplete", "· Limit conflict"; null without a kidney context. Only entered
 * clinician numbers are printed (never a generic default); why a status applies opens with the details.
 */
export function renalLine(scope: Pick<RenalScope, 'status' | 'label' | 'bounds'> | null | undefined): string | null {
  if (!scope || scope.status === 'none') return null;
  const word = scope.status === 'conflict' ? 'Limit conflict' : (scope.label ?? 'Review');
  const bounds = scope.status === 'entered' ? scope.bounds.filter((b) => b.status === 'enforceable' && BOUND_NAME[b.def.quantity]).map(renalBoundText) : [];
  return ['Kidney nutrition', word, ...bounds].join(' · ');
}

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
  /** List the plan limits under the mode line (default true). The consent step shows the mode line alone. */
  locks?: boolean;
  /** The "your body sets limits too" note while the body facts are missing (default true). */
  bodyNote?: boolean;
}

/**
 * The gate outcome in plain words (design §6.2 "Safety summary"): the mode, what it changes in plans, and
 * the help card in gentle mode. Used on the consent step (mode line only), the Planner gate, Settings and /safety.
 */
export function SafetySummary({ outcome, title = SUMMARY.title, titleAs = 'h2', review = false, children, bare = false, locks = true, bodyNote = true }: SafetySummaryProps) {
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
          <strong className="font-medium">{MESSAGES[m.id].title}</strong> {MESSAGES[m.id].body}
        </p>
      ))}
      {exerciseInReview(outcome) ? <p className="m-0 text-sm text-ink">{EXERCISE_REVIEW}</p> : null}
      {renalLine(outcome.renal) ? <p className="m-0 text-sm text-ink lm-num">{renalLine(outcome.renal)}</p> : null}
      {locks && lines.length > 0 ? (
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
      {bodyNote && !outcome.bodyRulesApplied && outcome.hardStop !== 'BLOCK_APP' ? <p className="m-0 text-xs text-ink-2">{SUMMARY.bodyPending}</p> : null}
      {outcome.restrictions.includes('R1') ? (
        <div className="border-t border-line pt-4">
          <HelpCard headingAs={titleAs === 'h2' ? 'h3' : 'h4'} />
        </div>
      ) : null}
      {children}
      {review ? (
        <div>
          <KeyLink to={paths.welcome('screening', 'settings')} size="sm" variant="text">
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
