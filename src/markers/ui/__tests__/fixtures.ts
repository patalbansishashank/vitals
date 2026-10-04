import { readingFromInput, upsertReadings } from '../../doc';
import { emptyMarkersDoc, type MarkerEvaluation, type MarkerNote, type MarkersDoc } from '../../types';

export const LDL_NOTE: MarkerNote = {
  rule: 'W-L-LDL-1',
  markerId: 'ldl',
  kind: 'warn',
  severity: 'caution',
  because: { markerId: 'ldl', label: 'LDL cholesterol', value: 192, unit: 'mg/dL', date: '2026-09-14' },
  levers: ['vlc', 'satfat'],
  text: 'Your LDL is high; very-low-carb eating and saturated fat can raise it further.',
  grade: 'B',
  sources: [{ id: 'S1', doi: '10.1000/x' }],
  retestDue: '2026-12-14',
};

export const OLD_NOTE: MarkerNote = { ...LDL_NOTE, rule: 'W-L-LDL-2', because: { ...LDL_NOTE.because, date: '2025-08-01' } };

export const DANGER_NOTE: MarkerNote = {
  rule: 'W-L-EGFR-C1',
  markerId: 'egfr',
  kind: 'clinician',
  severity: 'danger',
  because: { markerId: 'egfr', label: 'eGFR', value: 42, unit: 'mL/min/1.73 m²', date: '2026-09-14' },
  levers: ['highprotein'],
  text: 'Your kidney filtration is low. Please see a clinician before a high-protein plan.',
  grade: 'A',
  sources: [],
};

export function evaluationOf(notes: MarkerNote[], extra: Partial<MarkerEvaluation> = {}): MarkerEvaluation {
  return { states: [], notes, safety: { plannerLocks: [], flags: [] }, preferLevers: [], reasks: [], retests: [], unresolved: [], ...extra };
}

export function ldlDoc(values: Array<[string, number]> = [['2026-06-01', 180], ['2026-09-14', 192]]): MarkersDoc {
  return upsertReadings(
    emptyMarkersDoc(),
    values.map(([date, v]) => readingFromInput({ id: 'ldl', value: v, unit: 'mg/dL', date }, 'manual', `${date}T08:00:00.000Z`)),
  );
}
