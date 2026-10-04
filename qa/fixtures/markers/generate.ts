/**
 * Synthetic Indian-lab-style blood reports for the marker extraction tests (src/markers/extract/__tests__).
 *
 *   node qa/fixtures/markers/generate.ts
 *
 * Writes, next to this file, four PDFs with different table layouts, one photo-like PNG, and one `<name>.expected.json`
 * per fixture with the true values. Every person, number, doctor, address and lab here is invented; nothing is taken
 * from a real report. Needs the system Chromium (/usr/bin/chromium) and playwright-core (a dev dependency).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------------------------------- data model */

type Role = 'name' | 'method' | 'value' | 'flag' | 'unit' | 'range';

interface Row {
  name: string;
  value: string;
  unit?: string;
  range?: string | string[];
  method?: string;
  flag?: string;
  /** Tier A truth: marker id, value and unit the extractor must return as a confirmable row. */
  id?: string;
  v?: number;
  u?: string;
  /** Lab-calculated: true for a confirmable calculated row (LDL Friedewald without a direct LDL). */
  calc?: boolean;
  /** A Tier A name that is calculated and must be dropped from confirmation (shown, not used). */
  dropped?: boolean;
  issue?: string;
}

interface Section {
  title: string;
  rows: Row[];
}

interface Patient {
  name: string;
  ageSex: string;
  phone: string;
  id: string;
  barcode: string;
  address: string;
  doctor: string;
}

interface Fixture {
  file: string;
  layout: string;
  sampleDate: string;
  patient: Patient;
  /** Label/value pairs of the patient block, two per line. */
  header: Array<[string, string, string, string]>;
  lab: string;
  columns: Array<{ role: Role; title: string; width: string; align?: 'left' | 'center' | 'right' }>;
  /** 'inline' = method in its own column; 'below' = a small "Method : …" line under the name. */
  methodStyle: 'column' | 'below' | 'none';
  pages: Section[][];
  /** Index of a page rendered as an image only (no text layer), 0-based in `pages`. */
  imagePage?: number;
  css?: string;
}

/* ------------------------------------------------------------------------------------------- fixtures */

const thyro: Fixture = {
  file: 'thyro-style.pdf',
  layout: 'TEST NAME / TECHNOLOGY / VALUE / UNITS / REFERENCE RANGE (method column second)',
  sampleDate: '2026-09-14',
  lab: 'AAROGYA SYNTHETIC DIAGNOSTICS · Wellness Profile',
  patient: {
    name: 'Aarav Testpatel',
    ageSex: '34 Y / M',
    phone: '+91 98765 43210',
    id: 'PID-77881234',
    barcode: 'BC90817263',
    address: 'Flat 12, Imaginary Residency, Pune 411001',
    doctor: 'Dr. Fictional Rao',
  },
  header: [
    ['NAME', 'Aarav Testpatel (34Y/M)', 'SAMPLE COLLECTED ON (SCT)', '14 Sep 2026 07:42'],
    ['REF. BY', 'Dr. Fictional Rao', 'SAMPLE RECEIVED ON (SRT)', '14 Sep 2026 13:10'],
    ['PATIENT ID', 'PID-77881234', 'REPORT RELEASED ON (RRT)', '15 Sep 2026 18:55'],
    ['BARCODE', 'BC90817263', 'PHONE', '+91 98765 43210'],
    ['ADDRESS', 'Flat 12, Imaginary Residency, Pune 411001', 'LABCODE', '1409XYZ123'],
  ],
  columns: [
    { role: 'name', title: 'TEST NAME', width: '36%' },
    { role: 'method', title: 'TECHNOLOGY', width: '17%' },
    { role: 'value', title: 'VALUE', width: '10%' },
    { role: 'unit', title: 'UNITS', width: '11%' },
    { role: 'range', title: 'REFERENCE RANGE', width: '26%' },
  ],
  methodStyle: 'column',
  pages: [
    [
      {
        title: 'LIPID PROFILE',
        rows: [
          { name: 'TOTAL CHOLESTEROL', method: 'PHOTOMETRY', value: '268', unit: 'mg/dL', range: '< 200' },
          {
            name: 'HDL CHOLESTEROL - DIRECT',
            method: 'PHOTOMETRY',
            value: '44',
            unit: 'mg/dL',
            range: '40-60',
            id: 'hdl',
            v: 44,
            u: 'mg/dL',
          },
          {
            name: 'LDL CHOLESTEROL - DIRECT',
            method: 'PHOTOMETRY',
            value: '192',
            unit: 'mg/dL',
            range: '< 100',
            id: 'ldl',
            v: 192,
            u: 'mg/dL',
          },
          {
            name: 'TRIGLYCERIDES',
            method: 'PHOTOMETRY',
            value: '160',
            unit: 'mg/dL',
            range: '< 150',
            id: 'tg',
            v: 160,
            u: 'mg/dL',
          },
          {
            name: 'TC/ HDL CHOLESTEROL RATIO',
            method: 'CALCULATED',
            value: '6.1',
            unit: 'Ratio',
            range: '3 - 5',
          },
          { name: 'LDL / HDL RATIO', method: 'CALCULATED', value: '4.4', unit: 'Ratio', range: '1.5-3.5' },
          { name: 'VLDL CHOLESTEROL', method: 'CALCULATED', value: '32', unit: 'mg/dL', range: '5 - 40' },
          {
            name: 'NON-HDL CHOLESTEROL',
            method: 'CALCULATED',
            value: '224',
            unit: 'mg/dL',
            range: '< 160',
            id: 'nonHdl',
            dropped: true,
          },
          {
            name: 'APOLIPOPROTEIN - B (APO-B)',
            method: 'IMMUNOTURBIDIMETRY',
            value: '138',
            unit: 'mg/dL',
            range: '49 - 103',
            id: 'apoB',
            v: 138,
            u: 'mg/dL',
          },
          {
            name: 'LIPOPROTEIN (A) [LP(A)]',
            method: 'IMMUNOTURBIDIMETRY',
            value: '62',
            unit: 'mg/dL',
            range: '< 30',
            id: 'lpa',
            v: 62,
            u: 'mg/dL',
          },
        ],
      },
      {
        title: 'DIABETES',
        rows: [
          {
            name: 'HbA1c',
            method: 'H.P.L.C',
            value: '5.9',
            unit: '%',
            range: ['Below 5.7 : Normal', '5.7 - 6.4 : Prediabetes', '>= 6.5 : Diabetes'],
            id: 'hba1c',
            v: 5.9,
            u: '%',
          },
          {
            name: 'AVERAGE BLOOD GLUCOSE (ABG)',
            method: 'CALCULATED',
            value: '123',
            unit: 'mg/dL',
            range: '90 - 120',
          },
        ],
      },
      {
        title: 'THYROID PROFILE',
        rows: [
          {
            name: 'TOTAL TRIIODOTHYRONINE (T3)',
            method: 'C.L.I.A',
            value: '118',
            unit: 'ng/dL',
            range: '60 - 200',
          },
          { name: 'TOTAL THYROXINE (T4)', method: 'C.L.I.A', value: '8.1', unit: 'µg/dL', range: '4.5 - 12' },
          {
            name: 'FREE T3',
            method: 'C.L.I.A',
            value: '3.1',
            unit: 'pg/mL',
            range: '2.0 - 4.4',
            id: 'ft3',
            v: 3.1,
            u: 'pg/mL',
          },
          {
            name: 'TSH - ULTRASENSITIVE',
            method: 'C.L.I.A',
            value: '2.84',
            unit: 'µIU/mL',
            range: '0.54 - 5.30',
            id: 'tsh',
            v: 2.84,
            u: 'µIU/mL',
          },
        ],
      },
      {
        title: 'VITAMINS & INFLAMMATION',
        rows: [
          {
            name: 'VITAMIN B-12',
            method: 'C.L.I.A',
            value: '178',
            unit: 'pq/mL',
            range: '211 - 911',
            id: 'b12',
            v: 178,
            u: 'pg/mL',
            issue: '"pq" read as pg; check this value',
          },
          {
            name: '25-OH VITAMIN D (TOTAL)',
            method: 'C.L.I.A',
            value: '18.4',
            unit: 'ng/mL',
            range: '30 - 100',
            id: 'vitD',
            v: 18.4,
            u: 'ng/mL',
          },
          {
            name: 'HIGH SENSITIVITY C-REACTIVE PROTEIN (HS-CRP)',
            method: 'IMMUNOTURBIDIMETRY',
            value: '2.6',
            unit: 'mg/L',
            range: '< 1',
            id: 'hsCrp',
            v: 2.6,
            u: 'mg/L',
          },
          {
            name: 'FERRITIN',
            method: 'C.L.I.A',
            value: '96.5',
            unit: 'ng/mL',
            range: '22 - 322',
            id: 'ferritin',
            v: 96.5,
            u: 'ng/mL',
          },
        ],
      },
    ],
  ],
};

const srl: Fixture = {
  file: 'srl-style.pdf',
  layout: 'Test / Result / Unit / Bio. Ref. Interval, method lines under names, category ranges (low eGFR)',
  sampleDate: '2026-08-03',
  lab: 'IMAGINARY PATHLABS NATIONAL REFERENCE LAB',
  patient: {
    name: 'Meera Imaginary',
    ageSex: '61 Years / Female',
    phone: '9123456780',
    id: 'LPL-0099887',
    barcode: '112233445',
    address: 'Imaginary Collection Centre, 4 Fake Lane, Kolkata',
    doctor: 'Dr. Placeholder Sen',
  },
  header: [
    ['Name', 'Ms. Meera Imaginary', 'Collected', '03/Aug/2026 08:15AM'],
    ['Lab No.', '112233445', 'Received', '03/Aug/2026 11:40AM'],
    ['Ref By', 'Dr. Placeholder Sen', 'Reported', '04/Aug/2026 06:02PM'],
    ['Age / Gender', '61 Years / Female', 'Report Status', 'Final'],
    ['UHID', 'LPL-0099887', 'Mobile No.', '9123456780'],
    ['Collected at', 'Imaginary Collection Centre, 4 Fake Lane, Kolkata', 'A/c Status', 'P'],
  ],
  columns: [
    { role: 'name', title: 'Test', width: '46%' },
    { role: 'value', title: 'Result', width: '12%' },
    { role: 'unit', title: 'Unit', width: '16%' },
    { role: 'range', title: 'Bio. Ref. Interval', width: '26%' },
  ],
  methodStyle: 'below',
  pages: [
    [
      {
        title: 'KIDNEY PANEL; SERUM',
        rows: [
          {
            name: 'Serum Creatinine',
            method: 'Modified Jaffe, kinetic',
            value: '1.28',
            unit: 'mg/dL',
            range: '0.51 - 0.95',
            id: 'creatinine',
            v: 1.28,
            u: 'mg/dL',
          },
          {
            name: 'EST. GLOMERULAR FILTRATION RATE (eGFR)',
            method: 'CKD-EPI 2021 equation',
            value: '47',
            unit: 'mL/min/1.73m2',
            range: '> 59',
            id: 'egfr',
            v: 47,
            u: 'mL/min/1.73 m²',
          },
          { name: 'Urea', method: 'Urease UV', value: '44.0', unit: 'mg/dL', range: '17 - 43' },
          {
            name: 'Urea Nitrogen Blood',
            method: 'Calculated',
            value: '20.6',
            unit: 'mg/dL',
            range: '8 - 20',
          },
          { name: 'BUN/Creatinine Ratio', method: 'Calculated', value: '16.1', range: '10 - 20' },
          {
            name: 'URIC ACID',
            method: 'Uricase',
            value: '7.2',
            unit: 'mg/dL',
            range: '2.6 - 6.0',
            id: 'urate',
            v: 7.2,
            u: 'mg/dL',
          },
          {
            name: 'SODIUM',
            method: 'Indirect ISE',
            value: '136',
            unit: 'mEq/L',
            range: '136 - 146',
            id: 'sodium',
            v: 136,
            u: 'mEq/L',
          },
          {
            name: 'POTASSIUM',
            method: 'Indirect ISE',
            value: '5.3',
            unit: 'mEq/L',
            range: '3.5 - 5.1',
            id: 'potassium',
            v: 5.3,
            u: 'mEq/L',
          },
          { name: 'Chloride', method: 'Indirect ISE', value: '103', unit: 'mEq/L', range: '101 - 109' },
          {
            name: 'Microalbumin/Creatinine ratio',
            method: 'Immunoturbidimetry',
            value: '48',
            unit: 'mg/g',
            range: '< 30',
            id: 'uacr',
            v: 48,
            u: 'mg/g',
          },
        ],
      },
      {
        title: 'LIVER PANEL',
        rows: [
          {
            name: 'ALT (SGPT)',
            method: 'IFCC without P5P',
            value: '38',
            unit: 'U/L',
            range: '< 33',
            id: 'alt',
            v: 38,
            u: 'U/L',
          },
          {
            name: 'AST (SGOT)',
            method: 'IFCC without P5P',
            value: '31',
            unit: 'U/L',
            range: '< 32',
            id: 'ast',
            v: 31,
            u: 'U/L',
          },
          {
            name: 'GAMMA GT (GGT)',
            method: 'IFCC',
            value: '54',
            unit: 'U/L',
            range: '< 40',
            id: 'ggt',
            v: 54,
            u: 'U/L',
          },
          { name: 'SGOT/SGPT Ratio', method: 'Calculated', value: '0.82' },
          { name: 'Alkaline Phosphatase', method: 'IFCC-AMP', value: '96', unit: 'U/L', range: '35 - 104' },
          { name: 'Bilirubin Total', method: 'Diazo', value: '0.6', unit: 'mg/dL', range: '0.3 - 1.2' },
          { name: 'Bilirubin Direct', method: 'Diazo', value: '0.2', unit: 'mg/dL', range: '< 0.3' },
          { name: 'Bilirubin Indirect', method: 'Calculated', value: '0.4', unit: 'mg/dL', range: '< 1.1' },
          { name: 'A : G Ratio', method: 'Calculated', value: '1.5', range: '0.9 - 2.0' },
        ],
      },
    ],
    [
      {
        title: 'LIPID PROFILE, BASIC',
        rows: [
          {
            name: 'Cholesterol, Total',
            method: 'CHO-POD',
            value: '212',
            unit: 'mg/dL',
            range: ['Desirable : < 200', 'Borderline High : 200-239', 'High : > 240'],
          },
          {
            name: 'Triglycerides',
            method: 'GPO-POD',
            value: '182',
            unit: 'mg/dL',
            range: ['Normal : < 150', 'Borderline High : 150-199', 'High : 200-499'],
            id: 'tg',
            v: 182,
            u: 'mg/dL',
          },
          {
            name: 'HDL Cholesterol',
            method: 'Direct measure',
            value: '41',
            unit: 'mg/dL',
            range: ['Low : < 40', 'High : > 60'],
            id: 'hdl',
            v: 41,
            u: 'mg/dL',
          },
          {
            name: 'LDL Cholesterol (Calculated)',
            method: 'Friedewald',
            value: '134.6',
            unit: 'mg/dL',
            range: ['Optimal : < 100', 'Near optimal : 100-129', 'Borderline High : 130-159'],
            id: 'ldl',
            v: 134.6,
            u: 'mg/dL',
            calc: true,
          },
          { name: 'VLDL Cholesterol', method: 'Calculated', value: '36.4', unit: 'mg/dL', range: '< 30' },
          {
            name: 'Non-HDL Cholesterol',
            method: 'Calculated',
            value: '171',
            unit: 'mg/dL',
            range: '< 130',
            id: 'nonHdl',
            dropped: true,
          },
        ],
      },
      {
        title: 'DIABETES',
        rows: [
          {
            name: 'Glucose, Fasting (Plasma)',
            method: 'Hexokinase',
            value: '112',
            unit: 'mg/dL',
            range: '70 - 100',
            id: 'fpg',
            v: 112,
            u: 'mg/dL',
          },
          {
            name: 'HbA1c (Glycated Haemoglobin)',
            method: 'HPLC, NGSP certified',
            value: '6.2',
            unit: '%',
            range: '4.0 - 5.6',
            id: 'hba1c',
            v: 6.2,
            u: '%',
          },
        ],
      },
    ],
  ],
};

const fullBody: Fixture = {
  file: 'fullbody-multipage.pdf',
  layout:
    'TEST DESCRIPTION / RESULT / UNITS / REF. RANGE / METHOD over three pages, patient block on every page',
  sampleDate: '2026-06-19',
  lab: 'SAMPLE HEALTHCHECK LABS · Full Body Checkup Advanced',
  patient: {
    name: 'Kabir Nonexistent',
    ageSex: '42 Yrs / Male',
    phone: '+91-90000-11122',
    id: 'UHID-55660011',
    barcode: 'SID-A0044721',
    address: '221 Pretend Nagar, Bengaluru 560001',
    doctor: 'Dr. Example Menon',
  },
  header: [
    ['Patient Name', 'Mr. Kabir Nonexistent', 'Registered On', '20/06/2026 09:05'],
    ['Age/Sex', '42 Yrs / Male', 'Collected On', '19/06/2026 18:30'],
    ['UHID', 'UHID-55660011', 'Reported On', '21/06/2026 14:12'],
    ['Sample ID', 'SID-A0044721', 'Referred By', 'Dr. Example Menon'],
    ['Contact', '+91-90000-11122', 'Address', '221 Pretend Nagar, Bengaluru 560001'],
  ],
  columns: [
    { role: 'name', title: 'TEST DESCRIPTION', width: '34%' },
    { role: 'value', title: 'RESULT', width: '10%' },
    { role: 'unit', title: 'UNITS', width: '12%' },
    { role: 'range', title: 'REF. RANGE', width: '24%' },
    { role: 'method', title: 'METHOD', width: '20%' },
  ],
  methodStyle: 'column',
  pages: [
    [
      {
        title: 'COMPLETE BLOOD COUNT (CBC)',
        rows: [
          {
            name: 'HEMOGLOBIN',
            value: '14.6',
            unit: 'g/dL',
            range: '13.0 - 17.0',
            method: 'Photometric',
            id: 'hb',
            v: 14.6,
            u: 'g/dL',
          },
          {
            name: 'TOTAL RBC COUNT',
            value: '4.92',
            unit: 'mill/cumm',
            range: '4.5 - 5.5',
            method: 'Impedance',
          },
          { name: 'HEMATOCRIT (PCV)', value: '44.1', unit: '%', range: '40 - 50', method: 'Calculated' },
          { name: 'MCV', value: '89.6', unit: 'fL', range: '83 - 101', method: 'Calculated' },
          { name: 'MCH', value: '29.7', unit: 'pg', range: '27 - 32', method: 'Calculated' },
          { name: 'MCHC', value: '33.1', unit: 'g/dL', range: '31.5 - 34.5', method: 'Calculated' },
          { name: 'RDW-CV', value: '13.2', unit: '%', range: '11.6 - 14.0', method: 'Calculated' },
          {
            name: 'TOTAL LEUCOCYTE COUNT',
            value: '7,240',
            unit: 'cells/cumm',
            range: '4000 - 10000',
            method: 'Impedance',
          },
          { name: 'NEUTROPHILS', value: '58', unit: '%', range: '40 - 80', method: 'Flow cytometry' },
          { name: 'LYMPHOCYTES', value: '32', unit: '%', range: '20 - 40', method: 'Flow cytometry' },
          { name: 'MONOCYTES', value: '6', unit: '%', range: '2 - 10', method: 'Flow cytometry' },
          { name: 'EOSINOPHILS', value: '3', unit: '%', range: '1 - 6', method: 'Flow cytometry' },
          { name: 'BASOPHILS', value: '1', unit: '%', range: '0 - 2', method: 'Flow cytometry' },
          {
            name: 'PLATELET COUNT',
            value: '2.45',
            unit: 'lakh/cumm',
            range: '1.5 - 4.1',
            method: 'Impedance',
          },
          { name: 'ESR', value: '12', unit: 'mm/hr', range: '0 - 15', method: 'Westergren' },
        ],
      },
    ],
    [
      {
        title: 'LIPID PROFILE',
        rows: [
          {
            name: 'TOTAL CHOLESTEROL',
            value: '196',
            unit: 'mg/dL',
            range: ['Desirable : < 200', 'Borderline High : 200-239', 'High : > 240'],
            method: 'CHOD-PAP',
          },
          {
            name: 'HDL CHOLESTEROL - DIRECT',
            value: '52',
            unit: 'mg/dL',
            range: '> 40',
            method: 'Direct',
            id: 'hdl',
            v: 52,
            u: 'mg/dL',
          },
          {
            name: 'LDL CHOLESTEROL - DIRECT',
            value: '118',
            unit: 'mg/dL',
            range: ['Optimal : < 100', 'Near optimal : 100-129'],
            method: 'Direct',
            id: 'ldl',
            v: 118,
            u: 'mg/dL',
          },
          {
            name: 'LDL CHOLESTEROL (CALCULATED)',
            value: '112',
            unit: 'mg/dL',
            range: '< 100',
            method: 'Friedewald',
          },
          {
            name: 'TRIGLYCERIDES',
            value: '132',
            unit: 'mg/dL',
            range: ['Normal : < 150', 'High : 200-499'],
            method: 'GPO-PAP',
            id: 'tg',
            v: 132,
            u: 'mg/dL',
          },
          {
            name: 'NON-HDL CHOLESTEROL',
            value: '144',
            unit: 'mg/dL',
            range: '< 130',
            method: 'Calculated',
            id: 'nonHdl',
            dropped: true,
          },
          { name: 'CHOL/HDL RATIO', value: '3.8', range: '3.5 - 5.0', method: 'Calculated' },
        ],
      },
      {
        title: 'DIABETES SCREEN',
        rows: [
          {
            name: 'FASTING BLOOD SUGAR(GLUCOSE)',
            value: '94',
            unit: 'mg/dL',
            range: '70 - 100',
            method: 'Hexokinase',
            id: 'fpg',
            v: 94,
            u: 'mg/dL',
          },
          // µIU/mL is printed; the unit table spells insulin's unit µU/mL (the same unit), so that is what the row carries
          {
            name: 'INSULIN - FASTING',
            value: '11.2',
            unit: 'µIU/mL',
            range: '2.6 - 24.9',
            method: 'C.L.I.A',
            id: 'insulin',
            v: 11.2,
            u: 'µU/mL',
          },
          { name: 'HOMA-IR', value: '2.6', range: '< 2.5', method: 'Calculated' },
          {
            name: 'HbA1c',
            value: '5.4',
            unit: '%',
            range: '4.0 - 5.6',
            method: 'HPLC',
            id: 'hba1c',
            v: 5.4,
            u: '%',
          },
        ],
      },
    ],
    [
      {
        title: 'HORMONES, VITAMINS & MINERALS',
        rows: [
          {
            name: 'TESTOSTERONE',
            value: '512',
            unit: 'ng/dL',
            range: '264 - 916',
            method: 'C.L.I.A',
            id: 'testosterone',
            v: 512,
            u: 'ng/dL',
          },
          {
            name: 'CORTISOL (MORNING)',
            value: '14.2',
            unit: 'µg/dL',
            range: '6.2 - 19.4',
            method: 'C.L.I.A',
            id: 'cortisol',
            v: 14.2,
            u: 'µg/dL',
          },
          {
            name: 'VITAMIN B12',
            value: '412',
            unit: 'pg/mL',
            range: '211 - 911',
            method: 'C.L.I.A',
            id: 'b12',
            v: 412,
            u: 'pg/mL',
          },
          {
            name: 'VITAMIN D TOTAL (25-OH)',
            value: '31',
            unit: 'ng/mL',
            range: '30 - 100',
            method: 'C.L.I.A',
            id: 'vitD',
            v: 31,
            u: 'ng/mL',
          },
          {
            name: 'SERUM FERRITIN',
            value: '140',
            unit: 'ng/mL',
            range: '22 - 322',
            method: 'C.L.I.A',
            id: 'ferritin',
            v: 140,
            u: 'ng/mL',
          },
          { name: 'IRON', value: '88', unit: 'µg/dL', range: '65 - 175', method: 'Ferrozine' },
          {
            name: 'TOTAL IRON BINDING CAPACITY (TIBC)',
            value: '310',
            unit: 'µg/dL',
            range: '250 - 450',
            method: 'Ferrozine',
          },
          {
            name: '% TRANSFERRIN SATURATION',
            value: '28.4',
            unit: '%',
            range: '15 - 50',
            method: 'Calculated',
          },
          { name: 'CALCIUM', value: '9.4', unit: 'mg/dL', range: '8.8 - 10.6', method: 'Arsenazo' },
          {
            name: 'C-REACTIVE PROTEIN (CRP)',
            value: '3.2',
            unit: 'mg/L',
            range: '< 5',
            method: 'Immunoturbidimetry',
          },
          { name: 'IgE TOTAL', value: '210', unit: 'IU/mL', range: '< 100', method: 'C.L.I.A' },
        ],
      },
    ],
  ],
};

const hospital: Fixture = {
  file: 'hospital-si.pdf',
  layout:
    'Investigation / Observed Value / Flag / Units / Biological Reference Interval, SI units, H/L flags, page 2 image only',
  sampleDate: '2026-05-11',
  lab: 'NOTREAL MULTISPECIALITY HOSPITAL · Department of Laboratory Medicine',
  patient: {
    name: 'Rohan Fakename',
    ageSex: '52 Y / M',
    phone: '044-2345 6789',
    id: 'H-55443322',
    barcode: 'ACC-7788990',
    address: 'No. 7, Dummy Street, Chennai 600004',
    doctor: 'Dr. Notreal Iyer',
  },
  header: [
    ['Patient Name', 'Mr. Rohan Fakename', 'MRN', 'H-55443322'],
    ['Age / Sex', '52 Y / M', 'Accession No', 'ACC-7788990'],
    ['Referring Doctor', 'Dr. Notreal Iyer', 'Collection Date/Time', '2026-05-11 08:20'],
    ['Phone', '044-2345 6789', 'Report Date', '2026-05-12 16:40'],
    ['Address', 'No. 7, Dummy Street, Chennai 600004', 'Ward / OPD', 'OPD'],
  ],
  columns: [
    { role: 'name', title: 'Investigation', width: '34%' },
    { role: 'value', title: 'Observed Value', width: '14%', align: 'center' },
    { role: 'flag', title: 'Flag', width: '7%', align: 'center' },
    { role: 'unit', title: 'Units', width: '16%' },
    { role: 'range', title: 'Biological Reference Interval', width: '29%' },
  ],
  methodStyle: 'none',
  imagePage: 1,
  pages: [
    [
      {
        title: 'Clinical Biochemistry',
        rows: [
          {
            name: 'Haemoglobin',
            value: '128',
            flag: 'L',
            unit: 'g/L',
            range: '130 - 170',
            id: 'hb',
            v: 128,
            u: 'g/L',
          },
          {
            name: 'Fasting Plasma Glucose',
            value: '6.4',
            flag: 'H',
            unit: 'mmol/L',
            range: '3.9 - 5.5',
            id: 'fpg',
            v: 6.4,
            u: 'mmol/L',
          },
          { name: 'HbA1c', value: '6.6', flag: 'H', unit: '%', range: '< 5.7', id: 'hba1c', v: 6.6, u: '%' },
          { name: 'Total Cholesterol', value: '5.9', flag: 'H', unit: 'mmol/L', range: '< 5.2' },
          {
            name: 'LDL-C (direct)',
            value: '3.9',
            flag: 'H',
            unit: 'mmol/L',
            range: '< 2.6',
            id: 'ldl',
            v: 3.9,
            u: 'mmol/L',
          },
          {
            name: 'HDL-C',
            value: '0.9',
            flag: 'L',
            unit: 'mmol/L',
            range: '> 1.0',
            id: 'hdl',
            v: 0.9,
            u: 'mmol/L',
          },
          {
            name: 'Triglycerides',
            value: '2.4',
            flag: 'H',
            unit: 'mmol/L',
            range: '< 1.7',
            id: 'tg',
            v: 2.4,
            u: 'mmol/L',
          },
          {
            name: 'Creatinine',
            value: '132',
            flag: 'H',
            unit: 'µmol/L',
            range: '62 - 106',
            id: 'creatinine',
            v: 132,
            u: 'µmol/L',
          },
          {
            name: 'eGFR (CKD-EPI 2021)',
            value: '55',
            flag: 'L',
            unit: 'mL/min/1.73 m²',
            range: '> 90',
            id: 'egfr',
            v: 55,
            u: 'mL/min/1.73 m²',
          },
          {
            name: 'Uric Acid',
            value: '452',
            flag: 'H',
            unit: 'µmol/L',
            range: '200 - 430',
            id: 'urate',
            v: 452,
            u: 'µmol/L',
          },
          {
            name: 'Sodium',
            value: '139',
            unit: 'mmol/L',
            range: '135 - 145',
            id: 'sodium',
            v: 139,
            u: 'mmol/L',
          },
          {
            name: 'Potassium',
            value: '4.6',
            unit: 'mmol/L',
            range: '3.5 - 5.1',
            id: 'potassium',
            v: 4.6,
            u: 'mmol/L',
          },
          { name: 'ALT', value: '0.75', unit: 'µkat/L', range: '< 0.85', id: 'alt', v: 0.75, u: 'µkat/L' },
          { name: 'AST', value: '28', unit: 'U/L', range: '< 40', id: 'ast', v: 28, u: 'U/L' },
          { name: 'TSH', value: '3.4', unit: 'mIU/L', range: '0.4 - 4.0', id: 'tsh', v: 3.4, u: 'mIU/L' },
          {
            name: 'Free T3',
            value: '4.9',
            unit: 'pmol/L',
            range: '3.1 - 6.8',
            id: 'ft3',
            v: 4.9,
            u: 'pmol/L',
          },
          {
            name: 'Vitamin B12',
            value: '<111',
            flag: 'L',
            unit: 'pmol/L',
            range: '145 - 569',
            id: 'b12',
            v: 111,
            u: 'pmol/L',
          },
          {
            name: '25-Hydroxy Vitamin D',
            value: '42',
            flag: 'L',
            unit: 'nmol/L',
            range: '75 - 250',
            id: 'vitD',
            v: 42,
            u: 'nmol/L',
          },
          {
            name: 'hs-CRP',
            value: '4.1',
            flag: 'H',
            unit: 'mg/L',
            range: '< 3.0',
            id: 'hsCrp',
            v: 4.1,
            u: 'mg/L',
          },
          {
            name: 'Testosterone, total',
            value: '14.8',
            unit: 'nmol/L',
            range: '8.6 - 29',
            id: 'testosterone',
            v: 14.8,
            u: 'nmol/L',
          },
        ],
      },
    ],
    [
      {
        title: 'Special Chemistry (scanned page)',
        rows: [
          {
            name: 'Cortisol (8 AM)',
            value: '390',
            unit: 'nmol/L',
            range: '170 - 540',
            id: 'cortisol',
            v: 390,
            u: 'nmol/L',
          },
          {
            name: 'Ferritin',
            value: '310',
            unit: 'µg/L',
            range: '30 - 400',
            id: 'ferritin',
            v: 310,
            u: 'µg/L',
          },
          {
            name: 'Apolipoprotein B',
            value: '1.21',
            unit: 'g/L',
            range: '0.6 - 1.17',
            id: 'apoB',
            v: 1.21,
            u: 'g/L',
          },
        ],
      },
    ],
  ],
};

/** The photo: a short report, patient block in the top ~18 % of the image. */
const photo: Fixture = {
  file: 'photo-report.png',
  layout: 'phone photo of a one-page report (PNG, slightly rotated)',
  sampleDate: '2026-07-02',
  lab: 'PHANTOM DIAGNOSTIC CENTRE',
  patient: {
    name: 'Ishaan Madeup',
    ageSex: '29 Y / M',
    phone: '+91 99887 66554',
    id: 'PDC-3141592',
    barcode: 'BAR-2718281',
    address: '9 Nowhere Road, Jaipur 302001',
    doctor: 'Dr. Unreal Shah',
  },
  header: [
    ['Name', 'Mr. Ishaan Madeup', 'Collected', '02/07/2026'],
    ['Age/Sex', '29 Y / M', 'Patient ID', 'PDC-3141592'],
    ['Ref. Dr.', 'Dr. Unreal Shah', 'Mobile', '+91 99887 66554'],
    ['Address', '9 Nowhere Road, Jaipur 302001', 'Barcode', 'BAR-2718281'],
  ],
  columns: [
    { role: 'name', title: 'Test', width: '42%' },
    { role: 'value', title: 'Result', width: '14%' },
    { role: 'unit', title: 'Unit', width: '16%' },
    { role: 'range', title: 'Reference Range', width: '28%' },
  ],
  methodStyle: 'none',
  pages: [
    [
      {
        title: 'Lipid, sugar, thyroid, vitamin D',
        rows: [
          {
            name: 'LDL Cholesterol',
            value: '165',
            unit: 'mg/dL',
            range: '< 100',
            id: 'ldl',
            v: 165,
            u: 'mg/dL',
          },
          {
            name: 'HDL Cholesterol',
            value: '52',
            unit: 'mg/dL',
            range: '> 40',
            id: 'hdl',
            v: 52,
            u: 'mg/dL',
          },
          {
            name: 'Triglycerides',
            value: '140',
            unit: 'mg/dL',
            range: '< 150',
            id: 'tg',
            v: 140,
            u: 'mg/dL',
          },
          { name: 'HbA1c', value: '5.6', unit: '%', range: '4.0 - 5.6', id: 'hba1c', v: 5.6, u: '%' },
          { name: 'TSH', value: '1.9', unit: 'µIU/mL', range: '0.4 - 4.2', id: 'tsh', v: 1.9, u: 'µIU/mL' },
          {
            name: 'Vitamin D (25-OH)',
            value: '24',
            unit: 'ng/mL',
            range: '30 - 100',
            id: 'vitD',
            v: 24,
            u: 'ng/mL',
          },
          { name: 'MCV', value: '86', unit: 'fL', range: '83 - 101' },
        ],
      },
    ],
  ],
};

/* ------------------------------------------------------------------------------------------- html */

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function patientBlock(f: Fixture): string {
  const rows = f.header
    .map(
      ([a, b, c, d]) =>
        `<tr><td class="k">${esc(a)}</td><td>: ${esc(b)}</td><td class="k">${esc(c)}</td><td>: ${esc(d)}</td></tr>`,
    )
    .join('');
  return `<div class="lab">${esc(f.lab)}</div><table class="pt">${rows}</table><hr/>`;
}

function cell(f: Fixture, role: Role, r: Row): string {
  switch (role) {
    case 'name':
      return (
        esc(r.name) +
        (f.methodStyle === 'below' && r.method ? `<div class="m">Method : ${esc(r.method)}</div>` : '')
      );
    case 'method':
      return esc(r.method ?? '');
    case 'value':
      return f.columns.some((c) => c.role === 'flag') ? esc(r.value) : esc(r.value);
    case 'flag':
      return esc(r.flag ?? '');
    case 'unit':
      return esc(r.unit ?? '');
    case 'range':
      return Array.isArray(r.range) ? r.range.map(esc).join('<br/>') : esc(r.range ?? '');
  }
}

function table(f: Fixture, sections: Section[]): string {
  const head = `<tr>${f.columns.map((c) => `<th style="width:${c.width};text-align:${c.align ?? 'left'}">${esc(c.title)}</th>`).join('')}</tr>`;
  const body = sections
    .map(
      (s) =>
        `<tr><td class="sec" colspan="${f.columns.length}">${esc(s.title)}</td></tr>` +
        s.rows
          .map(
            (r) =>
              `<tr>${f.columns.map((c) => `<td style="text-align:${c.align ?? 'left'}">${cell(f, c.role, r)}</td>`).join('')}</tr>`,
          )
          .join(''),
    )
    .join('');
  return `<table class="res">${head}${body}</table>`;
}

const CSS = `
  @page { size: A4; margin: 14mm 12mm; }
  body { font-family: 'Liberation Sans', sans-serif; font-size: 9.5pt; color: #111; margin: 0; }
  .lab { font-size: 12pt; font-weight: bold; margin-bottom: 6px; }
  table { border-collapse: collapse; width: 100%; }
  .pt td { padding: 1px 4px; vertical-align: top; }
  .pt td.k { font-weight: bold; white-space: nowrap; }
  .res th { border-bottom: 1px solid #333; padding: 4px; font-size: 9pt; }
  .res td { padding: 3px 4px; vertical-align: top; }
  .res td.sec { font-weight: bold; padding-top: 10px; text-decoration: underline; }
  .m { font-size: 7.5pt; color: #444; margin-top: 1px; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .foot { margin-top: 14px; font-size: 8pt; color: #555; }
  img.scan { width: 100%; }
`;

function pageHtml(f: Fixture, sections: Section[], i: number, n: number): string {
  return `<div class="page">${patientBlock(f)}${table(f, sections)}<div class="foot">Page ${i + 1} of ${n} · This is a synthetic test report, not a real result.</div></div>`;
}

/* ------------------------------------------------------------------------------------------- expected */

/** Number of pages in a Chromium PDF (one `/Type /Page` object per page). */
const countPages = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

function expected(f: Fixture, extra: Record<string, unknown> = {}): unknown {
  const tierA: unknown[] = [];
  const imageOnly: unknown[] = [];
  const dropped: string[] = [];
  f.pages.forEach((sections, pi) => {
    for (const s of sections)
      for (const r of s.rows) {
        if (!r.id) continue;
        if (r.dropped) {
          dropped.push(r.name);
          continue;
        }
        const e = {
          markerId: r.id,
          nameOnReport: r.name,
          value: r.v,
          unit: r.u,
          calculated: !!r.calc,
          ...(r.issue ? { issue: r.issue } : {}),
        };
        if (pi === f.imagePage) imageOnly.push({ ...e, sourcePage: pi + 1 });
        else tierA.push(e);
      }
  });
  return {
    file: f.file,
    synthetic: true,
    layout: f.layout,
    sampleDate: f.sampleDate,
    pages: f.pages.length,
    textlessPages: f.imagePage === undefined ? [] : [f.imagePage + 1],
    note: 'textlessPages and imageOnly[].sourcePage count the source pages; a long table may spill onto an extra printed page (see printedPages)',
    patient: f.patient,
    tierA,
    imageOnly,
    droppedCalculated: dropped,
    ...extra,
  };
}

/* ------------------------------------------------------------------------------------------- main */

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const sizes: string[] = [];

  for (const f of [thyro, srl, fullBody, hospital]) {
    const n = f.pages.length;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      if (i === f.imagePage) {
        // Render the page alone as a greyscale JPEG and place it as the only thing on the page: no text layer.
        await page.setViewportSize({ width: 794, height: 1123 });
        await page.setContent(
          `<html><head><style>${CSS} body{margin:40px;filter:grayscale(1)}</style></head><body>${pageHtml(f, f.pages[i]!, i, n)}</body></html>`,
        );
        const jpg = await page.screenshot({ type: 'jpeg', quality: 45, fullPage: false });
        parts.push(
          `<div class="page"><img class="scan" src="data:image/jpeg;base64,${jpg.toString('base64')}"/></div>`,
        );
      } else {
        parts.push(pageHtml(f, f.pages[i]!, i, n));
      }
    }
    await page.setContent(`<html><head><style>${CSS}</style></head><body>${parts.join('')}</body></html>`);
    const pdf = await page.pdf({ format: 'A4', printBackground: false, preferCSSPageSize: true });
    writeFileSync(join(here, f.file), pdf);
    writeFileSync(
      join(here, f.file.replace(/\.pdf$/, '.expected.json')),
      JSON.stringify(expected(f, { printedPages: countPages(pdf) }), null, 2) + '\n',
    );
    sizes.push(`${f.file} ${(pdf.length / 1024).toFixed(1)} kB`);
  }

  // Photo: 760 × 1000, patient block at the top, a slight rotation and a grey cast like a phone shot.
  await page.setViewportSize({ width: 760, height: 1000 });
  await page.setContent(
    `<html><head><style>${CSS} body{margin:0;background:#d8d4cc} .sheet{background:#f4f1ea;margin:18px;padding:22px;transform:rotate(-0.7deg);font-size:12px}</style></head>` +
      `<body><div class="sheet">${pageHtml(photo, photo.pages[0]!, 0, 1)}</div></body></html>`,
  );
  const bottom = await page.evaluate(() => {
    const hr = document.querySelector('hr');
    return hr ? hr.getBoundingClientRect().bottom : 0;
  });
  const shot = await page.screenshot({ type: 'png', fullPage: false });
  const sharp = (await import('sharp')).default;
  const png = await sharp(shot)
    .grayscale()
    .png({ palette: true, colours: 16, compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(here, photo.file), png);
  writeFileSync(
    join(here, 'photo-report.expected.json'),
    JSON.stringify(
      expected(photo, {
        width: 760,
        height: 1000,
        patientBlockBottomFraction: Math.round((bottom / 1000) * 1000) / 1000,
      }),
      null,
      2,
    ) + '\n',
  );
  sizes.push(
    `${photo.file} ${(png.length / 1024).toFixed(1)} kB (patient block ends at ${((bottom / 1000) * 100).toFixed(1)} % of the height)`,
  );

  await browser.close();
  console.log(sizes.join('\n'));
}

await main();
