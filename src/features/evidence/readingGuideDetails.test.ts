/**
 * C6 info sheet: the status rows a caller hands the Explain sheet (range basis, model limit, policy and model versions)
 * appear under "How to read it", after the status, the range kind and the goal capability — never on the operating
 * screen. A fixed display range reads as one; a sensitivity range says its coverage is not validated.
 */
import { describe, expect, it } from 'vitest';
import { readingGuide } from './ExplainDrawer';

describe('reading guide details (C6)', () => {
  it('appends the caller’s detail rows in order', () => {
    const rows = readingGuide('fatMass', { status: 'scenario', reason: 'a broad scenario', details: [{ label: 'Range from', value: '16 model variations · coverage not validated' }, { label: 'Model version', value: '1.3.0-policy' }] }, true);
    const labels = rows.map((r) => r.label);
    expect(labels[0]).toBe('Status');
    expect(rows[0]!.value).toBe('Scenario · a broad scenario');
    expect(labels).toContain('Range');
    expect(labels.slice(-2)).toEqual(['Range from', 'Model version']);
  });

  it('names a fixed display range and a sensitivity range for what they are', () => {
    expect(readingGuide(undefined, { uncertaintyKind: 'heuristic' }, true).find((r) => r.label === 'Range')?.value).toBe('Fixed display range');
    expect(readingGuide(undefined, null, true).find((r) => r.label === 'Range')?.value).toMatch(/coverage not validated/);
  });
});
