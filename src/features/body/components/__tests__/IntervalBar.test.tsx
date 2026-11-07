// IntervalBar (r071): the 80 % range as a scale. The pure model decides which ticks are lit and where the marker sits; the
// component only draws it, and the frame it ends on is the frame it shows when it cannot animate.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { IntervalBar, intervalModel } from '../IntervalBar';

afterEach(() => cleanup());

describe('intervalModel', () => {
  it('gives the range half its width of room on both sides, with the estimate inside', () => {
    const m = intervalModel(20, 30, 25);
    expect(m.min).toBeCloseTo(15, 9);
    expect(m.max).toBeCloseTo(35, 9);
    expect(m.at(25)).toBeCloseTo(50, 9);
    expect(m.at(20)).toBeCloseTo(25, 9);
    expect(m.at(30)).toBeCloseTo(75, 9);
  });

  it('lights exactly the ticks that lie inside the range', () => {
    const m = intervalModel(20, 30, 25);
    expect(m.ticks).toHaveLength(41);
    const lit = m.ticks.filter((t) => t.lit);
    expect(lit.length).toBeGreaterThan(15);
    expect(lit.length).toBeLessThan(25);
    for (const t of m.ticks) {
      const x = m.min + (t.pos / 100) * (m.max - m.min);
      expect(t.lit, `tick at ${x.toFixed(2)}`).toBe(x >= 20 - 1e-4 && x <= 30 + 1e-4);
    }
    // lit ticks are contiguous
    const first = m.ticks.findIndex((t) => t.lit);
    const last = m.ticks.length - 1 - [...m.ticks].reverse().findIndex((t) => t.lit);
    expect(m.ticks.slice(first, last + 1).every((t) => t.lit)).toBe(true);
  });

  it('keeps the estimate on the scale even when it sits outside its own range (a pinned estimate)', () => {
    const m = intervalModel(20, 30, 36);
    expect(m.at(36)).toBeLessThanOrEqual(100);
    expect(m.max).toBeGreaterThanOrEqual(36);
  });

  it('a thin scale has fewer ticks than the full one', () => {
    expect(intervalModel(1, 2, 1.5, 'thin').ticks).toHaveLength(25);
    expect(intervalModel(1, 2, 1.5, 'full').ticks).toHaveLength(41);
  });

  it('is finite for a range with no width', () => {
    const m = intervalModel(5, 5, 5);
    expect(Number.isFinite(m.min) && Number.isFinite(m.max)).toBe(true);
    expect(m.ticks.every((t) => Number.isFinite(t.pos))).toBe(true);
  });
});

describe('<IntervalBar>', () => {
  it('prints the two ends and says the range for assistive technology', () => {
    const { container } = render(<IntervalBar low={20.3} high={32.4} value={26.4} />);
    expect(container.querySelector('.lm-sr')?.textContent).toBe('likely 20.3 to 32.4');
    expect(Array.from(container.querySelectorAll('.lm-body-iv__ends span')).map((s) => s.textContent)).toEqual(['20.3', '32.4']);
    expect(container.querySelectorAll('.lm-body-iv__t[data-lit]').length).toBeGreaterThan(0);
  });

  it('quiet: the picture with no numeral anywhere, for the eye or the ear', () => {
    const { container } = render(<IntervalBar low={20.3} high={32.4} value={26.4} quiet />);
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.querySelector('.lm-body-iv__ends')).toBeNull();
  });

  it('thin: the range is said by its caller, so no ends are printed', () => {
    const { container } = render(<IntervalBar low={20.3} high={32.4} value={26.4} size="thin" />);
    expect(container.querySelector('.lm-body-iv__ends')).toBeNull();
    expect(container.querySelector('.lm-sr')?.textContent).toBe('likely 20.3 to 32.4');
  });

  it('formats with the caller\'s decimals and formatter', () => {
    const { container } = render(<IntervalBar low={2140} high={2910} value={2520} decimals={0} format={(x) => `${Math.round(x)} kcal`} />);
    expect(container.querySelector('.lm-sr')?.textContent).toBe('likely 2140 kcal to 2910 kcal');
  });

  it('the frame it animates to is the frame it shows when it cannot animate', () => {
    const a = render(<IntervalBar low={20} high={30} value={25} animate />);
    const animated = a.container.innerHTML;
    cleanup();
    const b = render(<IntervalBar low={20} high={30} value={25} animate={false} />);
    expect(b.container.innerHTML).toBe(animated);
    expect(b.container.querySelector('[data-reveal]')).toBeNull();
  });
});
