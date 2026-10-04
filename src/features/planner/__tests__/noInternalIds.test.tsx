import '@/features/charts/test/setupDom';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { describeFasts } from '@/engine/planner/domain/fastingExplain';
import { MemoryRouter } from 'react-router';
import type { PlannerRequestV2 } from '@/engine/planner/domain/types';
import { fixtureLadder, fixtureLadderCase, fixtureRequest } from './fixtures';
import { CollapsedChip, LadderCard } from '../components/LadderCard';
import { LadderScale } from '../components/LadderScale';
import { collapsedChips, idealSameAsHard, planOf, presentKinds } from '../ladder';
import { LimitCosts } from '../components/LimitCosts';
import { LadderTable } from '../components/LadderTable';
import { comparisonRows } from '../ladder';
import { limitCostSentence } from '../components/LimitCosts';

const goals = fixtureRequest().goals;
/** A dotted internal id ("constraints.eatingWindow", "training.owned") or a rule code. */
const LEAK = /\b(constraints|training|sleep|cardio)\.[a-zA-Z]+|\b(HC|W|R)-[A-Z0-9-]{2,}\b/;

describe('no internal ids reach the screen (PLN-01)', () => {
  const v2 = fixtureLadder({}, { ideal: true });
  const ideal = v2.ideal!;
  it('keeps the fixture honest: the engine hands over dotted field ids', () => {
    expect(ideal.relaxed.some((r) => r.field.startsWith('constraints.'))).toBe(true);
  });
  it('the Ideal card and the Limits tab print what changed, without the field ids', () => {
    for (const all of [false, true]) {
      const { container, unmount } = render(<LimitCosts ideal={ideal} goals={goals} units="metric" energy="kcal" all={all} />);
      const text = container.textContent ?? '';
      expect(text).toContain('what it changes');
      expect(text).toContain('3 → up to 6');
      expect(text).not.toMatch(LEAK);
      unmount();
    }
  });
  it('the comparison table (and the print summary built from it) carry no ids', () => {
    const { container } = render(<LadderTable v2={v2} goals={goals} units="metric" energy="kcal" selected="hard" onSelect={() => {}} />);
    expect(container.textContent ?? '').not.toMatch(LEAK);
    expect(JSON.stringify(comparisonRows(v2, goals, 'metric'))).not.toMatch(LEAK);
    for (const c of ideal.limitCosts) expect(limitCostSentence(c, goals, 'metric', 'kcal')).not.toMatch(LEAK);
  });
  it('the table has no stray "row" header (PLN-07)', () => {
    const { container } = render(<LadderTable v2={v2} goals={goals} units="metric" energy="kcal" selected="hard" onSelect={() => {}} />);
    const corner = container.querySelector('th.lp-ltable__corner')!;
    expect(corner.textContent).toBe('Measure');
    expect(container.textContent ?? '').not.toMatch(/\brow\b/);
  });
});

describe('the ladder cases carry no internal references (chips, Ideal equals Hard, carried, the graph)', () => {
  /** Section signs, rule codes, spec or plan names, package letters. */
  const INTERNAL = /§|\bR-\d|\bPLN-|\bSPEC\b|PLANNER_V2|\bE21\b|\bA3\b|\bitem \d|\b[Pp]lan 0\d/;
  for (const c of ['four', 'three', 'sameAsHard', 'hardOnly'] as const) {
    it(c, () => {
      const v2 = fixtureLadderCase(c);
      const request = fixtureRequest() as PlannerRequestV2;
      const { container } = render(
        <MemoryRouter>
          <LadderScale v2={v2} goal1={request.goals[0]} units="metric" energy="kcal" selected="hard" onSelect={() => {}} />
          <ul>
            {collapsedChips(v2).map((x) => (
              <CollapsedChip key={x.kind} kind={x.kind} title={x.title} text={x.text} />
            ))}
          </ul>
          {presentKinds(v2).map((k) => (
            <LadderCard
              key={k}
              kind={k}
              plan={planOf(v2, k)!}
              v2={v2}
              request={request}
              phases={[]}
              dayToDay="hunger: moderate"
              units="metric"
              energy="kcal"
              selected={false}
              sameAsIdeal={k === 'hard' ? idealSameAsHard(v2) : null}
              onSelect={() => {}}
            />
          ))}
        </MemoryRouter>,
      );
      const text = container.textContent ?? '';
      expect(text).not.toMatch(LEAK);
      expect(text).not.toMatch(INTERNAL);
      for (const el of Array.from(container.querySelectorAll('[aria-label], [title]'))) expect(`${el.getAttribute('aria-label')} ${el.getAttribute('title')}`).not.toMatch(INTERNAL);
    });
  }
});

describe('describeFasts (PLN-02)', () => {
  it('counts every kind of fast from the events', () => {
    const evs = [...Array(7).fill({ durationH: 24 }), ...Array(3).fill({ durationH: 72 })];
    const t = describeFasts(evs, 0, 84);
    expect(t).toBe('3 fasts of 72 hours and 7 fasts of 24 hours (10 fasts in all)');
  });
  it('keeps the short forms for one kind', () => {
    expect(describeFasts(Array(12).fill({ durationH: 24 }), 0, 84)).toBe('a 24-hour fast every week (12 in all)');
    expect(describeFasts([{ durationH: 72 }], 0, 84)).toBe('one fast of 72 hours');
    expect(describeFasts([], 3, 28)).toBe('3 zero-energy days');
  });
});
