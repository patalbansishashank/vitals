// @vitest-environment node
/**
 * Golden personas with lab variants (PLAN 02 item 9; SUITE_SPEC §13.5 acceptance): a high-LDL and a low-eGFR version of
 * the 95-kg man. The rules fire, the caps bind in the planner's compiled limits and in the plans it returns, every note
 * says "because your X was Y on date", and nothing is removed: the planner still returns plans, very-low-carb stays
 * possible for the high-LDL person (it carries a warning instead), and creatine is only "not suggested". D4-07: the
 * low-eGFR reading sets no protein bound of its own; it marks renal context (renal targets wait for a repeat test or the
 * clinician's numbers), which the request carries in `profile.safety.flags.renalContext`.
 */
import { describe, expect, it } from 'vitest';
import { compileRequest } from '@/engine/planner/domain/context';
import { runDomainPlanner } from '@/engine/planner/domain/planner';
import { compileSafetyCaps } from '@/engine/planner/domain/safety';
import type { PlannerResult } from '@/engine/planner/domain/types';
import { FAT_LOSS_KEEP_LEAN, MAN_95, request } from '@/engine/planner/domain/__tests__/personas';
import { becauseText } from '../because';
import { readingFromInput } from '../doc';
import { evaluateMarkers, mergeSafety, ruleContextFrom } from '../rules';
import type { MarkerReadingInput, MarkersDoc } from '../types';
import { withMarkerSafety } from '../ui/request';

const TODAY = '2026-10-02';
const DATE = '2026-09-12';

const doc = (inputs: MarkerReadingInput[]): MarkersDoc => ({
  _schema: 1,
  readings: inputs.map((i) => readingFromInput(i, 'manual', `${DATE}T09:00:00Z`)),
  displayOnly: [],
  context: {},
  chapter: 'manual',
});

const HIGH_LDL = doc([
  { id: 'ldl', value: 192, unit: 'mg/dL', date: DATE, labRange: { high: 100, unit: 'mg/dL' } },
  { id: 'hdl', value: 44, unit: 'mg/dL', date: DATE },
  { id: 'tg', value: 160, unit: 'mg/dL', date: DATE },
  { id: 'apoB', value: 128, unit: 'mg/dL', date: DATE },
]);
const LOW_EGFR = doc([
  { id: 'creatinine', value: 1.6, unit: 'mg/dL', date: DATE },
  { id: 'egfr', value: 52, unit: 'mL/min/1.73 m²', date: DATE },
  { id: 'uacr', value: 45, unit: 'mg/g', date: DATE },
]);

const ctx = ruleContextFrom(MAN_95, TODAY);

describe('high-LDL persona', () => {
  const ev = evaluateMarkers(HIGH_LDL, ctx);
  const ids = ev.notes.map((n) => n.rule);

  it('fires the LDL and ApoB rules with their because-lines', () => {
    for (const id of ['W-L-LDL-1', 'W-L-LDL-2', 'W-L-LDL-3', 'W-L-LDL-5', 'W-L-LDL-7', 'W-L-APOB-1', 'W-L-APOB-2', 'W-L-TG-1', 'W-L-TG-2']) expect(ids).toContain(id);
    const vlc = ev.notes.find((n) => n.rule === 'W-L-LDL-5')!;
    expect(vlc.kind).toBe('warn');
    expect(vlc.levers).toContain('vlc');
    expect(becauseText(vlc)).toBe('because your LDL cholesterol was 192 mg/dL on 12 Sep 2026');
    expect(ev.notes.find((n) => n.rule === 'W-L-LDL-1')!.text).toBe(
      'Saturated fat is kept under 10 % of energy because your LDL was 192 mg/dL on 12 Sep 2026. Ghee, butter, coconut oil and fatty dairy are swapped for vegetable oils.',
    );
    expect(ev.notes.find((n) => n.rule === 'W-L-LDL-7')!.severity).toBe('danger');
  });

  it('caps saturated fat and added sugar, prefers fibre and unsaturated fat, sets a retest', () => {
    const locks = Object.fromEntries(ev.safety.plannerLocks.map((l) => [l.id, l.value]));
    expect(locks['satfat-cap']).toBe(10);
    expect(locks['added-sugar-cap']).toBe(10);
    expect(ev.preferLevers.map((p) => p.lever)).toEqual(expect.arrayContaining(['fibre', 'unsatfat', 'dietcholesterol']));
    for (const p of ev.preferLevers) expect(p.weight).toBeLessThanOrEqual(0.02);
    expect(ev.retests.find((t) => t.markerId === 'ldl')?.due).toBe('2026-11-07');
  });

  it('removes nothing: very-low-carb and fasting stay available to the planner', () => {
    const req = request(MAN_95, FAT_LOSS_KEEP_LEAN, { safety: mergeSafety(undefined, ev.safety) });
    const plain = compileRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN));
    const caps = compileRequest(req).caps;
    expect(caps.blocked).toBeNull();
    expect(caps.ketogenicAllowed).toBe(plain.caps.ketogenicAllowed);
    expect(caps.maxFastH).toBe(plain.caps.maxFastH);
    expect(caps.deficitCapPct).toBe(plain.caps.deficitCapPct);
  });
});

describe('low-eGFR persona', () => {
  const ev = evaluateMarkers(LOW_EGFR, ctx);
  const ids = ev.notes.map((n) => n.rule);

  it('fires the kidney rules: kidney flag, creatine and potassium salt not suggested, no protein bound of its own (D4-07)', () => {
    for (const id of ['W-L-EGFR-1', 'W-L-EGFR-2', 'W-L-EGFR-3', 'W-L-EGFR-4', 'W-L-ACR-1', 'W-L-ACR-2']) expect(ids).toContain(id);
    expect(ids).not.toContain('W-L-EGFR-6'); // clinician-only below 30
    expect(ev.safety.flags).toContain('kidney-disease');
    const locks = Object.fromEntries(ev.safety.plannerLocks.map((l) => [l.id, l.value]));
    expect(locks['protein-cap']).toBeUndefined();
    expect(locks['creatine-cap']).toBe(0);
    expect(locks['potassium-supp-cap']).toBe(0);
    const n = ev.notes.find((x) => x.rule === 'W-L-EGFR-1')!;
    expect(n.text).toBe("Because your eGFR was 52 mL/min/1.73 m² on 12 Sep 2026, kidney targets for protein, potassium and fluid wait for a repeat test or your clinician's numbers.");
    expect(becauseText(n)).toBe('because your eGFR was 52 mL/min/1.73 m² on 12 Sep 2026');
  });

  it('the planner still returns plans, creatine stays out, and the request carries the renal review context', async () => {
    const base = request({ ...MAN_95, safety: { mode: 'M0', flags: {} } }, FAT_LOSS_KEEP_LEAN);
    const req = { ...withMarkerSafety(base, ev), budget: { tier: 'S' as const } };
    expect(req.profile.safety?.flags.renalContext).toBe('priorAbnormalityReview');
    expect(req.safety?.plannerLocks?.map((l) => l.id)).not.toContain('protein-cap');
    const pc = compileRequest(req);
    expect(pc.caps.creatineAllowed).toBe(false);
    expect(pc.caps.blocked).toBeNull();
    const res: PlannerResult = await runDomainPlanner(req, { tier: 'S' });
    expect(res.status).toBe('ok');
    expect(res.options.length).toBeGreaterThan(0);
    for (const o of res.options) for (const prog of o.schedule.programs) expect(prog.substances?.creatineG ?? 0).toBe(0);
  }, 300_000);

  it('a kidney reading does not tighten a screening protein cap; the supplement caps merge strictest-first with both reasons', () => {
    const merged = mergeSafety({ plannerLocks: [{ id: 'protein-cap', value: 1.6, reasons: [{ rule: 'S-1' }] }, { id: 'creatine-cap', value: 5, reasons: [{ rule: 'S-2' }] }] }, ev.safety);
    const p = merged.plannerLocks!.filter((l) => l.id === 'protein-cap');
    expect(p).toHaveLength(1);
    expect(p[0]!.value).toBe(1.6);
    expect(p[0]!.reasons!.map((r) => r.rule)).toEqual(['S-1']);
    const c = merged.plannerLocks!.filter((l) => l.id === 'creatine-cap');
    expect(c).toHaveLength(1);
    expect(c[0]!.value).toBe(0);
    expect(c[0]!.reasons!.map((r) => r.rule)).toEqual(expect.arrayContaining(['S-2', 'W-L-EGFR-2']));
    const rp = compileRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN)).rp;
    expect(compileSafetyCaps(rp, merged).creatineAllowed).toBe(false);
  });
});
