/**
 * Pure equations of the moderators module (dossier 16). Every function is a pure function of numbers (no allocation),
 * so the unit tests can check each one against the dossier's worked numbers and the module can call them in the
 * daily hooks. Units: sleep hours h, debt h, caffeine mg, minutes, g/kg, days.
 */

/** 16 §4.1.1 nightly deficit: d_t = max(0, hRef − sleep) + qualityEq (poor sleep) + shift-work equivalent. */
export function nightlyDeficitH(hRef: number, sleepH: number, poor: number, shift: number, poorH: number, shiftH: number): number {
  const d = hRef - sleepH;
  return (d > 0 ? d : 0) + (poor > 0 ? poorH : 0) + (shift > 0 ? shiftH : 0);
}

/** 16 §4.0.1 insulin-sensitivity multiplier 1 − k·min(dS, cap). */
export function siSleepMult(dS: number, perH: number, cap: number): number {
  return 1 - perH * (dS < cap ? dS : cap);
}

/** 16 §4.0.1 MPS / RT-accretion multiplier 1 − k·min(dS, cap) (= 09 f_sleep). */
export function mpsSleepMult(dS: number, perH: number, cap: number): number {
  return 1 - perH * (dS < cap ? dS : cap);
}

/** 16 §4.0.1 testosterone multiplier for men 1 − k·min(dS, cap_T); women / unspecified sex = 1. */
export function testoSleepMult(dS: number, perH: number, capT: number, isMale: boolean): number {
  return isMale ? 1 - perH * (dS < capT ? dS : capT) : 1;
}

/**
 * 16 §4.1.3 added P-ratio (protein-energy share of loss) from slow sleep debt, deficit only:
 * `u < 0 ? min(cap, k·dS·min(1, (−u)/uRef)) : 0` with u = energyBalanceFrac of the previous day.
 */
export function partitionSleepShift(dS: number, u: number, perH: number, cap: number, uRef: number): number {
  if (!(u < 0)) return 0;
  const r = -u / uRef;
  const shift = perH * dS * (r < 1 ? r : 1);
  return shift < cap ? shift : cap;
}

/** Caffeine body load after `hours` of first-order decay with half-life t½ (16 §4.2.1: C = dose·2^(−t/t½)). */
export function caffeineResidualMg(doseMg: number, hoursBefore: number, tHalfH: number): number {
  return doseMg * Math.pow(2, -hoursBefore / tHalfH);
}

/** Caffeine half-life with the 16 §4.2.1 modifiers: combined oral contraceptive ×1.47, smoker ×0.56. */
export function caffeineHalfLifeH(tHalfH: number, combinedOral: boolean, smoker: boolean, ocMult: number, smokerMult: number): number {
  return tHalfH * (combinedOral ? ocMult : 1) * (smoker ? smokerMult : 1);
}

/** 16 §4.2.1 total-sleep-time loss, minutes: min(cap, k·max(0, R − R*)). */
export function tstLossMin(residualMg: number, rStarMg: number, perMg: number, capMin: number): number {
  const x = residualMg - rStarMg;
  if (!(x > 0)) return 0;
  const loss = perMg * x;
  return loss < capMin ? loss : capMin;
}

/** 15 §4.10 next-night recovery penalty (fraction of the HRV recovery scale) by dose g/kg: 0 / low / mid / high. */
export function alcoholRecoveryPenalty(gPerKg: number, doseLow: number, doseHigh: number, penLow: number, penMid: number, penHigh: number): number {
  if (!(gPerKg > 0)) return 0;
  return gPerKg <= doseLow ? penLow : gPerKg <= doseHigh ? penMid : penHigh;
}

/**
 * Sleep-quality index (MODEL_SPEC §1.1 step 6): base − TSTloss/ptsPerMin − 100·alcohol penalty, clamped to [0, 100].
 * UI heuristic (grade D): never fed back into the simulation.
 */
export function sleepQualityIndex(base: number, tstLossMinutes: number, ptsPerMin: number, alcoholPenalty: number): number {
  const v = base - tstLossMinutes / ptsPerMin - 100 * alcoholPenalty;
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** First luteal cycle day for a cycle of length L days: ceil(L/2) + 1 (16 §4.5; days 15-28 for L = 28). */
export function lutealStartDay(cycleLenD: number): number {
  return Math.ceil(cycleLenD / 2) + 1;
}

/**
 * Luteal-phase weight s(d) ∈ [0, 1] (02 §4.3): 1 on luteal days, linear ramps of `rampDays` (2) on both sides
 * (distance in days to the nearest luteal day, circular over the cycle). `cycleDay` is 1-based (1 = first day of flow).
 * Returns 0 when `cycleDay < 1` (not tracked).
 */
export function lutealWeightAt(cycleDay: number, cycleLenD: number, rampDays: number): number {
  if (cycleDay < 1) return 0;
  const start = lutealStartDay(cycleLenD);
  if (cycleDay >= start) return 1;
  // days before the luteal phase: distance to its first day, or (wrapping) days since the previous cycle's last day
  const before = start - cycleDay;
  const after = cycleDay;
  const dist = before < after ? before : after;
  const w = 1 - dist / rampDays;
  return w > 0 ? w : 0;
}

/** Mean of s(d) over one cycle (energy centres the luteal RMR term with it so that the phase-averaged RMR0 is unchanged). */
export function lutealMeanWeight(cycleLenD: number, rampDays: number): number {
  let sum = 0;
  for (let d = 1; d <= cycleLenD; d++) sum += lutealWeightAt(d, cycleLenD, rampDays);
  return sum / cycleLenD;
}

/** Days since 1970-01-01 of a proleptic-Gregorian civil date (Hinnant's algorithm; no Date object: deterministic). */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** Parse the leading `YYYY-MM-DD` of an ISO string to a day number; NaN when malformed. */
export function isoDayNumber(iso: string | undefined): number {
  if (!iso) return Number.NaN;
  const m = ISO_DAY.exec(iso);
  if (!m) return Number.NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return Number.NaN;
  return daysFromCivil(y, mo, d);
}

/** Non-negative modulo. */
export const mod = (a: number, n: number): number => ((a % n) + n) % n;

/**
 * 1-based cycle day on simulation day `dayIndex` (may be negative during burn-in) for a cycle of length L whose last
 * period began on `lastPeriodDay` (day number) with simulation day 0 at `startDay` (day number).
 */
export function cycleDayOn(lastPeriodDay: number, startDay: number, dayIndex: number, cycleLenD: number): number {
  return mod(startDay - lastPeriodDay + dayIndex, cycleLenD) + 1;
}
