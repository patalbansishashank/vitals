// @vitest-environment node
/**
 * D7-01: male testosterone rules apply only to confirmed adult male reference physiology. Female or unknown physiology
 * never meets a male cut-off (unknown is unresolved, shown as "needs context"); a sample on hormone therapy is judged by
 * the lab's reference; the repeat rule claims "two morning fasting tests" only when both draws record those facts; the
 * testosterone-derived 3.4 g/kg protein cap is gone (an evidence-qualified concern remains). The research source and
 * the builder carry the applicability schema; malformed applicability stops the build.
 */
import { describe, expect, it } from 'vitest';
import { applicabilityFrom, buildTable, readInputs } from '../../../scripts/markers/build-interactions';
import { join } from 'node:path';
import type { PersonProfile } from '@/engine/types/profile';
import { readingFromInput } from '../doc';
import { evaluateMarkers, referencePhysiologyOf, ruleContextFrom } from '../rules';
import { TABLE } from '../table';
import type { MarkerReading, MarkerReadingInput, MarkersDoc, RuleContext } from '../types';

const TODAY = '2026-10-02';
const D1 = '2026-08-20';
const D2 = '2026-09-20';

const read = (input: MarkerReadingInput, extra: Partial<MarkerReading> = {}): MarkerReading => ({ ...readingFromInput(input, 'manual', `${input.date}T09:00:00Z`), ...extra });
const doc = (readings: MarkerReading[]): MarkersDoc => ({ _schema: 1, readings, displayOnly: [], context: {}, chapter: 'manual' });
const ctx = (over: Partial<RuleContext>): RuleContext => ({ sex: 'male', today: TODAY, defaultDeficitCapPct: 25, ageYears: 35, bmi: 29, fields: { deficitPct: 30, sleepHours: 5 }, ...over });

const MALE_RULES = TABLE.rules.filter((r) => r.applicability?.referencePhysiology === 'adultMale').map((r) => r.id);
const lowT = (value: number, date: string, extra: Partial<MarkerReading> = {}): MarkerReading => read({ id: 'testosterone', value, unit: 'ng/dL', date }, extra);

describe('population applicability of the male testosterone rules', () => {
  it('the male rules are the testosterone rules and the free-T3 + testosterone rule', () => {
    expect(MALE_RULES.sort()).toEqual(['W-L-FT3-3', 'W-L-TESTOSTERONE-1', 'W-L-TESTOSTERONE-2', 'W-L-TESTOSTERONE-3', 'W-L-TESTOSTERONE-4', 'W-L-TESTOSTERONE-5', 'W-L-TESTOSTERONE-6']);
    for (const id of MALE_RULES) expect(TABLE.rules.find((r) => r.id === id)!.applicability).toMatchObject({ referencePhysiology: 'adultMale', adultOnly: true });
  });

  it('female total T 30 ng/dL twice: no male rule fires, no lock, no cap, nothing unresolved', () => {
    const d = doc([lowT(30, D1), lowT(32, D2)]);
    const ev = evaluateMarkers(d, ctx({ sex: 'female', referencePhysiology: 'adultFemale' }));
    expect(ev.notes.filter((n) => n.markerId === 'testosterone')).toEqual([]);
    expect(ev.safety.plannerLocks).toEqual([]);
    expect(ev.preferLevers).toEqual([]);
    expect(ev.retests.filter((t) => t.markerId === 'testosterone')).toEqual([]);
    expect(ev.applicability).toEqual([]);
    // the measured value stays visible with its own state
    expect(ev.states.find((s) => s.markerId === 'testosterone')?.reading.value).toBe(32);
  });

  it('unknown physiology: the male diagnostic condition is unresolved (needs context), never true', () => {
    const d = doc([lowT(30, D1), lowT(32, D2)]);
    const ev = evaluateMarkers(d, ctx({ sex: 'unknown', referencePhysiology: 'unresolved' }));
    expect(ev.notes.filter((n) => n.markerId === 'testosterone')).toEqual([]);
    expect(ev.safety.plannerLocks.map((l) => l.id)).not.toContain('protein-cap');
    expect(ev.applicability).toContainEqual({ rule: 'W-L-TESTOSTERONE-2', status: 'unresolved', reason: 'referencePhysiology' });
    expect(ev.unresolved).toContainEqual({ rule: 'W-L-TESTOSTERONE-2', field: 'referencePhysiology' });
  });

  it('eligible adult male with two documented morning fasting draws: the referral and its claim are kept', () => {
    const facts = { sampleLocalClockH: 8, fastingStatus: 'fasting' as const };
    const ev = evaluateMarkers(doc([lowT(240, D1, facts), lowT(250, D2, { ...facts, fastingHours: 12 })]), ctx({ referencePhysiology: 'adultMale' }));
    const n = ev.notes.find((x) => x.rule === 'W-L-TESTOSTERONE-2');
    expect(n?.severity).toBe('danger');
    expect(n?.text).toBe('Your testosterone has been below 264 ng/dL on two morning fasting tests (20 Sep 2026). Please see a clinician.');
    expect(ev.applicability!.filter((a) => a.rule === 'W-L-TESTOSTERONE-2')).toEqual([]);
  });

  it('afternoon draws: the referral still prompts review but never claims two morning tests', () => {
    const pm = { sampleLocalClockH: 15, fastingStatus: 'fasting' as const };
    const ev = evaluateMarkers(doc([lowT(240, D1, pm), lowT(250, D2, pm)]), ctx({ referencePhysiology: 'adultMale' }));
    const n = ev.notes.find((x) => x.rule === 'W-L-TESTOSTERONE-2')!;
    expect(n.text).toBe('Your testosterone has been below 264 ng/dL on two tests (20 Sep 2026). Please see a clinician.');
    expect(n.text).not.toMatch(/morning/);
    expect(ev.applicability).toContainEqual({ rule: 'W-L-TESTOSTERONE-2', status: 'unresolved', reason: 'sampleNotMorningFasting' });
  });

  it('missing sample time: the morning claim is unresolved; one known draw is not enough for both', () => {
    const ev = evaluateMarkers(doc([lowT(240, D1, { sampleLocalClockH: 7, fastingStatus: 'fasting' }), lowT(250, D2)]), ctx({ referencePhysiology: 'adultMale' }));
    expect(ev.notes.find((x) => x.rule === 'W-L-TESTOSTERONE-2')!.text).not.toMatch(/morning/);
    expect(ev.applicability).toContainEqual({ rule: 'W-L-TESTOSTERONE-2', status: 'unresolved', reason: 'sampleTimingUnknown' });
  });

  it('a draw on hormone therapy is judged by the lab reference: unresolved, and it never counts toward the repeat', () => {
    const cur = evaluateMarkers(doc([lowT(240, D1), lowT(250, D2, { hormoneTherapy: 'yes' })]), ctx({ referencePhysiology: 'adultMale' }));
    expect(cur.notes.filter((n) => n.markerId === 'testosterone')).toEqual([]);
    expect(cur.applicability).toContainEqual({ rule: 'W-L-TESTOSTERONE-1', status: 'unresolved', reason: 'hormoneTherapy' });
    expect(cur.safety.plannerLocks).toEqual([]);
    // the older draw on therapy is not one of the two low male-reference draws
    const old = evaluateMarkers(doc([lowT(240, D1, { hormoneTherapy: 'yes' }), lowT(250, D2, { hormoneTherapy: 'no' })]), ctx({ referencePhysiology: 'adultMale' }));
    expect(old.notes.map((n) => n.rule)).toContain('W-L-TESTOSTERONE-1');
    expect(old.notes.map((n) => n.rule)).not.toContain('W-L-TESTOSTERONE-2');
  });

  it('no testosterone-derived protein cap: an evidence-qualified very-high-protein/low-carb concern instead', () => {
    const ev = evaluateMarkers(doc([lowT(250, D2)]), ctx({ referencePhysiology: 'adultMale' }));
    expect(ev.safety.plannerLocks.map((l) => l.id)).not.toContain('protein-cap');
    const n = ev.notes.find((x) => x.rule === 'W-L-TESTOSTERONE-5')!;
    expect(n.kind).toBe('warn');
    expect(n.levers).toEqual(expect.arrayContaining(['highprotein', 'vlc']));
    expect(n.text).toMatch(/limited evidence/);
    const rule = TABLE.rules.find((r) => r.id === 'W-L-TESTOSTERONE-5')!;
    expect(rule.effect.locks).toBeUndefined();
    expect(rule.effect.displayValue).toEqual({ name: 'proteinGPerKg', value: 3.4 });
    // no testosterone rule anywhere writes a protein lock or promises that eating more fixes it
    for (const r of TABLE.rules.filter((x) => x.markerId === 'testosterone')) {
      expect((r.effect.locks ?? []).map((l) => l.lock)).not.toContain('protein-cap');
      expect(r.message).not.toMatch(/usually recovers with more food/);
    }
  });

  it('the deficit cap and sleep advice stay for an eligible adult man (supportive, not a guaranteed treatment)', () => {
    const ev = evaluateMarkers(doc([lowT(250, D2)]), ctx({ referencePhysiology: 'adultMale' }));
    const ids = ev.notes.map((n) => n.rule);
    expect(ids).toEqual(expect.arrayContaining(['W-L-TESTOSTERONE-1', 'W-L-TESTOSTERONE-3', 'W-L-TESTOSTERONE-4', 'W-L-TESTOSTERONE-6']));
    expect(ev.safety.plannerLocks.find((l) => l.id === 'deficit-cap')?.value).toBe(20);
  });

  it('a minor is not the adult population (not applicable, silent)', () => {
    const ev = evaluateMarkers(doc([lowT(200, D2)]), ctx({ referencePhysiology: 'adultMale', ageYears: 16 }));
    expect(ev.notes.filter((n) => n.markerId === 'testosterone')).toEqual([]);
    expect(ev.applicability).toEqual([]);
  });

  it('unrelated sex-specific rules keep their conservative unknown-sex reading (Hb, ALT)', () => {
    const d = doc([read({ id: 'hb', value: 12.5, unit: 'g/dL', date: D2 }), read({ id: 'alt', value: 28, unit: 'U/L', date: D2 })]);
    const ids = evaluateMarkers(d, ctx({ sex: 'unknown', referencePhysiology: 'unresolved' })).notes.map((n) => n.rule);
    expect(ids).toEqual(expect.arrayContaining(['W-L-HB-1', 'W-L-ALT-1']));
  });
});

describe('reference physiology from the profile', () => {
  const body = (sex: 'male' | 'female', ageYears?: number) => ({ sex, ageYears, heightCm: 178, weightKg: 85 }) as unknown as PersonProfile['body'];

  it('confirmed adult male or female physiology; unknown sex or age is unresolved, never male', () => {
    expect(ruleContextFrom({ body: body('male', 40) }, TODAY).referencePhysiology).toBe('adultMale');
    expect(ruleContextFrom({ body: body('female', 40) }, TODAY).referencePhysiology).toBe('adultFemale');
    expect(ruleContextFrom({ body: body('male', 40), sexUnspecified: true }, TODAY).referencePhysiology).toBe('unresolved');
    expect(ruleContextFrom({ body: body('male') }, TODAY).referencePhysiology).toBe('unresolved');
    expect(ruleContextFrom(undefined, TODAY).referencePhysiology).toBe('unresolved');
    expect(referencePhysiologyOf('male', 17)).toBe('unresolved');
  });

  it('an explicit context wins over the derivation (a lab reference supplied by a caller)', () => {
    expect(ruleContextFrom({ body: body('male', 40) }, TODAY, { referencePhysiology: 'unresolved' }).referencePhysiology).toBe('unresolved');
  });
});

describe('research source and builder schema', () => {
  const inputs = readInputs(join(__dirname, '..', '..', '..'));

  it('rejects a misspelt or unknown applicability, and a sample claim without declared sample facts', () => {
    expect(() => applicabilityFrom({ referencePhysiology: 'male' }, 'X')).toThrow(/referencePhysiology/);
    expect(() => applicabilityFrom({ population: 'adultMale' }, 'X')).toThrow(/applicability key/);
    expect(() => applicabilityFrom({ sample: { evening: true } }, 'X')).toThrow(/sample/);
    const bad = inputs.map((i) => ({ ...i, data: JSON.parse(JSON.stringify(i.data)) as typeof i.data }));
    const r2 = bad.flatMap((i) => i.data.rules).find((r: { id: string }) => r.id === 'W-L-TESTOSTERONE-2')!;
    delete r2.applicability.sample;
    expect(() => buildTable(bad)).toThrow(/sampleClaim/);
    r2.applicability.sample = { morning: true };
    r2.message = 'Below 264 ng/dL on two morning tests. Please see a clinician.';
    expect(() => buildTable(bad)).toThrow(/sampleClaim|morning tests/);
  });

  it('the 264 and 300 ng/dL thresholds keep their own provenance in the source', () => {
    const rules = inputs.flatMap((i) => i.data.rules) as Array<{ id: string; thresholdContext?: string; when: { value: unknown } }>;
    for (const r of rules.filter((x) => /^W-L-TESTOSTERONE-/.test(x.id))) {
      expect(r.thresholdContext, r.id).toMatch(r.when.value === 264 ? /^264 ng\/dL/ : /^300 ng\/dL/);
    }
  });
});
