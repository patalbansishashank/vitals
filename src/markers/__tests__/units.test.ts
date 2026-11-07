// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MGDL_PER_MMOLL_CHOL, MGDL_PER_MMOLL_GLC, MGDL_PER_MMOLL_TG } from '@/engine/model/cardiometabolic/baselines';
import { parseNumber } from '@/components/lib/format';
import type { PersonProfile } from '@/engine/types/profile';
import { becauseText, fillMessage, formatMarkerDate } from '../because';
import { labBaselinesFrom, labBaselinesWithDates, withMarkerLabs } from '../baselines';
import { currentReadings, isStale, migrateProfileLabs, normaliseDoc, readingFromInput, removeReading, upsertReadings } from '../doc';
import { evaluateMarkers } from '../rules';
import { MARKER_IDS, emptyMarkersDoc, type MarkerId } from '../types';
import { MARKER_UNITS, canonicalUnitOf, checkBounds, convert, fromCanonical, gfrQuantityOf, indexedConversionOf, indexedEgfrOf, normaliseUnit, toCanonical, unitsOf } from '../units';

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
    expect(checkBounds('tg', 1200, 'mg/dL')).toEqual({ ok: false, level: 'ask', message: 'Is 1,200 mg/dL right?' });
    expect(parseNumber('1,200')).toBe(1200);
    expect(parseNumber('1 200')).toBe(1200); // older grouped input remains accepted
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

/* ------------------------------------------------------------------------------------------- D7-02 */

describe('kidney function quantities (D7-02): indexed eGFR is not absolute GFR or creatinine clearance', () => {
  const at = '2026-09-14T10:00:00Z';
  const egfr = (value: number, unit: string, extra: Record<string, unknown> = {}) => ({ ...readingFromInput({ id: 'egfr', value, unit, date: '2026-09-12' }, 'manual', at), ...extra });
  const docOf = (...rs: ReturnType<typeof egfr>[]) => ({ ...emptyMarkersDoc(), readings: rs });
  const ctx = { sex: 'male' as const, today: '2026-10-02', ageYears: 50, referencePhysiology: 'adultMale' as const };

  it('mL/min never converts to mL/min/1.73 m² by a unit factor; the raw value stays its own canonical', () => {
    expect(convert('egfr', 70, 'mL/min', 'mL/min/1.73 m²')).toBeNull();
    expect(convert('egfr', 70, 'mL/min/1.73 m²', 'mL/min')).toBeNull();
    expect(canonicalUnitOf('egfr', 'mL/min')).toBe('mL/min');
    const r = egfr(70, 'mL/min');
    expect([r.value, r.unit, r.valueCanonical, r.unitCanonical]).toEqual([70, 'mL/min', 70, 'mL/min']);
    expect(checkBounds('egfr', 70, 'mL/min')).toEqual({ ok: true });
  });

  it('an ambiguous mL/min value is indexing-unconfirmed: no CKD staging, no kidney flag, noSuggest unresolved', () => {
    const r = egfr(50, 'mL/min');
    expect(gfrQuantityOf(r)).toBe('indexingUnconfirmed');
    expect(indexedEgfrOf(r)).toEqual({ status: 'unresolved', reason: 'indexingUnconfirmed' });
    const ev = evaluateMarkers(docOf(r), ctx);
    expect(ev.notes.filter((n) => n.markerId === 'egfr').map((n) => n.rule)).toEqual([]);
    expect(ev.safety.flags).not.toContain('kidney-disease');
    expect(ev.safety.plannerLocks).toEqual([]);
    expect(ev.unresolved).toContainEqual({ rule: 'W-L-EGFR-1', field: 'egfr:indexingUnconfirmed' });
    expect(ev.noSuggest!.filter((d) => d.rule === 'W-L-EGFR-2').map((d) => [d.subject, d.applicability])).toEqual([
      ['supp:creatine_monohydrate', 'unresolved'],
      ['supp:potassium_salt_substitute', 'unresolved'],
    ]);
    // the baseline leaves it out, with its quantity kind for the "Unit unclear" prompt
    const b = labBaselinesWithDates(docOf(r), '2026-10-02');
    expect(b.labs.egfr).toBeUndefined();
    expect(b.labMeta.egfr).toMatchObject({ quantityKind: 'indexingUnconfirmed', original: { value: 50, unit: 'mL/min' } });
  });

  it('converting 70 mL/min to indexed without sample-date height and weight refuses', () => {
    const abs = egfr(70, 'mL/min', { quantityKind: 'gfrAbsolute' });
    expect(indexedConversionOf(abs, {})).toEqual({ ok: false, reason: 'anthropometryMissing' });
    expect(indexedConversionOf(abs, { heightCm: 176, weightKg: 99, date: '2026-01-01' })).toEqual({ ok: false, reason: 'anthropometryNotSampleDate' });
    expect(indexedConversionOf(egfr(70, 'mL/min'), { heightCm: 176, weightKg: 99, date: '2026-09-12' })).toEqual({ ok: false, reason: 'indexingUnconfirmed' });
    expect(indexedConversionOf(egfr(70, 'mL/min', { quantityKind: 'creatinineClearance' }), { heightCm: 176, weightKg: 99, date: '2026-09-12' })).toEqual({ ok: false, reason: 'creatinineClearanceNotGfr' });
    expect(indexedEgfrOf(abs)).toEqual({ status: 'unresolved', reason: 'absoluteNeedsBsa' });
  });

  it('BSA 2.2 m² (Mosteller, 176 cm × 99 kg on the sample date) converts 70 → 55.04545 with provenance; the raw value stays', () => {
    const abs = egfr(70, 'mL/min', { quantityKind: 'gfrAbsolute' });
    const c = indexedConversionOf(abs, { heightCm: 176, weightKg: 99, date: '2026-09-12' });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.indexed.bsaM2).toBeCloseTo(2.2, 10);
    expect(c.indexed.valueMlMin173).toBeCloseTo(55.04545, 4);
    expect(c.indexed).toMatchObject({ bsaMethod: 'mosteller', heightCm: 176, weightKg: 99, anthropometryDate: '2026-09-12' });
    const stored = { ...abs, indexed: c.indexed };
    expect(stored.value).toBe(70);
    expect(indexedEgfrOf(stored)).toEqual({ status: 'resolved', value: c.indexed.valueMlMin173, source: 'bsaConverted' });
    // the indexed value stages: < 60 fires the kidney rules
    const ev = evaluateMarkers(docOf(stored), ctx);
    expect(ev.notes.map((n) => n.rule)).toContain('W-L-EGFR-1');
    expect(ev.safety.flags).toContain('kidney-disease');
    const b = labBaselinesWithDates(docOf(stored), '2026-10-02');
    expect(b.labs.egfr).toBeCloseTo(55.04545, 4);
    expect(b.labMeta.egfr).toMatchObject({ quantityKind: 'gfrAbsolute', original: { value: 70, unit: 'mL/min' } });
  });

  it('a value the person confirmed is indexed eGFR printed without its index reads as indexed', () => {
    const r = egfr(52, 'mL/min', { quantityKind: 'egfrIndexed' });
    expect(indexedEgfrOf(r)).toEqual({ status: 'resolved', value: 52, source: 'confirmedIndexed' });
    expect(evaluateMarkers(docOf(r), ctx).notes.map((n) => n.rule)).toContain('W-L-EGFR-1');
    expect(indexedEgfrOf(egfr(52, 'mL/min/1.73 m²'))).toEqual({ status: 'resolved', value: 52, source: 'printedIndexed' });
  });
});

describe('measured lab values stay exact (D7-02)', () => {
  const at = '2026-09-14T10:00:00Z';
  const d = upsertReadings(emptyMarkersDoc(), [
    readingFromInput({ id: 'ldl', value: 310, unit: 'mg/dL', date: '2026-09-12' }, 'manual', at),
    readingFromInput({ id: 'tg', value: 1200, unit: 'mg/dL', date: '2026-09-12' }, 'manual', at),
    readingFromInput({ id: 'fpg', value: 300, unit: 'mg/dL', date: '2026-09-12' }, 'manual', at),
    readingFromInput({ id: 'hba1c', value: 14, unit: '%', date: '2026-09-12' }, 'manual', at),
  ]);

  it('LDL 310 / TG 1200 / FPG 300 mg/dL and HbA1c 14 % reach the baseline exactly, flagged out of domain, not clipped', () => {
    const { labs, labMeta } = labBaselinesWithDates(d, '2026-10-02');
    // exact up to the canonical unit's 1e-6 mmol/L storage precision (never a plausibility clamp)
    expect(labs.ldlMmolL! * MGDL_PER_MMOLL_CHOL).toBeCloseTo(310, 3);
    expect(labs.tgMmolL! * MGDL_PER_MMOLL_TG).toBeCloseTo(1200, 3);
    expect(labs.fastingGlucoseMmolL! * MGDL_PER_MMOLL_GLC).toBeCloseTo(300, 3);
    expect(labs.hba1cPct).toBe(14);
    for (const f of ['ldlMmolL', 'tgMmolL', 'fastingGlucoseMmolL', 'hba1cPct'] as const) expect(labMeta[f], f).toMatchObject({ source: 'marker', measuredOn: '2026-09-12', outOfDomain: true });
    const p = withMarkerLabs({ labs: {} } as Pick<PersonProfile, 'labs' | 'labMeta'>, d, '2026-10-02');
    expect(p.labs!.hba1cPct).toBe(14);
    expect(p.labMeta?.hba1cPct?.original).toEqual({ value: 14, unit: '%' });
  });

  it('the rules read the measured values (no plausibility clamp)', () => {
    const ids = evaluateMarkers(d, { sex: 'male', today: '2026-10-02' }).notes.map((n) => n.rule);
    expect(ids).toEqual(expect.arrayContaining(['W-L-LDL-7']));
    expect(ids.some((x) => x.startsWith('W-L-TG-'))).toBe(true);
    expect(ids.some((x) => x.startsWith('W-L-FPG-'))).toBe(true);
    expect(ids.some((x) => x.startsWith('W-L-HBA1C-'))).toBe(true);
  });

  it('newer writers\' review states, conditions and medication changes survive a normalising read', () => {
    const raw = { ...emptyMarkersDoc(), reviews: [{ id: 'r1', markerId: 'egfr', readingIds: ['x'], state: 'unresolvedPriorAbnormality', since: '2026-01-01', authority: 'rule' }], conditions: [], medications: [{ id: 'm', medicationClass: 'statin', change: 'start', date: '2026-02-01' }] };
    const n = normaliseDoc(raw);
    expect(n.reviews).toEqual(raw.reviews);
    expect(n.conditions).toEqual([]);
    expect(n.medications).toEqual(raw.medications);
    expect(normaliseDoc(emptyMarkersDoc())).toEqual(emptyMarkersDoc());
  });

  it('sample facts are stored only when given', () => {
    const r = readingFromInput({ id: 'testosterone', value: 300, unit: 'ng/dL', date: '2026-09-12', sampleId: 's1', fastingHours: 10, assay: 'LC-MS/MS' }, 'manual', at);
    expect(r).toMatchObject({ sampleId: 's1', fastingHours: 10, assay: 'LC-MS/MS' });
    const bare = readingFromInput({ id: 'testosterone', value: 300, unit: 'ng/dL', date: '2026-09-12' }, 'manual', at);
    for (const k of ['sampleId', 'sampledAt', 'fastingHours', 'quantityKind', 'assay', 'sampleLocalClockH', 'fastingStatus']) expect(bare).not.toHaveProperty(k);
  });
});
