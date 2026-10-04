/**
 * The evidence behind a warning is shown as topic name and source numbers, each a link into the Evidence library
 * ("Evidence: Safety limits › references 6, 7"). The maintainers' research-note pointer in `src` is never printed.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { SimWarning } from '@/engine';
import { WarningsPanel } from '../components/WarningsPanel';
import { groupWarnings, toWarningItem, type WarningRemedy } from '../lib/warnings';

afterEach(() => cleanup());

const MESSAGE =
  'Your average intake (1100 kcal/day) is below the 1500 kcal/day usually treated as the minimum without professional support. This is a simulation, not advice.';

const warn = (over: Partial<SimWarning> = {}): SimWarning => ({
  id: 'W-E01',
  severity: 'caution',
  startDay: 0,
  endDay: 13,
  peakValue: 1100,
  message: MESSAGE,
  src: '17 §3 [6][7]',
  sources: [{ topic: 'safety-limits', refs: [6, 7], legacy: '17 §3 [6][7]' }],
  ...over,
});

const remedyHref = (r: WarningRemedy) =>
  `/simulate/s1/schedule?days=${r.startDay}-${r.endDay}&fix=${r.ruleId}`;

function mount(warnings: SimWarning[]) {
  return render(
    <MemoryRouter>
      <WarningsPanel
        groups={groupWarnings(warnings)}
        startDate="2026-10-05"
        onShow={() => {}}
        remedyHref={remedyHref}
        returnTo={{ to: '/simulate/s1/results?x=1', label: 'Spring cut results' }}
      />
    </MemoryRouter>,
  );
}

describe('warning evidence', () => {
  it('the panel item carries the structured sources, not the pointer', () => {
    const item = toWarningItem(warn());
    expect(item.sources).toEqual([{ topic: 'safety-limits', refs: [6, 7], legacy: '17 §3 [6][7]' }]);
    expect(toWarningItem(warn({ sources: undefined })).sources).toEqual([]);
  });

  it('renders "Evidence: Safety limits › references 6, 7" with links into the topic and its sources', () => {
    mount([warn()]);
    const row = screen.getByText(MESSAGE).closest('li')!;
    const line = within(row).getByText(/^Evidence:/);
    expect(line.textContent).toBe('Evidence: Safety limits › references 6, 7');
    const topic = within(row).getByRole('link', { name: 'Safety limits' });
    expect(topic.getAttribute('href')).toBe('/evidence/topics/safety-limits');
    const six = within(row).getByRole('link', { name: 'Safety limits, source 6' });
    expect(six.getAttribute('href')).toBe('/evidence/topics/safety-limits#ref-6');
    expect(within(row).getByRole('link', { name: 'Safety limits, source 7' }).textContent).toBe('7');
    // nothing of the research notes reaches the page
    expect(row.textContent).not.toMatch(/§|17 |\[6\]/);
  });

  it('shows the topic alone when the rule cites it as a whole, and nothing when a warning has no sources', () => {
    mount([
      warn({
        id: 'W-U04',
        severity: 'info',
        startDay: 0,
        endDay: 0,
        message: 'Blood-marker curves are model trends.',
        sources: [{ topic: 'safety-limits' }],
      }),
      warn({
        id: 'W-E03',
        startDay: 2,
        endDay: 9,
        message: 'Your deficit is 31% of maintenance.',
        sources: undefined,
      }),
    ]);
    // the always-on note keeps its evidence inside the disclosure
    expect(screen.getByText(/Blood-marker curves are model trends\./).closest('li')!.textContent).toMatch(
      /Evidence: Safety limits$/,
    );
    const row = screen.getByText('Your deficit is 31% of maintenance.').closest('li')!;
    expect(within(row).queryByText(/Evidence:/)).toBeNull();
  });
});
