/**
 * Dose units and dose checks per catalogue item (SUITE_SPEC §13.2 dose row; design/COMPONENTS.md §14.4).
 *
 * The dose on a row is the amount **each time** it is taken; the daily amount is dose × the number of times of day
 * (at least one). Validation errors are input errors only (no amount, a unit the item is not sold in, a number no
 * product comes in); amounts above the catalogue's upper limit are a **warning**, never a refusal.
 */
import { SEED_SUPPLEMENTS } from '@/content/catalogues/supplements'; // not the index: it builds the whole seed catalogue
import type { SupplementRecord } from '../types';
import type { SupplementRow } from './types';

/** Units offered for free-text rows (not matched to the catalogue yet). */
export const FREE_TEXT_UNITS: readonly string[] = ['g', 'mg', 'µg', 'IU', 'ml', 'scoop', 'tablet', 'capsule'];

/** Extra units people buy an item in, beyond the catalogue's own unit. */
const EXTRA_UNITS: Readonly<Record<string, readonly string[]>> = {
  whey_protein: ['scoop'],
  plant_protein: ['scoop'],
  casein_presleep: ['scoop'],
  creatine_monohydrate: ['scoop'],
  caffeine: ['tablet'],
  electrolytes_fasting: ['mg'],
  electrolytes_sweat_lowcarb: ['mg'],
  magnesium: ['tablet', 'capsule'],
  vitamin_d3: ['µg', 'tablet', 'capsule'],
  omega3_epa_dha: ['mg', 'capsule'],
  vitamin_b12: ['tablet'],
  iron: ['tablet'],
  calcium: ['tablet'],
  folic_acid: ['tablet'],
  dietary_nitrate: ['ml'],
  beta_alanine: ['mg'],
  melatonin: ['tablet'],
  ashwagandha: ['capsule'],
};

/** Plausible upper bound of one dose per unit (an input check, not a safety limit). */
const MAX_PER_UNIT: Readonly<Record<string, number>> = { g: 500, mg: 50_000, µg: 100_000, IU: 200_000, mmol: 100, ml: 2000, scoop: 20, tablet: 20, capsule: 20 };

export function supplementRecord(id: string | null | undefined): SupplementRecord | undefined {
  if (!id) return undefined;
  const k = id.toLowerCase();
  return SEED_SUPPLEMENTS.find((s) => s.id === k) ?? SEED_SUPPLEMENTS.find((s) => s.aliases.some((a) => a.toLowerCase() === k));
}

/** The catalogue's unit as a unit you can type a number in: "g protein" → g, "mg/kg" → mg, "mmol nitrate" → mmol. */
export function baseUnit(catalogueUnit: string): string {
  const first = catalogueUnit.trim().split(/[\s/]/)[0] ?? '';
  return first === 'share' ? 'g' : first || 'g';
}

/** Units a row for this item may use; the first is the default. */
export function doseUnits(supplementId: string | null | undefined): readonly string[] {
  const r = supplementRecord(supplementId);
  if (!r) return FREE_TEXT_UNITS;
  const base = baseUnit(r.dose.unit);
  return [base, ...(EXTRA_UNITS[r.id] ?? []).filter((u) => u !== base)];
}

/** The catalogue's adult amount as a starting dose; none when the dose depends on body weight or is a rule. */
export function defaultDose(supplementId: string | null | undefined): { dose?: number; unit: string } {
  const r = supplementRecord(supplementId);
  if (!r) return { unit: FREE_TEXT_UNITS[0]! };
  const unit = baseUnit(r.dose.unit);
  const perWeight = r.dose.perKg || /\/kg/.test(r.dose.unit);
  return r.dose.amount !== null && !perWeight ? { dose: r.dose.amount, unit } : { unit };
}

/** The catalogue's usual dose as a short line ("3–5 g a day"); empty when the catalogue gives a rule instead. */
export function catalogueDoseLine(supplementId: string | null | undefined): string {
  const r = supplementRecord(supplementId);
  if (!r) return '';
  const d = r.dose;
  const per = d.per && /^(day|serving|night|dose)$/.test(d.per) ? ` a ${d.per}` : '';
  if (d.range) return `${d.range[0]}–${d.range[1]} ${d.unit}${per}`;
  if (d.amount !== null) return `${d.amount} ${d.unit}${per}`;
  return '';
}

/** Convert between g, mg and µg, and IU ↔ µg for vitamin D (40 IU = 1 µg). Null when the units do not convert. */
export function convertDose(amount: number, from: string, to: string, supplementId?: string | null): number | null {
  if (from === to) return amount;
  const mass: Record<string, number> = { g: 1, mg: 1e-3, µg: 1e-6 };
  const vitD = supplementRecord(supplementId)?.id === 'vitamin_d3';
  const toMass = (a: number, u: string): number | null => (u in mass ? a * mass[u]! : vitD && u === 'IU' ? (a / 40) * 1e-6 : null);
  const g = toMass(amount, from);
  if (g === null) return null;
  if (to in mass) return g / mass[to]!;
  if (vitD && to === 'IU') return (g / 1e-6) * 40;
  return null;
}

export type DoseIssue =
  | { kind: 'error'; code: 'noDose' | 'notPositive' | 'tooLarge' | 'unit' | 'noTime'; message: string }
  | { kind: 'warning'; code: 'aboveUpperLimit'; message: string };

/**
 * Checks a row. Only `taking` rows need a dose and a time; any row with a dose must have a plausible number in one of
 * the item's units. Messages are plain words for the field.
 */
export function validateDose(row: Pick<SupplementRow, 'supplementId' | 'state' | 'dose' | 'unit' | 'timesOfDay'>): { ok: boolean; issues: DoseIssue[] } {
  const issues: DoseIssue[] = [];
  const units = doseUnits(row.supplementId);
  const taking = row.state === 'taking';
  if (row.dose === undefined || row.dose === null) {
    if (taking) issues.push({ kind: 'error', code: 'noDose', message: 'Enter an amount' });
  } else if (!Number.isFinite(row.dose) || row.dose <= 0) {
    issues.push({ kind: 'error', code: 'notPositive', message: 'Enter an amount above 0' });
  } else if (row.unit && row.dose > (MAX_PER_UNIT[row.unit] ?? Infinity)) {
    issues.push({ kind: 'error', code: 'tooLarge', message: `That is more than any product holds; check the amount (${row.unit})` });
  }
  if (row.dose !== undefined && (!row.unit || !units.includes(row.unit))) issues.push({ kind: 'error', code: 'unit', message: `Choose a unit: ${units.join(', ')}` });
  if (taking && row.timesOfDay.length === 0) issues.push({ kind: 'error', code: 'noTime', message: 'Choose when you take it' });

  const lim = supplementRecord(row.supplementId)?.dose.upperLimit;
  if (lim && lim.per === 'day' && row.dose && row.unit && Number.isFinite(row.dose) && row.dose > 0) {
    const each = convertDose(row.dose, row.unit, lim.unit, row.supplementId);
    const daily = each === null ? null : each * Math.max(1, row.timesOfDay.length);
    if (daily !== null && daily > lim.amount + 1e-9)
      issues.push({ kind: 'warning', code: 'aboveUpperLimit', message: `About ${Math.round(daily)} ${lim.unit} a day, above the usual upper limit of ${lim.amount} ${lim.unit} a day; worth checking with a doctor or pharmacist` });
  }
  return { ok: !issues.some((i) => i.kind === 'error'), issues };
}

/** The amount taken in a day (dose × times, at least one), in the row's unit; null without a dose. */
export function dailyAmount(row: Pick<SupplementRow, 'dose' | 'timesOfDay'>): number | null {
  return row.dose === undefined ? null : row.dose * Math.max(1, row.timesOfDay.length);
}
