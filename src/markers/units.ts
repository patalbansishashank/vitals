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
 *
 * eGFR (D7-02): mL/min/1.73 m² (indexed eGFR) and bare mL/min (absolute GFR, creatinine clearance, or an indexed value
 * printed without its index) are different quantities. They never convert into each other by a unit factor; an
 * ambiguous mL/min reading keeps its raw value and stays unresolved for indexed thresholds until the person confirms
 * what it is. A confirmed absolute GFR converts only with sample-date height and weight and a declared BSA method.
 */
import { MGDL_PER_MMOLL_CHOL, MGDL_PER_MMOLL_GLC, MGDL_PER_MMOLL_TG } from '@/engine/model/cardiometabolic/baselines';
import { formatNumber } from '@/components/lib/format';
import { gfrQuantityFromUnit, indexGfr, type GfrQuantityKind } from '@/lib/measurementOperators';
import type { MarkerGroupId, MarkerId, MarkerReading } from './types';

/** One accepted unit: canonical = value × factor (+ offset). */
interface UnitDef {
  unit: string;
  factor: number;
  offset?: number;
  /**
   * A distinct quantity measured in this unit (D7-02): it is its own canonical unit and never converts to the marker's
   * other units (eGFR mL/min is not mL/min/1.73 m²).
   */
  distinct?: true;
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
      { unit: 'mL/min', factor: 1, distinct: true },
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

/** Canonical unit of a reading: the marker's canonical unit, or for Lp(a) and a distinct quantity (eGFR mL/min) the entered unit. */
export function canonicalUnitOf(id: MarkerId, unit: string): string {
  const spec = MARKER_UNITS[id];
  const d = unitDef(id, unit);
  if (spec.noConversion || d?.distinct) return d?.unit ?? spec.canonical;
  return spec.canonical;
}

/** value (in `unit`) → canonical. Throws `unit not recognised` for a unit outside the table. */
export function toCanonical(id: MarkerId, value: number, unit: string): number {
  const d = unitDef(id, unit);
  if (!d) throw new Error('unit not recognised');
  if (MARKER_UNITS[id].noConversion || d.distinct) return value;
  return r(value * d.factor + (d.offset ?? 0));
}

/** canonical → value in `unit` (Lp(a) and distinct quantities: only their own unit). */
export function fromCanonical(id: MarkerId, canonical: number, unit: string): number {
  const d = unitDef(id, unit);
  if (!d) throw new Error('unit not recognised');
  if (MARKER_UNITS[id].noConversion || d.distinct) return canonical;
  return r((canonical - (d.offset ?? 0)) / d.factor);
}

/**
 * Convert between two accepted units of a marker. Lp(a) mg/dL ↔ nmol/L and eGFR mL/min ↔ mL/min/1.73 m² (different
 * quantities) are refused (null).
 */
export function convert(id: MarkerId, value: number, from: string, to: string): number | null {
  const a = unitDef(id, from);
  const b = unitDef(id, to);
  if (!a || !b) return null;
  if (a.unit === b.unit) return value;
  if (MARKER_UNITS[id].noConversion || a.distinct || b.distinct) return null;
  return fromCanonical(id, toCanonical(id, value, a.unit), b.unit);
}

/* ------------------------------------------------------------------------------------------- kidney function (D7-02) */

/** The indexed eGFR unit the kidney rules and the engine baseline are written in. */
export const EGFR_INDEXED_UNIT = 'mL/min/1.73 m²';

/**
 * Quantity kind of an eGFR reading: the confirmed kind when the person or lab gave one, else what the printed unit says
 * (an explicit /1.73 m² is indexed eGFR; bare mL/min is `indexingUnconfirmed`). Legacy readings are never rewritten.
 */
export function gfrQuantityOf(r: Pick<MarkerReading, 'unit' | 'quantityKind'>): GfrQuantityKind {
  return r.quantityKind ?? gfrQuantityFromUnit(r.unit);
}

export type IndexedEgfr =
  | { status: 'resolved'; value: number; source: 'printedIndexed' | 'confirmedIndexed' | 'bsaConverted' }
  | { status: 'unresolved'; reason: 'indexingUnconfirmed' | 'creatinineClearance' | 'absoluteNeedsBsa' | 'notEgfr' | 'nonFinite' };

/**
 * The indexed eGFR (mL/min/1.73 m²) a reading supports (D7-02): the printed indexed value, an mL/min value the person
 * confirmed is indexed eGFR printed without its index, or the stored explicit BSA conversion of a confirmed absolute GFR.
 * Anything else (ambiguous mL/min, creatinine clearance, absolute GFR without sample-date anthropometry) is unresolved.
 */
export function indexedEgfrOf(r: Pick<MarkerReading, 'id' | 'value' | 'unit' | 'quantityKind' | 'indexed'>): IndexedEgfr {
  if (r.id !== 'egfr') return { status: 'unresolved', reason: 'notEgfr' };
  if (!Number.isFinite(r.value)) return { status: 'unresolved', reason: 'nonFinite' };
  const kind = gfrQuantityOf(r);
  switch (kind) {
    case 'egfrIndexed': {
      const printed = unitDef('egfr', r.unit)?.unit === EGFR_INDEXED_UNIT;
      return { status: 'resolved', value: r.value, source: printed ? 'printedIndexed' : 'confirmedIndexed' };
    }
    case 'gfrAbsolute':
      return r.indexed && Number.isFinite(r.indexed.valueMlMin173) ? { status: 'resolved', value: r.indexed.valueMlMin173, source: 'bsaConverted' } : { status: 'unresolved', reason: 'absoluteNeedsBsa' };
    case 'creatinineClearance':
      return { status: 'unresolved', reason: 'creatinineClearance' };
    case 'indexingUnconfirmed':
      return { status: 'unresolved', reason: 'indexingUnconfirmed' };
  }
}

/**
 * The explicit absolute→indexed conversion of a confirmed absolute GFR reading (D7-02), kept beside the raw value:
 * indexed = absolute × 1.73 / BSA with Mosteller BSA from sample-date height and weight. Refuses (with the reason) for
 * an ambiguous or clearance quantity, an already indexed value, or anthropometry from another date; never guesses.
 */
export function indexedConversionOf(
  r: Pick<MarkerReading, 'id' | 'value' | 'unit' | 'quantityKind' | 'date'>,
  body: { heightCm?: number; weightKg?: number; date?: string },
): { ok: true; indexed: NonNullable<MarkerReading['indexed']> } | { ok: false; reason: string } {
  if (r.id !== 'egfr') return { ok: false, reason: 'notEgfr' };
  const res = indexGfr({
    valueMlMin: r.value,
    quantity: gfrQuantityOf(r),
    sampleDate: r.date,
    ...(body.heightCm !== undefined ? { heightCm: body.heightCm } : {}),
    ...(body.weightKg !== undefined ? { weightKg: body.weightKg } : {}),
    ...(body.date !== undefined ? { anthropometryDate: body.date } : {}),
  });
  if (res.status === 'refused') return { ok: false, reason: res.reason };
  return {
    ok: true,
    indexed: { valueMlMin173: res.indexedMlMin173, bsaM2: res.bsaM2, bsaMethod: res.bsaMethod, heightCm: res.anthropometry.heightCm, weightKg: res.anthropometry.weightKg, anthropometryDate: res.anthropometry.date },
  };
}

export type BoundCheck = { ok: true } | { ok: false; level: 'block' | 'ask'; message: string };

const fmt = (x: number): string => (Math.abs(x) >= 1000 ? formatNumber(Math.round(x)) : String(Math.round(x * 100) / 100));

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
