// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildExtraction,
  buildLines,
  detectHeader,
  extractFromTextItems,
  parseRows,
  parseUnit,
  parseValue,
  type TextItem,
} from '../layout';
import { findSampleDate, parseDate } from '../redact';
import { isCalculated, matchName } from '../synonyms';

/** Items for one table row: cells at the given x positions, 10 pt type. */
const row = (y: number, cells: Array<[number, string]>, page = 1, h = 10): TextItem[] =>
  cells.map(([x, str]) => ({ str, x, y, w: str.length * h * 0.5, h, page }));

const HEADER = row(100, [
  [40, 'Test'],
  [250, 'Result'],
  [320, 'Unit'],
  [400, 'Bio. Ref. Interval'],
]);

describe('lines and segments', () => {
  it('groups items on one baseline (small jitter) and keeps a smaller method line apart', () => {
    const items = [
      ...row(200, [[40, 'Serum Creatinine']]),
      ...row(200.8, [[250, '1.28']]),
      ...row(211, [[40, 'Method : Jaffe']], 1, 7),
    ];
    const lines = buildLines(items);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.segments.map((s) => s.text)).toEqual(['Serum Creatinine', '1.28']);
  });

  it('joins close runs into one segment and splits at column gaps', () => {
    const items: TextItem[] = [
      { str: 'LDL', x: 40, y: 50, w: 15, h: 10, page: 1 },
      { str: 'CHOLESTEROL', x: 58, y: 50, w: 60, h: 10, page: 1 },
      { str: '192', x: 250, y: 50, w: 15, h: 10, page: 1 },
    ];
    expect(buildLines(items)[0]!.segments.map((s) => s.text)).toEqual(['LDL CHOLESTEROL', '192']);
  });
});

describe('header detection', () => {
  it('reads the SRL / Lal-style header', () => {
    const cols = detectHeader(buildLines(HEADER)[0]!)!;
    expect(cols.map((c) => c.role)).toEqual(['name', 'value', 'unit', 'range']);
  });

  it('reads the Thyrocare-style header with the method column second', () => {
    const l = buildLines(
      row(80, [
        [40, 'TEST NAME'],
        [200, 'TECHNOLOGY'],
        [330, 'VALUE'],
        [380, 'UNITS'],
        [440, 'REFERENCE RANGE'],
      ]),
    )[0]!;
    expect(detectHeader(l)!.map((c) => c.role)).toEqual(['name', 'method', 'value', 'unit', 'range']);
  });

  it('is not fooled by a patient line', () => {
    expect(
      detectHeader(
        buildLines(
          row(80, [
            [40, 'Name'],
            [120, ': Test Person'],
            [300, 'Report Status'],
            [400, ': Final'],
          ]),
        )[0]!,
      ),
    ).toBeNull();
  });
});

describe('values and units', () => {
  it.each([
    ['192', 192, undefined, undefined],
    ['192 H', 192, undefined, 'H'],
    ['L 12.4', 12.4, undefined, 'L'],
    ['12.4L', 12.4, undefined, 'L'],
    ['< 0.5', 0.5, '<', undefined],
    ['>=90', 90, '≥', undefined],
    ['1,234', 1234, undefined, undefined],
    ['1,23,456', 123456, undefined, undefined],
    ['*6.4', 6.4, undefined, undefined],
    ['6.4 (H)', 6.4, undefined, 'H'],
    ['Negative', null, undefined, undefined],
  ] as const)('%s', (raw, value, comparator, flag) => {
    const v = parseValue(raw);
    expect(v.value).toBe(value);
    expect(v.comparator).toBe(comparator);
    expect(v.flag).toBe(flag);
  });

  it('normalises units and fixes the "pq" reading slip with an issue', () => {
    expect(parseUnit('mg/dl')).toEqual({ unit: 'mg/dL' });
    expect(parseUnit('μIU/mL')).toEqual({ unit: 'µIU/mL' });
    expect(parseUnit('pq/mL')).toEqual({ unit: 'pg/mL', fixed: '"pq" read as pg; check this value' });
    expect(parseUnit('mq/dL').unit).toBe('mg/dL');
    expect(parseUnit('mill/cumm').unit).toBeNull();
  });
});

describe('names', () => {
  it.each([
    ['LDL CHOLESTEROL - DIRECT', 'ldl', 'exact'],
    ['LDL Cholesterol (Calculated)', 'ldl', 'exact'],
    ['S.G.P.T', 'alt', 'exact'],
    ['ALT (SGPT)', 'alt', 'exact'],
    ['SGOT', 'ast', 'exact'],
    ['GAMMA GT', 'ggt', 'exact'],
    ['Serum Creatinine', 'creatinine', 'exact'],
    ['EST. GLOMERULAR FILTRATION RATE (eGFR)', 'egfr', 'exact'],
    ['Microalbumin/Creatinine ratio', 'uacr', 'exact'],
    ['URIC ACID', 'urate', 'exact'],
    ['TSH - ULTRASENSITIVE', 'tsh', 'exact'],
    ['FREE T3', 'ft3', 'exact'],
    ['HEMOGLOBIN', 'hb', 'exact'],
    ['VITAMIN B-12', 'b12', 'exact'],
    ['25-OH VITAMIN D (TOTAL)', 'vitD', 'exact'],
    ['HS-CRP', 'hsCrp', 'exact'],
    ['HIGH SENSITIVITY C-REACTIVE PROTEIN', 'hsCrp', 'exact'],
    ['APOLIPOPROTEIN - B (APO-B)', 'apoB', 'exact'],
    ['LIPOPROTEIN (A) [LP(A)]', 'lpa', 'exact'],
    ['FASTING BLOOD SUGAR(GLUCOSE)', 'fpg', 'exact'],
    ['INSULIN - FASTING', 'insulin', 'exact'],
    ['NON-HDL CHOLESTEROL', 'nonHdl', 'exact'],
    ['HDL CHOLESTEROL - DIRECT', 'hdl', 'exact'],
    ['Gamma Glutamyl Transferase (GGT), Serum', 'ggt', 'rule'],
    ['Tri-iodothyronine, Free (FT3)', 'ft3', 'rule'],
  ] as const)('%s → %s', (name, id, kind) => {
    expect(matchName(name)).toEqual({ markerId: id, kind });
  });

  it.each([
    'TOTAL TRIIODOTHYRONINE (T3)',
    'CRP',
    'C-REACTIVE PROTEIN (CRP)',
    'LDL / HDL RATIO',
    'VLDL CHOLESTEROL',
    'APOLIPOPROTEIN A1',
    'Average Blood Glucose',
    'MCHC',
    'A/G Ratio',
    'Bilirubin Direct',
    'Free Testosterone',
    'Urine Creatinine',
    'TOTAL THYROXINE (T4)',
    'Post Prandial Blood Sugar',
  ])('%s is shown, not used', (name) => expect(matchName(name).markerId).toBeNull());

  it('calculated rows: name, method or ratio; never eGFR or uACR', () => {
    expect(isCalculated('NON-HDL CHOLESTEROL', 'CALCULATED')).toBe(true);
    expect(isCalculated('LDL Cholesterol (Calculated)')).toBe(true);
    expect(isCalculated('LDL', 'Friedewald')).toBe(true);
    expect(isCalculated('Chol/HDL ratio')).toBe(true);
    expect(isCalculated('LDL CHOLESTEROL - DIRECT', 'PHOTOMETRY')).toBe(false);
    expect(isCalculated('EST. GLOMERULAR FILTRATION RATE (eGFR)', 'Calculated', 'egfr')).toBe(false);
    expect(isCalculated('Microalbumin/Creatinine ratio', undefined, 'uacr')).toBe(false);
  });
});

describe('rows', () => {
  it('category ranges continue the row; method lines attach; headings reset', () => {
    const items = [
      ...HEADER,
      ...row(120, [[40, 'LIPID PROFILE']]),
      ...row(140, [
        [40, 'Cholesterol, Total'],
        [250, '212'],
        [320, 'mg/dL'],
        [400, 'Desirable : < 200'],
      ]),
      ...row(150, [[40, 'Method : CHO-POD']], 1, 7),
      ...row(152, [[400, 'Borderline High : 200-239']]),
      ...row(164, [[400, 'High : > 240']]),
      ...row(180, [
        [40, 'Triglycerides'],
        [250, '182 H'],
        [320, 'mg/dL'],
        [400, '< 150'],
      ]),
    ];
    const { rows, headerFound } = parseRows(buildLines(items));
    expect(headerFound).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: 'Cholesterol, Total',
      rangeText: 'Desirable : < 200; Borderline High : 200-239; High : > 240',
      method: 'CHO-POD',
    });
    expect(rows[1]).toMatchObject({ name: 'Triglycerides', valueText: '182 H' });
  });

  it('without a header, reads "name value unit range" left to right', () => {
    const items = [
      ...row(50, [
        [40, 'HbA1c'],
        [200, '5.9'],
        [260, '%'],
        [320, '4.0 - 5.6'],
      ]),
      ...row(70, [
        [40, 'TSH'],
        [200, '2.1'],
        [260, 'µIU/mL'],
        [320, '0.4 - 4.0'],
      ]),
    ];
    const x = extractFromTextItems(items).extraction;
    expect(x.rows.map((r) => [r.markerId, r.value, r.unit])).toEqual([
      ['hba1c', 5.9, '%'],
      ['tsh', 2.1, 'µIU/mL'],
    ]);
  });
});

describe('extraction rules', () => {
  const parsed = (name: string, value: string, unit: string, method = '') => ({
    name,
    valueText: value,
    unitText: unit,
    rangeText: '',
    method,
    flag: '',
    page: 1,
    y: 0,
  });

  it('a calculated LDL with no direct LDL is kept, marked and capped', () => {
    const x = buildExtraction([parsed('LDL Cholesterol (Calculated)', '134.6', 'mg/dL', 'Friedewald')], {
      route: 'textLayer',
      newId: () => 'x1',
    });
    expect(x.rows[0]).toMatchObject({
      markerId: 'ldl',
      calculated: true,
      method: 'calculated',
      confidence: 0.8,
    });
    expect(x.rows[0]!.issues[0]).toBe('calculated by the lab (Friedewald); a direct LDL is better');
    expect(x.extractionId).toBe('x1');
  });

  it('a calculated LDL next to a direct one is shown only; non-HDL is recomputed', () => {
    const x = buildExtraction(
      [
        parsed('TOTAL CHOLESTEROL', '200', 'mg/dL'),
        parsed('HDL CHOLESTEROL', '50', 'mg/dL'),
        parsed('LDL CHOLESTEROL - DIRECT', '118', 'mg/dL'),
        parsed('LDL CHOLESTEROL (CALCULATED)', '112', 'mg/dL'),
        parsed('NON-HDL CHOLESTEROL', '160', 'mg/dL', 'Calculated'),
      ],
      { route: 'textLayer', sampleDate: '2026-09-14' },
    );
    expect(x.rows.map((r) => r.nameOnReport)).toEqual(['HDL CHOLESTEROL', 'LDL CHOLESTEROL - DIRECT']);
    expect(x.displayOnly.map((d) => d.name)).toEqual([
      'TOTAL CHOLESTEROL',
      'NON-HDL CHOLESTEROL',
      'LDL CHOLESTEROL (CALCULATED)',
    ]);
    // printed 160, recomputed 200 − 50 = 150: both shown
    expect(x.displayOnly[1]).toMatchObject({ value: '160 (recomputed: 150)', date: '2026-09-14' });
    expect(x.notInReport).not.toContain('nonHdl');
  });

  it('confidence: exact + accepted unit + in bounds = 1; missing unit, unknown unit and outliers lower it with a reason', () => {
    const x = buildExtraction(
      [
        parsed('HbA1c', '5.9', '%'),
        parsed('HbA1c', '5.9', ''),
        parsed('TSH', '2.1', 'ng/mL'),
        parsed('FERRITIN', '9000', 'ng/mL'),
        parsed('Gamma-Glutamyl Transpeptidase (GGT), Serum', '40', 'U/L'),
      ],
      { route: 'textLayer' },
    );
    expect(x.rows.map((r) => r.confidence)).toEqual([1, 0.6, 0.4, expect.any(Number), 0.85]);
    expect(x.rows[1]!.issues).toEqual(['no unit printed; check the unit']);
    expect(x.rows[2]!.issues).toEqual(['unit not recognised']);
    expect(x.rows[2]!.unit).toBeNull();
    expect(x.rows[3]!.confidence).toBeLessThan(0.7);
    expect(x.rows[3]!.issues.length).toBe(1);
  });
});

describe('dates', () => {
  it.each([
    ['2026-09-14', '2026-09-14'],
    ['14/09/2026 07:42', '2026-09-14'],
    ['14-09-26', '2026-09-14'],
    ['14 Sep 2026', '2026-09-14'],
    ['03/Aug/2026 08:15AM', '2026-08-03'],
    ['Sept 4, 2026', '2026-09-04'],
    ['31/02/2026', undefined],
  ])('%s', (s, d) => expect(parseDate(s)).toBe(d));

  it('prefers the collection date over registration and report dates', () => {
    expect(
      findSampleDate([
        'Registered On : 20/06/2026 09:05',
        'Reported On : 21/06/2026',
        'Name : X   Collected On : 19/06/2026 18:30',
      ]),
    ).toBe('2026-06-19');
    expect(findSampleDate(['Reported : 04/Aug/2026', 'Received : 03/Aug/2026'])).toBe('2026-08-03');
    expect(findSampleDate(['Collected at : Some Centre', 'Report Date : 2026-05-12'])).toBe('2026-05-12');
    expect(findSampleDate(['HbA1c 5.9 %'])).toBeUndefined();
  });
});
