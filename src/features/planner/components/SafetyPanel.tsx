import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Icon, formatNumber } from '@/components';
import { SafetySummary, type SafetyAccess, type SafetyBodyContext } from '@/features/onboarding';
import { exerciseInReview } from '@/features/onboarding/SafetySummary';

export interface PlannerSafetyPanelProps {
  access: SafetyAccess;
  context: SafetyBodyContext;
}

/**
 * The safety mode on the Goals screen: a quiet row at the end of the screen ("Safety · Standard mode · deficits up to
 * 25 % · fasts up to 24 h", plus "exercise: review" or "kidney nutrition: entered" when they apply) that opens to the
 * full summary. It opens by itself in any mode other than Standard, where
 * the restrictions change what plans can contain. The fasting opt-ins sit under the "Longest fast" bank (LimitsPanel).
 */
export function PlannerSafetyPanel({ access }: PlannerSafetyPanelProps) {
  const { outcome } = access;
  const standard = outcome.modeName === 'standard';
  const [open, setOpen] = useState(!standard);
  const deficitCap = access.plannerLocks.find((l) => l.id === 'deficit-cap')?.value;
  const noDeficit = access.plannerLocks.some((l) => l.id === 'no-deficit');
  const maxFast = access.fasting.maxFastHours;
  const line = [
    access.modeLabel,
    // r068 W2-16: short values ("deficit ≤ 25 %"), each kept whole, so no unit wraps alone
    noDeficit ? 'no deficits' : deficitCap !== undefined ? `deficit ≤\u00a0${formatNumber(deficitCap, 0)}\u00a0%` : null,
    maxFast > 0 ? `fasts ≤\u00a0${formatNumber(maxFast, 0)}\u00a0h` : 'no fasts',
    // C5 status words (D4-02, D4-07): exercise in review, kidney nutrition entered / review / incomplete
    exerciseInReview(outcome) ? 'exercise: review' : null,
    outcome.renal && outcome.renal.status !== 'none' ? `kidney nutrition: ${(outcome.renal.status === 'conflict' ? 'limit conflict' : (outcome.renal.label ?? 'review')).toLowerCase()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <details className="lp-safety lm-material" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="lp-safety__summary">
        <span className="lp-safety__title">Safety</span>
        <span className="lp-safety__line">{line}</span>
        <Icon icon={ChevronRight} size={16} className="lp-safety__chev" />
      </summary>
      <div className="lp-safety__body">
        <SafetySummary outcome={outcome} review bare />
      </div>
    </details>
  );
}
