import { describe, expect, it } from 'vitest';
import { makeChartData } from '../fixtures';
import { buildTable, tableToCSV } from '../lib/table';

const data = makeChartData({ days: 84 });
const pick = (ids: string[]) => ids.map((id) => data.series.find((s) => s.id === id)!);

describe('table fallback', () => {
  it('lists the visible window at the current resolution', () => {
    const t = buildTable(data.time, pick(['fat_mass', 'ketones']), 7, 14, 'daily', data.intake);
    expect(t.rows).toHaveLength(7);
    expect(t.rows[0]!.label).toBe('Mon 12 Oct · day 8');
    expect(t.columns.map((c) => c.id)).toEqual(['intake', 'maintenance', 'fat_mass', 'ketones']);
    const h = buildTable(data.time, pick(['glucose']), 10, 11, 'hourly');
    expect(h.rows).toHaveLength(24);
    expect(h.rows[18]!.label).toBe('Thu 15 Oct 18:00');
  });
  it('pairs every value with its likely range', () => {
    const t = buildTable(data.time, pick(['fat_mass']), 0, 1, 'daily');
    expect(t.rows[0]!.cells[0]!.text).toMatch(/^\d+\.\d \(\d+\.\d–\d+\.\d\)$/);
  });
  it('writes CSV with value / low / high columns and plain numbers', () => {
    const csv = tableToCSV(buildTable(data.time, pick(['fat_mass', 'met_adaptation']), 0, 2, 'daily', data.intake));
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'time,Intake (kcal),Maintenance (kcal),Fat mass (kg),Fat mass likely low,Fat mass likely high,Metabolic adaptation (kcal/d),Metabolic adaptation likely low,Metabolic adaptation likely high',
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).not.toMatch(/\u2212|\u2009/);
    expect(lines[1]!.split(',')[0]).toBe('Mon 5 Oct · day 1');
  });
  it('escapes commas and quotes', () => {
    const s = { ...pick(['fat_mass'])[0]!, label: 'Fat, "total"' };
    const csv = tableToCSV(buildTable(data.time, [s], 0, 1, 'daily'));
    expect(csv.split('\n')[0]).toContain('"Fat, ""total"" (kg)"');
  });
});
