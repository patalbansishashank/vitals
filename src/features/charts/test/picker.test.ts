import { describe, expect, it } from 'vitest';
import { makeChartData } from '../fixtures';
import { capacityText, DEFAULT_LANE_IDS, isOverlayEligible, matchesQuery, pickerGroups, toggleMetric } from '../lib/picker';

const { series } = makeChartData({ days: 84 });
const byId = (id: string) => series.find((s) => s.id === id)!;

describe('metric picker logic', () => {
  it('groups by category in palette order with counts', () => {
    const g = pickerGroups(series, ['fat_mass', 'ketones']);
    expect(g.map((x) => x.category)).toEqual(['body', 'fuel', 'energy', 'cellular', 'hormones', 'cardio', 'performance', 'recovery'].sort((a, b) => ['body', 'fuel', 'energy', 'cellular', 'performance', 'recovery', 'cardio', 'hormones'].indexOf(a) - ['body', 'fuel', 'energy', 'cellular', 'performance', 'recovery', 'cardio', 'hormones'].indexOf(b)));
    expect(g[0]).toMatchObject({ category: 'body', label: 'body composition', selectedCount: 1 });
    expect(g[0]!.total).toBe(8);
  });
  it('searches label, id, unit and category (accent-insensitive, all tokens)', () => {
    expect(matchesQuery(byId('ketones'), 'bhb')).toBe(true);
    expect(matchesQuery(byId('vo2max'), 'VO₂')).toBe(true);
    expect(matchesQuery(byId('ldl'), 'cardio mmol')).toBe(true);
    expect(matchesQuery(byId('ldl'), 'cardio kg')).toBe(false);
    const g = pickerGroups(series, [], { query: 'glycogen' });
    expect(g.flatMap((x) => x.items.map((i) => i.id))).toEqual(['glycogen', 'liver_glycogen', 'muscle_glycogen']);
  });
  it('filters by grade and selection', () => {
    const d = pickerGroups(series, ['fat_mass'], { grades: ['D'] }).flatMap((g) => g.items.map((i) => i.grade));
    expect(new Set(d)).toEqual(new Set(['D']));
    expect(pickerGroups(series, ['fat_mass'], { selectedOnly: true }).flatMap((g) => g.items)).toHaveLength(1);
  });
  it('adds a lane after the last lane of its category', () => {
    const r = toggleMetric(series, ['fat_mass', 'glycogen', 'hunger'], 'lean_mass', 'lanes');
    expect(r.selected).toEqual(['fat_mass', 'lean_mass', 'glycogen', 'hunger']);
    expect(toggleMetric(series, r.selected, 'lean_mass', 'lanes').selected).toEqual(['fat_mass', 'glycogen', 'hunger']);
  });
  it('refuses a 7th overlay metric, a 4th per category, and ineligible metrics', () => {
    const six = ['fat_mass', 'glycogen', 'tdee', 'autophagy', 'hunger', 'ldl'];
    expect(toggleMetric(series, six, 'vo2max', 'overlay').refused).toBe('Overlay shows up to 6 metrics. Switch to Lanes to see more.');
    expect(toggleMetric(series, ['fat_mass', 'lean_mass', 'scale_weight'], 'waist', 'overlay').refused).toMatch(/up to 3 body composition/);
    expect(toggleMetric(series, [], 'ketones', 'overlay').refused).toMatch(/ten-fold/);
    expect(isOverlayEligible(byId('tdee'))).toBe(false);
  });
  it('has the documented default set and capacity copy', () => {
    expect(DEFAULT_LANE_IDS.every((id) => series.some((s) => s.id === id))).toBe(true);
    expect(capacityText(9, 4)).toBe('Lanes: 9 · Overlay: 4 / 6');
  });
});
