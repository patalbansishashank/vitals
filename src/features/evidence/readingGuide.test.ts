/** C6 info sheet: status, range kind, goal capability and warrants for a metric (no operating-screen chatter). */
import { describe, expect, it } from 'vitest';
import { readingGuide, warrantText } from './ExplainDrawer';

describe('readingGuide', () => {
  it('names a research index Exploratory and says it is not a goal', () => {
    const rows = readingGuide('autophagyIdx', null, false);
    expect(rows.find((r) => r.label === 'Status')!.value).toBe('Exploratory');
    expect(rows.find((r) => r.label === 'As a goal')!.value).toBe('Not a goal');
  });

  it('calls a range a parameter-sensitivity range with unvalidated coverage, never a likelihood', () => {
    const rows = readingGuide('fatMass', null, true);
    expect(rows.find((r) => r.label === 'Range')!.value).toMatch(/model variations; coverage not validated/);
    expect(rows.some((r) => r.label === 'Warrant')).toBe(true);
  });

  it('carries the run status and its reason', () => {
    const rows = readingGuide('ldl', { status: 'outOfDomain', reason: 'outside the calibration range' }, false);
    expect(rows[0]).toEqual({ label: 'Status', value: 'Unsupported · outside the calibration range' });
  });

  it('formats a warrant with its confidence and scope', () => {
    expect(warrantText({ type: 'analyticallyTrue', confidence: 'high', scope: 'direction only' })).toBe('Analytically true · high · direction only');
  });
});
