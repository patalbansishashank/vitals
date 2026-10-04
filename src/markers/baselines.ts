/**
 * Engine baseline from markers (SUITE_SPEC §13.5.4). Pure.
 *
 * Confirmed, non-stale readings become `LabBaselines` fields in the engine's units; entered values replace the
 * population draw (the cardiometabolic module uses a lab value when present and draws the rest conditioned on it).
 */
import type { LabBaselines, PersonProfile } from '@/engine/types/profile';
import type { LocalDate } from '@/store';
import { currentReadings, isStale } from './doc';
import type { MarkerId, MarkersDoc } from './types';
import { convert } from './units';

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
  egfr: { field: 'egfr', unit: 'mL/min/1.73 m²' },
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

export interface MarkerBaselines {
  labs: Partial<LabBaselines>;
  /** Sample date of each field set from a reading. */
  labDates: Partial<Record<keyof LabBaselines, LocalDate>>;
}

/** `labBaselinesFrom(doc)` (§13.5.4): confirmed, non-stale readings in the engine's units, with their dates. */
export function labBaselinesWithDates(doc: MarkersDoc, today: LocalDate, dietChangeDate?: LocalDate): MarkerBaselines {
  const out: MarkerBaselines = { labs: {}, labDates: {} };
  for (const r of currentReadings(doc)) {
    if (isStale(r, today, dietChangeDate)) continue;
    let field: NumericLab | undefined;
    let v: number | null;
    if (r.id === 'lpa') {
      field = r.unit === 'nmol/L' ? 'lpaNmolL' : 'lpaMgDl';
      v = r.value;
    } else {
      const f = FIELD[r.id];
      if (!f) continue;
      field = f.field;
      v = convert(r.id, r.value, r.unit, f.unit);
    }
    if (v === null || !Number.isFinite(v)) continue;
    out.labs[field] = v;
    out.labDates[field] = r.date;
  }
  return out;
}

export function labBaselinesFrom(doc: MarkersDoc, today: LocalDate, dietChangeDate?: LocalDate): Partial<LabBaselines> {
  return labBaselinesWithDates(doc, today, dietChangeDate).labs;
}

/** The profile with entered labs over the Body page's values (entered labs replace population starting values). */
export function withMarkerLabs<P extends Pick<PersonProfile, 'labs'>>(profile: P, doc: MarkersDoc | null | undefined, today: LocalDate, dietChangeDate?: LocalDate): P {
  if (!doc) return profile;
  const labs = labBaselinesFrom(doc, today, dietChangeDate);
  if (!Object.keys(labs).length) return profile;
  return { ...profile, labs: { ...(profile.labs ?? {}), ...labs } };
}
