/**
 * Validation harness for the fasting module (test-only; never imported by production code).
 *
 * The real `fastingModule` is stepped hour by hour inside hand-built stand-ins for the modules it talks to, each
 * written from its MODEL_SPEC section (reduced forms; the integration pass must re-run 20 V1-V10 with the real modules):
 *  - intake (§1.3): first-order absorption (τ 3 h) of each meal's energy, protein and carbohydrate;
 *  - energy (§1.5): RMR_mass = RMR0 + 22·ΔLT + 3.2·ΔFM (02 §4.2, R-RMRMASS); AT_R held while the overlay is active or
 *    |fastRmrMult − 1| > 0.001 (R-FAST-AT, M19); P_eff frozen while fasting (M6); kP 0.6; NEAT0·BW/BW0 + AT_N (02 §4.8:
 *    β 0.14 / β⁺ 0.12, 40/60 split, τ 7/14 d on, 14 d off); TEF 10 % of absorbed energy; no GNG cost (M5);
 *    maintenance EI_inst = (RMR_mass + AT_R + NEAT + AT_N)/(1 − α0) without fastRmrMult; tdeeEst = yesterday's TDEE;
 *  - fuel (§1.6, 04 §4.2, 20 §4.3.1): liver τ_L 24 h to a 5 g floor while carbohydrate is absent, muscle
 *    −k_Mf·(G_M − 0.35·G_M0) while fastActive, refill τ 12 h (liver) / 24 h (muscle) on ≥ 50 g/d carbohydrate;
 *  - ketones (§1.7): BHB = 20 §4.3.4 BHB_ref (the ketones calibration target) during the overlay, relaxing to 0.1 mM with a
 *    1-h half-life after refeeding; urinary ketone energy 10 g/d fat-equivalent above 1.5 mM (20 §4B.1 step 5);
 *  - composition (§1.8): per-hour regime (M7): fasting branch ΔLT = −fastProtOx·(1 + h_P)/1000, fat by the residual
 *    (ρF + ηF 9 620, ρL + ηL 2 045 kcal/kg); otherwise a Forbes lean share p0 = 10.4/(10.4 + FM) of mass change (03 §4.4
 *    base, protein/RT modifiers omitted) plus the explicit repletion term; M9 smooth fat floor (FM_min = 0.02·BW0);
 *  - water (§1.10): glycogen water 3 g/g, E_cna* = −0.6·max(0, 1 − carb24/100)·(1 + 0.5·fastActive) (τ 1.5 d down,
 *    0.7 d up), gut to 0 while fasting (τ 1.5 d, M16) else (S0 + 5·NSP)·T_tr, refeeding oedema from fasting.
 */
import { bhbRefMmolL, type FastingConstants, type FastingState } from './index';
import { makeRig, type FastingRig } from './testkit';

export interface HarnessPerson {
  sex: 'M' | 'F';
  ageY: number;
  heightCm: number;
  bwKg: number;
  bfPct: number;
  /** Habitual non-resting, non-TEF energy as a fraction of RMR0 (20 §4A: 0.40 lean, 0.35 obese). */
  activityFrac?: number;
  liverG0?: number;
  muscleG0?: number;
  /** Habitual protein, g/kg BW (default 15.6 %E, MODEL_SPEC §5.3) and carbohydrate share of energy (default 0.5, 20 §4.6.3). */
  proteinGPerKg?: number;
  carbShare?: number;
}

/** Hourly intake: ingested kcal, protein g, carbohydrate g, planned-fast flag, day sodium mg and day carbohydrate g. */
export interface HourIntake {
  kcal: number;
  protein: number;
  carb: number;
  planned: number;
  sodiumMg: number;
  dayCarb: number;
}

export type IntakeFn = (hour: number, base: HarnessBaseline, out: HourIntake) => void;

export interface HarnessBaseline {
  rmr0: number;
  neat0: number;
  tdee0: number;
  fm0: number;
  ffm0: number;
  bw0: number;
  p0: number;
  carb0: number;
}

export interface DayRecord {
  day: number;
  dBw: number;
  dFm: number;
  /** Hydrated protein tissue change ΔLT, kg. */
  dLt: number;
  dDxaLean: number;
  dGlyWater: number;
  dEcfGut: number;
  /** RMR incl. fastRmrMult (≈ measured REE), kcal/d, and change vs RMR0 (fraction). */
  rmr: number;
  rmrRel: number;
  tee: number;
  /** Urinary N over the day, g; protein oxidised by the overlay, g. */
  nDay: number;
  protOxDay: number;
  bhbEnd: number;
  sN: number;
  sAT: number;
  dLabG: number;
  oedemaL: number;
  active: number;
  muscleGlyRel: number;
}

const RHO_F = 9441 + 179;
const RHO_L = 1816 + 229;
const RHO_G = 4.207;
const TEF = 0.1;
const ABS_F = Math.exp(-1 / 3);

export function baselineOf(p: HarnessPerson): HarnessBaseline {
  const fm0 = (p.bwKg * p.bfPct) / 100;
  const ffm0 = p.bwKg - fm0;
  const rmr0 = 10 * p.bwKg + 6.25 * p.heightCm - 5 * p.ageY + (p.sex === 'M' ? 5 : -161);
  const neat0 = (p.activityFrac ?? (p.bfPct >= 30 ? 0.35 : 0.4)) * rmr0;
  const tdee0 = (rmr0 + neat0) / (1 - TEF);
  const p0 = p.proteinGPerKg !== undefined ? p.proteinGPerKg * p.bwKg : (0.156 * tdee0) / 4;
  const carb0 = ((p.carbShare ?? 0.5) * tdee0) / 4;
  return { rmr0, neat0, tdee0, fm0, ffm0, bw0: p.bwKg, p0, carb0 };
}

/** Habitual three-meal day (08, 13, 19 h) at `frac` of TDEE0 with the baseline macro mix (protein g/kg optional). */
export function mealsHour(
  hod: number,
  base: HarnessBaseline,
  out: HourIntake,
  frac = 1,
  proteinG?: number,
  carbShare = 0.5,
): void {
  if (hod === 8 || hod === 13 || hod === 19) {
    out.kcal = (frac * base.tdee0) / 3;
    out.protein = (proteinG ?? frac * base.p0) / 3;
    out.carb = (carbShare * frac * base.tdee0) / 4 / 3;
  } else {
    out.kcal = 0;
    out.protein = 0;
    out.carb = 0;
  }
  out.planned = 0;
  out.sodiumMg = 3000;
  out.dayCarb = (carbShare * frac * base.tdee0) / 4;
}

/**
 * A planned water-only fast (FastEvent) of `fastH` hours starting at absolute hour `startH`; habitual meals at 08/13/19 h
 * before (a meal inside the span moves to the nearest earlier free hour, as the schedule compiler does), a meal in the
 * first hour after the span (dinner → dinner fasts), then habitual meals at `refeedFrac` of TDEE0 (50 % carbohydrate,
 * protein 1.3 g/kg BW0 unless given) — 20 §4.6.3's refeed assumption.
 */
export function waterFast(
  startH: number,
  fastH: number,
  refeedFrac = 1,
  refeedProteinGPerKg = 1.3,
): IntakeFn {
  const end = startH + fastH;
  return (h, base, out) => {
    if (h >= startH && h < end) {
      out.kcal = 0;
      out.protein = 0;
      out.carb = 0;
      out.planned = 1;
      out.sodiumMg = 3000;
      out.dayCarb = 0;
      return;
    }
    const hod = h % 24;
    if (h < startH) {
      // the start-day meal falling inside the span is eaten in the hour before the span
      const moved = h === startH - 1 && (startH % 24 === 8 || startH % 24 === 13 || startH % 24 === 19);
      mealsHour(moved ? startH % 24 : hod, base, out);
      return;
    }
    const proteinG = refeedProteinGPerKg * base.bw0 * refeedFrac;
    if (h === end) mealsHour(19, base, out, refeedFrac, proteinG);
    else mealsHour(hod, base, out, refeedFrac, proteinG);
  };
}

export interface HarnessRun {
  base: HarnessBaseline;
  days: DayRecord[];
  rig: FastingRig;
  /** Hourly traces (for § 4B.3 checks). */
  hourlyN: Float64Array;
  hourlySN: Float64Array;
  hourlySAT: Float64Array;
  /** Hourly ΔBW, ΔFM and ΔLT (kg) at the end of each hour, relative to t = 0. */
  hourlyBw: Float64Array;
  hourlyFm: Float64Array;
  hourlyLt: Float64Array;
  hourlyRmrRel: Float64Array;
}

export interface HarnessOptions {
  fastSpans?: { startHour: number; endHour: number; electrolytes: boolean }[];
  paramOverrides?: Record<string, number>;
  /** Hours of the habitual day simulated before t = 0 (burn-in, 3 d default). */
  burnInH?: number;
}

export function runHarness(
  p: HarnessPerson,
  nDays: number,
  intake: IntakeFn,
  opts: HarnessOptions = {},
): HarnessRun {
  const base = baselineOf(p);
  const nH = nDays * 24;
  const rig = makeRig(
    {
      ffm0Kg: base.ffm0,
      fm0Kg: base.fm0,
      tdee0Kcal: base.tdee0,
      habitualProteinG: base.p0,
      habitualCarbG: base.carb0,
    },
    {
      nDays,
      fastSpans: opts.fastSpans ?? [],
      paramOverrides: opts.paramOverrides,
      checks: true,
      startHour: -(opts.burnInH ?? 72),
    },
  );
  const k: FastingConstants = rig.k;
  const s: FastingState = rig.s;
  const bus = rig.bus;
  const kMf = paramValue(opts, 'fasting.kMf', 0.008);
  const hP = paramValue(opts, 'fasting.hP', 1.6);

  // states
  const gL0 = p.liverG0 ?? (p.sex === 'M' ? 85 : 65);
  const gM0 = p.muscleG0 ?? base.ffm0 * (p.sex === 'M' ? 6.76 : 5.84);
  let fm = base.fm0;
  let dLt = 0;
  let gL = gL0;
  let gM = gM0;
  let eCna = 0;
  const gutFed = (((p.sex === 'M' ? 162 : 83) + 5 * 20) * (p.sex === 'M' ? 2 : 3)) / 1000;
  const tTrH = (p.sex === 'M' ? 2 : 3) * 24;
  let gut = gutFed;
  let atR = 0;
  let atN = 0;
  let pEff = base.p0;
  let gutK = 0; // unabsorbed energy in the gut, kcal
  let gutC = 0; // unabsorbed carbohydrate, g
  let bhb = 0.1;
  let dayEi = 0;
  let dayTee = 0;
  let bwRef = 0;
  const hin: HourIntake = { kcal: 0, protein: 0, carb: 0, planned: 0, sodiumMg: 3000, dayCarb: 0 };
  const days: DayRecord[] = [];
  const hourlyN = new Float64Array(nH);
  const hourlySN = new Float64Array(nH);
  const hourlySAT = new Float64Array(nH);
  const hourlyBw = new Float64Array(nH);
  const hourlyFm = new Float64Array(nH);
  const hourlyLt = new Float64Array(nH);
  const hourlyRmrRel = new Float64Array(nH);
  let nDay = 0;
  let protDay = 0;
  let rmrLast: number;
  let teeLast: number;
  const burn = opts.burnInH ?? 72;

  bus.maintenanceKcalD = base.tdee0;
  bus.tdeeEstKcalD = base.tdee0;

  const scale = (): number =>
    fm + base.ffm0 + dLt + (4 * (gL + gM - gL0 - gM0)) / 1000 + eCna + (gut - gutFed) + bus.fastOedemaL;

  for (let hh = -burn; hh < nH; hh++) {
    const h = hh < 0 ? hh + 24 * Math.ceil(burn / 24) : hh; // burn-in replays the habitual day
    if (hh < 0) mealsHour(h % 24, base, hin);
    else intake(hh, base, hin);

    // ---- intake: absorption (τ 3 h)
    gutK += hin.kcal;
    gutC += hin.carb;
    const absK = gutK * (1 - ABS_F);
    const absC = gutC * (1 - ABS_F);
    gutK -= absK;
    gutC -= absC;

    // ---- fasting (the module under test; previous-hour FM/FFM/BHB on the bus)
    bus.fatMassKg = fm;
    bus.ffmActKg = base.ffm0 + dLt;
    bus.bhbMmolL = bhb;
    bus.bhbEndoMmolL = bhb;
    rig.step(hin.kcal, hin.protein, hin.carb, hin.planned, hin.sodiumMg, hin.dayCarb);
    const active = bus.fastActive === 1;
    const mult = bus.fastRmrMult;

    // ---- energy
    const bw = fm + base.ffm0 + dLt;
    const rmrMass = base.rmr0 + 22 * dLt + 3.2 * (fm - base.fm0);
    if (!active) pEff = s.protein24 + (pEff - s.protein24) * Math.exp(-1 / 48); // frozen while fasting (M6)
    const rmr = (rmrMass + atR + 0.6 * (pEff - base.p0)) * mult;
    const neat = (base.neat0 * bw) / base.bw0 + atN;
    const teeH = (rmr + neat) / 24 + TEF * absK;
    rmrLast = rmr;

    // ---- fuel (glycogen, g)
    const gL1 =
      s.carb24 < 10 || active
        ? 5 + (gL - 5) * Math.exp(-1 / 24)
        : s.carb24 >= 50
          ? gL0 + (gL - gL0) * Math.exp(-1 / 12)
          : gL;
    const gM1 = active
      ? 0.35 * gM0 + (gM - 0.35 * gM0) * Math.exp(-kMf)
      : s.carb24 >= 50
        ? gM0 + (gM - gM0) * Math.exp(-1 / 24)
        : gM;
    const dG = gL1 - gL + (gM1 - gM);
    gL = gL1;
    gM = gM1;

    // ---- ketones (hand-built BHB trajectory = 20 §4.3.4 reference) and urinary ketone energy
    const bhbNext = active
      ? bhbRefMmolL(k, s.tFastH, (100 * fm) / bw, s.carbFast24)
      : 0.1 + (bhb - 0.1) * 0.5;
    const ketLossH = (10 * 9.441 * Math.min(1, Math.max(0, (bhb - 1.5) / 2))) / 24;

    // ---- composition (per-hour regime, M7)
    const sH = absK - teeH - ketLossH - RHO_G * dG;
    let dLtH: number;
    let dFmH: number;
    const floorW = Math.min(1, Math.max(0, (fm - 0.02 * base.bw0) / 1.0)); // M9 smooth fat floor
    if (active) {
      const dLtF = -(bus.fastProtOxGH * (1 + hP)) / 1000;
      const resid = sH + RHO_L * -dLtF; // energy left for fat after the protein flux
      if (resid < 0) {
        dFmH = (floorW * resid) / RHO_F;
        dLtH = dLtF + ((1 - floorW) * resid) / RHO_L;
      } else {
        dFmH = resid / RHO_F;
        dLtH = dLtF;
      }
    } else {
      const dLtRep = (bus.fastRepletionGH * (1 + hP)) / 1000;
      const sPrime = sH - RHO_L * dLtRep;
      const pCat = 10.4 / (10.4 + fm);
      let pE = (pCat * RHO_L) / (pCat * RHO_L + (1 - pCat) * RHO_F);
      if (sPrime < 0) pE = pE + (1 - pE) * (1 - floorW);
      dLtH = dLtRep + (pE * sPrime) / RHO_L;
      dFmH = ((1 - pE) * sPrime) / RHO_F;
    }
    fm += dFmH;
    dLt += dLtH;
    const depCost = 179 * dFmH + 229 * dLtH;

    // ---- water
    const eTarget = -0.6 * Math.max(0, 1 - s.carb24 / 100) * (1 + 0.5 * (active ? 1 : 0));
    eCna = eTarget + (eCna - eTarget) * Math.exp(-1 / ((eTarget < eCna ? 1.5 : 0.7) * 24));
    const gTarget = active ? 0 : gutFed;
    gut = gTarget + (gut - gTarget) * Math.exp(-1 / (active ? 36 : tTrH / 2));
    bhb = bhbNext;

    // ---- day accumulators and daily signals
    dayEi += absK;
    dayTee += teeH + depCost;
    if (hh >= 0) {
      nDay += s.uNGd / 24;
      protDay += bus.fastProtOxGH;
      hourlyN[hh] = s.uNGd;
      hourlySN[hh] = s.sN;
      hourlySAT[hh] = s.sAT;
    }
    teeLast = dayTee;
    if (hh === -1) bwRef = scale();
    if (hh >= 0) {
      hourlyBw[hh] = scale() - bwRef;
      hourlyFm[hh] = fm - base.fm0;
      hourlyLt[hh] = dLt;
      hourlyRmrRel[hh] = rmr / base.rmr0 - 1;
    }
    if ((hh + 1) % 24 === 0) {
      // endOfDay: AT (02 §4.8), maintenance, tdeeEst
      const dEi = dayEi - base.tdee0;
      const atStar = (dEi < 0 ? 0.14 : 0.12) * dEi;
      const held = active || Math.abs(mult - 1) > 0.001;
      if (!held)
        atR =
          0.4 * atStar +
          (atR - 0.4 * atStar) * Math.exp(-1 / (Math.abs(0.4 * atStar) > Math.abs(atR) ? 7 : 14));
      atN = 0.6 * atStar + (atN - 0.6 * atStar) * Math.exp(-1 / 14);
      bus.maintenanceKcalD = (rmrMass + atR + neat) / (1 - TEF);
      bus.tdeeEstKcalD = dayTee;
      if (hh >= 0) {
        const bwNow = scale();
        days.push({
          day: (hh + 1) / 24,
          dBw: bwNow - bwRef,
          dFm: fm - base.fm0,
          dLt,
          dDxaLean: bwNow - bwRef - (fm - base.fm0),
          dGlyWater: (4 * (gL + gM - gL0 - gM0)) / 1000,
          dEcfGut: eCna + gut - gutFed,
          rmr: rmrLast,
          rmrRel: rmrLast / base.rmr0 - 1,
          tee: teeLast,
          nDay,
          protOxDay: protDay,
          bhbEnd: bhb,
          sN: s.sN,
          sAT: s.sAT,
          dLabG: s.dLabG,
          oedemaL: bus.fastOedemaL,
          active: bus.fastActive,
          muscleGlyRel: gM / gM0,
        });
      }
      nDay = 0;
      protDay = 0;
      dayEi = 0;
      dayTee = 0;
    }
  }
  return { base, days, rig, hourlyN, hourlySN, hourlySAT, hourlyBw, hourlyFm, hourlyLt, hourlyRmrRel };
}

function paramValue(opts: HarnessOptions, id: string, dflt: number): number {
  return opts.paramOverrides?.[id] ?? dflt;
}

/** Cohort mean of several person runs with weights (e.g. 7 men / 6 women). */
export function cohortMean(
  runs: { run: HarnessRun; w: number }[],
  day: number,
  f: (d: DayRecord) => number,
): number {
  let sw = 0;
  let sv = 0;
  for (const { run, w } of runs) {
    const d = run.days[day - 1];
    if (!d) throw new Error(`day ${day} not simulated`);
    sv += w * f(d);
    sw += w;
  }
  return sv / sw;
}
