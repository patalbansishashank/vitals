/**
 * Independent post-validator (dossier 18 §4.4.6 layer 3, §9 item 3, §7.4). Re-expands a returned `Schedule` through
 * its own code path — it shares only the dossier-17 constants and the compiled person caps with the planner, never
 * the decoder, repair or day-estimation code — and checks every input-space bound, tier rule and user hard constraint.
 * A failing plan is discarded, never repaired.
 */
import type { DayTemplate, MacroAmount, Schedule, ScheduleDay } from '../../types/schedule';
import { BLOCKS, type BlockId } from './registry/blocks';
import type { PlanningContext } from './context';
import { HC, tierForHours } from './safety';
import { refeedRamp } from '../../core/compileSchedule';

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}

/** 10 §4.8 moderate-equivalent intensity bands, fraction of VO2max (upper bounds checked). */
const BAND_MAX: Record<string, number> = { walk: 0.55, run: 0.85, cycle: 0.7, swim: 0.7, row: 0.7, other: 0.7, hiit: 1 };
const EPS_PCT = 0.5;
const EPS_G = 1;

interface VDay {
  t: DayTemplate;
  kcal: number;
  p: number;
  c: number;
  f: number;
  /** Explicit kept meals (a fast-shortened day). */
  shortened: boolean;
  mealHours: number[];
}

function merged(s: Schedule, d: number): DayTemplate {
  const sd: ScheduleDay = s.days[d]!;
  const b = s.programs[sd.program]!;
  const o = sd.override;
  if (!o) return b;
  const t = { ...b, ...o } as DayTemplate;
  if (o.macros) t.macros = { ...b.macros, ...o.macros };
  if (o.meals) t.meals = { ...b.meals, ...o.meals };
  if (o.hydration) t.hydration = { ...b.hydration, ...o.hydration };
  if (o.substances) t.substances = { ...b.substances, ...o.substances };
  if (o.sleep) t.sleep = { ...b.sleep, ...o.sleep };
  return t;
}

function amount(m: MacroAmount | { unit: 'gPer1000Kcal'; value: number } | undefined, perG: number, E: number, bw: number, ffm: number): number | null {
  if (!m) return null;
  if (m.unit === 'g') return m.value;
  if (m.unit === 'gPerKgBw') return m.value * bw;
  if (m.unit === 'gPerKgFfm') return m.value * ffm;
  if (m.unit === 'pctEnergy') return (m.value / 100) * E / perG;
  if (m.unit === 'gPer1000Kcal') return (m.value * E) / 1000;
  return null; // remainder
}

function expand(ctx: PlanningContext, t: DayTemplate): Omit<VDay, 't' | 'shortened' | 'mealHours'> {
  const tdee = ctx.rp.tdee0Kcal;
  const bw = ctx.rp.weightKg;
  const ffm = ctx.rp.ffm0Kg;
  const e = t.energy;
  const E = e.kind === 'zero' ? 0 : e.kind === 'kcal' ? e.kcal : (e.pct * tdee) / 100;
  if (E <= 0) return { kcal: 0, p: 0, c: 0, f: 0 };
  const fib = amount(t.macros.fibre, 2, E, bw, ffm) ?? (8 * E) / 1000;
  let p = amount(t.macros.protein, 4, E, bw, ffm);
  let c = amount(t.macros.carbs, 4, E, bw, ffm);
  let f = amount(t.macros.fat, 9, E, bw, ffm);
  const rest = Math.max(0, E - 4 * (p ?? 0) - 4 * (c ?? 0) - 9 * (f ?? 0) - 2 * fib);
  if (f === null) f = rest / 9;
  else if (c === null) c = rest / 4;
  else if (p === null) p = rest / 4;
  p = p ?? 0;
  c = c ?? 0;
  return { kcal: 4 * p + 4 * c + 9 * f + 2 * fib, p, c, f };
}

function mealTimes(t: DayTemplate): number[] {
  const m = t.meals ?? {};
  if (m.meals?.length) return m.meals.map((x) => x.clockH);
  const n = Math.max(1, Math.round(m.count ?? 3));
  const s = m.window?.startH ?? 8;
  const L = m.window?.lengthH ?? 12;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(n === 1 ? s : s + (L * i) / (n - 1));
  return out;
}

export function validatePlan(ctx: PlanningContext, s: Schedule): ValidationResult {
  const reasons: string[] = [];
  const bad = (rule: string, msg: string) => {
    if (reasons.length < 40) reasons.push(`${rule}: ${msg}`);
  };
  const caps = ctx.caps;
  const pr = ctx.practical;
  const T = s.horizonDays;
  const tdee = ctx.rp.tdee0Kcal;
  if (caps.blocked) return { ok: false, reasons: [`blocked: ${caps.blocked}`] };
  if (s.schemaVersion !== 1 || s.days.length !== T || T < 1) return { ok: false, reasons: ['structure: malformed schedule'] };
  for (const sd of s.days) if (!(sd.program >= 0 && sd.program < s.programs.length)) return { ok: false, reasons: ['structure: invalid program index'] };

  // ---- blocks (tier / exclusions / simulate-only)
  for (const b of s.blocks ?? []) {
    const id = b.buildingBlockId as BlockId | undefined;
    if (!id) continue;
    const blk = BLOCKS[id];
    if (!blk) continue;
    if (blk.use === 'simulateOnly' || blk.use === 'registryOnly') bad('tier', `${id} is not planner-prescribable`);
    const tier = blk.tier(caps);
    if (tier === 'never' || tier === 'expert') bad('tier', `${id} is not available for this person`);
    if (pr.excluded.has(id)) bad('user.excluded', `${id} was excluded`);
  }

  // ---- per-day expansion
  const evs = (s.events ?? []).map((e) => ({ a: e.startDay * 24 + e.startH, b: e.startDay * 24 + e.startH + e.durationH, e }));
  const days: VDay[] = [];
  const intake: number[] = [];
  for (let d = 0; d < T; d++) {
    const t = merged(s, d);
    const x = expand(ctx, t);
    const covered = evs.reduce((acc, v) => acc + Math.max(0, Math.min(v.b, d * 24 + 24) - Math.max(v.a, d * 24)), 0);
    const hours: number[] = [];
    if (covered < 24 - 1e-9 && x.kcal > HC.zeroKcal) {
      const mt = mealTimes(t);
      if (x.kcal / mt.length > HC.zeroKcal) for (const c of mt) {
        const h = d * 24 + c;
        // last intake at a and first at b are eaten; meals strictly inside the fast are not (ruling 18:10)
        if (!evs.some((v) => h > v.a + 1e-6 && h < v.b - 1e-6)) hours.push(h);
      }
    }
    let factor = 1;
    for (const v of evs) {
      const ramp = v.e.refeedFactors?.length ? v.e.refeedFactors : v.e.refeed === 'auto' ? refeedRamp(v.e.durationH) : [];
      const i = d - Math.floor((v.b + 1e-9) / 24);
      if (i >= 0 && i < ramp.length) factor = Math.min(factor, ramp[i]!);
    }
    const eaten = !(covered >= 24 - 1e-9 || hours.length === 0);
    // the engine scales every macro of a refeed day by its factor (17 HC-F3)
    const kcal = eaten ? x.kcal * factor : 0;
    days.push({ t, kcal, p: eaten ? x.p * factor : 0, c: eaten ? x.c * factor : 0, f: eaten ? x.f * factor : 0, shortened: !!t.meals?.meals?.length || factor < 1, mealHours: hours });
    intake.push(...hours);
  }
  intake.sort((a, b) => a - b);

  // ---- energy (HC-E8, no-deficit profiles, rolling planned mean vs HC-E3 / HC-E1, HC-E2)
  const need = Math.max(caps.deficitCapPct > 0 ? 100 - caps.deficitCapPct : 100, (100 * caps.energyFloorKcal) / tdee);
  const touched = (d: number) => evs.some((v) => v.a < d * 24 + 24 && v.b > d * 24);
  // fast days (ruling 18:10): touched by a ≥ 24-h fast, zero-energy days, and the locked refeed days of longer fasts
  const fastDay = new Uint8Array(T);
  for (const v of evs) {
    if (v.e.durationH < 24 - 1e-6) continue;
    for (let d = Math.max(0, Math.floor(v.a / 24)); d <= Math.min(T - 1, Math.floor((v.b - 1e-9) / 24)); d++) fastDay[d] = 1;
    if (v.e.durationH > 24 + 1e-6) {
      const end = Math.floor((v.b + 1e-9) / 24);
      const n = Math.max(2, refeedRamp(v.e.durationH).length);
      for (let d = end; d < Math.min(T, end + n); d++) fastDay[d] = 1;
    }
  }
  for (let d = 0; d < T; d++) if (days[d]!.t.energy.kind === 'zero') fastDay[d] = 1;
  for (let d = 0; d < T; d++) {
    const x = days[d]!;
    const pct = (100 * x.kcal) / tdee;
    if (x.t.energy.kind === 'pctMaintenance' && x.t.energy.pct > caps.maxPctTdee + EPS_PCT) bad('HC-E8', `day ${d + 1} planned at ${x.t.energy.pct.toFixed(0)} % of maintenance`);
    if (caps.deficitCapPct <= 0 && !fastDay[d] && pct < 100 - EPS_PCT) bad('HC-P3/P4', `day ${d + 1} is below maintenance`);
  }
  // 7-day deficit cap / kcal floor on non-fast days; 28-day mean-intake floor on all days (ruling 18:10)
  for (let a = 0; a + 7 <= T; a++) {
    let sum = 0;
    let n = 0;
    for (let d = a; d < a + 7; d++) if (!fastDay[d]) {
      sum += days[d]!.kcal;
      n++;
    }
    if (!n) continue;
    const pct = (100 * sum) / n / tdee;
    if (pct < need - EPS_PCT) {
      bad('HC-E3/E1', `non-fast days ${a + 1}-${a + 7} average ${pct.toFixed(1)} % of maintenance (minimum ${need.toFixed(1)} %)`);
      break;
    }
  }
  const W28 = Math.min(28, T);
  for (let a = 0; a + W28 <= T; a++) {
    let sum = 0;
    for (let d = a; d < a + W28; d++) sum += days[d]!.kcal;
    if (sum / W28 < caps.energyFloorKcal - 1) {
      bad('HC-E1.28d', `days ${a + 1}-${a + W28} average ${Math.round(sum / W28)} kcal (floor ${caps.energyFloorKcal})`);
      break;
    }
  }
  const restricted = (d: number) => !touched(d) && days[d]!.kcal > HC.zeroKcal && days[d]!.kcal < caps.restrictedDayUpperKcal;
  for (let d = 0; d < T; d++) {
    if (!restricted(d)) continue;
    if (days[d]!.kcal < caps.restrictedDayMinKcal - 1) bad('HC-E2', `day ${d + 1} below ${caps.restrictedDayMinKcal} kcal`);
    if (d > 0 && restricted(d - 1)) bad('HC-E2', `consecutive restricted days ${d}-${d + 1}`);
    let n = 0;
    for (let k = Math.max(0, d - 6); k <= d; k++) if (restricted(k)) n++;
    if (n > HC.restrictedDay.maxPer7d) bad('HC-E2', `more than 2 restricted days in the 7 days to day ${d + 1}`);
  }

  // ---- macros: protein (7-d means), fat and carbohydrate floors (eating days ≥ 800 kcal, not fast-shortened)
  const rw = caps.rwKg;
  // HC-M1 on plain eating days; "deficit" = trailing 7-d planned deficit > 10 % (17 §2.1 deficit_pct_7)
  for (let d = 0; d < T; d++) {
    const x = days[d]!;
    if (x.kcal < caps.restrictedDayUpperKcal || x.shortened || touched(d)) continue;
    let k = 0;
    let n = 0;
    for (let j = Math.max(0, d - 6); j <= d; j++) {
      k += days[j]!.kcal;
      n++;
    }
    // borderline weeks (within 0.1 % of the 10 % deficit threshold) are judged with the lower floor (repair uses the higher)
    const floor = (100 * k) / n / tdee < 100 - HC.proteinDeficitThresholdPct - 0.1 || caps.ageYears >= 65 ? caps.proteinFloorDeficitRw : caps.proteinFloorRw;
    // the floor can never exceed the hard caps (35 %E, 3.1 g/kg FFM, protein lock): safety wins over a user floor
    const eff = Math.min(floor, (HC.protein.capPctEnergy / 100) * x.kcal / 4 / rw, (caps.proteinCapGPerKgFfm * caps.ffmKg) / rw, caps.proteinCapRw);
    if (x.p / rw < eff - 0.005) {
      bad('HC-M1', `day ${d + 1} protein ${(x.p / rw).toFixed(2)} g/kg (floor ${floor})`);
      break;
    }
  }
  for (let a = 0; a + 7 <= T; a += 1) {
    let pSum = 0;
    let kSum = 0;
    for (let d = a; d < a + 7; d++) {
      pSum += days[d]!.p * (days[d]!.kcal > 0 ? 1 : 0);
      kSum += days[d]!.kcal;
    }
    const pMean = pSum / 7 / rw;
    if (pMean > caps.proteinCapRw + 0.02 || pSum / 7 > caps.proteinCapGPerKgFfm * caps.ffmKg + EPS_G) {
      bad('HC-M2', `protein above the cap in days ${a + 1}-${a + 7}`);
      break;
    }
    if (kSum > 0 && (400 * pSum) / kSum > HC.protein.capPctEnergy + EPS_PCT) {
      bad('HC-M2', `protein above 35 % of energy in days ${a + 1}-${a + 7}`);
      break;
    }
  }
  for (let d = 0; d < T; d++) {
    const x = days[d]!;
    if (x.kcal < HC.fat.appliesAboveKcal || x.shortened) continue;
    const fFloor = Math.max((HC.fat.minPctEnergy / 100) * x.kcal / 9, caps.fatFloorG);
    if (x.f < fFloor - EPS_G) bad('HC-M3', `day ${d + 1} fat ${x.f.toFixed(0)} g < ${fFloor.toFixed(0)} g`);
    if (caps.carbFloorG > 0 && x.c < caps.carbFloorG - EPS_G) bad('HC-M4', `day ${d + 1} carbohydrate ${x.c.toFixed(0)} g < ${caps.carbFloorG} g`);
  }

  // ---- eating window, meals (HC-F5, user window, single-meal days)
  for (let d = 0; d < T; d++) {
    const x = days[d]!;
    if (x.kcal <= 0 || touched(d) || x.shortened) continue;
    const mt = mealTimes(x.t);
    if (mt.length < 2) bad('HC-F5', `day ${d + 1} has a single meal`);
    const len = Math.max(...mt) - Math.min(...mt);
    if (len < caps.minWindowH - 0.01) bad('HC-F5', `day ${d + 1} eating window ${len.toFixed(1)} h < ${caps.minWindowH} h`);
    if (Math.min(...mt) < pr.earliestH - 0.01 || Math.max(...mt) > pr.latestH + 0.01) bad('user.eatingWindow', `day ${d + 1} meals outside ${pr.earliestH}-${pr.latestH} h`);
    if (mt.length > pr.meals.max) bad('user.meals', `day ${d + 1} has ${mt.length} meals`);
  }

  // ---- zero-intake spans: tiers, consent, spacing, cumulative hours, refeed (HC-F1, HC-F2, HC-F3, 20 §4C)
  const spans: Array<{ a: number; b: number; h: number }> = [];
  for (let i = 1; i < intake.length; i++) {
    const h = intake[i]! - intake[i - 1]!;
    if (h > HC.tierMaxH.T0 + 1e-9) spans.push({ a: intake[i - 1]!, b: intake[i]!, h });
  }
  for (const z of spans) {
    const tier = tierForHours(z.h);
    if (z.h > caps.maxFastH + 1e-6 || !caps.fastTierAllowed[tier]) bad('HC-F1', `${z.h.toFixed(0)}-h fast (${tier}) not allowed`);
    if (pr.fastingRefused || !ctx.fastingRelevant) bad('fasting-goal', `${z.h.toFixed(0)}-h fast planned although fasting is refused or not goal-relevant`);
  }
  // HC-F2 with the engine's semantics (safety spacingViolation + fastH_7 ledger; ruling R-T4CAP): eating gap to the previous
  // fast ≥ 24 h / 7 d (T3) / 28 d (T4); counts by resume time; ≤ 108 fasted hours of T0-T3 fasts per 7 calendar days
  const tierN = (h: number) => Number(tierForHours(h).slice(1));
  const ledger = new Map<number, number>();
  for (let i = 0; i < spans.length; i++) {
    const z = spans[i]!;
    const tz = tierN(z.h);
    if (i > 0) {
      const y = spans[i - 1]!;
      const tmax = Math.max(tz, tierN(y.h));
      const need = tmax >= 4 ? 28 * 24 : tmax === 3 ? 7 * 24 : 24;
      if (z.a - y.b < need - 1e-6) bad('HC-F2', `only ${((z.a - y.b) / 24).toFixed(1)} d of eating before the fast ending at hour ${z.b.toFixed(0)} (minimum ${need / 24} d)`);
    }
    const back = (days: number, pred: (y: { a: number; b: number; h: number }) => boolean) =>
      spans.filter((y, j) => j <= i && y.b >= z.b - days * 24 - 1e-6 && pred(y)).length;
    if (tz <= 2 && back(7, () => true) > 3) bad('HC-F2', 'more than 3 fasts in 7 days');
    if (tz <= 2 && z.h > 36 + 1e-6 && back(7, (y) => y.h > 36 + 1e-6) > 2) bad('HC-F2', 'more than 2 fasts over 36 h in 7 days');
    if (tz >= 3 && back(30, (y) => tierN(y.h) >= 3) > 2) bad('HC-F2', 'more than 2 fasts over 48 h in 30 days');
    if (tz >= 4 && (back(84, (y) => tierN(y.h) >= 4) > 1 || back(365, (y) => tierN(y.h) >= 4) > 4)) bad('HC-F2', 'more than 1 expert-tier fast in 12 weeks');
    for (let j = 0; j < i; j++) {
      const y = spans[j]!;
      const gapDays = Math.max(z.h, y.h) > 72 + 1e-6 ? 84 : Math.max(z.h, y.h) > 48 + 1e-6 ? 30 : 14;
      if (z.h >= 48 - 1e-6 && y.h >= 48 - 1e-6 && z.a - y.a < gapDays * 24 - 1e-6) bad('13 B14/B15', 'multi-day fasts too frequent');
    }
    if (tz <= 3) {
      for (let d = Math.floor(z.a / 24); d <= Math.floor((z.b - 1e-9) / 24); d++) ledger.set(d, (ledger.get(d) ?? 0) + Math.min(z.b, d * 24 + 24) - Math.max(z.a, d * 24));
      for (let end = Math.floor(z.a / 24); end <= Math.floor((z.b - 1e-9) / 24) + 6; end++) {
        let h7 = 0;
        for (let d = end - 6; d <= end; d++) h7 += ledger.get(d) ?? 0;
        if (h7 > HC.fastH7Max + 1e-6) {
          bad('HC-F2', `cumulative fasting cap exceeded in the 7 days to day ${end + 1}`);
          break;
        }
      }
    }
    if (z.h >= 48 - 1e-6) {
      const endDay = Math.floor((z.b + 1e-9) / 24);
      const nRec = Math.max(2, refeedRamp(z.h).length);
      for (let d = endDay; d < endDay + nRec; d++) {
        if (d >= T) continue;
        const e = days[d]!.t.energy;
        if (e.kind === 'pctMaintenance' && e.pct >= 120 - 1e-6) bad('13 rule 4', `day ${d + 1} ≥ 120 % right after a ${z.h.toFixed(0)}-h fast`);
        if ((days[d]!.t.exercise ?? []).length) bad('HC-F3/F4', `training on recovery day ${d + 1}`);
      }
    }
  }
  for (const v of evs) if (v.e.durationH > 48 + 1e-6 && v.e.refeed !== 'auto' && !v.e.refeedFactors?.length) bad('HC-F3', `fast on day ${v.e.startDay + 1} without the graded refeed`);

  // ---- exercise (HC-F4, HC-X2..X5, user days / length, rest day)
  const allowed = new Set(pr.allowedTrainingWeekdays);
  const weeks = Math.ceil(T / 7);
  for (let w = 0; w < weeks; w++) {
    let sets = 0;
    let minutes = 0;
    let active = 0;
    const from = w * 7;
    const to = Math.min(T, from + 7);
    for (let d = from; d < to; d++) {
      const ex = days[d]!.t.exercise ?? [];
      if (ex.length) active++;
      for (const x of ex) {
        const s0 = d * 24 + x.startH;
        if (!caps.exercise.allowed) bad('HC-X4', `session on day ${d + 1} although exercise prescription is locked`);
        if (!allowed.has((ctx.startWeekday + d) % 7)) bad('user.trainingWeekdays', `session on a disallowed weekday (day ${d + 1})`);
        if ((x.durationMin ?? 60) > pr.maxSessionMin + 1) bad('user.maxSessionMin', `day ${d + 1} session ${x.durationMin} min`);
        for (const z of spans) {
          if (z.h < 24 - 1e-6) continue;
          if (s0 >= z.a && s0 < z.b) bad('HC-F4', `session inside a ${z.h.toFixed(0)}-h fast on day ${d + 1}`);
          if (z.h > 24 + 1e-6 && d >= Math.floor(z.a / 24) && d <= Math.floor((z.b - 1e-9) / 24)) bad('HC-F4', `training on a day touched by a ${z.h.toFixed(0)}-h fast (day ${d + 1})`);
        }
        if (x.kind === 'cardio') {
          minutes += x.durationMin;
          if ((caps.exercise.lightModerateOnly || caps.exercise.noVigorousOutdoor) && (x.modality === 'hiit' || x.modality === 'run')) bad('HC-X4/X5', `vigorous modality on day ${d + 1}`);
          if (x.pctVo2max !== undefined && x.pctVo2max > (BAND_MAX[x.modality] ?? 0.7) + 1e-6) bad('HC-X4', `cardio above the moderate band on day ${d + 1}`);
        } else {
          minutes += x.durationMin ?? 60;
          const v = Object.values(x.setsByRegion ?? {}).map((q) => q ?? 0);
          sets += v.length ? Math.max(...v) : 0;
        }
      }
    }
    if (caps.rtNovice && sets > HC.rtNovice.startSetsMax + HC.rtNovice.setsIncreasePerWeek * w + 0.05) bad('HC-X2', `week ${w + 1}: ${sets.toFixed(1)} sets per muscle`);
    if (caps.sedentaryStart && minutes > HC.sedentary.startMinPerWeek * Math.pow(1 + HC.sedentary.increasePct / 100, w) + 1) bad('HC-X3', `week ${w + 1}: ${minutes} exercise minutes`);
    if (to - from === 7 && active >= 7) bad('HC-X3', `week ${w + 1} has no rest day`);
  }

  // ---- substances and opt-in levers (HC-M10..M12, 21 L7/L8)
  for (let d = 0; d < T; d++) {
    const t = days[d]!.t;
    const sub = t.substances;
    if (sub?.alcohol?.length) bad('HC-M10', `alcohol on day ${d + 1}`);
    if (sub?.caffeine?.length) {
      const tot = sub.caffeine.reduce((a, c) => a + c.mg, 0);
      if (tot > 400 || sub.caffeine.some((c) => c.mg > 200)) bad('HC-M11', `caffeine on day ${d + 1}`);
    }
    if (sub?.creatineG !== undefined && sub.creatineG > 0) {
      if (sub.creatineG > HC.creatineMaxG + 1e-9) bad('HC-M12', `creatine ${sub.creatineG} g on day ${d + 1}`);
      if (!caps.creatineAllowed || pr.excluded.has('L7') || pr.excluded.has('creatine')) bad('HC-M12', `creatine not allowed (day ${d + 1})`);
    }
    if (sub?.creatineLoading) bad('HC-M12', 'creatine loading is not planned');
    if (t.macros.fatTypes?.omega3G && !(caps.optInLevers.has('L8') || caps.optInLevers.has('omega3'))) bad('tier.optIn', 'omega-3 without consent');
    if (t.energy.kind === 'zero' && (pr.fastingRefused || pr.excluded.has('zeroDay'))) bad('user.excluded', `zero-energy day ${d + 1}`);
  }
  for (const v of evs) {
    const lever = v.e.durationH <= 24 ? 'fastDay24' : 'waterFast';
    if (pr.excluded.has(lever)) bad('user.excluded', `${lever} on day ${v.e.startDay + 1}`);
  }
  return { ok: reasons.length === 0, reasons };
}
