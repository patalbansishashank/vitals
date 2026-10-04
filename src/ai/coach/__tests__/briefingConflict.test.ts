import { describe, expect, it } from 'vitest';
import { projectEntries, projectLiving, type LogEntry, type MeasurementEntry } from '@/living';
import { buildBriefing } from '../briefing';

const date = '2026-10-04';
const now = `${date}T12:00:00.000Z`;
const original: LogEntry = { id: 'original', kind: 'note', date, tz: 'UTC', at: now, text: 'Original note', source: { by: 'user', method: 'typed' } };
const entries: LogEntry[] = [
  original,
  { ...original, id: 'version-a', supersedes: original.id, text: 'First edit' },
  { ...original, id: 'version-b', supersedes: original.id, text: 'Second edit' },
];

describe('conflicts in the Coach and MCP briefing', () => {
  it.each([false, true])('keeps one flagged entry and asks the person to choose (quiet=%s)', (quietMode) => {
    const todayView = projectLiving({
      docs: { plan: null, versions: [], dayStatus: [], entries, measurements: [], records: [], settings: { quietMode } },
      today: date, tz: 'UTC', now,
    }).today;
    const briefing = buildBriefing({ now, today: date, todayView, recentLog: projectEntries(entries).map((entry) => ({ ...entry })) });
    expect(todayView.logged.entries).toHaveLength(1);
    expect(briefing.text).toContain('note (2 versions; counted once)');
    expect(briefing.text).toContain('Ask the person which version to keep.');
    expect(briefing.text).toContain('2 versions; unresolved edit, counted once');
    expect(briefing.text).not.toContain('First edit');
    expect(briefing.visible.today?.logged.entries[0]?.conflict?.versions).toHaveLength(2);
  });

  it('also flags a measurement fork in today and the briefing', () => {
    const measurement: MeasurementEntry = { id: 'reading', date, at: now, metric: 'weightKg', value: 70, source: { by: 'user', method: 'typed' } };
    const todayView = projectLiving({
      docs: {
        plan: null, versions: [], dayStatus: [], entries: [], records: [],
        measurements: [measurement, { ...measurement, id: 'reading-a', supersedes: measurement.id, value: 71 }, { ...measurement, id: 'reading-b', supersedes: measurement.id, value: 72 }],
      },
      today: date, tz: 'UTC', now,
    }).today;
    expect(todayView.logged.measurements).toHaveLength(1);
    expect(todayView.logged.measurements?.[0]?.conflict?.versions).toHaveLength(2);
    expect(buildBriefing({ now, today: date, todayView }).text).toContain('measurement (2 versions; counted once)');
  });
});
