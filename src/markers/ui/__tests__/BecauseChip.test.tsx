import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { markerEvidenceHref } from '@/features/evidence/links';
import { BecauseChip, BecauseChips, dedupeByReading } from '../BecauseChip';
import { MarkerBanner, sortNotes } from '../MarkerBanner';
import { DANGER_NOTE, LDL_NOTE, OLD_NOTE } from './fixtures';

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('BecauseChip', () => {
  it('full form names the reading with the entered unit and the date', () => {
    wrap(<BecauseChip note={LDL_NOTE} form="full" today="2026-10-02" />);
    const chip = screen.getByRole('button', { name: 'because your LDL cholesterol was 192 mg/dL on 14 Sep 2026' });
    expect(chip.textContent).toBe('because your LDL cholesterol was 192 mg/dL on 14 Sep 2026');
    expect(chip.getAttribute('data-form')).toBe('full');
  });

  it('short form under 280 px keeps the full sentence as its name', () => {
    wrap(<BecauseChip note={LDL_NOTE} form="short" />);
    const chip = screen.getByRole('button', { name: /because your LDL cholesterol was 192/ });
    expect(chip.textContent).toBe('because LDL 192 · 14 Sep');
  });

  it('container form carries both forms for the host container query (the receipt at 390 px shows the short one)', () => {
    wrap(<BecauseChip note={LDL_NOTE} form="container" />);
    const chip = screen.getByRole('button', { name: 'because your LDL cholesterol was 192 mg/dL on 14 Sep 2026' });
    expect(chip.getAttribute('data-form')).toBe('container');
    expect(chip.querySelector('.lm-because__full')?.textContent).toBe('because your LDL cholesterol was 192 mg/dL on 14 Sep 2026');
    expect(chip.querySelector('.lm-because__short')?.textContent).toBe('because LDL 192 · 14 Sep');
    expect(chip.getAttribute('title')).toBe('because your LDL cholesterol was 192 mg/dL on 14 Sep 2026');
  });

  it('month-day date style', () => {
    wrap(<BecauseChip note={LDL_NOTE} form="full" dateStyle="month-day" />);
    expect(screen.getByRole('button').textContent).toBe('because your LDL cholesterol was 192 mg/dL on Sep 14, 2026');
  });

  it('older than 12 months adds "· old result" in ink-2', () => {
    wrap(<BecauseChip note={OLD_NOTE} form="full" today="2026-10-02" />);
    const chip = screen.getByRole('button');
    expect(chip.textContent).toMatch(/on 1 Aug 2025 · old result$/);
    expect(chip.querySelector('.lm-because__old')?.textContent).toBe(' · old result');
  });

  it('opens a popover with the rule, the grade, the retest date and the two links', () => {
    wrap(<BecauseChip note={LDL_NOTE} form="full" />);
    act(() => fireEvent.click(screen.getByRole('button')));
    const pop = screen.getByRole('dialog');
    expect(pop.textContent).toContain(LDL_NOTE.text);
    expect(pop.querySelector('.lm-grade')?.getAttribute('data-grade')).toBe('B');
    expect(pop.textContent).toContain('retest due 14 Dec 2026');
    expect(screen.getByRole('link', { name: 'Why' }).getAttribute('href')).toBe(markerEvidenceHref('ldl'));
    expect(markerEvidenceHref('ldl')).toMatch(/^\/evidence\//);
    expect(screen.getByRole('link', { name: 'Edit value' }).getAttribute('href')).toBe('/onboarding/markers?edit=ldl#marker-ldl');
    for (const bad of ['W-L', 'R13', '§', 'dossier']) expect(pop.textContent).not.toContain(bad);
  });

  it('shows two chips per row, then "+n more"', () => {
    const third = { ...DANGER_NOTE, rule: 'W-L-HB-1' as const, markerId: 'hb' as const, because: { ...DANGER_NOTE.because, markerId: 'hb' as const, label: 'Haemoglobin', unit: 'g/dL', value: 11 } };
    wrap(<BecauseChips notes={[LDL_NOTE, DANGER_NOTE, third]} form="short" />);
    expect(screen.getAllByRole('button', { name: /^because/ })).toHaveLength(2);
    act(() => fireEvent.click(screen.getByRole('button', { name: '+1 more' })));
    expect(screen.getAllByRole('button', { name: /^because/ })).toHaveLength(3);
  });

  it('one chip per reading', () => {
    expect(dedupeByReading([LDL_NOTE, { ...LDL_NOTE, rule: 'W-L-LDL-9' }])).toHaveLength(1);
  });
});

describe('MarkerBanner', () => {
  it('renders nothing without notes', () => {
    const { container } = wrap(<MarkerBanner notes={[]} />);
    expect(container.textContent).toBe('');
  });

  it('lists the active notes, clinician first, each with its chip, and says nothing is banned', () => {
    wrap(<MarkerBanner notes={[LDL_NOTE, DANGER_NOTE]} today="2026-10-02" />);
    const region = screen.getByRole('region', { name: 'From your blood test' });
    const items = region.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]!.getAttribute('data-severity')).toBe('danger');
    expect(items[0]!.textContent).toContain('see a clinician');
    expect(region.textContent).toContain('Nothing is banned outright');
    expect(screen.getByRole('button', { name: /because your LDL cholesterol was 192 mg\/dL/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Re-enter values' }).getAttribute('href')).toBe('/onboarding/markers');
    expect(sortNotes([LDL_NOTE, DANGER_NOTE])[0]).toBe(DANGER_NOTE);
  });

  it('folds notes past the limit under "Show all"', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...LDL_NOTE, rule: `W-L-LDL-${i}` as const }));
    wrap(<MarkerBanner notes={many} max={4} />);
    expect(screen.getByText('Show all 6')).toBeTruthy();
  });
});
