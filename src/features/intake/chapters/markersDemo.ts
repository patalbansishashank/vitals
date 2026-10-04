/**
 * A synthetic report reading (no real person's data) for the review table: tests, screenshots, and
 * `/onboarding/markers?demo=review` in development builds only (loaded with a dynamic import behind
 * `import.meta.env.DEV`, so production bundles never contain it).
 */
import type { MarkerExtraction } from '@/markers';

export const DEMO_EXTRACTION: MarkerExtraction = {
  extractionId: 'demo-extraction',
  route: 'textLayer',
  sampleDate: '2026-09-14',
  rows: [
    { row: 0, markerId: 'ldl', nameOnReport: 'LDL Cholesterol, Direct', value: 192, unit: 'mg/dL', labRange: '< 100', method: 'direct', calculated: false, confidence: 0.96, issues: [] },
    { row: 1, markerId: 'hdl', nameOnReport: 'HDL Cholesterol', value: 41, unit: 'mg/dL', labRange: '> 40', calculated: false, confidence: 0.94, issues: [] },
    { row: 2, markerId: 'tg', nameOnReport: 'Triglycerides', value: 168, unit: 'mg/dl', labRange: '< 150', calculated: false, confidence: 0.91, issues: [] },
    { row: 3, markerId: 'hba1c', nameOnReport: 'HbA1c', value: 5.9, unit: '%', labRange: '4.0 - 5.6', calculated: false, confidence: 0.72, issues: ['two values on this line; the first was used'] },
    { row: 4, markerId: 'b12', nameOnReport: 'Vitamin B12', value: 178, unit: 'pq/mL', labRange: '211 - 911', calculated: false, confidence: 0.41, issues: ['"pq" read as pg; check this value'] },
    { row: 5, markerId: 'nonHdl', nameOnReport: 'Non-HDL Cholesterol (calculated)', value: 226, unit: 'mg/dL', labRange: '< 130', calculated: true, confidence: 0.9, issues: [] },
    { row: 6, markerId: null, nameOnReport: 'VLDL Cholesterol', value: 34, unit: 'mg/dL', labRange: '< 30', calculated: true, confidence: 0.88, issues: [] },
  ],
  displayOnly: [
    { name: 'MCV', value: '88', unit: 'fL', range: '80 - 100', date: '2026-09-14' },
    { name: 'A/G ratio', value: '1.4', range: '1.1 - 2.2', date: '2026-09-14' },
    { name: 'ALP', value: '84', unit: 'U/L', range: '44 - 147', date: '2026-09-14' },
  ],
  notInReport: ['fpg'],
};
