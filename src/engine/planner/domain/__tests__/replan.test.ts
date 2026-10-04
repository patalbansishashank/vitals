// @vitest-environment node
/**
 * Receding-horizon re-plan (docs/PLANNER_V2_SPEC.md §7, §9.7 row "Re-plan"): past immutable, lock window, absolute
 * targets, churn limits, load-raising changes only as proposals, fasting spacing across the logged past, light re-plans
 * touch 7 days only, determinism, plain texts. Small plans (28 days), tier-S budgets of 60 EU.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { checkReplan } from '@/living';
import { leak } from '@/content/evidence/__tests__/leakScan';
import type { DayTemplate, Schedule } from '../../../types/schedule';
import { futureSpacingViolation, loadChange, replan, toActivePlan, toActivePlanFromScenario, type ReplanDiagnostics, type ReplanOptions } from '../replan';
import type { ActivePlanRecord, ConfirmedState, ReplanRequest, ReplanResult } from '../replanTypes';
import { dateAt, dayTemplate, planContext, withDayTemplates } from '../sensitivities';
import type { ZeroSpan } from '../repair';
import type { RungPlan } from '../types';
import { baseRequest, confirmedState, logsAsPlanned, makePlan, replanRequest, type Fixture } from './replan.fixtures';

const TODAY = 10;
const ANCHOR = 7;
const EU = 60;

const b1 = (energy: number) => makePlan({ pick: (s) => /^B1(\[|$)/.test(s.id), x: (st) => withGene(st, 'seg0.energy', energy) });
function withGene(st: { x0: Float64Array; geneIndex: Readonly<Record<string, number>> }, path: string, v: number): Float64Array {
  const x = Float64Array.from(st.x0);
  const i = st.geneIndex[path];
  if (i !== undefined) x[i] = v;
  return x;
}

const results: ReplanResult[] = [];
const runs: Array<{ req: ReplanRequest; r: ReplanResult }> = [];
async function run(req: ReplanRequest, extra: ReplanOptions = {}): Promise<{ r: ReplanResult; d: ReplanDiagnostics }> {
  let d: ReplanDiagnostics | null = null;
  const r = await replan(req, { totalEU: EU, onDiagnostics: (x) => (d = x), ...extra });
  results.push(r);
  runs.push({ req, r });
  return { r, d: d! };
}

const tpl = (s: Schedule, d: number): string => JSON.stringify(dayTemplate(s, d));
const noEnergy = (t: DayTemplate): string => JSON.stringify({ ...t, energy: undefined });
const eventsBefore = (s: Schedule, d: number) => JSON.stringify((s.events ?? []).filter((e) => e.startDay < d));
const pct = (t: DayTemplate): number => (t.energy.kind === 'pctMaintenance' ? t.energy.pct : t.energy.kind === 'kcal' ? t.energy.kcal : 0);

describe('re-plan (living plan)', () => {
  let gentle: Fixture;
  let mid: Fixture;
  let sGentle: ConfirmedState;
  let sMid: ConfirmedState;
  beforeAll(() => {
    gentle = b1(0.6);
    mid = b1(0.8);
    sGentle = confirmedState(gentle.plan, ANCHOR, { deltaSd: 60 });
    sMid = confirmedState(mid.plan, ANCHOR, { deltaSd: 60 });
  }, 60_000);

  it('light: no change for noise (unchanged, same record) and deterministic', async () => {
    const a = await run(replanRequest(gentle.plan, sGentle, TODAY, 'light'));
    const b = await run(replanRequest(gentle.plan, sGentle, TODAY, 'light'));
    expect(a.d.safetyFirst).toBe(false);
    expect(a.r.status).toBe('unchanged');
    expect(a.r.plan).toBe(gentle.plan);
    expect(a.r.diff).toEqual([]);
    expect(JSON.stringify(b.r)).toBe(JSON.stringify(a.r));
    expect(a.r.forecast.asPrescribed[0]!.target).toBe(22);
    expect(a.r.forecast.bands.fatMass!.p50.length).toBe(28 - TODAY);
  }, 60_000);

  it('light re-plan touches the next 7 days only: today kept, tomorrow within ±10 % energy, days from today+7 kept', async () => {
    const { r, d } = await run(replanRequest(mid.plan, sMid, TODAY, 'light'));
    expect(d.safetyFirst).toBe(false);
    expect(['ok', 'proposal']).toContain(r.status);
    const a = mid.plan.schedule;
    const n = r.plan.schedule;
    for (let k = 0; k <= TODAY; k++) expect(tpl(n, k)).toBe(tpl(a, k));
    expect(noEnergy(dayTemplate(n, TODAY + 1))).toBe(noEnergy(dayTemplate(a, TODAY + 1)));
    const ratio = pct(dayTemplate(n, TODAY + 1)) / pct(dayTemplate(a, TODAY + 1));
    expect(ratio).toBeGreaterThanOrEqual(0.9 - 1e-9);
    expect(ratio).toBeLessThanOrEqual(1.1 + 1e-9);
    for (let k = TODAY + 7; k < 28; k++) expect(tpl(n, k)).toBe(tpl(a, k));
    expect(r.diff.every((x) => x.date >= dateAt(mid.plan.startDate, TODAY + 1) && x.date < dateAt(mid.plan.startDate, TODAY + 7))).toBe(true);
    // the living plan's own stability checker agrees (no lock, past or churn violation)
    expect(checkReplan(a, n, TODAY, 'light').violations).toEqual([]);
  }, 60_000);

  it('past immutable: logged days drive the forecast, the returned plan keeps every past prescription', async () => {
    const overeat = logsAsPlanned(gentle.plan, ANCHOR, TODAY, (k, t) => (k === 8 ? { ...t, energy: { kind: 'kcal', kcal: 4500 } } : t));
    const withLogs = await run(replanRequest(gentle.plan, sGentle, TODAY, 'weekly', { logs: overeat }));
    const without = await run(replanRequest(gentle.plan, sGentle, TODAY, 'weekly'));
    for (const { r } of [withLogs, without]) {
      for (let k = 0; k < TODAY; k++) expect(tpl(r.plan.schedule, k)).toBe(tpl(gentle.plan.schedule, k));
      expect(eventsBefore(r.plan.schedule, TODAY)).toBe(eventsBefore(gentle.plan.schedule, TODAY));
    }
    const fat = (r: ReplanResult) => r.forecast.asPrescribed.find((g) => g.metric === 'fatMass')!.endP50;
    expect(fat(withLogs.r) - fat(without.r)).toBeGreaterThan(0.05);
  }, 60_000);

  it('lock window: today and tomorrow keep their prescription; a deeper target raises load → proposal', async () => {
    const changes = { goals: [{ metric: 'fatMass' as const, direction: 'target' as const, target: 20, targetKind: 'absolute' as const }, { metric: 'leanTissue' as const, direction: 'maximise' as const }] };
    const { r, d } = await run(replanRequest(gentle.plan, sGentle, TODAY, 'event', { trigger: 'requestChange', changes }));
    expect(d.safetyFirst).toBe(false);
    expect(d.lockEnd).toBe(TODAY + 2);
    expect(r.status).toBe('proposal');
    expect(r.proposals.length).toBe(1);
    expect(r.proposals[0]!.raisesLoad).toBe(true);
    expect(r.diff.length).toBeGreaterThan(0);
    for (let k = 0; k < TODAY + 2; k++) expect(tpl(r.plan.schedule, k)).toBe(tpl(gentle.plan.schedule, k));
    expect(r.diff.every((x) => x.date >= dateAt(gentle.plan.startDate, TODAY + 2))).toBe(true);
    expect(r.plan.request.goals[0]).toMatchObject({ target: 20, targetKind: 'absolute' });
    expect(r.plan.version).toBe(gentle.plan.version + 1);
    expect(r.plan.provenance.replanFrame).toBeTruthy();
  }, 60_000);

  it('absolute targets: toActivePlan freezes change targets (and the anchoring offset); re-plans keep them; new change targets count from today', async () => {
    const request = { ...baseRequest(), goals: [{ metric: 'fatMass' as const, direction: 'target' as const, target: -4, targetKind: 'change' as const }, { metric: 'leanTissue' as const, direction: 'maximise' as const }] };
    const rung = { kind: 'medium', schedule: gentle.plan.schedule, genome: { structureId: gentle.structure.id, x: Array.from(gentle.x) }, scorecard: [{ goal: 0, start: 26.8 }, { goal: 1, start: 65 }] } as unknown as RungPlan;
    const wed = dateAt(gentle.plan.startDate, 2);
    const p: ActivePlanRecord = toActivePlan(rung, request, { planId: 'p-rung', startDate: wed });
    expect(p.kind).toBe('medium');
    expect(p.request.goals[0]).toMatchObject({ target: 22.8, targetKind: 'absolute' });
    expect(p.provenance.replanFrame!.offset).toBe(-2);
    expect(JSON.stringify(p.schedule.days[0])).toBe(JSON.stringify(gentle.plan.schedule.days[2]));
    expect(p.startDate).toBe(wed);
    const st = confirmedState(p, ANCHOR, { deltaSd: 60 });
    const { r } = await run(replanRequest(p, { ...st, trendWeight: { kg: st.trendWeight.kg - 1.5, sd: 0.3 } }, TODAY, 'weekly'));
    expect(r.status).not.toBe('noSafePlan');
    expect(r.plan.request.goals[0]).toMatchObject({ target: 22.8, targetKind: 'absolute' });
    expect(r.forecast.asPrescribed[0]!.target).toBeCloseTo(22.8, 9);
    // a target the user sets now is measured from today (the trend weight), and stored absolute
    const u = await run(replanRequest(gentle.plan, { ...sGentle, trendWeight: { kg: 93.5, sd: 0.3 } }, TODAY, 'user', { trigger: 'user', changes: { goals: [{ metric: 'scaleWeight', direction: 'target', target: -2, targetKind: 'change' }] } }));
    expect(['ok', 'proposal']).toContain(u.r.status);
    expect(u.r.plan.request.goals[0]).toMatchObject({ metric: 'scaleWeight', target: 91.5, targetKind: 'absolute' });
  }, 90_000);

  it('churn limits: a weekly re-plan keeps the next 7 days within ±10 % energy, ±1 session, no new fast or day type', async () => {
    const { r, d } = await run(replanRequest(mid.plan, sMid, TODAY, 'weekly'));
    expect(d.safetyFirst).toBe(false);
    expect(r.status).not.toBe('noSafePlan');
    if (d.chosen) expect(d.chosen.vL).toBe(0);
    expect(checkReplan(mid.plan.schedule, r.plan.schedule, TODAY, 'weekly').violations).toEqual([]);
  }, 60_000);

  const tplNoId = (sc: Schedule, d: number): string => JSON.stringify({ ...dayTemplate(sc, d), id: undefined });
  it('pinned days (E5b): the person’s edit stays in every candidate, the diff and goal dates compare with the plan before it; all days pinned → no search', async () => {
    const base = gentle.plan.schedule;
    // the first three training days after the lock window lose their sessions
    const pins = Array.from({ length: base.horizonDays - TODAY - 2 }, (_, k) => TODAY + 2 + k).filter((d) => (dayTemplate(base, d).exercise ?? []).length > 0).slice(0, 3);
    expect(pins.length).toBe(3);
    const edited = withDayTemplates(base, new Map(pins.map((d) => [d, { ...dayTemplate(base, d), exercise: undefined, habitualTraining: false }])));
    const plan = { ...gentle.plan, schedule: edited };
    const { r, d } = await run(replanRequest(plan, sGentle, TODAY, 'weekly', { trigger: 'absence', pinnedDays: pins, baseline: base }));
    expect(r.status).not.toBe('noSafePlan');
    expect(r.status).not.toBe('unchanged');
    for (const k of pins) expect(tplNoId(r.plan.schedule, k)).toBe(tplNoId(edited, k));
    // past immutable; the lock window too unless the edited plan needed a safety fix (then today and tomorrow may move)
    for (let k = 0; k < (d.safetyFirst ? TODAY : TODAY + 2); k++) expect(tplNoId(r.plan.schedule, k)).toBe(tplNoId(base, k));
    for (const k of pins) expect(r.diff.some((x) => x.date === dateAt(plan.startDate, k) && x.field === 'training')).toBe(true);
    expect(r.forecast.before?.length).toBe(r.forecast.asPrescribed.length);
    // fewer sessions: the forecast end of fat mass is no lower than before the edit
    expect(r.forecast.asPrescribed[0]!.endP50).toBeGreaterThanOrEqual(r.forecast.before![0]!.endP50 - 1e-6);
    if (!d.safetyFirst) {
      if (d.chosen) expect(d.chosen.vL).toBe(0);
      expect(checkReplan(edited, r.plan.schedule, TODAY, 'weekly').violations).toEqual([]);
    }
    const all = Array.from({ length: base.horizonDays - TODAY }, (_, k) => TODAY + k);
    const fixed = await run(replanRequest(plan, sGentle, TODAY, 'weekly', { trigger: 'absence', pinnedDays: all, baseline: base }));
    expect(fixed.d.candidates).toBe(0);
    expect(JSON.stringify(fixed.r.plan.schedule.days.map((_, k) => tplNoId(fixed.r.plan.schedule, k)))).toBe(JSON.stringify(edited.days.map((_, k) => tplNoId(edited, k))));
  }, 90_000);

  it('automatic changes only lower load (status ok ⇒ every changed day lowers load)', () => {
    const ctx = planContext(gentle.plan);
    const s = gentle.plan.schedule;
    const deeper = withDayTemplates(s, new Map([[15, { ...dayTemplate(s, 15), id: 'deeper', energy: { kind: 'pctMaintenance', pct: pct(dayTemplate(s, 15)) - 10 } }]]));
    const easier = withDayTemplates(s, new Map([[15, { ...dayTemplate(s, 15), id: 'easier', energy: { kind: 'pctMaintenance', pct: pct(dayTemplate(s, 15)) + 5 } }]]));
    expect(loadChange(ctx, s, deeper, TODAY, 28).raises).toContain('a deeper energy deficit');
    const e = loadChange(ctx, s, easier, TODAY, 28);
    expect(e.raises).toEqual([]);
    expect(e.lowers).toBe(true);
    let oks = 0;
    for (const { req, r } of runs) {
      if (r.status === 'proposal') expect(r.proposals.some((p) => p.raisesLoad)).toBe(true);
      if (r.status !== 'ok' || r.plan.schedule === req.plan.schedule) continue;
      oks++;
      expect(loadChange(planContext(r.plan), req.plan.schedule, r.plan.schedule, TODAY, r.plan.schedule.horizonDays).raises).toEqual([]);
    }
    expect(runs.length).toBeGreaterThan(0);
    void oks;
  });

  it('fasting spacing counts the logged past: a long fast logged 5-7 days before today removes the next fasts', async () => {
    const f = makePlan({ pick: (s) => s.skeleton.overlay?.lever === 'fastDay24' && s.skeleton.overlay.perWeek === 1 && s.skeleton.segments.length === 1 && s.skeleton.segments[0]!.kind === 'phase' && s.skeleton.segments[0]!.block === 'B1', x: (st) => withGene(st, 'seg0.energy', 1) });
    const futureFasts = (s: Schedule) => (s.events ?? []).filter((e) => e.startDay >= TODAY).length;
    expect(futureFasts(f.plan.schedule)).toBeGreaterThan(0);
    // without the logged fast the plan with its weekly fasts stands
    const calm = await run(replanRequest(f.plan, confirmedState(f.plan, ANCHOR, { deltaSd: 60 }), TODAY, 'weekly'));
    expect(calm.r.status).toBe('unchanged');
    // three zero-energy days logged (days 3-5): an 85-hour fast; the next fast needs 28 days of eating first
    const zero = (k: number): DayTemplate => ({ ...dayTemplate(f.plan.schedule, k), id: `z${k}`, energy: { kind: 'zero' } });
    const realised = withDayTemplates(f.plan.schedule, new Map([3, 4, 5].map((k) => [k, zero(k)] as const)));
    const logs = logsAsPlanned(f.plan, 3, TODAY, (k, t) => (k <= 5 ? zero(k) : t));
    const { r, d } = await run(replanRequest(f.plan, confirmedState(f.plan, ANCHOR, { realised, deltaSd: 60 }), TODAY, 'weekly', { logs }));
    expect(d.keep.violated).toContain('spacing');
    expect(r.status).not.toBe('noSafePlan');
    expect(futureFasts(r.plan.schedule)).toBe(0);
    for (let k = TODAY; k < 28; k++) expect(dayTemplate(r.plan.schedule, k).energy.kind).not.toBe('zero');
    // the check itself: a 24-h fast 8 days after an 85-hour fast breaks the spacing rule, without it nothing does
    const long: ZeroSpan = { start: 67, end: 152, hours: 85 };
    const next: ZeroSpan = { start: 355, end: 379, hours: 24 };
    expect(futureSpacingViolation([long, next], 240)?.span).toBe(next);
    expect(futureSpacingViolation([next], 240)).toBeNull();
  }, 90_000);

  it('scenario-started plans: kind custom, no genome; a light re-plan keeps a safe plan', async () => {
    const p = toActivePlanFromScenario(gentle.plan.schedule, gentle.plan.request, { planId: 'scn' });
    expect(p.kind).toBe('custom');
    expect(p.genome).toEqual([]);
    const { r, d } = await run(replanRequest(p, sGentle, TODAY, 'light'));
    expect(d.candidates).toBe(0);
    expect(r.status).toBe('unchanged');
  }, 60_000);

  it('texts are plain: no internal references in explanations, diff rows or proposals', () => {
    expect(results.length).toBeGreaterThan(8);
    const hits: string[] = [];
    for (const r of results) {
      const texts = [...r.explanation, ...r.proposals.map((p) => p.text), ...r.diff.flatMap((x) => [x.why, x.before, x.after])];
      for (const t of texts) {
        const l = leak(t);
        if (l) hits.push(l);
      }
      expect(r.explanation.length).toBeGreaterThan(0);
    }
    expect(hits).toEqual([]);
  });
});
