/**
 * Same-scale effort bars (plan-ladder.md §12.1, the acceptance oracle of the effort-bar fix): every card's track runs
 * from today's habit to your limit at one width, so equal values draw equal fills on every card (the fill is a plain
 * percentage of a fixed-width track); the limit tick sits at the track's right end everywhere; only the Ideal, and only
 * on a row past the limit, draws the hatched "past your limit" segment, at most half a track long.
 */
import '@/features/charts/test/setupDom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { PlannerRequestV2, PlanKind } from '@/engine/planner/domain/types';
import { BurdenScale, fillWidth } from '../components/BurdenScale';
import { LadderCard } from '../components/LadderCard';
import { burdenRows, planOf } from '../ladder';
import { fixtureDifficulty, fixtureLadderCase, fixtureRequest } from './fixtures';

const KINDS: PlanKind[] = ['hard', 'medium', 'easy', 'ideal'];

function renderCards(v2 = fixtureLadderCase('sameEffort')) {
  const request = fixtureRequest() as PlannerRequestV2;
  return render(
    <MemoryRouter>
      <div>
        {KINDS.map((k) => (
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
            onSelect={() => undefined}
          />
        ))}
      </div>
    </MemoryRouter>,
  );
}

const fills = (card: Element) =>
  Object.fromEntries(Array.from(card.querySelectorAll('.lp-burden__row[data-active]')).map((r) => [r.querySelector('dt')!.textContent, (r.querySelector('.lp-burden__fill') as HTMLElement).style.width]));

describe('effort bars on one scale', () => {
  it('draws equal values as equal fills on every card, the Ideal included', () => {
    const { container } = renderCards();
    const cards = KINDS.map((k) => container.querySelector(`article[data-rung="${k}"]`)!);
    const hard = fills(cards[0]!);
    expect(Object.keys(hard)).toHaveLength(7);
    for (const c of cards.slice(1)) {
      const f = fills(c);
      for (const [label, w] of Object.entries(f)) {
        // the Ideal's two rows past the limit are full tracks; every other value equals Hard's
        if (c.getAttribute('data-rung') === 'ideal' && (label === 'deficit' || label === 'training time')) expect(w).toBe('100%');
        else expect(w).toBe(hard[label]);
      }
    }
    // the fill is a share of the track (never a 1/1.5 squeeze); the tick is at the track's right end on every card
    expect(hard['training time']).toBe('50%');
    expect(hard.hunger).toBe('65%');
    for (const c of cards) for (const tick of Array.from(c.querySelectorAll<HTMLElement>('.lp-burden__limit'))) expect(tick.style.left).toBe('');
  });

  it('draws the hatched segment iff Ideal ∧ over > 0, at most half a track, and says "past your limit"', () => {
    const { container } = renderCards();
    for (const k of ['hard', 'medium', 'easy']) expect(container.querySelectorAll(`article[data-rung="${k}"] .lp-burden__over`)).toHaveLength(0);
    const ideal = container.querySelector('article[data-rung="ideal"]')!;
    const over = Array.from(ideal.querySelectorAll<HTMLElement>('.lp-burden__row[data-over]'));
    expect(over.map((r) => r.querySelector('dt')!.textContent)).toEqual(['deficit', 'training time']);
    const seg = over.map((r) => r.querySelector<HTMLElement>('.lp-burden__over')!);
    // deficit: 13 against a 0 → 10 span is 0.3 past; training time 0.9 past, cut at half a track
    expect(seg.map((s) => s.style.width)).toEqual(['30%', '50%']);
    expect(seg[0]!.hasAttribute('data-capped')).toBe(false);
    expect(seg[1]!.hasAttribute('data-capped')).toBe(true);
    expect(over[0]!.textContent).toContain('(past your limit)');
    expect(ideal.querySelector('.lp-burden')!.hasAttribute('data-overflow')).toBe(true);
    expect(ideal.querySelector('.lp-burden__legend')!.textContent).toBe('nowyour limitpast your limit');
    expect(ideal.textContent).toContain('effort (past your limits)');
  });

  it('an Ideal within your limits is laid out exactly like Hard: no reserve, no hatching, plain "effort"', () => {
    const v2 = fixtureLadderCase('sameEffort');
    v2.ideal = { ...v2.ideal!, summary: { ...v2.ideal!.summary, difficulty: fixtureDifficulty(0.5) } };
    const { container } = renderCards(v2);
    const ideal = container.querySelector('article[data-rung="ideal"]')!;
    expect(ideal.querySelectorAll('.lp-burden__over')).toHaveLength(0);
    expect(ideal.querySelector('.lp-burden')!.hasAttribute('data-overflow')).toBe(false);
    expect(ideal.querySelector('.lp-burden__legend')!.textContent).toBe('nowyour limit');
    expect(ideal.querySelector('.lp-lcard__sec')).not.toBeNull();
    expect(Array.from(ideal.querySelectorAll('.lp-lcard__sec')).map((s) => s.textContent)).toContain('effort');
    expect(fills(ideal)).toEqual(fills(container.querySelector('article[data-rung="hard"]')!));
  });

  it('puts the legend and the effort footer on every card, and the Overview footnote goes on from it', () => {
    const { container } = renderCards();
    for (const k of KINDS) {
      const c = container.querySelector(`article[data-rung="${k}"]`)!;
      expect(c.querySelector('.lp-burden__legend')!.textContent).toMatch(/^nowyour limit/);
      expect(c.querySelector('.lp-burden__foot')!.textContent).toBe('effort 50 is the average of these seven parts.');
    }
    const { container: full } = render(<BurdenScale difficulty={fixtureDifficulty(0.5)} footnote />);
    expect(full.querySelector('.lp-burden__foot')!.textContent).toBe(
      'effort 50 is the average of these seven parts. When several limits are tight, effort stays low even for the hardest plan you can do.',
    );
  });

  it('keeps the same width rules in CSS: a fixed track per size, no 1.5 squeeze, the tick at the right end', () => {
    const css = readFileSync(resolve(__dirname, '../ladder.css'), 'utf8');
    expect(css).not.toMatch(/\/\s*1\.5\b/);
    expect(css).not.toMatch(/66\.66/);
    const block = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));
    expect(block('  .lp-burden__bar')).toMatch(/width: var\(--lp-track\)/);
    expect(block('  .lp-burden__limit')).toMatch(/right: 0/);
    expect(block('  .lp-burden__over')).toMatch(/left: 100%/);
    expect(block('  .lp-burden__fill')).not.toMatch(/width/);
    expect(fillWidth(0.333333)).toBe('33.3%');
    expect(fillWidth(1.7)).toBe('100%');
    expect(burdenRows(fixtureDifficulty(0.5, { over: 1.9 }), { ideal: true }).find((r) => r.id === 'deficit')).toMatchObject({ over: 0.5, capped: true });
  });
});
