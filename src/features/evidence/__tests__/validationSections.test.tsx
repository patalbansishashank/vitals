import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  isPlannerBenchmarks,
  PLANNER_BENCHMARKS_FIXTURE,
  plannerBenchmarksProblems,
} from '@/content/evidence/validation/plannerBenchmarks';
import { ActivityIntakeValidationSection, PlannerBenchmarksSection } from '../components/ValidationSections';

describe('planner benchmarks section', () => {
  it('renders the gate, every suite with its table and a time-to-quality chart', () => {
    render(<PlannerBenchmarksSection report={PLANNER_BENCHMARKS_FIXTURE} />);
    expect(screen.getByRole('heading', { name: 'Planner benchmarks' })).toBeInTheDocument();
    expect(screen.getByText('Passed.')).toBeInTheDocument();
    for (const s of PLANNER_BENCHMARKS_FIXTURE.suites) {
      expect(screen.getByRole('heading', { name: s.label })).toBeInTheDocument();
      const table = screen.getByRole('region', { name: `${s.label}: results by method` });
      expect(within(table).getAllByRole('row')).toHaveLength(1 + s.results.length);
      expect(screen.getByRole('img', { name: new RegExp(`^${s.label}: share of quality targets`) })).toBeInTheDocument();
    }
    expect(screen.getByText(/31 held-out seeds/)).toBeInTheDocument();
  });

  it('says the benchmarks are not published when there is no file, or when it cannot be read', () => {
    const { rerender } = render(<PlannerBenchmarksSection report={null} />);
    expect(screen.getByText('The planner benchmarks are not published yet.')).toBeInTheDocument();
    rerender(<PlannerBenchmarksSection report="invalid" />);
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
  });

  it('checks the shape of a results file', () => {
    expect(plannerBenchmarksProblems(PLANNER_BENCHMARKS_FIXTURE)).toEqual([]);
    expect(isPlannerBenchmarks({ ...PLANNER_BENCHMARKS_FIXTURE, version: 2 })).toBe(false);
    expect(isPlannerBenchmarks({ ...PLANNER_BENCHMARKS_FIXTURE, suites: [] })).toBe(false);
    const badGate = { ...PLANNER_BENCHMARKS_FIXTURE, gate: { ...PLANNER_BENCHMARKS_FIXTURE.gate, candidateId: 'nobody' } };
    expect(plannerBenchmarksProblems(badGate)).toContain('gate malformed');
    expect(isPlannerBenchmarks(JSON.parse(JSON.stringify(PLANNER_BENCHMARKS_FIXTURE)))).toBe(true);
  });
});

describe('activity intake validation section', () => {
  it('renders every check group with its rows and explains the misses', () => {
    render(<ActivityIntakeValidationSection />);
    expect(screen.getByRole('heading', { name: 'Activity intake validation' })).toBeInTheDocument();
    expect(screen.getByText(/\d+ of 56 checks pass/)).toBeInTheDocument();
    expect(screen.getAllByText('known miss').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('open question')).toHaveLength(0); // the mixed-job rows closed with occMixed 0.40 (I1)
    expect(screen.getAllByText(/digesting food/).length).toBeGreaterThan(0);
  });
});
