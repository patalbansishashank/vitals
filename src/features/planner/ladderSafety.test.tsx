/**
 * Safety status and uncertainty language on the plan ladder (C5/C6, D4-01/D4-03): no automatic "within safety limits",
 * Unchecked when the planner attached no check, exact scenario-run counts in the plan details, no inline chance and no
 * "likely" on the goal rows.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { JointScreenResult } from '@/lib/bodyContracts';
import type { RankedGoal } from '@/engine/planner/domain/types';
import { checkRunShare, comparisonRows, outcomeView, planSafetyStatus, safetyDetails } from './ladder';
import { SafetyLine } from './components/PlanParts';
import { fixtureLadder } from './__tests__/fixtures';

const goals: RankedGoal[] = [
  { metric: 'fatMass', direction: 'target', target: -5, targetKind: 'change' },
  { metric: 'leanTissue', direction: 'maximise', target: 0, targetKind: 'change' },
];

const audit = (passes: number, M = 16, status: JointScreenResult['status'] = passes >= 15 ? 'pass' : 'fail'): JointScreenResult => ({ status, M, passes, required: 15, failedMembers: [], missing: [], alpha: 0.1, reasonCode: status === 'pass' ? 'ok' : 'belowRequired' });

describe('plan safety status (C5)', () => {
  it('a plan without an attached check is Unchecked, never verified by an empty list of notes', () => {
    const v2 = fixtureLadder();
    expect(planSafetyStatus(v2.rungs.hard)).toBe('unchecked');
    const safety = comparisonRows(v2, goals, 'metric').find((r) => r.id === 'safety')!;
    for (const cell of Object.values(safety.cells)) {
      expect(cell).toMatch(/^Unchecked/);
      expect(cell).not.toMatch(/within safety limits/);
    }
  });

  it('the details give exact scenario-run counts and keep the outcome holdout apart', () => {
    const rows = safetyDetails({
      safety: {
        status: 'review',
        evaluations: [
          { constraintId: 'fat-cap', key: 'k', status: 'pass', capability: 'enforced', mandatory: true, margin: 2, unit: '%E' },
          { constraintId: 'satfat-cap', key: 'k2', status: 'unchecked', capability: 'unsupported', mandatory: true, margin: null, unit: '%E' },
        ],
        audit: audit(14),
        outcomeHoldout: { draws: 8, status: 'evaluated' },
      },
    });
    const text = rows.map((r) => `${r.key}: ${r.value}`);
    expect(text).toContain('Status: Review');
    expect(text).toContain('fat-cap (%E): Verified');
    expect(text).toContain('satfat-cap (%E): Unchecked · not supported');
    expect(text).toContain('Safety audit: 14 of 16 scenario runs passed every required limit · 15 needed');
    expect(text.join(' ')).toMatch(/kept apart from the safety audit/);
    expect(text.join(' ')).not.toMatch(/chance|probab/i);
  });

  it('an unrun audit reads Unchecked', () => {
    const rows = safetyDetails({ safety: { status: 'unchecked' } });
    expect(rows.find((r) => r.key === 'Safety audit')!.value).toMatch(/Unchecked/);
  });

  it('the card line shows the status word, not a green "within safety limits"', () => {
    render(<SafetyLine option={{ safetyItems: [], safetyNotes: [] }} />);
    expect(screen.getByText('Unchecked')).toBeInTheDocument();
    expect(screen.queryByText(/within safety limits/)).toBeNull();
    render(<SafetyLine option={{ safetyItems: [], safetyNotes: [], safety: { status: 'verified' } }} />);
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });
});

describe('uncertainty language (C6/D4-03)', () => {
  it('goal rows give a unit-bearing range and no chance', () => {
    const v2 = fixtureLadder();
    const hard = outcomeView(v2.rungs.hard!.summary.outcomes[0]!, goals[0], 'hard', 'metric');
    expect(hard.range).toBe('4.6–5.8 kg');
    expect(hard.verdict).not.toMatch(/chance|%/);
    expect(hard.range).not.toMatch(/likely/);
  });

  it('the share of check runs is a count of model runs, never a chance', () => {
    expect(checkRunShare(0.8125, 16)).toBe('13 of 16 check runs');
    expect(checkRunShare(0.82)).toBe('82 % of the check runs');
    expect(checkRunShare(null)).toBeNull();
    expect(checkRunShare(0.82, undefined, true)).toMatch(/^about 80/);
  });
});
