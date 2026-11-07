import { act, render, screen } from '@testing-library/react';
import { useSettingsStore } from '@/state/settingsStore';
import type { EquivalenceResult } from '@/catalogues';
import {
  EquivalenceMeter,
  EquivalenceQuietProvider,
  equivalenceVerdict,
  verdictBand,
} from '../../components/EquivalenceMeter';

/** A synthetic result (numbers are illustrative). */
function result(score: number, extra: Partial<EquivalenceResult> = {}): EquivalenceResult {
  const band = score >= 0.9 ? 'full' : score >= 0.6 ? 'partial' : 'different';
  return {
    score,
    credit: band === 'full' ? 1 : score,
    parity: band === 'full',
    band,
    perTerm: [
      { term: 'hyp', ratio: score, weight: 0.6 },
      { term: 'kcal', ratio: 0.5, weight: 0.4 },
    ],
    shortfall: [],
    alsoTrained: [],
    ...extra,
  };
}

describe('EquivalenceMeter', () => {
  it('says "counts as" at 0.95', () => {
    render(<EquivalenceMeter result={result(0.95)} target="today’s swing" />);
    const meter = screen.getByRole('meter', { name: 'same stimulus' });
    expect(meter).toHaveAttribute('aria-valuenow', '95');
    expect(meter).toHaveAttribute('aria-valuetext', '95 %, counts as today’s swing');
    expect(screen.getByText('counts as today’s swing')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '95 %' })).toBeInTheDocument();
  });

  it('says "partly" at 0.75, with the catalogue’s fix or "add 1 set"', () => {
    const { rerender } = render(
      <EquivalenceMeter
        result={result(0.75, {
          shortfall: [{ term: 'hyp', missing: 1, text: 'Chest work is short: add 1 set.' }],
        })}
        target="today’s lift"
      />,
    );
    expect(screen.getByText('partly — chest work is short: add 1 set')).toBeInTheDocument();
    rerender(<EquivalenceMeter result={result(0.75)} target="today’s lift" />);
    expect(screen.getByText('partly — add 1 set')).toBeInTheDocument();
  });

  it('says "different work" at 0.40, credited to the regions it trained or its strongest term', () => {
    const { rerender } = render(
      <EquivalenceMeter
        result={result(0.4, { alsoTrained: ['shoulders', 'upperBack'] })}
        target="today’s run"
      />,
    );
    expect(screen.getByText('different work — credited to shoulders and upper back')).toBeInTheDocument();
    rerender(
      <EquivalenceMeter
        result={result(0.4, {
          perTerm: [
            { term: 'card', ratio: 0.2, weight: 0.5 },
            { term: 'kcal', ratio: 0.7, weight: 0.5 },
          ],
        })}
        target="today’s run"
      />,
    );
    expect(screen.getByText('different work — credited to energy')).toBeInTheDocument();
  });

  it('uses a range scale with named partial and full-credit thresholds', () => {
    const { container } = render(<EquivalenceMeter result={result(0.72)} target="today’s lift" />);
    expect(container.querySelector('.lmz-scale')).toBeInTheDocument();
    expect(container.querySelector('.lmv-tick')).not.toBeInTheDocument();
    expect(screen.getByText('Partly 60 %')).toBeInTheDocument();
    expect(screen.getByText('Full 90 %')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'same stimulus' })).toHaveAttribute(
      'aria-valuetext',
      '72 %, partly — add 1 set',
    );
    expect(screen.getByRole('button', { name: 'About Same stimulus' })).toBeInTheDocument();
  });

  it('keeps the small scale compact and names the verdict outside the picture', () => {
    const { container } = render(<EquivalenceMeter result={result(0.72)} target="today’s lift" size="sm" />);
    expect(container.querySelector('.lmz-scale')).toHaveAttribute('data-size', 'inline');
    expect(screen.queryByText('Partly 60 %')).not.toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'same stimulus' })).toHaveAttribute('aria-valuenow', '72');
    expect(screen.getByText('partly — add 1 set')).toBeInTheDocument();
  });

  it('shows per-term ratios with their weights and "also trained" in the detail', () => {
    render(
      <EquivalenceMeter result={result(0.92, { alsoTrained: ['core'] })} target="today’s lift" detail />,
    );
    expect(screen.getByText('how it compares')).toBeInTheDocument();
    expect(screen.getByText('muscle 92 % · weighs 60 %')).toBeInTheDocument();
    expect(screen.getByText('energy 50 % · weighs 40 %')).toBeInTheDocument();
    expect(screen.getByText('also trained: trunk')).toBeInTheDocument();
  });

  it('uses the catalogue’s thresholds for the words', () => {
    expect(verdictBand(0.9)).toBe('full');
    expect(verdictBand(0.89)).toBe('partial');
    expect(verdictBand(0.6)).toBe('partial');
    expect(verdictBand(0.59)).toBe('different');
    expect(equivalenceVerdict(result(0.9), 'x')).toBe('counts as x');
  });

  describe('quiet mode (words only: no digits, no scores)', () => {
    const quietOn = () => act(() => useSettingsStore.getState().set({ quietMode: true }));
    afterEach(() => act(() => useSettingsStore.getState().set({ quietMode: false })));
    const hasDigit = (t: string | null) => /\d/.test(t ?? '');

    it('prints no percentage, scale numerals, ratios or weights, only the verdict', () => {
      quietOn();
      const shortfall = [{ term: 'hyp' as const, missing: 1, text: 'Chest work is short: add 1 set.' }];
      const { container } = render(
        <EquivalenceMeter result={result(0.72, { shortfall })} target="today’s lift" detail />,
      );
      const meter = screen.getByRole('meter', { name: 'same stimulus' });
      expect(hasDigit(container.textContent)).toBe(false);
      expect(hasDigit(meter.getAttribute('aria-valuetext'))).toBe(false);
      expect(meter).not.toHaveAttribute('aria-valuenow');
      expect(meter).not.toHaveAttribute('aria-valuemin');
      expect(screen.getByText('partly — chest work is short: add a set')).toBeInTheDocument();
      expect(screen.getByText('muscle: mostly')).toBeInTheDocument();
      expect(screen.getByText('energy: partly')).toBeInTheDocument();
    });

    it('is digit-free for full credit and different work too', () => {
      quietOn();
      const { container, rerender } = render(
        <EquivalenceMeter result={result(0.95)} target="today’s swing" size="sm" detail />,
      );
      expect(hasDigit(container.textContent)).toBe(false);
      rerender(
        <EquivalenceMeter result={result(0.4, { alsoTrained: ['core'] })} target="today’s run" detail />,
      );
      expect(hasDigit(container.textContent)).toBe(false);
      expect(screen.getByText('different work — credited to trunk')).toBeInTheDocument();
    });

    it('a screen that reveals numbers on request gets them back, and a screen can force quiet', () => {
      quietOn();
      const { container, rerender } = render(
        <EquivalenceQuietProvider quiet={false}>
          <EquivalenceMeter result={result(0.72)} target="x" />
        </EquivalenceQuietProvider>,
      );
      expect(screen.getByRole('img', { name: '72 %' })).toBeInTheDocument();
      act(() => useSettingsStore.getState().set({ quietMode: false }));
      rerender(
        <EquivalenceQuietProvider quiet>
          <EquivalenceMeter result={result(0.72)} target="x" />
        </EquivalenceQuietProvider>,
      );
      expect(hasDigit(container.textContent)).toBe(false);
    });

    it('shows the percentage outside quiet mode', () => {
      render(<EquivalenceMeter result={result(0.72)} target="x" />);
      expect(screen.getByRole('img', { name: '72 %' })).toBeInTheDocument();
    });
  });
});
