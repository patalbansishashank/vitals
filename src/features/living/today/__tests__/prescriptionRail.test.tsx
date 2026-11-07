import { fireEvent, screen, within } from '@testing-library/react';
import {
  PrescriptionRows,
  compactPreview,
  quietRowLabel,
  quietRowTarget,
} from '../components/PrescriptionRows';
import { todayRows } from '../model';
import { todayViewFixture, CONTRACT_DATE } from './todayView.fixture';
import { renderLiving } from '../../testing';

const rows = () => todayRows(todayViewFixture());

describe('Today compact rail', () => {
  it('keeps an overdue unanswered meal among the next stops and limits the phone preview', () => {
    const all = rows().map((r) => (r.glyph === 'meal' ? { ...r, status: 'empty' as const } : r));
    expect(compactPreview(all, 18)).toHaveLength(3);
    expect(compactPreview(all, 18)[0]?.id).toBe(all.find((r) => r.glyph === 'meal')?.id);
  });

  it('quiet targets and session labels contain words while plan clocks stay', () => {
    for (const r of rows()) expect(quietRowTarget(r)).not.toMatch(/\d/);
    const session = rows().find((r) => r.glyph === 'session')!;
    expect(quietRowLabel(session, true)).toBe('lift');
    expect(quietRowLabel(session, false)).toBe('lift · 45 min');
    renderLiving(<PrescriptionRows rows={rows()} date={CONTRACT_DATE} readOnly quiet />);
    expect(screen.getByText('17:30')).toBeInTheDocument();
    expect(screen.queryByText(/45 min/)).toBeNull();
    expect(screen.queryByText(/6[ ,]?120/)).toBeNull();
  });

  it('the hero opens the same meal editor without requiring the row in the compact preview', async () => {
    const handled = vi.fn();
    renderLiving(
      <PrescriptionRows
        rows={rows()}
        date={CONTRACT_DATE}
        readOnly={false}
        quiet={false}
        compact
        openRowId="meal:dinner"
        onOpenRowHandled={handled}
      />,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Dinner' });
    expect(within(sheet).getByRole('radio', { name: 'As planned' })).toBeInTheDocument();
    expect(handled).toHaveBeenCalled();
  });

  it('Any time starts folded and opens the editable steps row on the shared rail', () => {
    renderLiving(<PrescriptionRows rows={rows()} date={CONTRACT_DATE} readOnly={false} quiet={false} />);
    expect(screen.queryByRole('button', { name: 'Details for steps' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Any time/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Details for steps' }));
    expect(screen.getByRole('dialog', { name: 'Steps' })).toBeInTheDocument();
  });
});
