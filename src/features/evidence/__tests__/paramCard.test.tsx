import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { findParam } from '@/content/evidence/params';
import { paramEvidence } from '@/content/evidence/paramEvidence';
import type { Mechanism } from '@/content/evidence/schema';
import type { ParamDef } from '@/engine/types/params';
import { ParamCard, ParamCards } from '../components/ParamCard';

const def = (over: Partial<ParamDef>): ParamDef => ({
  id: 'test.k',
  value: 1,
  unit: 'kcal/kg/h',
  low: 0.9,
  high: 1.1,
  grade: 'C',
  source: 'Hall 2011 PMID 21872751',
  dossier: '01 §4',
  label: 'Test coefficient',
  ...over,
});

const MECH = { id: '22-test', title: 'Work energy above sitting', relatedParamIds: ['activityIntake.occMixed', 'nope.missing'] } as Mechanism;

describe('parameter evidence labels', () => {
  it('certainty is the grade; the mechanism label exists only when a mechanism documents the parameter', () => {
    expect(paramEvidence(def({})).mechanism).toBeUndefined();
    const ev = paramEvidence(def({}), [MECH]);
    expect(ev.mechanism).toEqual({ known: true, pathway: 'Work energy above sitting', route: 'modelled' });
    expect(ev.certainty).toBe('C');
  });

  it('widens a narrow band to the grade floor and never moves the centre; a fixed value gets a band at the floor', () => {
    const narrow = paramEvidence(def({ grade: 'D' })).inflation;
    expect(narrow.k).toBeGreaterThan(1);
    expect(1 - narrow.low).toBeCloseTo(narrow.high - 1, 10);
    const wide = paramEvidence(def({ low: 0.2, high: 3, grade: 'A' })).inflation;
    expect(wide.k).toBe(1);
    const fixed = paramEvidence(def({ low: 1, high: 1 })).inflation;
    expect(fixed.k).toBeNull();
    expect(fixed.low).toBeLessThan(1);
  });
});

describe('ParamCard', () => {
  it('shows value, range, both labels, the inflation and the sources without the maintainers’ pointer', () => {
    render(<ParamCard def={def({ grade: 'D' })} documentedBy={[MECH]} />);
    const card = screen.getByRole('article', { name: 'Test coefficient' });
    expect(card).toHaveTextContent('1 kcal/kg/h');
    expect(card).toHaveTextContent('plausible range 0.9–1.1 kcal/kg/h');
    expect(card).toHaveTextContent('known, modelled: Work energy above sitting');
    expect(card).toHaveTextContent('Grade D');
    expect(card).toHaveTextContent(/band widened ×\d\.\d\d for grade D/);
    expect(card).toHaveTextContent('Body-weight models › Hall 2011');
    expect(card.textContent).not.toMatch(/§|01 /);
  });

  it('writes a dimensionless unit with a note as the note alone, never as a bare "1"', () => {
    render(<ParamCard def={def({ value: 0.005, low: 0.004, high: 0.008, unit: '1 (fraction of body mass)' })} />);
    const card = screen.getByRole('article', { name: 'Test coefficient' });
    expect(card).toHaveTextContent('0.005 fraction of body mass');
    expect(card).toHaveTextContent('plausible range 0.004–0.008 fraction of body mass');
    expect(card.textContent).not.toMatch(/\b1 \(/);
  });

  it('renders the cards of a mechanism’s linked parameters and skips unknown ids', () => {
    render(<ParamCards mechanism={MECH} />);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', { name: findParam('activityIntake.occMixed')!.label! })).toBeInTheDocument();
  });
});
