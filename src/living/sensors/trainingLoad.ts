/**
 * Training load of approved bouts (`train-load/1`, Addendum A.1.2 #33). Descriptive only: no injury or readiness claim, and
 * it never feeds an index other than `recovery-index/6`'s prior-day load part (TRIMP only).
 *
 * Per approved bout, ONE method:
 *  - session-RPE `minutes × rpe` when the bout's rating is on Borg CR10 (`rpeScale: 'cr10'`; Foster 2001);
 *  - else Banister TRIMP over supported minutes: f = clip((HR − HRrest)/(HRmax − HRrest), 0, 1), Σ Δmin·f·c(f) with
 *    c = 0.64·e^(1.92f) (male) or 0.86·e^(1.67f) (female). TRIMP needs a WAKING HRrest (entered, not the sleeping low) and a
 *    known coefficient set; otherwise the bout's load is `unavailable` (never estimated).
 * The two methods are different scales (AU): they are never summed; each has its own day series and the card names the one
 * used. dayLoad = Σ by the bout's start day; acute = Σ of 7 days; chronic = Σ of 28 days ÷ 4; ratio = acute ÷ chronic:
 * under 0.8 "Below usual", 0.8-1.3 "In range", over 1.3 "Above usual" (P, a convention). Learning until 21 days of history.
 *
 * Warrants: empirical-formal B for TRIMP and session-RPE as internal-load descriptors (Banister 1991; Foster 2001), W11
 * eminence for their coaching use; C for the ring's HR during the bout; the ratio bands are a convention (P, C) and the
 * acute:chronic ratio has no validated injury meaning (it is shown as "usual", never as risk).
 */
import type { EffortScale } from '@/engine/types/schedule';
import { SENSOR_VERSIONS, clip01, clipSegments, isFiniteNum, sp, type CoefficientSex, type HrSegment, type Interval } from './types';

export type LoadMethod = 'sessionRpe' | 'trimp';

export interface LoadBout {
  id: string;
  /** Local date of the bout's start (YYYY-MM-DD). */
  date: string;
  durationMin: number;
  rpe?: number | null;
  rpeScale?: EffortScale | null;
  window?: Interval;
  pauses?: readonly Interval[];
  segments?: readonly HrSegment[];
}

export interface LoadProfile {
  hrMax: number | null;
  /** A WAKING resting HR (the profile's `override`); the sleeping-low proxy is not accepted. */
  wakingHrRest: number | null;
  sex: CoefficientSex;
}

export type BoutLoad =
  | { id: string; date: string; method: LoadMethod; au: number; status: 'inferred' }
  | { id: string; date: string; method: null; au: null; status: 'unavailable'; reason: 'noWakingRest' | 'sexUnknown' | 'noHr' | 'noHrMax' };

/** Banister TRIMP of supported segments, AU. */
export function banisterTrimp(segments: readonly HrSegment[], hrMax: number, hrRest: number, sex: 'male' | 'female'): number {
  const a = sex === 'male' ? sp('banisterMaleA') : sp('banisterFemaleA');
  const b = sex === 'male' ? sp('banisterMaleB') : sp('banisterFemaleB');
  let t = 0;
  for (const s of segments) {
    const dMin = (s.end - s.start) / 60_000;
    const f = clip01((s.bpm - hrRest) / (hrMax - hrRest));
    t += dMin * f * a * Math.exp(b * f);
  }
  return t;
}

export function boutLoad(b: LoadBout, p: LoadProfile): BoutLoad {
  if (b.rpeScale === 'cr10' && isFiniteNum(b.rpe) && b.rpe >= 0 && b.rpe <= 10 && b.durationMin > 0) return { id: b.id, date: b.date, method: 'sessionRpe', au: b.durationMin * b.rpe, status: 'inferred' };
  const no = (reason: 'noWakingRest' | 'sexUnknown' | 'noHr' | 'noHrMax'): BoutLoad => ({ id: b.id, date: b.date, method: null, au: null, status: 'unavailable', reason });
  if (!isFiniteNum(p.hrMax)) return no('noHrMax');
  if (!isFiniteNum(p.wakingHrRest)) return no('noWakingRest');
  if (p.sex !== 'male' && p.sex !== 'female') return no('sexUnknown');
  const segs = b.window ? clipSegments(b.segments ?? [], b.window, b.pauses ?? []) : clipSegments(b.segments ?? [], { start: -Infinity, end: Infinity });
  if (segs.length === 0) return no('noHr');
  return { id: b.id, date: b.date, method: 'trimp', au: banisterTrimp(segs, p.hrMax, p.wakingHrRest, p.sex), status: 'inferred' };
}

const DAY = 86_400_000;
const dayNum = (d: string): number => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);

export type LoadWord = 'Below usual' | 'In range' | 'Above usual';

export interface LoadSummary {
  method: LoadMethod;
  dayLoad: number;
  acute: number;
  chronic: number;
  ratio: number | null;
  word: LoadWord | null;
  /** Day loads of the 28 days ending on the date (oldest first). */
  days28: number[];
  bouts: number;
}

export interface TrainingLoad {
  version: typeof SENSOR_VERSIONS.trainingLoad;
  date: string;
  /** The method of most bouts in the 28 days (the card names it); null when none has a load. */
  method: LoadMethod | null;
  byMethod: Record<LoadMethod, LoadSummary | null>;
  /** Both methods occur in the window: they are separate scales, never summed. */
  mixed: boolean;
  learning: boolean;
  historyDays: number;
  perBout: BoutLoad[];
  unit: 'AU';
  status: 'inferred' | 'unavailable';
}

/** The day's training load from approved bouts (`historyStart`: the first date with any recorded data). */
export function trainingLoad(i: { date: string; bouts: readonly LoadBout[]; profile: LoadProfile; historyStart?: string | null }): TrainingLoad {
  const d0 = dayNum(i.date);
  const perBout = i.bouts.map((b) => boutLoad(b, i.profile));
  const summary = (m: LoadMethod): LoadSummary | null => {
    const days = new Array<number>(28).fill(0);
    let n = 0;
    for (const b of perBout) {
      if (b.method !== m) continue;
      const k = d0 - dayNum(b.date);
      if (k < 0 || k > 27) continue;
      days[27 - k]! += b.au;
      n++;
    }
    if (n === 0) return null;
    const acute = days.slice(21).reduce((a, x) => a + x, 0);
    const chronic = days.reduce((a, x) => a + x, 0) / 4;
    const ratio = chronic > 0 ? acute / chronic : null;
    const word: LoadWord | null = ratio === null ? null : ratio < sp('loadRatioLo') ? 'Below usual' : ratio > sp('loadRatioHi') ? 'Above usual' : 'In range';
    return { method: m, dayLoad: days[27]!, acute, chronic, ratio, word, days28: days, bouts: n };
  };
  const trimp = summary('trimp');
  const srpe = summary('sessionRpe');
  const method = trimp && srpe ? (srpe.bouts > trimp.bouts ? 'sessionRpe' : 'trimp') : trimp ? 'trimp' : srpe ? 'sessionRpe' : null;
  const firstDates = [i.historyStart, ...i.bouts.map((b) => b.date)].filter((x): x is string => typeof x === 'string' && x.length >= 10);
  const first = firstDates.length > 0 ? Math.min(...firstDates.map(dayNum)) : d0;
  const historyDays = d0 - first + 1;
  return {
    version: SENSOR_VERSIONS.trainingLoad,
    date: i.date,
    method,
    byMethod: { trimp, sessionRpe: srpe },
    mixed: trimp !== null && srpe !== null,
    learning: historyDays < sp('loadLearningDays'),
    historyDays,
    perBout,
    unit: 'AU',
    status: method === null ? 'unavailable' : 'inferred',
  };
}

/**
 * Prior-day TRIMP balance for `recovery-index/6` (the Gauge recovery v5 form, `LocalInsightEngine.kt`, moved from active
 * minutes onto TRIMP): z = clip((yesterday − median)/max(IQR/1.349, 10 AU), ±3) over the prior 28 days' daily TRIMP (days
 * with a TRIMP bout, or given rest days as 0), score = 100·e^(−0.5·max(0, z)²): only an unusually high prior day lowers
 * it; a quiet day is never "poor". Null when TRIMP is unavailable, yesterday has no record, or fewer than 7 days span ≥ 6.
 */
export function priorDayTrimpBalance(i: { date: string; bouts: readonly LoadBout[]; profile: LoadProfile; restDays?: readonly string[] }): { priorDay: number; median28: number; scale: number; z: number; score: number; days: number } | null {
  const d0 = dayNum(i.date);
  const byDay = new Map<number, number>();
  for (const r of i.restDays ?? []) byDay.set(dayNum(r), byDay.get(dayNum(r)) ?? 0);
  for (const b of i.bouts) {
    const l = boutLoad(b, i.profile);
    if (l.method !== 'trimp') continue;
    const k = dayNum(b.date);
    byDay.set(k, (byDay.get(k) ?? 0) + l.au);
  }
  const prior: number[] = [];
  let firstK = Infinity;
  let lastK = -Infinity;
  for (let k = d0 - 29; k <= d0 - 2; k++)
    if (byDay.has(k)) {
      prior.push(byDay.get(k)!);
      firstK = Math.min(firstK, k);
      lastK = Math.max(lastK, k);
    }
  if (prior.length < sp('loadBalanceMinDays') || lastK - firstK < 6 || !byDay.has(d0 - 1)) return null;
  const s = prior.slice().sort((a, b) => a - b);
  const q = (p: number) => {
    const x = p * (s.length - 1);
    const lo = Math.floor(x);
    return s[lo]! + (s[Math.min(s.length - 1, lo + 1)]! - s[lo]!) * (x - lo);
  };
  const m = q(0.5);
  const scale = Math.max((q(0.75) - q(0.25)) / 1.349, sp('loadBalanceScaleFloor'));
  const priorDay = byDay.get(d0 - 1)!;
  const z = Math.max(-sp('zClip'), Math.min(sp('zClip'), (priorDay - m) / scale));
  const zp = Math.max(0, z);
  return { priorDay, median28: m, scale, z, score: 100 * Math.exp(-0.5 * zp * zp), days: prior.length };
}
