import { render, screen } from '@testing-library/react';
import type { EquivalenceResult } from '@/catalogues';
import { EquivalenceMeter, equivalenceVerdict, verdictBand } from '../../components/EquivalenceMeter';

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
    expect(screen.getByText('95 %')).toBeInTheDocument();
  });

  it('says "partly" at 0.75, with the catalogue’s fix or "add 1 set"', () => {
    const { rerender } = render(<EquivalenceMeter result={result(0.75, { shortfall: [{ term: 'hyp', missing: 1, text: 'Chest work is short: add 1 set.' }] })} target="today’s lift" />);
    expect(screen.getByText('partly — chest work is short: add 1 set')).toBeInTheDocument();
    rerender(<EquivalenceMeter result={result(0.75)} target="today’s lift" />);
    expect(screen.getByText('partly — add 1 set')).toBeInTheDocument();
  });

  it('says "different work" at 0.40, credited to the regions it trained or its strongest term', () => {
    const { rerender } = render(<EquivalenceMeter result={result(0.4, { alsoTrained: ['shoulders', 'upperBack'] })} target="today’s run" />);
    expect(screen.getByText('different work — credited to shoulders and upper back')).toBeInTheDocument();
    rerender(<EquivalenceMeter result={result(0.4, { perTerm: [{ term: 'card', ratio: 0.2, weight: 0.5 }, { term: 'kcal', ratio: 0.7, weight: 0.5 }] })} target="today’s run" />);
    expect(screen.getByText('different work — credited to energy')).toBeInTheDocument();
  });

  it('prints ticks and numerals at 0, 60, 90 and 100 and an ink tick at the score', () => {
    const { container } = render(<EquivalenceMeter result={result(0.72)} target="today’s lift" size="sm" />);
    const numerals = [...container.querySelectorAll('text[data-numeral]')].map((t) => t.textContent);
    expect(numerals).toEqual(['0', '60', '90', '100']);
    const majors = [...container.querySelectorAll('line[data-major="true"]')].map((l) => l.getAttribute('data-tick'));
    expect(majors).toEqual(['0', '60', '90', '100']);
    expect(container.querySelector('rect[data-score]')).toHaveAttribute('data-score', '72');
    // numerals stay at least 11 px
    for (const t of container.querySelectorAll('text[data-numeral]')) expect(Number(t.getAttribute('font-size'))).toBeGreaterThanOrEqual(11);
  });

  it('shows per-term ratios with their weights and "also trained" in the detail', () => {
    render(<EquivalenceMeter result={result(0.92, { alsoTrained: ['core'] })} target="today’s lift" detail />);
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
});
