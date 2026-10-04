import { describe, expect, it } from 'vitest';
import { paths } from '../paths';

describe('paths.signals', () => {
  it('leaves the defaults out of the URL (SUITE_SPEC §15.3)', () => {
    expect(paths.signals()).toBe('/signals');
    expect(paths.signals('sleep', 'day')).toBe('/signals');
    expect(paths.signals('heart')).toBe('/signals?tab=heart');
    expect(paths.signals('activity', 'week', '2026-10-04')).toBe('/signals?tab=activity&period=week&date=2026-10-04');
    expect(paths.signals(undefined, 'month')).toBe('/signals?period=month');
  });

  it('links to the Install section of Settings', () => {
    expect(paths.settings('install')).toBe('/settings#install');
  });
});
