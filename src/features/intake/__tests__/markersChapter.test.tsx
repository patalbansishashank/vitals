/** Blood-markers chapter (design intake-v3 §8): statements, skip, typed table, review table, a11y names. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkersView } from '@/markers';
import { emptyMarkersDoc } from '@/markers';
import { M } from '../chapters/markers';
import { DEMO_EXTRACTION } from '../chapters/markersDemo';
import { MarkersEntry } from '../chapters/markersEntry';
import { MarkersReceipt } from '../chapters/markersReceipt';
import { ReviewTable } from '../chapters/markersReview';
import { MarkersTable } from '../chapters/markersTable';

const api = vi.hoisted(() => ({
  setMarkers: vi.fn(),
  confirmExtraction: vi.fn(),
}));
vi.mock('../chapters/markersApi', async (orig) => ({ ...(await orig<object>()), setMarkers: api.setMarkers, confirmExtraction: api.confirmExtraction }));

const VIEW: MarkersView = { doc: { ...emptyMarkersDoc(), chapter: 'manual' }, current: [], notes: [] };

beforeEach(() => {
  api.setMarkers.mockReset().mockResolvedValue({ ok: true, value: VIEW });
  api.confirmExtraction.mockReset().mockResolvedValue({ ok: true, value: VIEW });
});

const FORBIDDEN = /§|R13|dossier|W-L|MODEL_SPEC/;

describe('B0 entry', () => {
  it('shows both statements verbatim before any choice, and records the choice', () => {
    const onChoose = vi.fn();
    const { container } = render(<MarkersEntry onChoose={onChoose} />);
    expect(screen.getByText(M.statement1)).toBeInTheDocument();
    expect(screen.getByText(M.statement2)).toBeInTheDocument();
    expect(M.statement1).toBe('This is the most detailed option; many values are involved.');
    expect(M.statement2).toBe('Vitals is not medical advice; it does not diagnose or treat.');
    // the statements come before the answer keys in reading order
    const text = container.textContent ?? '';
    expect(text.indexOf(M.statement2)).toBeLessThan(text.indexOf(M.has.options.skip));
    const group = screen.getByRole('group', { name: M.has.prompt });
    expect(within(group).getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed')).map((b) => b.textContent)).toEqual([M.has.options.skip, M.has.options.manual, expect.stringContaining(M.has.options.report)]);
    expect(screen.getByText(`if you skip: ${M.has.skipText}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: M.has.options.skip }));
    expect(onChoose).toHaveBeenCalledWith('skip');
    expect(text).not.toMatch(FORBIDDEN);
  });
});

describe('B1 typed table', () => {
  const value = (label: string) => screen.getByRole('spinbutton', { name: M.table.value(label) }) as HTMLInputElement;
  const valueBox = (label: string) => screen.getByLabelText(M.table.value(label)) as HTMLInputElement;

  it('save is disabled at zero with the reason', () => {
    render(<MarkersTable onSaved={vi.fn()} today="2026-10-02" />);
    expect(screen.getByRole('button', { name: 'Save 0 values' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByText(M.table.saveNone).length).toBeGreaterThan(0);
    expect(() => value('LDL cholesterol')).toThrow(); // a text field, not a spinbutton
  });

  it('converts on a unit switch and shows the canonical value', () => {
    render(<MarkersTable onSaved={vi.fn()} today="2026-10-02" />);
    const ldl = valueBox('LDL cholesterol');
    fireEvent.change(ldl, { target: { value: '192' } });
    fireEvent.blur(ldl);
    expect(screen.getByText(/^= 4\.97 mmol\/L$/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(M.table.unit('LDL cholesterol')), { target: { value: 'mmol/L' } });
    expect(valueBox('LDL cholesterol').value).toBe('4.965');
    // Lp(a) re-labels, never converts
    fireEvent.change(valueBox('Lp(a)'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText(M.table.unit('Lp(a)')), { target: { value: 'nmol/L' } });
    expect(valueBox('Lp(a)').value).toBe('60');
    expect(screen.getByText(M.table.noConvert)).toBeInTheDocument();
  });

  it('blocks implausible values, asks on unusual ones, and saves only entered rows', async () => {
    const onSaved = vi.fn();
    render(<MarkersTable onSaved={onSaved} today="2026-10-02" />);
    const tg = valueBox('triglycerides');
    fireEvent.change(tg, { target: { value: '9000' } });
    fireEvent.blur(tg);
    expect(tg).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/^Vitals accepts .* for triglycerides\. Check the unit\.$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Save 0 values/ })).toHaveAttribute('aria-disabled', 'true');

    fireEvent.change(tg, { target: { value: '' } });
    const ldl = valueBox('LDL cholesterol');
    fireEvent.change(ldl, { target: { value: '400' } }); // above the soft bound: asks
    fireEvent.blur(ldl);
    expect(screen.getByText('Is 400 mg/dL right?')).toBeInTheDocument();
    expect(screen.getAllByText(M.table.saveAsk).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: M.table.askYes }));

    const hdl = valueBox('HDL cholesterol');
    fireEvent.change(hdl, { target: { value: '41' } });
    fireEvent.change(screen.getByLabelText(M.table.low('HDL cholesterol')), { target: { value: '45' } });
    expect(screen.getAllByText('below range').length).toBeGreaterThan(0);

    const save = screen.getByRole('button', { name: 'Save 2 values' });
    expect(save).not.toHaveAttribute('aria-disabled');
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const input = api.setMarkers.mock.calls[0]![0];
    expect(input.chapter).toBe('manual');
    expect(input.readings).toEqual([
      { id: 'ldl', value: 400, unit: 'mg/dL', date: '2026-10-02' },
      { id: 'hdl', value: 41, unit: 'mg/dL', date: '2026-10-02', labRange: { low: 45, unit: 'mg/dL' } },
    ]);
  });

  it('groups: lipids open, the rest collapsed with a count', () => {
    render(<MarkersTable onSaved={vi.fn()} today="2026-10-02" />);
    expect(screen.getByRole('button', { name: /^lipids · 0 of 6 entered$/ })).toHaveAttribute('aria-expanded', 'true');
    const sugar = screen.getByRole('button', { name: /^sugar · 0 of 3 entered$/ });
    expect(sugar).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(sugar);
    expect(sugar).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('radiogroup', { name: M.table.fastingLabel('sugar') })).toBeInTheDocument();
  });
});

describe('B2 review table', () => {
  const renderReview = (onSaved = vi.fn()) => render(<ReviewTable extraction={DEMO_EXTRACTION} attachmentId="demo" today="2026-10-02" onSaved={onSaved} onBack={vi.fn()} />);
  const boxes = () => screen.getAllByRole('checkbox') as HTMLInputElement[];

  it('every row starts unticked; tick-all ticks only high rows; calculated rows are not confirmable', async () => {
    const onSaved = vi.fn();
    renderReview(onSaved);
    // five planned-on rows; the two calculated ones are only listed
    expect(boxes()).toHaveLength(5);
    expect(boxes().every((b) => !b.checked)).toBe(true);
    expect(screen.queryByRole('checkbox', { name: /non-HDL/ })).toBeNull();
    expect(screen.getByText(M.report2.shownNotUsed(5))).toBeInTheDocument();
    expect(screen.getByText(M.report2.notInReport('fasting glucose'))).toBeInTheDocument();
    expect(screen.getByText('"pq" read as pg; check this value', { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: M.report2.tickHigh(3) }));
    const ticked = boxes().filter((b) => b.checked).map((b) => b.getAttribute('aria-label'));
    expect(ticked).toEqual(['Use LDL cholesterol, 192 mg/dL', 'Use HDL cholesterol, 41 mg/dL', 'Use triglycerides, 168 mg/dL']);
    // the low-confidence row with an unknown unit cannot be ticked until edited
    expect(screen.getByRole('checkbox', { name: /vitamin B12/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /triglycerides/ })); // untick one
    fireEvent.click(screen.getByRole('button', { name: M.report2.save(2) }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const input = api.confirmExtraction.mock.calls[0]![0];
    expect(input.extractionId).toBe('demo-extraction');
    expect(input.accept).toEqual([
      { row: 0, date: '2026-09-14' },
      { row: 1, date: '2026-09-14' },
    ]);
  });

  it('save is disabled until something is ticked; edit fixes a row', async () => {
    renderReview();
    expect(screen.getByRole('button', { name: M.report2.save(0) })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: M.report2.editLabel('vitamin B12') }));
    fireEvent.change(screen.getByLabelText(M.table.unit('vitamin B12')), { target: { value: 'pg/mL' } });
    const b12 = screen.getByRole('checkbox', { name: /vitamin B12/ });
    expect(b12).not.toBeDisabled();
    fireEvent.click(b12);
    fireEvent.click(screen.getByRole('button', { name: M.report2.save(1) }));
    await waitFor(() => expect(api.confirmExtraction).toHaveBeenCalled());
    expect(api.confirmExtraction.mock.calls[0]![0].accept).toEqual([{ row: 4, unit: 'pg/mL', date: '2026-09-14' }]);
  });
});

describe('receipt', () => {
  it('lists saved groups and a doctor line as a caution, never a block', () => {
    const doc = {
      ...emptyMarkersDoc(),
      chapter: 'manual' as const,
      readings: [
        { id: 'ldl' as const, value: 192, unit: 'mg/dL', valueCanonical: 4.97, unitCanonical: 'mmol/L', date: '2026-09-14', provenance: 'manual' as const, confirmed: true, enteredAt: '2026-10-02T10:00:00Z' },
        { id: 'hdl' as const, value: 41, unit: 'mg/dL', valueCanonical: 1.06, unitCanonical: 'mmol/L', date: '2026-09-14', provenance: 'manual' as const, confirmed: true, enteredAt: '2026-10-02T10:00:00Z' },
      ],
    };
    const because = { markerId: 'ldl' as const, label: 'LDL cholesterol', value: 192, unit: 'mg/dL', date: '2026-09-14' };
    const notes = [
      { rule: 'W-L-LDL-1' as const, markerId: 'ldl' as const, kind: 'cap' as const, severity: 'caution' as const, because, levers: [], text: 'Saturated fat stays under 7 % of energy.', grade: 'A' as const, sources: [] },
      { rule: 'W-L-LDL-C1' as const, markerId: 'ldl' as const, kind: 'clinician' as const, severity: 'danger' as const, because, levers: [], text: 'See a doctor.', grade: 'A' as const, sources: [] },
    ];
    const { container } = render(
      <MemoryRouter>
        <MarkersReceipt doc={doc} notes={notes} onChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText('lipids · LDL 192, HDL 41 mg/dL · 14 Sep 2026')).toBeInTheDocument();
    expect(screen.getByText(M.receipt.clinician('LDL cholesterol'))).toBeInTheDocument();
    expect(screen.getByText('Saturated fat stays under 7 % of energy.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /because your LDL cholesterol was 192 mg\/dL on 14 Sep 2026/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^Change: lipids/ })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(FORBIDDEN);
  });
});
