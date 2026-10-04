/**
 * Marker units, conversions and entry bounds (docs/SUITE_SPEC.md §13.5.1). Pure.
 *
 * Canonical units are the engine's `LabBaselines` units; the lipid and glucose factors are the cardiometabolic module's
 * own constants so a value entered here lands on the engine unchanged. Lp(a) is never converted: mg/dL and nmol/L
 * measure different things (isoform-dependent), so each keeps its own thresholds.
 *
 * Bounds: `plausible` blocks entry (values no living adult's lab prints; engineering values, wider than any range in
 * the research files); `soft` asks "is this right?" (outside it a typo or a unit slip is likelier than the value; set
 * at or beyond the research files' clinician-only thresholds so a real critical value is asked about, not blocked).
 */
import { MGDL_PER_MMOLL_CHOL, MGDL_PER_MMOLL_GLC, MGDL_PER_MMOLL_TG } from '@/engine/model/cardiometabolic/baselines';
import type { MarkerGroupId, MarkerId } from './types';

/** One accepted unit: canonical = value × factor (+ offset). */
interface UnitDef {
  unit: string;
  factor: number;
  offset?: number;
}

export interface MarkerUnitSpec {
  id: MarkerId;
  /** Short name on screen ("LDL cholesterol"). */
  label: string;
  /** Plain words under the name ("bad cholesterol"). */
  plain: string;
  group: MarkerGroupId;
  canonical: string;
  /** Accepted units; the first is the usual one on Indian reports. */
  units: readonly UnitDef[];
  /** Lp(a): every accepted unit is its own canonical unit (no conversion). */
  noConversion?: boolean;
  /** Blocks entry, canonical unit. */
  plausible: readonly [number, number];
  /** Asks "is this right?", canonical unit. */
  soft: readonly [number, number];
  /** Decimals to show in the canonical unit. */
  dp: number;
}

const r = (x: number): number => Math.round(x * 1e6) / 1e6;

export const MARKER_UNITS: Readonly<Record<MarkerId, MarkerUnitSpec>> = {
  ldl: {
    id: 'ldl',
    label: 'LDL cholesterol',
    plain: 'bad cholesterol',
    group: 'lipids',
    canonical: 'mmol/L',
    units: [
      { unit: 'mg/dL', factor: 1 / MGDL_PER_MMOLL_CHOL },
      { unit: 'mmol/L', factor: 1 },
    ],
    plausible: [0.1, 26],
    soft: [0.8, 7.8],
    dp: 2,
  },
  hdl: {
    id: 'hdl',
    label: 'HDL cholesterol',
    plain: 'good cholesterol',
    group: 'lipids',
    canonical: 'mmol/L',
    units: [
      { unit: 'mg/dL', factor: 1 / MGDL_PER_MMOLL_CHOL },
      { unit: 'mmol/L', factor: 1 },
    ],
    plausible: [0.1, 5.2],
    soft: [0.5, 3.1],
    dp: 2,
  },
  nonHdl: {
    id: 'nonHdl',
    label: 'non-HDL cholesterol',
    plain: 'total minus good cholesterol',
    group: 'lipids',
    canonical: 'mmol/L',
    units: [
      { unit: 'mg/dL', factor: 1 / MGDL_PER_MMOLL_CHOL },
      { unit: 'mmol/L', factor: 1 },
    ],
    plausible: [0.2, 26],
    soft: [1.3, 7.8],
    dp: 2,
  },
  tg: {
    id: 'tg',
    label: 'triglycerides',
    plain: 'blood fats',
    group: 'lipids',
    canonical: 'mmol/L',
    units: [
      { unit: 'mg/dL', factor: 1 / MGDL_PER_MMOLL_TG },
      { unit: 'mmol/L', factor: 1 },
    ],
    plausible: [0.2, 56],
    soft: [0.3, 11.3],
    dp: 2,
  },
  apoB: {
    id: 'apoB',
    label: 'ApoB',
    plain: 'number of cholesterol-carrying particles',
    group: 'lipids',
    canonical: 'g/L',
    units: [
      { unit: 'mg/dL', factor: 0.01 },
      { unit: 'g/L', factor: 1 },
    ],
    plausible: [0.1, 4],
    soft: [0.3, 2],
    dp: 2,
  },
  lpa: {
    id: 'lpa',
    label: 'Lp(a)',
    plain: 'inherited cholesterol particle',
    group: 'lipids',
    canonical: 'mg/dL',
    units: [
      { unit: 'mg/dL', factor: 1 },
      { unit: 'nmol/L', factor: 1 },
    ],
    noConversion: true,
    plausible: [0, 1000],
    soft: [0, 400],
    dp: 0,
  },
  fpg: {
    id: 'fpg',
    label: 'fasting glucose',
    plain: 'blood sugar after no food overnight',
    group: 'sugar',
    canonical: 'mmol/L',
    units: [
      { unit: 'mg/dL', factor: 1 / MGDL_PER_MMOLL_GLC },
      { unit: 'mmol/L', factor: 1 },
    ],
    plausible: [1, 50],
    soft: [3, 22],
    dp: 1,
  },
  hba1c: {
    id: 'hba1c',
    label: 'HbA1c',
    plain: 'average blood sugar over about 3 months',
    group: 'sugar',
    canonical: '%',
    units: [
      { unit: '%', factor: 1 },
      { unit: 'mmol/mol', factor: 0.09148, offset: 2.152 },
    ],
    plausible: [3, 20],
    soft: [4, 14],
    dp: 1,
  },
  insulin: {
    id: 'insulin',
    label: 'fasting insulin',
    plain: 'insulin after no food overnight',
    group: 'sugar',
    canonical: 'µU/mL',
    units: [
      { unit: 'µU/mL', factor: 1 },
      { unit: 'pmol/L', factor: 1 / 6 },
    ],
    plausible: [0.2, 500],
    soft: [1, 60],
    dp: 1,
  },
  urate: {
    id: 'urate',
    label: 'uric acid',
    plain: 'linked to gout',
    group: 'kidney',
    canonical: 'mg/dL',
    units: [
      { unit: 'mg/dL', factor: 1 },
      { unit: 'µmol/L', factor: 1 / 59.48 },
    ],
    plausible: [0.5, 25],
    soft: [2, 12],
    dp: 1,
  },
  alt: {
    id: 'alt',
    label: 'ALT (SGPT)',
    plain: 'liver enzyme',
    group: 'liver',
    canonical: 'U/L',
    units: [
      { unit: 'U/L', factor: 1 },
      { unit: 'µkat/L', factor: 60 },
    ],
    plausible: [1, 10000],
    soft: [5, 300],
    dp: 0,
  },
  ast: {
    id: 'ast',
    label: 'AST (SGOT)',
    plain: 'liver and muscle enzyme',
    group: 'liver',
    canonical: 'U/L',
    units: [
      { unit: 'U/L', factor: 1 },
      { unit: 'µkat/L', factor: 60 },
    ],
    plausible: [1, 10000],
    soft: [5, 300],
    dp: 0,
  },
  ggt: {
    id: 'ggt',
    label: 'GGT',
    plain: 'liver enzyme that rises with alcohol',
    group: 'liver',
    canonical: 'U/L',
    units: [
      { unit: 'U/L', factor: 1 },
      { unit: 'µkat/L', factor: 60 },
    ],
    plausible: [1, 5000],
    soft: [3, 300],
    dp: 0,
  },
  creatinine: {
    id: 'creatinine',
    label: 'creatinine',
    plain: 'kidney filter waste product',
    group: 'kidney',
    canonical: 'mg/dL',
    units: [
      { unit: 'mg/dL', factor: 1 },
      { unit: 'µmol/L', factor: 1 / 88.42 },
    ],
    plausible: [0.1, 25],
    soft: [0.3, 4],
    dp: 2,
  },
  egfr: {
    id: 'egfr',
    label: 'eGFR',
    plain: 'how well the kidneys filter',
    group: 'kidney',
    canonical: 'mL/min/1.73 m²',
    units: [
      { unit: 'mL/min/1.73 m²', factor: 1 },
      { unit: 'mL/min', factor: 1 },
    ],
    plausible: [2, 200],
    soft: [15, 150],
    dp: 0,
  },
  uacr: {
    id: 'uacr',
    label: 'urine ACR',
    plain: 'protein leaking into urine',
    group: 'kidney',
    canonical: 'mg/g',
    units: [
      { unit: 'mg/g', factor: 1 },
      { unit: 'mg/mmol', factor: 8.84 },
      { unit: 'µg/mg', factor: 1 },
    ],
    plausible: [0, 20000],
    soft: [0, 3000],
    dp: 0,
  },
  sodium: {
    id: 'sodium',
    label: 'sodium',
    plain: 'salt balance',
    group: 'kidney',
    canonical: 'mmol/L',
    units: [
      { unit: 'mmol/L', factor: 1 },
      { unit: 'mEq/L', factor: 1 },
    ],
    plausible: [100, 180],
    soft: [125, 155],
    dp: 0,
  },
  potassium: {
    id: 'potassium',
    label: 'potassium',
    plain: 'mineral for heart and muscle rhythm',
    group: 'kidney',
    canonical: 'mmol/L',
    units: [
      { unit: 'mmol/L', factor: 1 },
      { unit: 'mEq/L', factor: 1 },
    ],
    plausible: [1.5, 9],
    soft: [3, 6],
    dp: 1,
  },
  tsh: {
    id: 'tsh',
    label: 'TSH',
    plain: 'thyroid-stimulating hormone',
    group: 'thyroid',
    canonical: 'mIU/L',
    units: [
      { unit: 'µIU/mL', factor: 1 },
      { unit: 'mIU/L', factor: 1 },
    ],
    plausible: [0.001, 500],
    soft: [0.05, 50],
    dp: 2,
  },
  ft3: {
    id: 'ft3',
    label: 'free T3',
    plain: 'active thyroid hormone',
    group: 'thyroid',
    canonical: 'pmol/L',
    units: [
      { unit: 'pg/mL', factor: 1.536 },
      { unit: 'pmol/L', factor: 1 },
    ],
    plausible: [0.3, 60],
    soft: [1.5, 15],
    dp: 2,
  },
  hb: {
    id: 'hb',
    label: 'haemoglobin',
    plain: 'oxygen carrier in red cells',
    group: 'blood',
    canonical: 'g/dL',
    units: [
      { unit: 'g/dL', factor: 1 },
      { unit: 'g/L', factor: 0.1 },
      { unit: 'mmol/L', factor: 1.611 },
    ],
    plausible: [2, 25],
    soft: [7, 20],
    dp: 1,
  },
  ferritin: {
    id: 'ferritin',
    label: 'ferritin',
    plain: 'iron stores',
    group: 'blood',
    canonical: 'µg/L',
    units: [
      { unit: 'ng/mL', factor: 1 },
      { unit: 'µg/L', factor: 1 },
    ],
    plausible: [0.5, 20000],
    soft: [3, 1500],
    dp: 0,
  },
  b12: {
    id: 'b12',
    label: 'vitamin B12',
    plain: 'needed for blood and nerves',
    group: 'vitamins',
    canonical: 'pg/mL',
    units: [
      { unit: 'pg/mL', factor: 1 },
      { unit: 'pmol/L', factor: 1 / 0.738 },
    ],
    plausible: [20, 10000],
    soft: [100, 2000],
    dp: 0,
  },
  vitD: {
    id: 'vitD',
    label: 'vitamin D (25-OH)',
    plain: 'sunshine vitamin',
    group: 'vitamins',
    canonical: 'ng/mL',
    units: [
      { unit: 'ng/mL', factor: 1 },
      { unit: 'nmol/L', factor: 1 / 2.496 },
    ],
    plausible: [1, 400],
    soft: [4, 150],
    dp: 1,
  },
  hsCrp: {
    id: 'hsCrp',
    label: 'hs-CRP',
    plain: 'inflammation marker',
    group: 'inflammation',
    canonical: 'mg/L',
    units: [
      { unit: 'mg/L', factor: 1 },
      { unit: 'mg/dL', factor: 10 },
    ],
    plausible: [0.01, 500],
    soft: [0.1, 50],
    dp: 1,
  },
  testosterone: {
    id: 'testosterone',
    label: 'testosterone (total)',
    plain: 'main male sex hormone',
    group: 'hormones',
    canonical: 'nmol/L',
    units: [
      { unit: 'ng/dL', factor: 0.03467 },
      { unit: 'nmol/L', factor: 1 },
      { unit: 'ng/mL', factor: 3.467 },
    ],
    plausible: [0.05, 100],
    soft: [0.3, 50],
    dp: 1,
  },
  cortisol: {
    id: 'cortisol',
    label: 'morning cortisol',
    plain: 'stress hormone, measured in the morning',
    group: 'hormones',
    canonical: 'µg/dL',
    units: [
      { unit: 'µg/dL', factor: 1 },
      { unit: 'nmol/L', factor: 1 / 27.59 },
    ],
    plausible: [0.1, 100],
    soft: [2, 40],
    dp: 1,
  },
};

export const GROUP_ORDER: readonly MarkerGroupId[] = ['lipids', 'sugar', 'liver', 'kidney', 'thyroid', 'blood', 'vitamins', 'inflammation', 'hormones'];

export const GROUP_LABEL: Readonly<Record<MarkerGroupId, string>> = {
  lipids: 'lipids',
  sugar: 'sugar',
  liver: 'liver',
  kidney: 'kidney and salts',
  thyroid: 'thyroid',
  blood: 'blood and iron',
  vitamins: 'vitamins',
  inflammation: 'inflammation',
  hormones: 'training extras',
};

export const markersOfGroup = (g: MarkerGroupId): MarkerId[] => (Object.keys(MARKER_UNITS) as MarkerId[]).filter((id) => MARKER_UNITS[id].group === g);

/** Spelling variants printed on reports and typed by people, mapped to the table's unit strings. */
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  'mg/dl': 'mg/dL',
  'mg / dl': 'mg/dL',
  'mg%': 'mg/dL',
  'mmol/l': 'mmol/L',
  'g/dl': 'g/dL',
  'gm/dl': 'g/dL',
  'gms/dl': 'g/dL',
  'gm%': 'g/dL',
  'g%': 'g/dL',
  'g/l': 'g/L',
  'gm/l': 'g/L',
  'u/l': 'U/L',
  'iu/l': 'U/L',
  'u/ l': 'U/L',
  'µkat/l': 'µkat/L',
  'ukat/l': 'µkat/L',
  '%': '%',
  'mmol/mol': 'mmol/mol',
  'µu/ml': 'µU/mL',
  'uu/ml': 'µU/mL',
  'µiu/ml': 'µIU/mL',
  'uiu/ml': 'µIU/mL',
  'miu/l': 'mIU/L',
  'mu/l': 'mIU/L',
  'pmol/l': 'pmol/L',
  'pg/ml': 'pg/mL',
  'ng/ml': 'ng/mL',
  'ng/dl': 'ng/dL',
  'nmol/l': 'nmol/L',
  'µg/l': 'µg/L',
  'ug/l': 'µg/L',
  'µg/dl': 'µg/dL',
  'ug/dl': 'µg/dL',
  'mg/l': 'mg/L',
  'µmol/l': 'µmol/L',
  'umol/l': 'µmol/L',
  'mg/g': 'mg/g',
  'mg/g creatinine': 'mg/g',
  'mg/gm': 'mg/g',
  'mg/mmol': 'mg/mmol',
  'µg/mg': 'µg/mg',
  'ug/mg': 'µg/mg',
  'meq/l': 'mEq/L',
  'ml/min/1.73m2': 'mL/min/1.73 m²',
  'ml/min/1.73 m2': 'mL/min/1.73 m²',
  'ml/min/1.73m²': 'mL/min/1.73 m²',
  'ml/min/1.73 m²': 'mL/min/1.73 m²',
  'ml/min/1.73 sq.m': 'mL/min/1.73 m²',
  'ml/min/1.73sq.m': 'mL/min/1.73 m²',
  'ml/min': 'mL/min',
};

/** Normalise a printed or typed unit string ("mg/dl", "gm/dL", "uIU/mL") to the table's spelling; null if unknown. */
export function normaliseUnit(raw: string): string | null {
  const k = raw
    .trim()
    .replace(/μ/g, 'µ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (UNIT_ALIASES[k]) return UNIT_ALIASES[k]!;
  const nospace = k.replace(/\s/g, '');
  return UNIT_ALIASES[nospace] ?? null;
}

/** Units the marker accepts (for the unit Select). */
export const unitsOf = (id: MarkerId): string[] => MARKER_UNITS[id].units.map((u) => u.unit);

function unitDef(id: MarkerId, unit: string): UnitDef | null {
  const u = normaliseUnit(unit) ?? unit;
  return MARKER_UNITS[id].units.find((d) => d.unit === u) ?? null;
}

export const isAcceptedUnit = (id: MarkerId, unit: string): boolean => unitDef(id, unit) !== null;

/** Canonical unit of a reading: the marker's canonical unit, or for Lp(a) the entered unit. */
export function canonicalUnitOf(id: MarkerId, unit: string): string {
  const spec = MARKER_UNITS[id];
  if (spec.noConversion) return unitDef(id, unit)?.unit ?? spec.canonical;
  return spec.canonical;
}

/** value (in `unit`) → canonical. Throws `unit not recognised` for a unit outside the table. */
export function toCanonical(id: MarkerId, value: number, unit: string): number {
  const d = unitDef(id, unit);
  if (!d) throw new Error('unit not recognised');
  if (MARKER_UNITS[id].noConversion) return value;
  return r(value * d.factor + (d.offset ?? 0));
}

/** canonical → value in `unit` (Lp(a): only its own unit). */
export function fromCanonical(id: MarkerId, canonical: number, unit: string): number {
  const d = unitDef(id, unit);
  if (!d) throw new Error('unit not recognised');
  if (MARKER_UNITS[id].noConversion) return canonical;
  return r((canonical - (d.offset ?? 0)) / d.factor);
}

/** Convert between two accepted units of a marker. Lp(a) mg/dL ↔ nmol/L is refused (returns null). */
export function convert(id: MarkerId, value: number, from: string, to: string): number | null {
  const a = unitDef(id, from);
  const b = unitDef(id, to);
  if (!a || !b) return null;
  if (a.unit === b.unit) return value;
  if (MARKER_UNITS[id].noConversion) return null;
  return fromCanonical(id, toCanonical(id, value, a.unit), b.unit);
}

export type BoundCheck = { ok: true } | { ok: false; level: 'block' | 'ask'; message: string };

const fmt = (x: number): string => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-GB').replace(/,/g, ' ') : String(Math.round(x * 100) / 100));

/** Plausibility (block) and soft (ask) bounds for one entered value. */
export function checkBounds(id: MarkerId, value: number, unit: string): BoundCheck {
  const spec = MARKER_UNITS[id];
  const d = unitDef(id, unit);
  if (!d) return { ok: false, level: 'block', message: 'unit not recognised' };
  if (!Number.isFinite(value)) return { ok: false, level: 'block', message: 'Enter a number.' };
  let lo = spec.plausible[0];
  let hi = spec.plausible[1];
  let slo = spec.soft[0];
  let shi = spec.soft[1];
  if (spec.noConversion && d.unit === 'nmol/L') {
    // Lp(a) in nmol/L reads about 2–2.5 × the mg/dL figure; bounds scale with the unit, the value never converts
    lo *= 2.5;
    hi *= 2.5;
    slo *= 2.5;
    shi *= 2.5;
  }
  const v = spec.noConversion ? value : toCanonical(id, value, d.unit);
  if (v < lo || v > hi) {
    const a = spec.noConversion ? lo : fromCanonical(id, lo, d.unit);
    const b = spec.noConversion ? hi : fromCanonical(id, hi, d.unit);
    return { ok: false, level: 'block', message: `Vitals accepts ${fmt(a)}–${fmt(b)} ${d.unit} for ${spec.label}. Check the unit.` };
  }
  if (v < slo || v > shi) return { ok: false, level: 'ask', message: `Is ${fmt(value)} ${d.unit} right?` };
  return { ok: true };
}

/** A value rounded for display in a unit. */
export function displayValue(id: MarkerId, value: number, unit: string): string {
  const spec = MARKER_UNITS[id];
  const dp = unit === spec.canonical ? spec.dp : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return String(Math.round(value * 10 ** dp) / 10 ** dp);
}
