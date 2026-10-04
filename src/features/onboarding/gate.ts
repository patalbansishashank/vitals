/**
 * Route-guard decisions (pure). The layout route <OnboardingGate> and /welcome both use these, so the
 * order of checks lives in one place:
 *   no answers → welcome · under 18 → hard stop · imported answers → review · question set changed or
 *   incomplete → review · clearance older than 12 months → review · consent missing or outdated → consent.
 */
import { paths } from '@/app/paths';
import { ACK_VERSIONS } from './copyEarly';
import { QUESTION_SET_VERSION, evaluateScreening, isAcknowledged, isClearanceExpired, type AcknowledgementRecord, type ScreeningAnswers } from './safetyRules';

export interface GateInput {
  answers: ScreeningAnswers | null;
  answeredAt: string | null;
  questionSetVersion: number | null;
  acknowledgements: AcknowledgementRecord;
  pendingReview: boolean;
}

export type ReviewReason = 'import' | 'update' | 'expired';
export type GateStatus =
  | { status: 'first-run' }
  | { status: 'blocked' }
  | { status: 'needs-review'; reason: ReviewReason }
  | { status: 'needs-consent'; updated: boolean }
  | { status: 'ready' };

export function gateStatus(s: GateInput, nowIso: string, disclaimerVersion: number = ACK_VERSIONS.disclaimer): GateStatus {
  if (!s.answers || s.answers.ageBand === undefined) return { status: 'first-run' };
  const outcome = evaluateScreening(s.answers);
  if (outcome.hardStop === 'BLOCK_APP') return { status: 'blocked' };
  if (s.pendingReview) return { status: 'needs-review', reason: 'import' };
  if (!outcome.complete || s.questionSetVersion !== QUESTION_SET_VERSION) return { status: 'needs-review', reason: 'update' };
  if (isClearanceExpired(s.answeredAt, nowIso)) return { status: 'needs-review', reason: 'expired' };
  if (!isAcknowledged(s.acknowledgements, 'disclaimer', disclaimerVersion)) return { status: 'needs-consent', updated: s.acknowledgements.disclaimer !== undefined };
  return { status: 'ready' };
}

/** Where a guarded route sends this visitor, or null to let them through. */
export function gateRedirect(s: GateInput, nowIso: string, disclaimerVersion: number = ACK_VERSIONS.disclaimer): string | null {
  const g = gateStatus(s, nowIso, disclaimerVersion);
  switch (g.status) {
    case 'ready':
      return null;
    case 'first-run':
      return paths.welcome();
    case 'blocked':
      return paths.welcome('stop');
    case 'needs-review':
      return paths.welcome('screening', g.reason);
    case 'needs-consent':
      return paths.welcome('consent', g.updated ? 'updated' : undefined);
  }
}
