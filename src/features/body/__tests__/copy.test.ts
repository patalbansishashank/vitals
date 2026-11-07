/**
 * The (i) panels of Your body (r071 definition of done): each card says in 25 to 60 words what used to be subtext, names
 * where it comes from and states its range (or that there is none); the two start options say their one sentence. No panel
 * speaks in numbers it could not know: they explain, they do not read.
 */
import type { InfoSpec } from '@/components';
import { INFO, SETUP } from '../copy';

const words = (t: string) => t.trim().split(/\s+/).length;
const all = Object.entries(INFO) as Array<[string, InfoSpec]>;
const cards = all.filter(([k]) => k !== 'plan' && k !== 'simulate');

describe('Your body (i) panels', () => {
  it.each(cards)('%s: 25 to 60 words, a named source and a stated range', (_name, info) => {
    const body = typeof info.body === 'string' ? info.body : '';
    expect(words(body)).toBeGreaterThanOrEqual(25);
    expect(words(body)).toBeLessThanOrEqual(60);
    expect(info.source?.kind).toBeTruthy();
    expect(info.source?.words?.length ?? 0).toBeGreaterThan(8);
    expect(String(info.range ?? '').length).toBeGreaterThan(5);
  });

  it('covers the eight cards: the figure, estimates, shape, basics, maintenance, habits and lab values, and the start options', () => {
    expect(Object.keys(INFO).sort()).toEqual(['basics', 'estimates', 'figure', 'habits', 'labs', 'maintenance', 'plan', 'shape', 'simulate']);
  });

  it('the start options carry their own sentences, unchanged', () => {
    expect(INFO.plan.body).toBe(SETUP.planLine);
    expect(INFO.simulate.body).toBe(SETUP.simulateLine);
  });

  it('uses "range", never a promise: nothing says "guaranteed", "accurate" or "exactly"', () => {
    for (const [, info] of cards) expect(`${info.body} ${info.range}`).not.toMatch(/guarantee|accurate|exactly|diagnos/i);
  });

  it('the evidence links are routes of the evidence library', () => {
    for (const [, info] of all) {
      const list = info.evidence ? (Array.isArray(info.evidence) ? info.evidence : [info.evidence]) : [];
      for (const e of list) expect(e.to).toMatch(/^\/evidence\/topics\/[a-z-]+$/);
    }
  });
});
