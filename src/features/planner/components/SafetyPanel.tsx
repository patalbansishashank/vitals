import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Faceplate, Icon, formatNumber } from '@/components';
import { FastingTierControls, SafetySummary, type SafetyAccess, type SafetyBodyContext } from '@/features/onboarding';

export interface PlannerSafetyPanelProps {
  access: SafetyAccess;
  context: SafetyBodyContext;
}

/**
 * The safety summary on the Goals screen, folded to one line in Standard mode so the goals stay the first thing on
 * the screen (a full summary pushed them below the fold on phones). It opens by itself in any other mode, where the
 * restrictions change what plans can contain. The fasting and short-window opt-ins live inside it.
 */
export function PlannerSafetyPanel({ access, context }: PlannerSafetyPanelProps) {
  const { outcome } = access;
  const standard = outcome.modeName === 'standard';
  const [open, setOpen] = useState(!standard);
  const deficitCap = access.plannerLocks.find((l) => l.id === 'deficit-cap')?.value;
  const noDeficit = access.plannerLocks.some((l) => l.id === 'no-deficit');
  const maxFast = access.fasting.maxFastHours;
  const line = [
    access.modeLabel,
    noDeficit ? 'no deficits' : deficitCap !== undefined ? `deficits up to ${formatNumber(deficitCap, 0)} %` : null,
    maxFast > 0 ? `fasts up to ${formatNumber(maxFast, 0)} h` : 'no fasts',
  ]
    .filter(Boolean)
    .join(' · ');
  const controls = outcome.fasting.optInTiers.length > 0 || outcome.fasting.shortWindowAvailable;
  return (
    <Faceplate as="div" className="lp-safety">
      <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="lp-safety__summary">
          <Icon icon={ChevronRight} size={16} className="lp-safety__chev" />
          <span className="lp-safety__title">Safety settings</span>
          <span className="lp-safety__line">{line}</span>
        </summary>
        <div className="lp-safety__body">
          <SafetySummary outcome={outcome} review bare>
            {controls ? <FastingTierControls context={context} /> : null}
          </SafetySummary>
        </div>
      </details>
    </Faceplate>
  );
}
