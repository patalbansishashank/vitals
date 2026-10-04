// @vitest-environment node
/**
 * Review pass 1 (markers): note texts never show a raw research placeholder ("{date+12w}") on screen, and the shipped
 * marker and kitchen text names no internal references.
 */
import { describe, expect, it } from 'vitest';
import { KITCHEN_SEED } from '@/content/catalogues/kitchen';
import { report, scan, strings } from '@/content/evidence/__tests__/leakScan';
import { migrateProfileLabs, readingFromInput } from '../doc';
import { evaluateMarkers } from '../rules';
import { TABLE } from '../table';
import { GROUP_LABEL, MARKER_UNITS } from '../units';
import { emptyMarkersDoc, type MarkerReadingInput, type MarkersDoc, type RuleContext } from '../types';

const TODAY = '2026-10-02';
const DATE = '2026-09-14';

const doc = (inputs: MarkerReadingInput[]): MarkersDoc => ({
  _schema: 1,
  readings: inputs.map((i) => readingFromInput(i, 'manual', `${DATE}T09:00:00Z`)),
  displayOnly: [],
  context: {},
  chapter: 'manual',
});
const ctx: RuleContext = { sex: 'male', today: TODAY, defaultDeficitCapPct: 25 };

describe('retest dates in note texts', () => {
  it('fills {date+Nw} and {date+Nm} from the reading date', () => {
    const ev = evaluateMarkers(
      doc([
        { id: 'alt', value: 60, unit: 'U/L', date: DATE },
        { id: 'ggt', value: 120, unit: 'U/L', date: DATE, labRange: { high: 55, unit: 'U/L' } },
        { id: 'egfr', value: 50, unit: 'mL/min/1.73 m²', date: DATE },
      ]),
      ctx,
    );
    const text = (id: string): string | undefined => ev.notes.find((n) => n.rule === id)?.text;
    expect(text('W-L-ALT-7')).toBe('Retest ALT around 7 Dec 2026 to see whether the plan is helping. Avoid hard lifting for 7 days before.');
    expect(text('W-L-GGT-3')).toContain('Retest GGT around 26 Oct 2026.');
    expect(text('W-L-EGFR-3')).toContain('Retest around 14 Dec 2026,');
    for (const n of ev.notes) expect(n.text, n.rule).not.toMatch(/\{[^}]*\}/);
  });

  it('every placeholder in the table is one the note builder fills', () => {
    const known = /^\{(v|value|date|cap|uln|old|d1|d2|start|date\+\d+[wm])\}$/;
    for (const r of TABLE.rules) for (const m of r.message.match(/\{[^}]*\}/g) ?? []) expect(m, r.id).toMatch(known);
  });
});

describe('profile labs migration', () => {
  it('dates the migrated reading on the local day of the update, not the UTC day', () => {
    const at = (tz: string) => migrateProfileLabs(emptyMarkersDoc(), { ldlMmolL: 3.1 } as never, '2026-03-01T22:30:00Z', tz).readings[0]!.date;
    expect(at('Asia/Kolkata')).toBe('2026-03-02');
    expect(at('UTC')).toBe('2026-03-01');
  });
});

describe('HOMA-IR note', () => {
  it('shows the HOMA-IR computed from glucose and insulin, not the insulin value', () => {
    // 5.0 mmol/L × 12 µU/mL / 22.5 = 2.67
    const ev = evaluateMarkers(
      doc([
        { id: 'fpg', value: 90, unit: 'mg/dL', date: DATE },
        { id: 'insulin', value: 12, unit: 'µU/mL', date: DATE },
      ]),
      ctx,
    );
    const text = ev.notes.find((n) => n.rule === 'W-L-INS-1')?.text;
    expect(text).toMatch(/^Because your HOMA-IR was 2\.\d+ on 14 Sep 2026/);
    expect(text).not.toContain('was 12 ');
  });
});

describe('shipped marker and kitchen text', () => {
  it('names no internal references (rule messages, unit labels, kitchen catalogue)', () => {
    const rows: Array<[string, string]> = [];
    for (const r of TABLE.rules) rows.push([r.id, r.message]);
    strings(MARKER_UNITS, 'units', rows);
    strings(GROUP_LABEL, 'groups', rows);
    strings(KITCHEN_SEED, 'kitchen', rows, new Set(['id', 'sources', 'foodRef', 'notes']));
    expect(rows.length).toBeGreaterThan(1000);
    const hits = scan(rows);
    expect(hits, report(hits)).toEqual([]);
    const ids = rows.filter(([, t]) => /\b(W-L-|HC-[A-Z]|R1\d\b|\[S\d+\]|plan\/)/.test(t)).map(([p, t]) => `${p}: ${t.slice(0, 80)}`);
    expect(ids).toEqual([]);
  });
});
