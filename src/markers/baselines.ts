/**
 * Engine baseline from markers (SUITE_SPEC §13.5.4). Pure.
 *
 * Confirmed, non-stale readings become `LabBaselines` fields in the engine's units; entered values replace the
 * population draw for their own marker only. A missing marker keeps its labelled population prior (the correlated prior
 * draws are correlated among themselves; they are NOT a posterior conditional on the entered labs, D7-07).
 *
 * Measured values are passed on exactly (D7-02): no plausibility clamp here or in the engine; a value outside the
 * engine's calibration domain is flagged `outOfDomain` in its provenance (`labMeta`) and keeps its number. eGFR enters
 * only as indexed eGFR (printed indexed, confirmed indexed, or an explicit BSA conversion of a confirmed absolute GFR);
 * an ambiguous mL/min value stays out of the baseline (and out of CKD staging) with its quantity kind in `labMeta`.
 *
 * Freshness (D7-05): the rules' freshness context (`freshnessOf`: day, diet change, dated medication changes) decides
 * which readings are a current baseline — the same one the rules use. An expired reading leaves the baseline (its
 * provenance stays in `labMeta` with `freshness: 'expired'`, the raw history untouched), and the Body page's value of the
 * same field cannot re-enter as a fallback (a stale marker plus the same stale profile value never resurrects it).
 *
 * Sample operator (C4/D7-09): a glucose or insulin known to be non-fasting is not a fasting baseline — it stays out of the
 * fasting fields (provenance kept). Unknown fasting is passed with its status unknown (no eligibility is asserted).
 *
 * Sample facts (A1-034/A1-047): the draw's recorded instant, a confirmed pairing and its known context (illness, prolonged
 * fast) travel atomically with the chosen value in `labMeta`, so the opt-in engine HOMA check (`homaPairEligibility`) and the
 * marker rules (`homaFor`) judge one pair from the same facts. Absent facts stay absent (unknown).
 */
import { MGDL_PER_MMOLL_CHOL, MGDL_PER_MMOLL_GLC, MGDL_PER_MMOLL_TG } from '@/engine/model/cardiometabolic/baselines';
import { CARDIOMETABOLIC_DOMAIN, type CardiometabolicLab } from '@/engine/model/cardiometabolic/constants';
import type { LabBaselineMeta, LabBaselines, MedicationChange, PersonProfile } from '@/engine/types/profile';
import type { LocalDate } from '@/store';
import { currentReadings, freshnessOf, isStaleIn, type FreshnessContext } from './doc';
import type { MarkerId, MarkerReading, MarkersDoc } from './types';
import { EGFR_INDEXED_UNIT, convert, gfrQuantityOf, indexedEgfrOf } from './units';
import { fastingSampleEligibility } from '@/lib/measurementOperators';

type NumericLab = Exclude<keyof LabBaselines, never>;

/** Marker → LabBaselines field and the unit that field is in. Lp(a) goes to the field of its entered unit. */
const FIELD: Readonly<Partial<Record<MarkerId, { field: NumericLab; unit: string }>>> = {
  ldl: { field: 'ldlMmolL', unit: 'mmol/L' },
  hdl: { field: 'hdlMmolL', unit: 'mmol/L' },
  tg: { field: 'tgMmolL', unit: 'mmol/L' },
  nonHdl: { field: 'nonHdlMmolL', unit: 'mmol/L' },
  apoB: { field: 'apoBgL', unit: 'g/L' },
  fpg: { field: 'fastingGlucoseMmolL', unit: 'mmol/L' },
  insulin: { field: 'fastingInsulinUuMl', unit: 'µU/mL' },
  hba1c: { field: 'hba1cPct', unit: '%' },
  hsCrp: { field: 'crpMgL', unit: 'mg/L' },
  urate: { field: 'urateMgDl', unit: 'mg/dL' },
  testosterone: { field: 'testosteroneNmolL', unit: 'nmol/L' },
  alt: { field: 'altUL', unit: 'U/L' },
  ast: { field: 'astUL', unit: 'U/L' },
  ggt: { field: 'ggtUL', unit: 'U/L' },
  creatinine: { field: 'creatinineMgDl', unit: 'mg/dL' },
  egfr: { field: 'egfr', unit: EGFR_INDEXED_UNIT },
  uacr: { field: 'uacrMgG', unit: 'mg/g' },
  tsh: { field: 'tshMiuL', unit: 'mIU/L' },
  ft3: { field: 'ft3PmolL', unit: 'pmol/L' },
  hb: { field: 'hbGdL', unit: 'g/dL' },
  ferritin: { field: 'ferritinUgL', unit: 'µg/L' },
  b12: { field: 'b12PgMl', unit: 'pg/mL' },
  vitD: { field: 'vitDNgMl', unit: 'ng/mL' },
  sodium: { field: 'sodiumMmolL', unit: 'mmol/L' },
  potassium: { field: 'potassiumMmolL', unit: 'mmol/L' },
};

/** LabBaselines field → the cardiometabolic calibration domain it is checked against, with the factor to its unit. */
const DOMAIN_OF: Readonly<Partial<Record<NumericLab, { lab: CardiometabolicLab; toModel: number }>>> = {
  ldlMmolL: { lab: 'ldl', toModel: MGDL_PER_MMOLL_CHOL },
  hdlMmolL: { lab: 'hdl', toModel: MGDL_PER_MMOLL_CHOL },
  tgMmolL: { lab: 'tg', toModel: MGDL_PER_MMOLL_TG },
  fastingGlucoseMmolL: { lab: 'fpg', toModel: MGDL_PER_MMOLL_GLC },
  hba1cPct: { lab: 'a1c', toModel: 1 },
  crpMgL: { lab: 'crp', toModel: 1 },
  urateMgDl: { lab: 'ua', toModel: 1 },
  apoBgL: { lab: 'apoB', toModel: 100 },
};

export interface MarkerBaselines {
  labs: Partial<LabBaselines>;
  /** Sample date of each field set from a reading. */
  labDates: Partial<Record<keyof LabBaselines, LocalDate>>;
  /**
   * Provenance of each field set from a reading, and of an eGFR reading that could not enter as indexed eGFR (C4,
   * D7-02): sample date and id, quantity kind, fasting status, the original value and unit, out-of-domain flag.
   */
  labMeta: Partial<Record<keyof LabBaselines, LabBaselineMeta>>;
}

/** Fasting status of a draw from its own metadata (hours ≥ 8 = fasting; the legacy flag only when explicitly set). */
function fastingStatusOf(r: MarkerReading): LabBaselineMeta['fastingStatus'] | undefined {
  const f = fastingSampleEligibility({ date: r.date, ...(r.fastingHours !== undefined ? { fastingHours: r.fastingHours } : {}), ...(r.fastingStatus ? { fastingStatus: r.fastingStatus } : r.fasting === true ? { fastingStatus: 'fasting' as const } : r.fasting === false ? { fastingStatus: 'nonFasting' as const } : {}) });
  return f === 'eligible' ? 'fasting' : f === 'notFasting' ? 'nonFasting' : r.fastingStatus === 'unknown' ? 'unknown' : undefined;
}

/** Fields that are fasting-sample operators (a non-fasting draw is a different observable). */
const FASTING_FIELDS: ReadonlySet<NumericLab> = new Set(['fastingGlucoseMmolL', 'fastingInsulinUuMl']);

function metaOf(r: MarkerReading, value: number | null, field: NumericLab, freshness: NonNullable<LabBaselineMeta['freshness']> = 'current'): LabBaselineMeta {
  const m: LabBaselineMeta = { source: 'marker', measuredOn: r.date, original: { value: r.value, unit: r.unit }, freshness };
  if (r.sampleId) m.sampleId = r.sampleId;
  // A1-034/A1-047: the draw's occurrence, pairing and context facts, carried exactly with the chosen value (the engine
  // reads them through the same shared HOMA operator as the rules; nothing is inferred or rewritten)
  if (r.sampledAt) m.sampledAt = r.sampledAt;
  if (r.sampleLocalClockH !== undefined && Number.isFinite(r.sampleLocalClockH)) m.sampleLocalClockH = r.sampleLocalClockH;
  if (r.confirmedPairWith) m.confirmedPairWith = r.confirmedPairWith;
  if (r.sampleContext && Object.keys(r.sampleContext).length) m.sampleContext = { ...r.sampleContext };
  if (r.id === 'egfr') m.quantityKind = gfrQuantityOf(r);
  const fasting = fastingStatusOf(r);
  if (fasting) m.fastingStatus = fasting;
  if (r.fastingHours !== undefined) m.fastingHours = r.fastingHours;
  const dom = DOMAIN_OF[field];
  if (dom && value !== null) {
    const d = CARDIOMETABOLIC_DOMAIN[dom.lab];
    const v = value * dom.toModel;
    if (v < d.lo || v > d.hi) m.outOfDomain = true;
  }
  return m;
}

/** The LabBaselines field a reading enters (Lp(a) by its entered unit). */
function fieldOf(r: Pick<MarkerReading, 'id' | 'unit'>): NumericLab | undefined {
  if (r.id === 'lpa') return r.unit === 'nmol/L' ? 'lpaNmolL' : 'lpaMgDl';
  if (r.id === 'egfr') return 'egfr';
  return FIELD[r.id]?.field;
}

/** The freshness context from a day (legacy callers) or the rules' context (D7-05: pass the same one the rules use). */
const contextOf = (doc: MarkersDoc, ctx: LocalDate | FreshnessContext, dietChangeDate?: LocalDate): FreshnessContext =>
  freshnessOf(doc, typeof ctx === 'string' ? { today: ctx, ...(dietChangeDate ? { dietChangeDate } : {}) } : ctx);

/**
 * `labBaselinesFrom(doc)` (§13.5.4): confirmed, current readings in the engine's units, with their dates. `ctx` is the
 * rules' freshness context (a `RuleContext` works) — or a day with an optional diet change date (legacy).
 */
export function labBaselinesWithDates(doc: MarkersDoc, ctx: LocalDate | FreshnessContext, dietChangeDate?: LocalDate): MarkerBaselines {
  const out: MarkerBaselines = { labs: {}, labDates: {}, labMeta: {} };
  const fresh = contextOf(doc, ctx, dietChangeDate);
  for (const r of currentReadings(doc)) {
    if (isStaleIn(r, fresh)) {
      // expired for quantitative use: provenance only (the reading stays in the history; its review lives in ./review.ts)
      const f = fieldOf(r);
      if (f) out.labMeta[f] = metaOf(r, null, f, 'expired');
      continue;
    }
    let field: NumericLab | undefined;
    let v: number | null;
    if (r.id === 'lpa') {
      field = r.unit === 'nmol/L' ? 'lpaNmolL' : 'lpaMgDl';
      v = r.value;
    } else if (r.id === 'egfr') {
      field = 'egfr';
      const g = indexedEgfrOf(r);
      if (g.status === 'unresolved') {
        // kept out of the baseline (never staged), its quantity kind recorded for the "Unit unclear" prompt
        out.labMeta.egfr = metaOf(r, null, field);
        continue;
      }
      v = g.value;
    } else {
      const f = FIELD[r.id];
      if (!f) continue;
      field = f.field;
      v = convert(r.id, r.value, r.unit, f.unit);
      if (FASTING_FIELDS.has(field) && fastingStatusOf(r) === 'nonFasting') {
        // C4/D7-09: a non-fasting draw is not the fasting-glucose/insulin observable; kept as provenance, not a baseline
        out.labMeta[field] = metaOf(r, null, field);
        continue;
      }
    }
    if (v === null || !Number.isFinite(v)) continue;
    out.labs[field] = v;
    out.labDates[field] = r.date;
    out.labMeta[field] = metaOf(r, v, field);
  }
  return out;
}

export function labBaselinesFrom(doc: MarkersDoc, ctx: LocalDate | FreshnessContext, dietChangeDate?: LocalDate): Partial<LabBaselines> {
  return labBaselinesWithDates(doc, ctx, dietChangeDate).labs;
}

/**
 * The profile with entered labs over the Body page's values (entered labs replace population starting values) and their
 * provenance (`labMeta`, C4). The values are exactly the confirmed readings in engine units: never clamped. A field whose
 * marker reading has expired (or is a non-fasting draw of a fasting field) also drops the Body page's value of that field,
 * unless that value carries its own newer, current measurement date (D7-05: stale fallbacks never re-enter unnoticed).
 * Pass the rules' context (`RuleContext`) so the diet and medication change dates match the rules exactly.
 *
 * The document's dated medication class changes (D7-09) reach the engine as `profile.medications` (merged by id with any
 * the profile already carries, ordered by date): the cardiometabolic module reads them for the glucose-lowering context
 * and the exogenous-insulin check of a HOMA pair. Nothing is inferred when the document has none.
 */
export function withMarkerLabs<P extends Pick<PersonProfile, 'labs'> & Partial<Pick<PersonProfile, 'labMeta' | 'medications'>>>(
  profile: P,
  doc: MarkersDoc | null | undefined,
  ctx: LocalDate | FreshnessContext,
  dietChangeDate?: LocalDate,
): P {
  if (!doc) return profile;
  const fresh = contextOf(doc, ctx, dietChangeDate);
  const { labs, labMeta } = labBaselinesWithDates(doc, fresh);
  const meds = doc.medications ?? [];
  if (!Object.keys(labs).length && !Object.keys(labMeta).length && !meds.length) return profile;
  const base: Partial<LabBaselines> = { ...(profile.labs ?? {}) };
  for (const [field, meta] of Object.entries(labMeta) as Array<[NumericLab, LabBaselineMeta]>) {
    if (field in labs || base[field] === undefined) continue;
    const own = profile.labMeta?.[field];
    const ownCurrent = own?.measuredOn !== undefined && meta.measuredOn !== undefined && own.measuredOn > meta.measuredOn && own.freshness !== 'expired' && !isStaleIn({ id: markerOfField(field), date: own.measuredOn }, fresh);
    if (!ownCurrent) delete base[field];
  }
  const out: P = Object.keys(labs).length || Object.keys(labMeta).length ? { ...profile, labs: { ...base, ...labs } as P['labs'] } : { ...profile };
  if (Object.keys(labMeta).length) out.labMeta = { ...(profile.labMeta ?? {}), ...labMeta };
  if (meds.length) {
    const byId = new Map<string, MedicationChange>();
    for (const m of [...(profile.medications ?? []), ...meds]) byId.set(m.id, m);
    out.medications = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }
  return out;
}

/** The marker a LabBaselines field comes from (for the fallback's own freshness). */
function markerOfField(field: NumericLab): MarkerId {
  if (field === 'lpaMgDl' || field === 'lpaNmolL') return 'lpa';
  if (field === 'egfr') return 'egfr';
  return (Object.entries(FIELD) as Array<[MarkerId, { field: NumericLab }]>).find(([, f]) => f.field === field)?.[0] ?? 'ldl';
}
