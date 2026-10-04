/**
 * Results display catalogue: the engine's output catalogue (`SERIES`, docs/MODEL_SPEC.md §6) mapped onto what the
 * results screen shows — plain labels, short names, display units in the user's unit system, presentation mode
 * (absolute · change from your baseline · index), lane type, overlay rule, threshold labels, caveats and the default
 * channel set. Pure data + pure functions; no React.
 */
import { KJ_PER_KCAL } from '@/components';
import { SERIES, type Presentation, type SeriesDef } from '@/engine/types/metrics';
import type { DirectionOfGood, EvidenceGrade, LaneKind, MetricCategory, OverlayTransform, Threshold } from '@/features/charts';

export interface UnitPrefs {
  /** Body masses and lengths. Stored values are metric; this only changes display. */
  units: 'metric' | 'imperial';
  energyUnit: 'kcal' | 'kJ';
  glucoseUnit: 'mmol' | 'mgdl';
}

export const METRIC_UNITS: UnitPrefs = { units: 'metric', energyUnit: 'kcal', glucoseUnit: 'mmol' };

/** A linear display conversion (no offsets, so changes convert with the same factor). */
export interface UnitConversion {
  unit: string;
  factor: number;
}

export interface DisplayMetric {
  id: string;
  label: string;
  /** Lowercase short name for the readout strip, overlay labels and the crosshair readout. */
  shortLabel: string;
  /** Engine unit (before presentation and conversion). */
  engineUnit: string;
  /** Unit as displayed (after presentation and conversion): "kg", "mmol/L vs start", "% vs start", "index". */
  unit: string;
  category: MetricCategory;
  grade: EvidenceGrade;
  direction: DirectionOfGood;
  decimals: number;
  presentation: Presentation;
  /** Multiplier from the engine unit to the display unit (after the presentation transform). */
  factor: number;
  /** Values are scaled ×100 before display (0–1 indices shown on the 0–100 index scale). */
  scale100: boolean;
  lane: LaneKind;
  overlay: OverlayTransform;
  overlayNote?: string;
  thresholds?: Threshold[];
  caveat?: string;
  /** Short "relative to your baseline" note for pickers and legends (deltaFromBaseline only). */
  relativeNote?: string;
  /** One-line mechanism summary under the focused lane (authored summary, else the catalogue's description). */
  mechanism?: string;
  /** Plain-language definition from the engine catalogue (`SeriesDef.description`), verbatim. */
  description?: string;
  /** Band fallback when the ensemble has not delivered (MODEL_SPEC §8.2). */
  bandFallback?: { kind: 'change' | 'value'; pct: number };
  /** The catalogue says this series has no likely range (rule-based or state series). */
  bandNone: boolean;
  /** Daily aggregation in the engine (baseline selection: `initial` is an instantaneous value). */
  agg: SeriesDef['agg'];
  goalEligible: boolean;
  sexes?: readonly ('male' | 'female')[];
}

/**
 * The recommended core set shown on first run (design/COMPONENTS.md §7 MetricPicker "Default set"): fat mass, lean
 * mass, scale weight, glycogen, blood ketones, hunger pressure, metabolic adaptation, energy expenditure. Lean mass is
 * the engine's protein-based lean tissue (the DXA-equivalent lean mass swings with glycogen and water; MODEL_SPEC §6).
 */
export const CORE_METRIC_IDS = [
  'fatMass',
  'leanTissue',
  'scaleWeight',
  'glycogenTotal',
  'bhb',
  'hunger',
  'metabolicAdaptation',
  'tdee',
] as const;

/** Readout strip headline items (simulator-results.md §4): fat mass, lean, scale weight, waist, maintenance. */
export const HEADLINE_METRIC_IDS = ['fatMass', 'leanTissue', 'scaleWeight', 'waist', 'maintenance'] as const;

/** At most this many user-pinned metrics join the strip. */
export const MAX_PINNED = 3;

/** Display names where the catalogue's label is too long for a 168 px lane gutter; the full name stays in Explain. */
const LABEL: Record<string, string> = {
  leanTissue: 'Lean tissue',
  leanMass: 'Lean mass (DXA)',
  tdee: 'Energy expenditure',
  adherence: 'Plan adherence',
  menstrualRisk: 'Cycle disturbance risk',
  rtMuscleGain: 'Lean from training',
  micronutrientScore: 'Micronutrients',
  hipBmdChange: 'Hip bone density',
  ketoInduction: 'Keto-induction symptoms',
};

const SHORT: Record<string, string> = {
  scaleWeight: 'scale weight',
  fatMass: 'fat mass',
  leanMass: 'lean mass (DXA)',
  leanTissue: 'lean tissue',
  skeletalMuscle: 'muscle',
  bodyFatPct: 'body fat',
  waist: 'waist',
  visceralFat: 'visceral fat',
  glycogenTotal: 'glycogen',
  liverGlycogen: 'liver glycogen',
  muscleGlycogen: 'muscle glycogen',
  bhb: 'ketones',
  hoursInKetosis: 'hours in ketosis',
  // ketoAdaptation: no override — its names come from the engine catalogue entry (QA release check 2026-10-01: the
  // series may be the slow component or a labelled combined index, and the UI must say whatever the engine says)
  fatOxidation: 'fat oxidation',
  glucose: 'glucose',
  tdee: 'expenditure',
  rmr: 'resting rate',
  neat: 'movement',
  metabolicAdaptation: 'adaptation',
  energyBalance: 'energy balance',
  maintenance: 'maintenance',
  autophagyIdx: 'autophagy signal',
  mtorIdx: 'mTOR',
  ampkIdx: 'AMPK',
  mps: 'MPS',
  igf1: 'IGF-1',
  hunger: 'hunger',
  leptin: 'leptin',
  t3: 'T3',
  cortisol: 'cortisol',
  testosterone: 'testosterone',
  menstrualRisk: 'cycle risk',
  adherence: 'adherence',
  insulinSensitivity: 'insulin sensitivity',
  ldl: 'LDL',
  apoB: 'ApoB',
  hdl: 'HDL',
  triglycerides: 'triglycerides',
  sbp: 'systolic BP',
  liverFat: 'liver fat',
  fastingGlucose: 'fasting glucose',
  crp: 'CRP',
  vo2max: 'VO₂max',
  strength: 'strength',
  trainingStatus: 'training status',
  enduranceCapacity: 'endurance',
  rtMuscleGain: 'training lean',
  sleepQuality: 'sleep quality',
  energyAvailability: 'energy availability',
  hipBmdChange: 'hip bone density',
  ketoInduction: 'keto-induction',
  micronutrientScore: 'micronutrients',
};

/** Threshold captions (lowercase, engraved) for the catalogue's reference lines. */
const THRESHOLD_LABELS: Record<string, Record<number, string>> = {
  bhb: { 0.5: 'nutritional ketosis', 3: 'deep ketosis' },
  energyAvailability: { 30: 'low availability', 45: 'adequate' },
};

/** One-line mechanism summaries shown under a focused lane (plain language; the Explain drawer has the detail). */
const MECHANISM: Record<string, string> = {
  fatMass: 'Falls when intake is below expenditure, minus the share of the gap taken from lean tissue; slows as adaptation builds.',
  leanTissue: 'Protein-based tissue: kept by protein and resistance training, lost faster in deep deficits and long fasts.',
  scaleWeight: 'Tissue plus fast-moving glycogen, water and gut contents, read on waking.',
  skeletalMuscle: 'About half of non-training lean change plus most of what training adds.',
  waist: 'Follows trunk fat and visceral fat; drops more slowly than weight at first.',
  glycogenTotal: 'Drains in fasts and on low-carbohydrate days, refills within a day or two of carbohydrate.',
  bhb: 'Rises 12–36 h into a fast as liver glycogen runs low; falls within hours of carbohydrate.',
  hunger: 'Rises with the deficit and as leptin falls with fat mass; eases with protein, fibre and sleep.',
  metabolicAdaptation: 'Expenditure drifts below what body size predicts during a deficit and recovers slowly afterwards.',
  tdee: 'Resting rate, digestion, everyday movement and exercise; falls with body mass and adaptation.',
  maintenance: 'The intake that would hold weight today; it moves as body mass and adaptation change.',
  autophagyIdx: 'A relative model signal that rises with long gaps without food; not a measurement.',
  insulinSensitivity: 'Improves with fat loss, training and lower liver fat.',
  ldl: 'Follows saturated fat, weight change and very-low-carbohydrate eating; shown as change from your baseline.',
};

const CAT_FALLBACK_NOTE: Partial<Record<string, string>> = {
  bhb: 'Ketones vary ten-fold, so they stay in lanes.',
  metabolicAdaptation: 'Adaptation starts at zero, so a percent change has no meaning; view it in Lanes.',
  energyBalance: 'Energy balance crosses zero, so a percent change has no meaning; view it in Lanes.',
  hipBmdChange: 'Already a change from your start; view it in Lanes.',
  hoursInKetosis: 'Hours in ketosis start near zero; view them in Lanes.',
};

/**
 * The leading sentences of a catalogue description, for the one-line mechanism under a focused lane (the Explain
 * drawer shows the whole text): whole sentences up to about `maxChars`, at least one.
 */
export function leadSentences(text: string | undefined, maxChars = 220): string | undefined {
  if (!text) return undefined;
  // sentence ends are end punctuation followed by whitespace, so "0.5 mmol/L" and "§4.11" do not split
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  let out = '';
  for (const part of parts) {
    if (out && out.length + 1 + part.length > maxChars) break;
    out = out ? `${out} ${part}` : part;
  }
  return out || text;
}

/** Optional display fields a catalogue entry may carry; when present they win over the derived defaults. */
type CatalogueEntry = SeriesDef & { readonly shortLabel?: string; readonly decimals?: number };

/**
 * Short name derived from the catalogue label: capitalised words go lowercase, acronyms stay
 * ("Keto-adaptation (slow)" → "keto-adaptation (slow)", "Blood ketones (BHB)" → "blood ketones (BHB)").
 */
export function shortFromLabel(label: string): string {
  return label.replace(/(^|[\s(–/-])([A-Z])(?=[a-z])/g, (_, pre: string, c: string) => pre + c.toLowerCase());
}

function directionOf(d: SeriesDef['direction']): DirectionOfGood {
  if (d === 'up') return 'higher';
  if (d === 'down') return 'lower';
  if (d === 'target') return 'in-range';
  return 'neutral';
}

const BODY_MASS_UNITS = new Set(['kg']);
const GLUCOSE_IDS = new Set(['glucose', 'fastingGlucose']);

/** Engine unit → display unit for the user's unit system. */
export function convertUnit(id: string, unit: string, prefs: UnitPrefs): UnitConversion {
  if (BODY_MASS_UNITS.has(unit) && prefs.units === 'imperial') return { unit: 'lb', factor: 2.2046226218 };
  if (unit === 'cm' && prefs.units === 'imperial') return { unit: 'in', factor: 1 / 2.54 };
  if (unit === 'kcal/d' && prefs.energyUnit === 'kJ') return { unit: 'kJ/d', factor: KJ_PER_KCAL };
  if (unit === 'kcal/kg FFM/d' && prefs.energyUnit === 'kJ') return { unit: 'kJ/kg FFM/d', factor: KJ_PER_KCAL };
  if (unit === 'mmol/L' && GLUCOSE_IDS.has(id) && prefs.glucoseUnit === 'mgdl') return { unit: 'mg/dL', factor: 18.016 };
  return { unit, factor: 1 };
}

function decimalsFor(unit: string, id: string): number {
  if (id === 'bhb') return 2;
  switch (unit) {
    case 'kg':
    case 'lb':
    case 'cm':
    case 'in':
    case '%':
    case '%-pts vs start':
    case 'h/d':
    case 'mL/kg/min':
    case '%/cycle':
    case 'kcal/kg FFM/d':
      return 1;
    case 'mmol/L':
    case 'mmol/L vs start':
    case 'g/L':
    case 'g/L vs start':
      return 2;
    case 'mg/dL':
    case 'mg/dL vs start':
    case 'mmHg vs start':
    case 'mmHg':
      return 0;
    default:
      return 0;
  }
}

function parseBand(m: string | undefined): DisplayMetric['bandFallback'] {
  if (!m) return undefined;
  const hit = /^fix(Change|Value):(\d+(?:\.\d+)?)$/.exec(m);
  if (!hit) return undefined;
  return { kind: hit[1] === 'Change' ? 'change' : 'value', pct: Number(hit[2]) };
}

/** Build the display entry of one catalogue series for the user's unit preferences. */
export function toDisplayMetric(d: SeriesDef, prefs: UnitPrefs = METRIC_UNITS): DisplayMetric {
  const entry = d as CatalogueEntry;
  const presentation = d.presentation;
  const scale100 = d.unit === '0–1';
  let unit = scale100 ? 'index' : d.unit;
  let factor = scale100 ? 100 : 1;
  let relativeNote: string | undefined;
  let overlay: OverlayTransform;
  let overlayNote: string | undefined;

  if (presentation === 'deltaFromBaseline') {
    relativeNote = 'relative to your baseline';
    if (d.unit === 'rel') {
      // relative markers (1 = your start) → percent change from your start
      unit = '% vs start';
      factor = 100;
      overlay = 'pts';
    } else {
      const conv = convertUnit(d.id, d.unit, prefs);
      unit = `${d.unit === '%' ? '%-pts' : conv.unit} vs start`;
      factor = conv.factor;
      overlay = 'none';
      overlayNote = 'Shown as change from your baseline in its own unit; compare it in Lanes.';
    }
  } else {
    const conv = convertUnit(d.id, unit, prefs);
    unit = conv.unit;
    factor *= conv.factor;
    overlay = d.overlay === 'log2' ? 'none' : d.overlay;
    if (overlay === 'none') overlayNote = CAT_FALLBACK_NOTE[d.id] ?? `${d.label} can't be indexed to its start; view it in Lanes.`;
  }

  const lane: LaneKind = d.lane === 'stacked-area' ? 'stacked-area' : d.lane === 'index' ? 'index' : 'line';
  const thresholds =
    presentation === 'absolute' && d.thresholds?.length
      ? d.thresholds.map((v) => ({ value: v * factor, label: THRESHOLD_LABELS[d.id]?.[v] ?? `${v} ${unit}` }))
      : undefined;

  return {
    id: d.id,
    label: LABEL[d.id] ?? d.label,
    shortLabel: SHORT[d.id] ?? entry.shortLabel ?? shortFromLabel(d.label),
    engineUnit: d.unit,
    unit,
    category: d.category,
    grade: d.grade,
    direction: directionOf(d.direction),
    decimals:
      entry.decimals != null && factor === 1
        ? entry.decimals
        : presentation === 'deltaFromBaseline' && d.unit === 'rel'
          ? 1
          : unit === 'index'
            ? 0
            : decimalsFor(unit, d.id),
    presentation,
    factor,
    scale100,
    lane,
    overlay,
    overlayNote,
    thresholds,
    caveat: d.caveat,
    relativeNote,
    mechanism: MECHANISM[d.id] ?? leadSentences(d.description),
    description: d.description,
    bandFallback: parseBand(d.bandFallback ?? (d.band !== 'draws' ? d.band : undefined)),
    bandNone: d.band === 'none',
    agg: d.agg,
    goalEligible: d.goal !== 'none',
    sexes: d.sexes,
  };
}

/**
 * The chartable outcome metrics (kind 'metric'), in catalogue order. State-presentation series (ketosis state, mood
 * tier) are not lanes: ketosis state is the event ribbon's band; the mood tier is a guard shown through warnings.
 */
export function displayCatalogue(prefs: UnitPrefs = METRIC_UNITS): DisplayMetric[] {
  return (SERIES as readonly SeriesDef[]).filter((d) => d.kind === 'metric' && d.presentation !== 'state').map((d) => toDisplayMetric(d, prefs));
}

const LOOSE = new Map((SERIES as readonly SeriesDef[]).map((d) => [d.id.replace(/[_-]/g, '').toLowerCase(), d.id]));

/** `fat_mass`, `fat-mass`, `FatMass` → `fatMass` (deep links written before the engine ids settled). Null if unknown. */
export function resolveMetricId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return LOOSE.get(raw.replace(/[_-]/g, '').toLowerCase()) ?? null;
}

/** Engine catalogue entry (any kind), or undefined. */
export function seriesDefOf(id: string): SeriesDef | undefined {
  return (SERIES as readonly SeriesDef[]).find((d) => d.id === id);
}
