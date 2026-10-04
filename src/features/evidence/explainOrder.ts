/**
 * Relevance order for "Explain this curve" (QA 11): the mechanism that defines or produces a metric comes first —
 * for blood ketones the liver's ketone production, not "Does protein knock you out of ketosis?".
 *
 * Content order (the order topics load and mechanisms are authored) says nothing about relevance, and the content's
 * `relatedMetricIds` are a flat list. The order here is derived without touching any number in the content:
 *
 *  1. a small hand-curated lead list per core metric (`LEADING_MECHANISMS`, ids that must exist in the content and
 *     list the metric — a test keeps them honest);
 *  2. mechanisms from the metric's owner dossier (the first dossier of the catalogue's `src`, e.g. "05 §4.1" → 05),
 *     then from its other defining dossiers;
 *  3. mechanisms whose title or id carries the metric's core terms ("ketone", "glycogen", "hunger"…);
 *  4. last: myth-like questions ("Does …?"), contested entries and moderators (sex, age, body fat, variability).
 *
 * Ties keep the content order, so the result is stable.
 */
import type { Mechanism } from '@/content/evidence/schema';
import { metricInfo } from './metricLabels';

/** Leading mechanism ids for the core channels, most defining first. */
export const LEADING_MECHANISMS: Readonly<Record<string, readonly string[]>> = {
  bhb: ['05-hepatic-ketogenesis', '05-ffa-supply', '05-ketone-clearance', '05-bhb-acac-and-diurnal-pattern', '05-fasting-ketosis-time-course', '05-very-low-carb-ketosis', '05-ketosis-exit-and-reentry'],
  ketosisState: ['05-hepatic-ketogenesis', '05-fasting-ketosis-time-course', '05-very-low-carb-ketosis', '05-ketosis-exit-and-reentry'],
  hoursInKetosis: ['05-fasting-ketosis-time-course', '05-very-low-carb-ketosis', '05-ketosis-exit-and-reentry', '05-ketone-clearance'],
  scaleWeight: ['13-scale-weight-decomposition', '01-glycogen-water-early-weight-change', '01-ecf-sodium-carbohydrate', '13-gut-content-mass', '01-energy-density-of-weight-change'],
  fatMass: ['01-macronutrient-flux-model', '01-energy-density-of-weight-change', '01-forbes-partition-p-ratio', '05-fat-balance-and-oxidation', '03-lean-fraction-of-loss'],
  leanTissue: ['01-forbes-partition-p-ratio', '03-lean-fraction-of-loss', '09-daily-accretion-update', '03-protein-dose-response-training-gain', '09-lean-retention-in-deficit'],
  leanMass: ['13-scale-weight-decomposition', '14-lean-compartment-initial-state', '13-early-weight-loss-energy-density'],
  skeletalMuscle: ['09-daily-accretion-update', '09-weekly-volume-dose-response', '09-lean-retention-in-deficit', '09-natural-muscle-ceiling'],
  bodyFatPct: ['14-body-fat-fusion', '14-body-composition-uncertainty', '14-population-body-fat-estimators'],
  waist: ['14-circumferences-from-state', '14-regional-fat-allocation', '14-fat-depots-and-visceral-fat'],
  glycogenTotal: ['04-glycogen-capacity-water-potassium', '04-carbohydrate-disposal-hourly', '04-liver-glycogen-fasting-exercise', '04-muscle-glycogen-use-exercise', '04-muscle-glycogen-repletion-supercompensation'],
  liverGlycogen: ['04-liver-glycogen-fasting-exercise', '04-liver-glycogen-repletion-fructose', '04-glycogen-capacity-water-potassium'],
  muscleGlycogen: ['04-muscle-glycogen-use-exercise', '04-muscle-glycogen-repletion-supercompensation', '04-muscle-glycogen-rest-low-carb', '04-glycogen-capacity-water-potassium'],
  hunger: ['12-hunger-pressure-index', '12-weight-loss-appetite-feedback', '12-food-properties-and-fullness', '12-meal-pattern-and-diet-fatigue', '16-sleep-energy-intake-hunger'],
  tdee: ['02-integrated-daily-expenditure', '02-resting-rate-equations', '02-neat-activity-steps', '02-thermic-effect-of-food', '10-mets-and-net-cost', '02-adaptive-thermogenesis-deficit'],
  maintenance: ['02-integrated-daily-expenditure', '02-resting-rate-equations', '10-activity-baselines-and-pal', '02-tdee-uncertainty-band'],
  metabolicAdaptation: ['02-adaptive-thermogenesis-deficit', '02-adaptation-in-surplus'],
  energyBalance: ['02-integrated-daily-expenditure', '11-energy-accounting-overfeeding-studies'],
  autophagyIdx: ['08-autophagy-signal-index', '08-fasting-depth-drive', '08-amino-acids-mtorc1', '08-insulin-akt-suppression', '07-fasting-clocks-and-memory'],
  mps: ['03-hourly-muscle-protein-balance', '03-per-meal-mps-dose-response', '03-resistance-exercise-turnover', '03-mps-suppression-energy-deficit'],
  ldl: ['06-marker-dynamics', '06-fatty-acid-exchange-lipids', '06-weight-loss-coefficients', '06-low-carb-ldl-average'],
  glucose: ['04-glucose-insulin-response-curves', '07-fasting-glucose-insulin-lipolysis', '07-gastric-emptying-and-absorption'],
  insulinSensitivity: ['04-insulin-sensitivity-state', '06-glucose-and-insulin', '10-exercise-insulin-sensitivity'],
  strength: ['09-strength-neural-drive', '19-strength-and-power-in-a-deficit'],
  fatOxidation: ['05-fat-balance-and-oxidation', '04-insulin-lipolysis-fat-oxidation', '05-fast-fat-adaptation', '20-fat-as-main-fuel'],
};

/** Extra core terms where the label alone would miss the vocabulary of the mechanisms. */
const TERMS: Readonly<Record<string, readonly string[]>> = {
  bhb: ['ketone', 'ketogenesis', 'ketosis', 'bhb'],
  ketosisState: ['ketone', 'ketosis'],
  hoursInKetosis: ['ketone', 'ketosis'],
  scaleWeight: ['scale', 'weight', 'water', 'sodium'],
  hunger: ['hunger', 'appetite', 'fullness'],
  tdee: ['expenditure', 'energy use', 'resting', 'neat'],
  maintenance: ['maintenance', 'expenditure'],
  metabolicAdaptation: ['adaptation', 'adaptive'],
  autophagyIdx: ['autophagy', 'recycling'],
  mps: ['protein synthesis', 'mps'],
  leanTissue: ['lean', 'protein'],
  skeletalMuscle: ['muscle', 'volume', 'accretion'],
  glycogenTotal: ['glycogen'],
  liverGlycogen: ['liver', 'glycogen'],
  muscleGlycogen: ['muscle glycogen'],
  fatMass: ['fat', 'energy density'],
};

const STOP = new Set(['the', 'and', 'of', 'a', 'an', 'in', 'on', 'per', 'total', 'index', 'state', 'signal', 'activity', 'relative', 'blood', 'change']);

/** Lowercase core terms of a metric: label words (plus the parenthesised abbreviation) and the curated extras. */
export function metricTerms(metricId: string): string[] {
  const label = metricInfo(metricId).label.toLowerCase();
  const words = label
    .replace(/[()₂]/g, ' ')
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    // "ketones" → "ketone", "markers" → "marker": a light plural strip so titles in the singular match
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
  return [...new Set([...(TERMS[metricId] ?? []), ...words])];
}

const QUESTION = /\?\s*$/;
const MODERATOR = /moderat|variab|sex-age|age-and-sex|\bage\b|adiposity|body-fat-level|menopause|cycle|ethnic|individual/;

/** Relevance score of one mechanism for a metric (higher first). Exported for tests. */
export function relevance(metricId: string, m: Pick<Mechanism, 'id' | 'title' | 'status'>, terms = metricTerms(metricId)): number {
  let score = 0;
  const lead = LEADING_MECHANISMS[metricId];
  const li = lead ? lead.indexOf(m.id) : -1;
  // the curated order is strict: each step (200) exceeds every other bonus or penalty combined (≤ 160)
  if (li >= 0) score += 10_000 - li * 200;
  const dossiers = metricInfo(metricId).dossiers;
  const prefix = m.id.slice(0, 2);
  if (dossiers[0] === prefix) score += 100;
  else if (dossiers.includes(prefix)) score += 60;
  const title = m.title.toLowerCase();
  const id = m.id.toLowerCase();
  if (terms.some((t) => title.includes(t))) score += 40;
  else if (terms.some((t) => id.includes(t.replace(/\s+/g, '-')))) score += 20;
  if (QUESTION.test(m.title)) score -= 80;
  if (m.status === 'contested') score -= 30;
  if (MODERATOR.test(id) || MODERATOR.test(title)) score -= 50;
  return score;
}

/** Mechanisms for a metric, most relevant first (stable for ties). */
export function orderForMetric<T extends { mechanism: Pick<Mechanism, 'id' | 'title' | 'status'> }>(metricId: string, list: readonly T[]): T[] {
  const terms = metricTerms(metricId);
  return list
    .map((r, i) => ({ r, i, s: relevance(metricId, r.mechanism, terms) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}
