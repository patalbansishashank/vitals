import { describe, expect, it } from 'vitest';
import { DEV, streamName } from './copy';

const base = { records: 10, samples: 47, duplicates: 0 };

describe('import result wording', () => {
  it('shows the range like the rest of the app, not as ISO dates', () => {
    const t = DEV.imported({ ...base, days: { from: '2026-09-29', to: '2026-10-01' } }, 'day-month');
    expect(t).toContain('29 Sep – 1 Oct');
    expect(t).not.toMatch(/2026|-10-|\bto\b/);
  });
  it('follows the month-first date style and collapses a single day', () => {
    expect(DEV.imported({ ...base, days: { from: '2026-09-29', to: '2026-10-01' } }, 'month-day')).toContain('Sep 29 – Oct 1');
    expect(DEV.imported({ ...base, days: { from: '2026-09-29', to: '2026-09-29' } }, 'day-month')).toMatch(/^29 Sep: /);
  });
  it('uses plain words for the counts', () => {
    const t = DEV.imported({ records: 1, samples: 1, duplicates: 3, days: null });
    expect(t).not.toMatch(/samples|duplicates/);
    expect(t).toContain('1 record');
    expect(t).toContain('1 reading');
    expect(t).toContain('3 were already here');
    expect(DEV.imported({ ...base, days: null })).toContain('10 records, 47 readings');
  });
});

describe('stream names', () => {
  it('never shows a raw metric id for the ring app\'s own scores', () => {
    expect(streamName('vendor:bp_sys_estimate')).toBe('vendor: blood pressure estimate (upper)');
    expect(streamName('vendor:vascular_age')).toBe('vendor: vascular age');
    expect(streamName('vendor:some_new_score')).toBe('vendor: some new score');
    expect(streamName('skin_temp')).toBe('skin temperature');
  });
});
