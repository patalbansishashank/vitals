/**
 * The snapshot contract, pinned by the fixtures both sides read (design/widget-fixtures): what the web publishes is stable
 * under its own sanitiser, quiet mode produces the quiet fixture from it, and the native parser (WidgetSnapshotTest.kt)
 * reads the same two files.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizeSnapshot, WIDGET_SERIES_MAX, type WidgetSnapshot } from '@/platform/widgets';

const fixture = (name: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../../design/widget-fixtures', name), 'utf8')) as WidgetSnapshot;
const numbers = fixture('snapshot-numbers.json');
const quiet = fixture('snapshot-quiet.json');

describe('the shared snapshot fixtures', () => {
  it('the numbers fixture is what the web sends: a fixed point of the sanitiser, weight included with the opt-in', () => {
    expect(sanitizeSnapshot(numbers, { weight: true })).toEqual(numbers);
  });

  it('without the opt-in the same snapshot has no body at all', () => {
    expect(sanitizeSnapshot(numbers).body).toBeUndefined();
  });

  it('quiet mode makes the quiet fixture of it: no energy, no figure, no line or bar; stages, ratios and instants stay', () => {
    expect(sanitizeSnapshot({ ...numbers, quiet: true }, { weight: true })).toEqual(quiet);
  });

  it('the quiet fixture is fixed under the sanitiser too, and carries no digit outside the instants, ratios and stage runs', () => {
    expect(sanitizeSnapshot(quiet, { weight: true })).toEqual(quiet);
    const text: string[] = [];
    const walk = (v: unknown, k: string) => {
      if (['stages', 'series', 'at', 'lastSyncAt', 'ratio', 'v', 'onset', 'wake', 'date'].includes(k)) return;
      if (typeof v === 'string') text.push(v);
      else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
    };
    walk(quiet, '');
    expect(text.length).toBeGreaterThan(8);
    for (const t of text) expect(t, t).not.toMatch(/\d/);
  });

  it('every series in the fixture is at most the longest a widget takes, inside 0..1, and its live index is inside it', () => {
    const series = [numbers.today?.energy?.series, numbers.today?.steps?.series, numbers.ring?.hr?.series, numbers.body?.weight?.series];
    for (const s of series) {
      expect(s).toBeDefined();
      expect(s!.y.length).toBeLessThanOrEqual(WIDGET_SERIES_MAX);
      for (const v of [...s!.y, ...(s!.ahead ?? [])]) if (v !== null) expect(v >= 0 && v <= 1).toBe(true);
      expect(s!.now! >= 0 && s!.now! < s!.y.length).toBe(true);
    }
  });
});
