import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { freshState } from '@/commands/__tests__/harness';
import { readHeadline } from '@/features/evidence/ValidationReportPage';
import { AboutSection } from '../sections';

const report = readFileSync(resolve(__dirname, '../../../../docs/VALIDATION_REPORT.md'), 'utf8');

beforeEach(() => freshState());

describe('About model evidence disclosure', () => {
  it('keeps dated model targets and known misses distinct from software status and accuracy', async () => {
    const headline = readHeadline(report)!;
    expect(headline.modelDate).toBe('19 October 2026');
    expect(headline.met + headline.known).toBe(headline.mustPass);
    render(<MemoryRouter><AboutSection /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Model evidence report\s*Open/ })).toHaveAttribute('href', '/evidence/validation');
    const summary = await screen.findByText(/Model snapshot: 19 October 2026/);
    expect(summary).toHaveTextContent(`${headline.met} of ${headline.mustPass} model targets met; ${headline.known} known misses.`);
    expect(summary).toHaveTextContent('not software test status or prediction accuracy');
    expect(summary).toHaveTextContent('missing independent evaluations');
  });

  it('does not invent a snapshot date or counts when the report format changes', () => {
    expect(readHeadline('A report without supported result rows.')).toBeNull();
    expect(readHeadline('**4 of 7 met**; 3 known misses')).toMatchObject({
      met: 4, mustPass: 7, known: 3, modelDate: null,
    });
  });
});
