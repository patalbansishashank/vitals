/**
 * Report names → Tier A marker ids (docs/SUITE_SPEC.md §13.5.6). Pure.
 *
 * Two layers:
 *   1. EXACT: normalised spellings seen on Indian lab reports (Thyrocare, SRL/Agilus, Lal PathLabs, Metropolis, Redcliffe,
 *      Healthians, hospital labs). A hit here is a "synonym exact" match (confidence 1).
 *   2. RULES: ordered patterns over the normalised name for spellings not in the list (confidence 0.85).
 * Before either, DISPLAY_ONLY patterns catch names that look like a Tier A name but are not one: total T3 is not free T3,
 * plain CRP is not hs-CRP, ratios, VLDL, free testosterone, urine creatinine and so on. Anything that matches nothing and
 * still looks like a result is shown, not used (`displayOnly`).
 *
 * Calculated rows (§13.5.6 "CALCULATED rows recomputed and dropped from confirmation"), decided here:
 *   - `isCalculated(name, method)` is true when the name or the method says calculated / calc. / derived / computed /
 *     Friedewald / Martin-Hopkins / estimated, or the name is a ratio. The urine albumin/creatinine ratio (a measured
 *     ratio) and eGFR (a lab estimate the spec takes as the lab value) are never treated as calculated rows to drop.
 *   - A calculated Tier A row (non-HDL, LDL/HDL …) is recomputed where the inputs are on the report and listed under
 *     displayOnly; it is not offered for confirmation.
 *   - Exception: a calculated LDL when the report has no direct LDL stays a confirmable row, `calculated: true`,
 *     method 'calculated', with the issue "calculated by the lab (Friedewald); a direct LDL is better".
 */
import type { MarkerId } from '../types';

/** Lower-case, dots dropped ("S.G.P.T" → "sgpt"), every other run of punctuation → one space. */
export function normaliseName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/μ/g, 'µ')
    .replace(/\./g, '')
    .replace(/[^a-z0-9%µ]+/g, ' ')
    .trim();
}

/** Specimen words that some labs put before or after the name. */
const SPECIMEN = /^(serum|s|plasma|blood|whole blood|edta)\s+|\s+(serum|plasma|blood|edta|level)$/;

const stripSpecimen = (n: string): string => {
  let prev = '';
  let s = n;
  while (s !== prev) {
    prev = s;
    s = s.replace(SPECIMEN, ' ').trim();
  }
  return s;
};

/** Normalised exact names → marker. */
const EXACT_LIST: ReadonlyArray<[MarkerId, string[]]> = [
  [
    'ldl',
    [
      'LDL CHOLESTEROL - DIRECT',
      'LDL CHOLESTEROL DIRECT',
      'LDL CHOLESTEROL',
      'LDL Cholesterol (Calculated)',
      'LDL CHOLESTEROL (CALCULATED)',
      'LDL Cholesterol, Calculated',
      'LDL Cholesterol (Direct)',
      'Direct LDL',
      'LDL-C',
      'LDL-C (direct)',
      'LDL',
      'LDL Cholesterol - Direct',
      'Low Density Lipoprotein Cholesterol',
      'LOW DENSITY LIPOPROTEIN',
      'LDL-Cholesterol',
    ],
  ],
  [
    'hdl',
    [
      'HDL CHOLESTEROL - DIRECT',
      'HDL CHOLESTEROL DIRECT',
      'HDL CHOLESTEROL',
      'HDL Cholesterol (Direct)',
      'HDL-C',
      'HDL',
      'High Density Lipoprotein Cholesterol',
      'HIGH DENSITY LIPOPROTEIN',
      'HDL-Cholesterol',
    ],
  ],
  ['tg', ['TRIGLYCERIDES', 'TRIGLYCERIDE', 'Triglycerides, Serum', 'TG', 'S. Triglycerides']],
  ['nonHdl', ['NON-HDL CHOLESTEROL', 'NON HDL CHOLESTEROL', 'Non-HDL-C', 'NON HDL']],
  [
    'apoB',
    [
      'APOLIPOPROTEIN - B (APO-B)',
      'APOLIPOPROTEIN B',
      'APO B',
      'APO-B',
      'Apolipoprotein B (Apo B)',
      'APOLIPOPROTEIN - B',
    ],
  ],
  [
    'lpa',
    [
      'LIPOPROTEIN (A) [LP(A)]',
      'LIPOPROTEIN (A)',
      'LIPOPROTEIN A',
      'LP(A)',
      'Lipoprotein (a), Lp(a)',
      'Lipoprotein(a)',
    ],
  ],
  [
    'fpg',
    [
      'FASTING BLOOD SUGAR(GLUCOSE)',
      'FASTING BLOOD SUGAR (GLUCOSE)',
      'FASTING BLOOD SUGAR',
      'FASTING BLOOD GLUCOSE',
      'FASTING PLASMA GLUCOSE',
      'Glucose, Fasting (Plasma)',
      'Glucose Fasting',
      'Glucose - Fasting',
      'Blood Sugar Fasting',
      'FBS',
      'FPG',
      'Plasma Glucose Fasting',
      'Glucose (Fasting)',
    ],
  ],
  [
    'hba1c',
    [
      'HbA1c',
      'HBA1C',
      'HbA1c (Glycated Haemoglobin)',
      'HbA1c (Glycosylated Hemoglobin)',
      'GLYCATED HAEMOGLOBIN',
      'GLYCATED HEMOGLOBIN',
      'GLYCOSYLATED HAEMOGLOBIN',
      'GLYCOSYLATED HEMOGLOBIN',
      'HbA1c (IFCC)',
      'HbA1c (NGSP)',
      'Hb A1c',
      'A1C',
    ],
  ],
  ['insulin', ['INSULIN - FASTING', 'INSULIN FASTING', 'FASTING INSULIN', 'Insulin, Fasting', 'INSULIN']],
  [
    'alt',
    [
      'SGPT',
      'S.G.P.T',
      'ALT (SGPT)',
      'SGPT (ALT)',
      'ALT',
      'ALANINE AMINOTRANSFERASE',
      'ALANINE TRANSAMINASE',
      'ALANINE AMINOTRANSFERASE (ALT/SGPT)',
    ],
  ],
  [
    'ast',
    [
      'SGOT',
      'S.G.O.T',
      'AST (SGOT)',
      'SGOT (AST)',
      'AST',
      'ASPARTATE AMINOTRANSFERASE',
      'ASPARTATE TRANSAMINASE',
      'ASPARTATE AMINOTRANSFERASE (AST/SGOT)',
    ],
  ],
  [
    'ggt',
    [
      'GAMMA GT',
      'GAMMA GT (GGT)',
      'GGT',
      'GGTP',
      'GAMMA GLUTAMYL TRANSFERASE',
      'GAMMA GLUTAMYL TRANSPEPTIDASE',
      'GAMMA-GLUTAMYLTRANSFERASE (GGT)',
    ],
  ],
  [
    'creatinine',
    ['Serum Creatinine', 'CREATININE', 'CREATININE, SERUM', 'S. Creatinine', 'Creatinine (Serum)'],
  ],
  [
    'egfr',
    [
      'EST. GLOMERULAR FILTRATION RATE (eGFR)',
      'ESTIMATED GLOMERULAR FILTRATION RATE',
      'eGFR',
      'eGFR (CKD-EPI 2021)',
      'eGFR (CKD-EPI)',
      'GFR ESTIMATED',
      'Estimated GFR',
    ],
  ],
  [
    'uacr',
    [
      'Microalbumin/Creatinine ratio',
      'MICROALBUMIN CREATININE RATIO',
      'URINE ALBUMIN/CREATININE RATIO',
      'Urine Albumin Creatinine Ratio',
      'ALBUMIN CREATININE RATIO',
      'ACR',
      'UACR',
      'Urine Microalbumin/Creatinine Ratio',
    ],
  ],
  ['urate', ['URIC ACID', 'Uric Acid, Serum', 'S. Uric Acid', 'SERUM URIC ACID', 'URATE']],
  [
    'tsh',
    [
      'TSH - ULTRASENSITIVE',
      'TSH ULTRASENSITIVE',
      'TSH',
      'TSH (ULTRASENSITIVE)',
      'THYROID STIMULATING HORMONE',
      'TSH, 3rd generation',
      'US-TSH',
      'TSH (3rd Generation)',
    ],
  ],
  ['ft3', ['FREE T3', 'FT3', 'FREE TRIIODOTHYRONINE', 'FREE TRIIODOTHYRONINE (FT3)', 'T3, Free']],
  ['hb', ['HEMOGLOBIN', 'HAEMOGLOBIN', 'Hemoglobin (Hb)', 'Haemoglobin (Hb)', 'Hb', 'HGB']],
  ['ferritin', ['FERRITIN', 'SERUM FERRITIN', 'Ferritin, Serum']],
  [
    'b12',
    ['VITAMIN B-12', 'VITAMIN B12', 'Vitamin B12 (Cyanocobalamin)', 'CYANOCOBALAMIN', 'COBALAMIN', 'Vit B12'],
  ],
  [
    'vitD',
    [
      '25-OH VITAMIN D (TOTAL)',
      'VITAMIN D TOTAL (25-OH)',
      'VITAMIN D (25-OH)',
      '25-Hydroxy Vitamin D',
      '25 HYDROXY VITAMIN D',
      'VITAMIN D, 25-HYDROXY',
      'VITAMIN D3 (25-OH)',
      'VITAMIN D',
      'Vitamin D Total',
      '25(OH) Vitamin D',
    ],
  ],
  [
    'hsCrp',
    [
      'HS-CRP',
      'HIGH SENSITIVITY C-REACTIVE PROTEIN',
      'HIGH SENSITIVITY C-REACTIVE PROTEIN (HS-CRP)',
      'hs CRP',
      'C-REACTIVE PROTEIN (HIGH SENSITIVITY)',
      'hsCRP',
    ],
  ],
  ['sodium', ['SODIUM', 'SODIUM (NA+)', 'Sodium, Serum', 'S. Sodium', 'Na+']],
  ['potassium', ['POTASSIUM', 'POTASSIUM (K+)', 'Potassium, Serum', 'S. Potassium', 'K+']],
  ['testosterone', ['TESTOSTERONE', 'TESTOSTERONE TOTAL', 'Testosterone, total', 'TOTAL TESTOSTERONE']],
  [
    'cortisol',
    [
      'CORTISOL',
      'CORTISOL (MORNING)',
      'Cortisol (8 AM)',
      'CORTISOL - MORNING',
      'SERUM CORTISOL',
      'Cortisol, AM',
    ],
  ],
];

const EXACT: ReadonlyMap<string, MarkerId> = new Map(
  EXACT_LIST.flatMap(([id, names]) => names.map((n) => [stripSpecimen(normaliseName(n)), id] as const)),
);

/** Names that are shown, not used. Checked before the Tier A rules. */
export const DISPLAY_ONLY: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /\b(total )?(t3|triiodothyronine)\b/, what: 'total T3 (free T3 is the planned marker)' },
  { re: /\b(t4|thyroxine|ft4)\b/, what: 'T4' },
  { re: /\bvldl\b/, what: 'VLDL' },
  { re: /\bratio\b|\b(tc|chol|ldl|hdl|tg) (hdl|ldl)\b/, what: 'ratio' },
  { re: /\bapo\w* ?a ?1?\b|apolipoprotein a/, what: 'apolipoprotein A1' },
  {
    re: /\b(average|mean|estimated average) (blood |plasma )?(glucose|sugar)\b|\beag\b|\babg\b/,
    what: 'average glucose',
  },
  { re: /\b(free|bioavailable|calculated free) testosterone\b|testosterone free/, what: 'free testosterone' },
  {
    re: /\b(urine|urinary|24 ?h)\b.*\b(creatinine|uric|sodium|potassium|cortisol|glucose|protein)\b/,
    what: 'urine test',
  },
  { re: /\bcreatinine clearance\b/, what: 'creatinine clearance' },
  { re: /\b(post ?prandial|pp|random|rbs|ppbs)\b/, what: 'non-fasting glucose' },
  { re: /\bhoma\b/, what: 'HOMA' },
  { re: /\bige\b|allerg/, what: 'allergy panel' },
  {
    re: /\b(rbc|wbc|tlc|dlc|pcv|hct|ha?ematocrit|mcv|mchc?|rdw\w*|platelets?|mpv|pdw|plcr|pct|neutrophils?|lymphocytes?|monocytes?|eosinophils?|basophils?|esr|reticulocytes?|leu[ck]ocytes?|granulocytes?|nrbc)\b/,
    what: 'blood count index',
  },
  { re: /\balkaline phosphatase\b|\balp\b/, what: 'ALP' },
  { re: /\bbilirubin\b/, what: 'bilirubin' },
  { re: /\burea\b|\bbun\b/, what: 'urea' },
  { re: /^(cholesterol( total)?|total cholesterol|cholesterol total|tc)$/, what: 'total cholesterol' },
  { re: /\b(total protein|albumin|globulin|a ?g)\b/, what: 'protein' },
  { re: /\b(iron|tibc|uibc|transferrin)\b/, what: 'iron studies' },
  { re: /\b(calcium|phosph\w*|magnesium|chloride|bicarbonate)\b/, what: 'mineral' },
  { re: /\b(folate|folic)\b/, what: 'folate' },
];

/** Tier A rules over the normalised name, in order (uACR before creatinine, non-HDL before HDL, …). */
const RULES: ReadonlyArray<{ id: MarkerId; re: RegExp; not?: RegExp }> = [
  { id: 'uacr', re: /(micro ?)?albumin\w* (to )?creatinine|\bu?acr\b/ },
  { id: 'egfr', re: /\begfr\b|glomerular filtration/ },
  { id: 'nonHdl', re: /\bnon ?hdl\b/ },
  {
    id: 'hsCrp',
    re: /\bhs ?crp\b|high sensitiv\w* c ?reactive|hs c ?reactive|c ?reactive protein high sensitiv/,
  },
  { id: 'hba1c', re: /\bhba1c\b|\bhb a1c\b|\ba1c\b|glyc(at|osyl)ated ha?emoglobin/ },
  { id: 'ldl', re: /\bldl\b|low density lipoprotein/ },
  { id: 'hdl', re: /\bhdl\b|high density lipoprotein/ },
  { id: 'tg', re: /triglycerides?\b/ },
  { id: 'apoB', re: /\bapo ?(lipoprotein )?b\b|apolipoprotein b\b|\bapo b 100\b/ },
  { id: 'lpa', re: /\blipoprotein ?a\b|\blp ?a\b/ },
  { id: 'fpg', re: /\bfasting\b.*\b(glucose|sugar)\b|\b(glucose|sugar)\b.*\bfasting\b|\bf[bp]s\b|\bfpg\b/ },
  { id: 'insulin', re: /\binsulin\b/, not: /antibod|resistan|c peptide/ },
  { id: 'alt', re: /\bs?gpt\b|\balt\b|alanine (amino ?)?trans(aminase|ferase)/ },
  { id: 'ast', re: /\bs?got\b|\bast\b|aspartate (amino ?)?trans(aminase|ferase)/ },
  { id: 'ggt', re: /\bggtp?\b|\bgamma ?gt\b|gamma glutamyl/ },
  { id: 'creatinine', re: /\bcreatinine\b/ },
  { id: 'urate', re: /\buric acid\b|\burate\b/ },
  { id: 'tsh', re: /\btsh\b|thyroid stimulating hormone/ },
  { id: 'ft3', re: /\bfree t3\b|\bft3\b|free triiodothyronine|\bt3 free\b/ },
  { id: 'hb', re: /^(ha?emoglobin|hb|hgb)\b/, not: /a1c|glyc|corpuscular|electrophoresis|variant/ },
  { id: 'ferritin', re: /\bferritin\b/ },
  { id: 'b12', re: /\b(vitamin |vit )?b ?12\b|cobalamin/ },
  {
    id: 'vitD',
    re: /\b25 ?(oh|hydroxy)\b.*\bvit\w* d\b|\bvit\w* d\b|\bcalcidiol\b/,
    not: /\b1 ?25\b|dihydroxy|\bd2\b only/,
  },
  { id: 'sodium', re: /\bsodium\b|^na\b/ },
  { id: 'potassium', re: /\bpotassium\b|^k\b/ },
  { id: 'testosterone', re: /\btestosterone\b/ },
  { id: 'cortisol', re: /\bcortisol\b/ },
];

export interface NameMatch {
  markerId: MarkerId | null;
  /** 'exact' = in the synonym list; 'rule' = matched a pattern; 'display' = a known shown-not-used name; 'none'. */
  kind: 'exact' | 'rule' | 'display' | 'none';
}

/** Ids whose measured value is a ratio or an estimate the lab prints as its own result (never dropped as calculated). */
const NEVER_DROPPED: ReadonlySet<MarkerId> = new Set(['uacr', 'egfr']);

/** Classify a name as printed on a report. */
export function matchName(raw: string): NameMatch {
  const n = stripSpecimen(normaliseName(raw));
  if (!n) return { markerId: null, kind: 'none' };
  const exact = EXACT.get(n);
  if (exact) return { markerId: exact, kind: 'exact' };
  // Measured ratios and estimates first: "Microalbumin/Creatinine ratio" is a ratio and still Tier A.
  for (const r of RULES) if (NEVER_DROPPED.has(r.id) && r.re.test(n)) return { markerId: r.id, kind: 'rule' };
  // "free T3" contains "t3": the free form is checked before the display-only total T3.
  if (/\bfree t3\b|\bft3\b|free triiodothyronine|\bt3 free\b/.test(n))
    return { markerId: 'ft3', kind: 'rule' };
  for (const d of DISPLAY_ONLY) if (d.re.test(n)) return { markerId: null, kind: 'display' };
  if (/\bcrp\b|c ?reactive/.test(n) && !/\bhs\b|high sensitiv/.test(n))
    return { markerId: null, kind: 'display' };
  for (const r of RULES) if (r.re.test(n) && !r.not?.test(n)) return { markerId: r.id, kind: 'rule' };
  return { markerId: null, kind: 'none' };
}

const CALC_WORDS = /\b(calculated|calc|calculation|derived|computed|friedewald|martin|estimated)\b/;

/** The lab computed this row from others (name or method says so, or it is a ratio). eGFR and uACR are never "calculated rows". */
export function isCalculated(name: string, method?: string, markerId?: MarkerId | null): boolean {
  if (markerId && NEVER_DROPPED.has(markerId)) return false;
  const n = normaliseName(name);
  const m = method ? normaliseName(method) : '';
  return CALC_WORDS.test(n) || CALC_WORDS.test(m) || /\bratio\b/.test(n);
}

/** Issue text on a kept calculated LDL. */
export const LDL_CALCULATED_ISSUE = 'calculated by the lab (Friedewald); a direct LDL is better';
