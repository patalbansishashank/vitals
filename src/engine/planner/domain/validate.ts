/**
 * Independent post-validator (dossier 18 §4.4.6 layer 3, §9 item 3, §7.4). Re-expands a returned `Schedule` through
 * its own code path — it shares only the dossier-17 constants and the compiled person caps with the planner, never
 * the decoder, repair or day-estimation code — and checks every input-space bound, tier rule and user hard constraint.
 * A failing plan is discarded, never repaired.
 */
import type { CardioSession, DayTemplate, MacroAmount, Schedule, ScheduleDay, SubstanceSpec } from '../../types/schedule';
import { BLOCKS, type BlockId } from './registry/blocks';
import type { PlanningContext } from './context';
import { generalProteinFloor, HC, tierForHours, type IntensityChannel } from './safety';
import { refeedRamp } from '../../core/compileSchedule';

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
  /**
   * Required comparisons this validator could not make (A1-003/A1-007): a clinician intensity maximum with no comparable
   * stated dose, a dose of unknown mass or an incompletely observed source. Not a violation; never a pass.
   */
  unchecked?: string[];
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
  /** (A1-014) The day's protein / carbohydrate / fat is only a known lower bound (a meal without that analysis). */
  pUnknown: boolean;
  cUnknown: boolean;
  fUnknown: boolean;
  /**
   * A fast-shortened day: touched by a fast event or a graded refeed day (A1-008). An ordinary explicit meal list is not
   * a shortened day: the same diet as meal times/shares or as a count has the same floors.
   */
  shortened: boolean;
  mealHours: number[];
}

/** Mass of one active dose in mg (C3 canonical); null for a molar dose (no declared mass conversion here). */
function activeMg(a: { amount: number; unit: string }): number | null {
  if (!Number.isFinite(a.amount) || a.amount < 0) return null;
  if (a.unit === 'g') return a.amount * 1000;
  if (a.unit === 'mg') return a.amount;
  if (a.unit === 'ug') return a.amount / 1000;
  return null;
}

/**
 * One ingredient's day total over the legacy channel and the normalized actives (A1-007), the validator's own reading:
 * doses sharing an explicit event identity count once; when one side has a dose without identity the two may coincide,
 * so the known total is the larger side and the possible total their sum. `unknown` = a dose of unknown mass.
 */
function ingredientDay(legacy: ReadonlyArray<{ mg: number; eventId?: string }>, actives: SubstanceSpec['actives'], ingredient: string): { known: number; possible: number; unknown: boolean } {
  const ids = new Set(legacy.map((l) => l.eventId).filter(Boolean));
  let sl = 0;
  let lNoId = false;
  for (const l of legacy) {
    if (!(l.mg > 0)) continue;
    sl += l.mg;
    if (!l.eventId) lNoId = true;
  }
  let sa = 0;
  let aNoId = false;
  let unknown = false;
  for (const a of actives ?? []) {
    if (a.ingredient !== ingredient) continue;
    if (a.eventId && ids.has(a.eventId)) continue;
    const mg = activeMg(a);
    if (mg === null) {
      unknown = true;
      continue;
    }
    sa += mg;
    if (!a.eventId) aNoId = true;
  }
  const ambiguous = sl > 0 && sa > 0 && (lNoId || aNoId);
  return { known: ambiguous ? Math.max(sl, sa) : sl + sa, possible: sl + sa, unknown };
}

/** The validator's own reading of a cardio session's comparable intensities (A1-003): every phase, never a mean. */
function cardioParts(x: CardioSession, channel: IntensityChannel): Array<number | null> {
  const scale = (x as { rpeScale?: string }).rpeScale;
  const val = (p: { pctVo2max?: number; met?: number; rpe?: number }, sc: string | undefined): number | null => {
    const v = channel === 'pctVo2maxFraction' ? p.pctVo2max : channel === 'grossMet' ? p.met : sc === 'cr10' ? p.rpe : undefined;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const own = val(x, scale);
  if (!x.phases?.length) return [own];
  const out: Array<number | null> = [];
  let booked = 0;
  for (const ph of x.phases) {
    booked += Math.max(0, ph.durationMin);
    if ((ph.kind as string) === 'remainder') out.push(null);
    else if (ph.pctVo2max !== undefined || ph.met !== undefined || ph.rpe !== undefined || ph.speedKmh !== undefined || ph.powerW !== undefined) out.push(val(ph, (ph as { rpeScale?: string }).rpeScale ?? scale));
    else out.push(own);
  }
  if (booked < x.durationMin - 1e-9) out.push(own);
  return out;
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

function expand(ctx: PlanningContext, t: DayTemplate): Pick<VDay, 'kcal' | 'p' | 'c' | 'f'> {
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

/**
 * Day totals from explicit meals that state their own amounts (A1-008/A1-014), the validator's own reading: a reported
 * meal's energy is exactly its `energyKcal` and only the grams it lists are known (an absent macro is unknown, an
 * explicit 0 a known zero); other meals take their listed grams, else their share of the day's macros — a share-filled
 * gram on a day with reported meals is a scenario fill, not a known amount. Null when no meal states amounts (the day's
 * template totals stand). `unknown*` = the total is only a known lower bound.
 */
function explicitMealTotals(t: DayTemplate, x: { kcal: number; p: number; c: number; f: number }): { kcal: number; p: number; c: number; f: number; pUnknown: boolean; cUnknown: boolean; fUnknown: boolean } | null {
  const ms = t.meals?.meals;
  if (!ms?.length || !ms.some((m) => m.energyKcal !== undefined || m.macros !== undefined)) return null;
  const reportedDay = ms.some((m) => m.energyKcal !== undefined);
  const shares = ms.map((m) => (typeof m.share === 'number' && m.share > 0 ? m.share : 1));
  const S = shares.reduce((a, b) => a + b, 0) || ms.length;
  const r = { kcal: 0, p: 0, c: 0, f: 0, pUnknown: false, cUnknown: false, fUnknown: false };
  const isKnown = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  ms.forEach((m, i) => {
    const w = shares[i]! / S;
    const kn = (m as { nutrientKnowledge?: Partial<Record<string, string>> }).nutrientKnowledge;
    const part = (g: number | undefined, key: 'protein' | 'carbohydrate' | 'fat', dayG: number): { v: number; unknown: boolean } => {
      const stated = kn?.[key];
      if (stated !== undefined && stated !== 'known') return { v: isKnown(g) ? g : 0, unknown: true };
      if (isKnown(g)) return { v: g, unknown: false };
      if (m.energyKcal !== undefined || reportedDay) return { v: 0, unknown: true };
      return { v: w * dayG, unknown: false };
    };
    const p = part(m.macros?.proteinG, 'protein', x.p);
    const c = part(m.macros?.carbG, 'carbohydrate', x.c);
    const f = part(m.macros?.fatG, 'fat', x.f);
    r.p += p.v;
    r.c += c.v;
    r.f += f.v;
    r.pUnknown ||= p.unknown;
    r.cUnknown ||= c.unknown;
    r.fUnknown ||= f.unknown;
    r.kcal += m.energyKcal !== undefined && Number.isFinite(m.energyKcal) && m.energyKcal >= 0 ? m.energyKcal : m.macros ? 4 * p.v + 4 * c.v + 9 * f.v : w * x.kcal;
  });
  return r;
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

/**
 * `elapsedDays`: the schedule starts this many days after the plan start (a re-plan's prescription from today), so the
 * novice / sedentary progression limits (HC-X2, HC-X3) continue from the plan's week instead of restarting at week 1.
 */
export function validatePlan(ctx: PlanningContext, s: Schedule, opts: { elapsedDays?: number } = {}): ValidationResult {
  const wOff = Math.max(0, Math.floor((opts.elapsedDays ?? 0) / 7));
  const reasons: string[] = [];
  const unchecked: string[] = [];
  const bad = (rule: string, msg: string) => {
    if (reasons.length < 40) reasons.push(`${rule}: ${msg}`);
  };
  const cannot = (rule: string, msg: string) => {
    if (unchecked.length < 20 && !unchecked.includes(`${rule}: ${msg}`)) unchecked.push(`${rule}: ${msg}`);
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
    const x0 = expand(ctx, t);
    // (A1-008/A1-014) meals that state their own amounts resolve the day (unknown analysis stays a lower bound)
    const em = explicitMealTotals(t, x0);
    const x = em ?? { ...x0, pUnknown: false, cUnknown: false, fUnknown: false };
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
    // (A1-008) a day is shortened by an actual fast (event coverage) or a graded refeed, never by its meal representation
    days.push({
      t,
      kcal,
      p: eaten ? x.p * factor : 0,
      c: eaten ? x.c * factor : 0,
      f: eaten ? x.f * factor : 0,
      pUnknown: eaten && x.pUnknown,
      cUnknown: eaten && x.cUnknown,
      fUnknown: eaten && x.fUnknown,
      shortened: covered > 1e-9 || factor < 1,
      mealHours: hours,
    });
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
    const deficitPct = 100 - (100 * k) / n / tdee;
    const floor = generalProteinFloor(caps, deficitPct > HC.proteinDeficitThresholdPct + 0.1 ? deficitPct : 0).value / rw;
    const eff = floor;
    if (x.p / rw < eff - 0.005) {
      // (A1-014) a known lower bound under a floor proves nothing when part of the day's protein is unanalysed
      if (x.pUnknown) {
        cannot('HC-M1', `day ${d + 1} protein not fully analysed`);
        continue;
      }
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
    // (A1-014) a known lower bound under a cap cannot prove compliance
    for (let d = a; d < a + 7; d++) if (days[d]!.pUnknown && Number.isFinite(caps.proteinCapRw)) cannot('HC-M2', `days ${a + 1}-${a + 7} protein not fully analysed`);
  }
  // Re-evaluate each canonical clinical requirement on this validator's independently expanded days.
  for (const bound of caps.renal.clinical.bounds) {
    const def = bound.normalized;
    if (bound.status !== 'enforceable' || !def || def.quantity !== 'proteinPerDay') continue;
    if (def.scope !== 'total') { if (def.mandatory) cannot(def.id, 'unsupported clinical protein scope'); continue; }
    if (def.window.kind !== 'day' && def.window.kind !== 'rolling') { if (def.mandatory) cannot(def.id, 'unsupported clinical protein window'); continue; }
    const n = def.window.kind === 'rolling' ? def.window.days : 1;
    if (n > T) { if (def.mandatory) cannot(def.id, 'clinical rolling window incomplete'); continue; }
    for (let end = n - 1; end < T; end++) {
      const window = days.slice(end - n + 1, end + 1);
      if (def.comparator === 'floor' && window.some((d) => d.kcal <= HC.zeroKcal || d.shortened)) continue;
      const amount = window.reduce((sum, d) => sum + d.p, 0) / n;
      const unknown = window.some((d) => d.pUnknown);
      if (def.comparator === 'cap' ? amount > def.value + 0.05 : !unknown && amount < def.value - 0.05)
        bad(def.id, `protein ${amount.toFixed(2)} g/day outside entered ${def.value} g/day (${def.window.kind})`);
      else if (unknown && def.mandatory) cannot(def.id, 'clinical protein not fully analysed');
    }
  }
  for (let d = 0; d < T; d++) {
    const x = days[d]!;
    if (x.kcal < HC.fat.appliesAboveKcal || x.shortened) continue;
    const fFloor = Math.max((HC.fat.minPctEnergy / 100) * x.kcal / 9, caps.fatFloorG);
    if (x.f < fFloor - EPS_G) {
      if (x.fUnknown) cannot('HC-M3', `day ${d + 1} fat not fully analysed`);
      else bad('HC-M3', `day ${d + 1} fat ${x.f.toFixed(0)} g < ${fFloor.toFixed(0)} g`);
    }
    if (caps.carbFloorG > 0 && x.c < caps.carbFloorG - EPS_G) {
      if (x.cUnknown) cannot('HC-M4', `day ${d + 1} carbohydrate not fully analysed`);
      else bad('HC-M4', `day ${d + 1} carbohydrate ${x.c.toFixed(0)} g < ${caps.carbFloorG} g`);
    }
  }
  // D4-01 total-fat lock (% of energy) on every eating day at the planned estimate; the resolved check (runtime
  // maintenance, overrides, refeeds) is `safetyAudit.evaluatePlanSafety`
  if (caps.fatMaxPctEnergy !== null) {
    for (let d = 0; d < T; d++) {
      const x = days[d]!;
      if (!(x.kcal > 0)) continue;
      const pctE = (900 * x.f) / x.kcal;
      if (pctE > caps.fatMaxPctEnergy + EPS_PCT) {
        bad('lock.fat-cap', `day ${d + 1} fat ${pctE.toFixed(1)} % of energy (cap ${caps.fatMaxPctEnergy} %)`);
        break;
      }
      if (x.fUnknown) cannot('lock.fat-cap', `day ${d + 1} fat not fully analysed`);
    }
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
        else if (x.kind === 'resistance' ? !caps.exercise.rtAllowed : !caps.exercise.cardioAllowed) bad('HC-X4', `${x.kind} session on day ${d + 1} is outside the permitted activities`);
        if (!allowed.has((ctx.startWeekday + d) % 7)) bad('user.trainingWeekdays', `session on a disallowed weekday (day ${d + 1})`);
        if ((x.durationMin ?? 60) > pr.maxSessionMin + 1) bad('user.maxSessionMin', `day ${d + 1} session ${x.durationMin} min`);
        if (x.kind === 'cardio' && (x.durationMin ?? 60) > pr.maxCardioSessionMin + 1e-6) bad('user.maxCardioSessionMin', `day ${d + 1} cardio ${x.durationMin} min`);
        for (const z of spans) {
          if (z.h < 24 - 1e-6) continue;
          if (s0 >= z.a && s0 < z.b) bad('HC-F4', `session inside a ${z.h.toFixed(0)}-h fast on day ${d + 1}`);
          if (z.h > 24 + 1e-6 && d >= Math.floor(z.a / 24) && d <= Math.floor((z.b - 1e-9) / 24)) bad('HC-F4', `training on a day touched by a ${z.h.toFixed(0)}-h fast (day ${d + 1})`);
        }
        // (D4-02/A1-003) every clinician intensity maximum on every part of the session (the peak phase, never a mean)
        for (const cap of caps.exercise.intensityCaps ?? []) {
          if (cap.status === 'unknownUnit' || cap.status === 'invalidValue') continue; // the limit itself needs review (final check)
          if (!cap.normalized) {
            cannot('envelope.intensity', `${cap.original.convention} limit has no comparable dose (day ${d + 1})`);
            continue;
          }
          const n = cap.normalized;
          const parts = x.kind === 'cardio' ? cardioParts(x, n.channel) : [n.channel === 'grossMet' && typeof x.met === 'number' && Number.isFinite(x.met) ? x.met : null];
          for (const v of parts) {
            if (v === null) cannot('envelope.intensity', `${x.kind} intensity on day ${d + 1} not comparable to the ${cap.original.convention} limit`);
            else if (v > n.max + 1e-9) bad('envelope.intensity', `${x.kind} intensity ${v} on day ${d + 1} above the clinician limit ${cap.original.max} ${cap.original.unit}`);
          }
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
    if (caps.rtNovice && sets > HC.rtNovice.startSetsMax + HC.rtNovice.setsIncreasePerWeek * (w + wOff) + 0.05) bad('HC-X2', `week ${w + wOff + 1}: ${sets.toFixed(1)} sets per muscle`);
    if (caps.sedentaryStart && minutes > HC.sedentary.startMinPerWeek * Math.pow(1 + HC.sedentary.increasePct / 100, w + wOff) + 1) bad('HC-X3', `week ${w + wOff + 1}: ${minutes} exercise minutes`);
    if (to - from === 7 && active >= 7) bad('HC-X3', `week ${w + 1} has no rest day`);
  }

  // ---- exercise gate (D4-02): no "training as usual" while exercise prescription is stopped, steps ≤ the ceiling; (A1-004)
  // from the day the governing envelope's entered review date passes, no sessions and steps at the habit
  const lapse = caps.exercise.gateChange ?? null;
  for (let d = 0; d < T; d++) {
    const t = days[d]!.t;
    if (lapse !== null && d >= lapse.day) {
      if ((t.exercise ?? []).length || t.habitualTraining) bad('HC-X4.envelope', `training on day ${d + 1} after the clinician review date ${lapse.date}`);
      const hab = Math.max(0, ctx.rp.habits.typicalSteps);
      if (t.steps !== undefined && t.steps > hab + 0.5) bad('HC-X4.steps', `day ${d + 1} prescribes ${Math.round(t.steps)} steps after the clinician review date (habit ${Math.round(hab)})`);
    }
    if (t.habitualTraining && !caps.exercise.habitualTrainingAllowed) bad('HC-X4', `training as usual on day ${d + 1} although exercise prescription is stopped`);
    if (t.habitualTraining && (caps.exercise.intensityCaps ?? []).some((c) => c.status !== 'unknownUnit' && c.status !== 'invalidValue')) cannot('envelope.intensity', `training as usual on day ${d + 1} has no stated intensity`);
    const ceil = caps.exercise.stepsCeiling;
    if (ceil !== null && t.steps !== undefined && t.steps > ceil + 0.5) bad('HC-X4.steps', `day ${d + 1} prescribes ${Math.round(t.steps)} steps (ceiling ${Math.round(ceil)})`);
  }

  // ---- substances and opt-in levers (HC-M10..M12, 21 L7/L8; D4-01 caffeine, creatine and potassium-supplement caps).
  // (A1-007) the legacy channels and the normalized active-ingredient doses together, in canonical units (1000 mg = 1 g),
  // a dose shared by an explicit event identity once; an observed day whose source is not fully observed is unchecked
  const potCap = ctx.caps.constraints.merged.find((m) => m.quantity === 'potassiumSupplementPerDay' && m.comparator === 'cap')?.value ?? null;
  for (let d = 0; d < T; d++) {
    const t = days[d]!.t;
    const sub = t.substances;
    const obs = t.observed;
    const fully = (ch: 'caffeine' | 'supplements') => {
      if (!obs) return true;
      const c = obs.coverage?.[ch];
      return c === 'complete' || c === 'confirmedZero';
    };
    if (sub?.alcohol?.length) bad('HC-M10', `alcohol on day ${d + 1}`);
    const caf = ingredientDay((sub?.caffeine ?? []).map((c) => ({ mg: c.mg, ...(c.eventId ? { eventId: c.eventId } : {}) })), sub?.actives, 'caffeine');
    if (caf.known > 0 || caf.unknown) {
      const doses = [...(sub?.caffeine ?? []).map((c) => c.mg), ...(sub?.actives ?? []).filter((a) => a.ingredient === 'caffeine').map((a) => activeMg(a) ?? 0)];
      if (caf.known > 400 || doses.some((mg) => mg > 200)) bad('HC-M11', `caffeine on day ${d + 1}`);
      if (caps.caffeineMaxMgPerDay !== null && caf.known > caps.caffeineMaxMgPerDay + 0.5) bad('lock.caffeine-cap', `caffeine ${caf.known} mg on day ${d + 1} (cap ${caps.caffeineMaxMgPerDay} mg/day)`);
      else if (caps.caffeineMaxMgPerDay !== null && (caf.unknown || caf.possible > caps.caffeineMaxMgPerDay + 0.5 || !fully('caffeine') || !fully('supplements'))) cannot('lock.caffeine-cap', `caffeine on day ${d + 1} not fully known`);
    }
    const cre = ingredientDay(sub?.creatineG !== undefined && sub.creatineG > 0 ? [{ mg: sub.creatineG * 1000 }] : [], sub?.actives, 'creatine');
    if (cre.known > 0 || cre.unknown) {
      const g = cre.known / 1000;
      if (g > caps.creatineMaxG + 1e-9) bad('HC-M12', `creatine ${+g.toFixed(3)} g on day ${d + 1}`);
      else if (cre.unknown || cre.possible / 1000 > caps.creatineMaxG + 1e-9 || !fully('supplements')) cannot('HC-M12', `creatine on day ${d + 1} not fully known`);
      if (!caps.creatineAllowed || pr.excluded.has('L7') || pr.excluded.has('creatine')) bad('HC-M12', `creatine not allowed (day ${d + 1})`);
    }
    if (potCap !== null) {
      const pot = ingredientDay([], sub?.actives, 'potassium');
      if (pot.known / 1000 > potCap + 1e-9) bad('lock.potassium-supp-cap', `potassium supplement ${+(pot.known / 1000).toFixed(3)} g on day ${d + 1} (cap ${potCap} g/day)`);
      else if (pot.unknown || !fully('supplements')) cannot('lock.potassium-supp-cap', `potassium supplement on day ${d + 1} not fully known`);
    }
    if (sub?.creatineLoading) bad('HC-M12', 'creatine loading is not planned');
    if (t.macros.fatTypes?.omega3G && !(caps.optInLevers.has('L8') || caps.optInLevers.has('omega3'))) bad('tier.optIn', 'omega-3 without consent');
    if (t.energy.kind === 'zero' && (pr.fastingRefused || pr.excluded.has('zeroDay'))) bad('user.excluded', `zero-energy day ${d + 1}`);
  }
  for (const v of evs) {
    const lever = v.e.durationH <= 24 ? 'fastDay24' : 'waterFast';
    if (pr.excluded.has(lever)) bad('user.excluded', `${lever} on day ${v.e.startDay + 1}`);
  }
  return { ok: reasons.length === 0, reasons, ...(unchecked.length ? { unchecked } : {}) };
}
