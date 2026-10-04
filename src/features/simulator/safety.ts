/**
 * Short, risk-first titles for warning rule ids (dossier 17 §3), used when a results remedy link
 * (`?days=a-b&fix=W-…`) lands on the schedule with the affected days selected.
 */
import { RULES } from '@/engine/model/safety/rules';

const TITLE: Record<string, string> = {
  'W-E02': 'Under 800 kcal a day.',
  'W-E04': 'Deficit over 40 % of maintenance.',
  'W-E06': 'Losing more than 1.5 kg a week.',
  'W-E08': 'Energy availability below 30.',
  'W-E12': 'More than 24 % of body weight lost.',
  'W-E14': 'BMI below 18.5.',
  'W-E16': 'Very low body fat.',
  'W-M03': 'Protein above 35 % of energy.',
  'W-M05': 'High protein with kidney disease.',
  'W-M07': 'Very low fat during fast weight loss.',
  'W-M10': 'Very-low-carb eating with a contraindication.',
  'W-M19': 'Alcohol on a fasting or very-low-energy day.',
  'W-F04': 'Water-only fast of 3–7 days.',
  'W-F05': 'Water-only fast over 7 days.',
  'W-F08': 'No gradual restart after a long fast.',
  'W-F12': 'Very-low-energy protein-sparing pattern.',
  'W-X05': 'Vigorous exercise needs clinician clearance.',
  'W-05-KETO-FED': 'Ketones above 3.0 while eating.',
  'W-01-FATFLOOR': 'Fat mass at the model floor.',
};

/** "Deficit over 40 % of maintenance." — or the first sentence of the rule's message. */
export function ruleTitle(id: string): string {
  if (TITLE[id]) return TITLE[id];
  const t = RULES.find((r) => r.id === id)?.template;
  return t ? (t.split(/(?<=\.)\s/)[0] ?? id).replace(/\{[^}]+\}/g, '…') : id;
}
