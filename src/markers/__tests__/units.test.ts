// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MGDL_PER_MMOLL_CHOL, MGDL_PER_MMOLL_GLC, MGDL_PER_MMOLL_TG } from '@/engine/model/cardiometabolic/baselines';
import { becauseText, fillMessage, formatMarkerDate } from '../because';
import { labBaselinesFrom, labBaselinesWithDates, withMarkerLabs } from '../baselines';
import { currentReadings, isStale, migrateProfileLabs, readingFromInput, removeReading, upsertReadings } from '../doc';
import { MARKER_IDS, emptyMarkersDoc, type MarkerId } from '../types';
import { MARKER_UNITS, checkBounds, convert, fromCanonical, normaliseUnit, toCanonical, unitsOf } from '../units';

describe('units (§13.5.1)', () => {
  it('every marker has a canonical unit among its accepted units and sane bounds', () => {
    for (const id of MARKER_IDS) {
      const s = MARKER_UNITS[id];
      expect(unitsOf(id)).toContain(s.canonical);
      expect(s.plausible[0]).toBeLessThanOrEqual(s.soft[0]);
      expect(s.plausible[1]).toBeGreaterThanOrEqual(s.soft[1]);
    }
  });

  it('uses the cardiometabolic module constants for lipids and glucose', () => {
    expect(toCanonical('ldl', MGDL_PER_MMOLL_CHOL, 'mg/dL')).toBeCloseTo(1, 6);
    expect(toCanonical('tg', MGDL_PER_MMOLL_TG, 'mg/dL')).toBeCloseTo(1, 6);
    expect(toCanonical('fpg', MGDL_PER_MMOLL_GLC, 'mg/dL')).toBeCloseTo(1, 6);
  });

  it('matches the §13.5.1 factors', () => {
    const cases: Array<[MarkerId, number, string, number]> = [
      ['ldl', 100, 'mg/dL', 2.586],
      ['tg', 100, 'mg/dL', 1.129],
      ['apoB', 100, 'mg/dL', 1],
      ['fpg', 100, 'mg/dL', 5.549],
      ['hba1c', 48, 'mmol/mol', 6.543],
      ['insulin', 60, 'pmol/L', 10],
      ['alt', 1, 'µkat/L', 60],
      ['creatinine', 88.42, 'µmol/L', 1],
      ['uacr', 3, 'mg/mmol', 26.52],
      ['urate', 59.48, 'µmol/L', 1],
      ['tsh', 2.5, 'µIU/mL', 2.5],
      ['ft3', 3, 'pg/mL', 4.608],
      ['hb', 135, 'g/L', 13.5],
      ['ferritin', 40, 'ng/mL', 40],
      ['b12', 147.6, 'pmol/L', 200],
      ['vitD', 49.92, 'nmol/L', 20],
      ['hsCrp', 0.3, 'mg/dL', 3],
      ['sodium', 140, 'mEq/L', 140],
      ['testosterone', 300, 'ng/dL', 10.401],
    ];
    for (const [id, v, u, c] of cases) expect(toCanonical(id, v, u), `${id} ${v} ${u}`).toBeCloseTo(c, 2);
  });

  it('round-trips every accepted unit', () => {
    for (const id of MARKER_IDS)
      for (const u of unitsOf(id)) {
        const v = MARKER_UNITS[id].soft[1] / 2 || 1;
        const there = fromCanonical(id, toCanonical(id, v, u), u);
        expect(there, `${id} ${u}`).toBeCloseTo(v, 4);
      }
  });

  it('never converts Lp(a) between mg/dL and nmol/L', () => {
    expect(convert('lpa', 60, 'mg/dL', 'nmol/L')).toBeNull();
    expect(toCanonical('lpa', 150, 'nmol/L')).toBe(150);
  });

  it('reads printed unit spellings and rejects unknown units', () => {
    expect(normaliseUnit('mg/dl')).toBe('mg/dL');
    expect(normaliseUnit('gm/dL')).toBe('g/dL');
    expect(normaliseUnit('uIU/mL')).toBe('µIU/mL');
    expect(normaliseUnit('mL/min/1.73m2')).toBe('mL/min/1.73 m²');
    expect(normaliseUnit('furlongs')).toBeNull();
    expect(() => toCanonical('ldl', 100, 'mg')).toThrow('unit not recognised');
    expect(checkBounds('ldl', 100, 'mg')).toEqual({ ok: false, level: 'block', message: 'unit not recognised' });
  });

  it('blocks implausible values and asks about unusual ones', () => {
    expect(checkBounds('tg', 6000, 'mg/dL')).toMatchObject({ ok: false, level: 'block' });
    expect(checkBounds('tg', 1200, 'mg/dL')).toEqual({ ok: false, level: 'ask', message: 'Is 1 200 mg/dL right?' });
    expect(checkBounds('tg', 150, 'mg/dL')).toEqual({ ok: true });
    expect((checkBounds('tg', 6000, 'mg/dL') as { message: string }).message).toMatch(/^Vitals accepts .* mg\/dL for triglycerides\. Check the unit\.$/);
  });
});

describe('because line (§13.5.3 snapshot)', () => {
  const b = { markerId: 'ldl' as const, label: 'LDL', value: 192, unit: 'mg/dL', date: '2026-09-12' };
  it('uses the entered unit and the person’s date style', () => {
    expect(becauseText(b)).toBe('because your LDL cholesterol was 192 mg/dL on 12 Sep 2026');
    expect(becauseText(b, { style: 'month-day' })).toBe('because your LDL cholesterol was 192 mg/dL on Sep 12, 2026');
    expect(becauseText(b, { short: true })).toBe('because LDL 192 · 12 Sep');
    expect(becauseText({ ...b, markerId: 'hba1c', value: 6.8, unit: '%' })).toBe('because your HbA1c was 6.8% on 12 Sep 2026');
    expect(becauseText({ ...b, markerId: 'tg', label: 'triglycerides', value: 180 })).toMatch(/^because your triglycerides were 180 mg\/dL on /);
    expect(becauseText({ ...b, value: 4.97, unit: 'mmol/L' })).toBe('because your LDL cholesterol was 4.97 mmol/L on 12 Sep 2026');
  });
  it('marks results older than 12 months', () => {
    expect(becauseText({ ...b, date: '2025-09-01' }, { today: '2026-10-02' })).toMatch(/· old result$/);
  });
  it('fills research placeholders', () => {
    expect(fillMessage('Because your ALT was {v} U/L on {date}, above {uln}.', { value: 61, date: '1 Sep 2026', uln: '33 U/L' })).toBe('Because your ALT was 61 U/L on 1 Sep 2026, above 33 U/L.');
    expect(formatMarkerDate('2026-01-05', 'day-month', false)).toBe('5 Jan');
  });
});

describe('document', () => {
  const now = '2026-09-14T10:00:00Z';
  it('keeps history, the newest confirmed reading is current, re-entry for a date replaces it', () => {
    let d = upsertReadings(emptyMarkersDoc(), [readingFromInput({ id: 'ldl', value: 180, unit: 'mg/dL', date: '2026-03-01' }, 'manual', now)]);
    d = upsertReadings(d, [readingFromInput({ id: 'ldl', value: 150, unit: 'mg/dL', date: '2026-09-01' }, 'pdf', now)]);
    d = upsertReadings(d, [readingFromInput({ id: 'ldl', value: 155, unit: 'mg/dL', date: '2026-09-01' }, 'manual', now)]);
    expect(d.readings).toHaveLength(2);
    expect(currentReadings(d)[0]!.value).toBe(155);
    expect(currentReadings(removeReading(d, 'ldl', '2026-09-01'))[0]!.value).toBe(180);
    // unconfirmed readings are never current
    d = upsertReadings(d, [{ ...readingFromInput({ id: 'hdl', value: 40, unit: 'mg/dL', date: '2026-09-01' }, 'pdf', now), confirmed: false }]);
    expect(currentReadings(d).map((r) => r.id)).toEqual(['ldl']);
  });

  it('stale after 12 months, and diet-sensitive markers 3 months after a diet change', () => {
    expect(isStale({ id: 'tsh', date: '2025-09-30' }, '2026-10-02')).toBe(true);
    expect(isStale({ id: 'tsh', date: '2025-11-30' }, '2026-10-02')).toBe(false);
    expect(isStale({ id: 'ldl', date: '2026-05-01' }, '2026-10-02', '2026-06-01')).toBe(true);
    expect(isStale({ id: 'tsh', date: '2026-05-01' }, '2026-10-02', '2026-06-01')).toBe(false);
  });

  it('migrates Body page labs as confirmed manual readings dated at the profile update', () => {
    const d = migrateProfileLabs(emptyMarkersDoc(), { ldlMmolL: 3.4, hba1cPct: 5.6, vo2maxMlKgMin: 40 }, '2026-08-01T12:00:00Z');
    expect(d.readings.map((r) => [r.id, r.value, r.unit, r.date, r.provenance, r.confirmed])).toEqual([
      ['hba1c', 5.6, '%', '2026-08-01', 'manual', true],
      ['ldl', 3.4, 'mmol/L', '2026-08-01', 'manual', true],
    ]);
  });
});

describe('engine baseline (§13.5.4)', () => {
  const now = '2026-09-14T10:00:00Z';
  const d = upsertReadings(emptyMarkersDoc(), [
    readingFromInput({ id: 'ldl', value: 192, unit: 'mg/dL', date: '2026-09-12' }, 'manual', now),
    readingFromInput({ id: 'lpa', value: 150, unit: 'nmol/L', date: '2026-09-12' }, 'manual', now),
    readingFromInput({ id: 'egfr', value: 52, unit: 'mL/min/1.73 m²', date: '2026-09-12' }, 'manual', now),
    readingFromInput({ id: 'tsh', value: 2, unit: 'µIU/mL', date: '2025-01-01' }, 'manual', now),
  ]);
  it('maps confirmed, non-stale readings to LabBaselines in engine units, with dates', () => {
    const { labs, labDates } = labBaselinesWithDates(d, '2026-10-02');
    expect(labs.ldlMmolL).toBeCloseTo(192 / MGDL_PER_MMOLL_CHOL, 5);
    expect(labs.lpaNmolL).toBe(150);
    expect(labs.lpaMgDl).toBeUndefined();
    expect(labs.egfr).toBe(52);
    expect(labs.tshMiuL).toBeUndefined(); // stale
    expect(labDates.ldlMmolL).toBe('2026-09-12');
  });
  it('entered labs replace the Body page values', () => {
    const p = withMarkerLabs({ labs: { ldlMmolL: 2.5, measuredRmrKcal: 1700 } }, d, '2026-10-02');
    expect(p.labs!.ldlMmolL).toBeCloseTo(4.965, 2);
    expect(p.labs!.measuredRmrKcal).toBe(1700);
    expect(labBaselinesFrom(emptyMarkersDoc(), '2026-10-02')).toEqual({});
  });
});
