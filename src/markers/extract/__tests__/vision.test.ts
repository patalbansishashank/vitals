// @vitest-environment node
/**
 * Patient-block stripping and the vision route: the provider must never receive the patient block. The fake provider
 * is a spy on the request body; images are decoded again (sharp) to prove the header band was blanked.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { extractFromFile, isLabReportLike } from '../index';
import type { TextItem } from '../layout';
import { extractTextItems, loadPdfjsLegacy, type PdfTextResult } from '../pdf';
import { isPatientLine, maskCanvas, maskImage, patientBoxes, redactText, type ImageLike } from '../redact';
import { normaliseVisionReply, type ImageCodec, type VisionPort, type VisionRequest } from '../vision';

const DIR = join(import.meta.dirname, '../../../../qa/fixtures/markers');
const photo = new Uint8Array(readFileSync(join(DIR, 'photo-report.png')));
const photoExpected = JSON.parse(readFileSync(join(DIR, 'photo-report.expected.json'), 'utf8')) as {
  patient: Record<string, string>;
  patientBlockBottomFraction: number;
  tierA: Array<{ markerId: string; nameOnReport: string; value: number; unit: string }>;
};

const codec: ImageCodec = {
  async decode(bytes) {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8Array(data) };
  },
  async encode(img) {
    const png = await sharp(Buffer.from(img.data), {
      raw: { width: img.width, height: img.height, channels: 4 },
    })
      .png()
      .toBuffer();
    return { mime: 'image/png', data: new Uint8Array(png) };
  },
};

const decodeSent = async (b64: string): Promise<ImageLike> =>
  codec.decode(new Uint8Array(Buffer.from(b64, 'base64')), 'image/png');

/** Share of non-white pixels in rows [y0, y1). */
function ink(img: ImageLike, y0: number, y1: number): number {
  let dark = 0;
  let n = 0;
  for (let y = Math.floor(y0); y < Math.min(img.height, y1); y++)
    for (let x = 0; x < img.width; x++, n++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i]! < 250 || img.data[i + 1]! < 250 || img.data[i + 2]! < 250) dark++;
    }
  return n ? dark / n : 0;
}

/** A provider spy: records requests, answers with canned rows. */
function spyProvider(reply: unknown): VisionPort & { requests: VisionRequest[] } {
  const requests: VisionRequest[] = [];
  return {
    requests,
    async readRows(req) {
      requests.push(req);
      return reply;
    },
  };
}

const photoReply = {
  sampleDate: '2026-07-02',
  rows: [
    ...photoExpected.tierA.map((e) => ({
      marker: e.markerId,
      nameOnReport: e.nameOnReport,
      value: e.value,
      unit: e.unit,
      labRange: '< 100',
    })),
    { marker: 'mcv', nameOnReport: 'MCV', value: 86, unit: 'fL' },
    { marker: 'ldl', nameOnReport: 'Mr. Ishaan Madeup', value: 'lots', unit: 'mg/dL' },
  ],
};

describe('patient-block stripping (text)', () => {
  const block = [
    'PHANTOM DIAGNOSTIC CENTRE',
    'Name : Mr. Ishaan Madeup        Collected : 02/07/2026',
    'Age/Sex : 29 Y / M             Patient ID : PDC-3141592',
    'Ref. Dr. : Dr. Unreal Shah     Mobile : +91 99887 66554',
    'Address : 9 Nowhere Road,',
    'Jaipur',
    'Barcode : BAR-2718281   UHID : U-99   Lab No. 44551',
    'Email : someone@example.invalid',
    'Aadhaar 1234 5678 9012',
    'LDL Cholesterol   165   mg/dL   < 100',
    'HbA1c   5.6   %   4.0 - 5.6',
  ].join('\n');

  it('removes every patient line, keeps results and returns the sample date apart', () => {
    const r = redactText(block);
    expect(r.sampleDate).toBe('2026-07-02');
    for (const s of [
      'Ishaan',
      'Madeup',
      'PDC-3141592',
      '99887',
      'Unreal',
      'Nowhere',
      'Jaipur',
      'BAR-2718281',
      'U-99',
      '44551',
      'example.invalid',
      '1234 5678',
      '29 Y',
    ])
      expect(r.text).not.toContain(s);
    expect(r.text).toContain('LDL Cholesterol   165   mg/dL   < 100');
    expect(r.text).toContain('HbA1c   5.6   %   4.0 - 5.6');
    expect(r.removed).toBe(9);
  });

  it.each([
    'Patient Name: A B',
    'UHID : 123',
    'Referred By : Self',
    'Mobile No. 9876543210',
    'Sample ID: S-1',
    'Accession No 77',
    'Collected at : X Lab',
    'Collection Centre: Y',
    'DOB: 01/01/1990',
    'Gender : Female',
    'Passport No: K1234567',
    'PAN ABCDE1234F',
    'Registration No: 55',
  ])('%s is a patient line', (l) => expect(isPatientLine(l)).toBe(true));

  it.each([
    'TOTAL CHOLESTEROL 268 mg/dL < 200',
    'HDL CHOLESTEROL - DIRECT 44 mg/dL 40-60',
    'Test Result Unit Bio. Ref. Interval',
    'SODIUM 136 mEq/L 136 - 146',
    'IMMUNOTURBIDIMETRY',
    'Platelet Count 2.45 lakh/cumm',
  ])('%s is not', (l) => expect(isPatientLine(l)).toBe(false));
});

describe('patient-block masking (images)', () => {
  const img: ImageLike = { width: 10, height: 10, data: new Uint8Array(400).fill(0) };

  it('fills the header band and boxes, leaves the rest', () => {
    const m = maskImage(img, {
      headerFraction: 0.2,
      boxes: [{ page: 1, x: 5, y: 6, w: 1, h: 1 }],
      padding: 0,
    });
    expect(ink(m, 0, 2)).toBe(0);
    expect(m.data[(6 * 10 + 5) * 4]).toBe(255);
    expect(m.data[(6 * 10 + 4) * 4]).toBe(0);
    expect(m.data[(9 * 10 + 9) * 4]).toBe(0);
    expect(img.data[0]).toBe(0); // the input is not changed
  });

  it('draws the same regions on a canvas', () => {
    const calls: number[][] = [];
    maskCanvas({ fillStyle: '', fillRect: (...a: number[]) => calls.push(a) }, 100, 200, {
      boxes: [{ page: 1, x: 10, y: 100, w: 20, h: 8 }],
    });
    expect(calls).toEqual([
      [0, 0, 100, 44],
      [6, 96, 28, 16],
    ]);
  });

  it('boxes the patient lines of a text page, with the wrapped address tail', async () => {
    const t = await extractTextItems(new Uint8Array(readFileSync(join(DIR, 'srl-style.pdf'))), {
      load: loadPdfjsLegacy,
    });
    const { buildLines } = await import('../layout');
    const lines = buildLines(t.items.filter((i) => i.page === 1));
    const boxes = patientBoxes(lines);
    const covered = (s: string) =>
      lines.filter((l) => l.text.includes(s)).every((l) => boxes.some((b) => b.y === l.box.y));
    for (const s of ['Meera', '112233445', 'Placeholder', 'LPL-0099887', 'Kolkata', 'Fake'])
      expect(covered(s), s).toBe(true);
    expect(boxes.some((b) => lines.find((l) => l.text.startsWith('Serum Creatinine'))!.box.y === b.y)).toBe(
      false,
    );
  });
});

describe('photo through the vision route', () => {
  it('sends a masked image and no patient details; validates the reply', async () => {
    const port = spyProvider(photoReply);
    const x = await extractFromFile(
      { bytes: photo, mime: 'image/png', name: 'Ishaan_Madeup_PDC-3141592.png' },
      { vision: port, allowVision: true, imageCodec: codec },
    );
    expect(port.requests).toHaveLength(1);
    const req = port.requests[0]!;
    // the request body carries none of the patient block, nor the file name
    const body = JSON.stringify(req);
    for (const v of [...Object.values(photoExpected.patient), 'Ishaan', 'Madeup', '3141592', '99887'])
      expect(body).not.toContain(v);
    // the image sent: header band blank, the patient block was inside it, the table below still has ink
    const sent = await decodeSent(req.images[0]!.data as string);
    const original = await codec.decode(photo, 'image/png');
    expect(photoExpected.patientBlockBottomFraction).toBeLessThan(0.22);
    expect(ink(original, 0, original.height * 0.2)).toBeGreaterThan(0.01);
    expect(ink(sent, 0, sent.height * 0.22)).toBe(0);
    expect(ink(sent, sent.height * 0.25, sent.height * 0.4)).toBeGreaterThan(0.01);
    // rows: Tier A only, unknown markers and non-numbers dropped
    expect(x.route).toBe('vision');
    expect(x.rows.map((r) => [r.markerId, r.value, r.unit])).toEqual(
      photoExpected.tierA.map((e) => [e.markerId, e.value, e.unit]),
    );
    expect(x.rows.every((r) => r.confidence <= 0.85)).toBe(true);
    expect(x.sampleDate).toBe('2026-07-02');
    expect(x.error).toBeUndefined();
    expect(JSON.stringify(x)).not.toContain('Madeup');
  });

  it('without a provider (or without consent) nothing is sent and the photo is reported unread', async () => {
    const port = spyProvider(photoReply);
    const x = await extractFromFile({ bytes: photo, mime: 'image/png' }, { vision: port, imageCodec: codec });
    expect(port.requests).toHaveLength(0);
    expect(x.error).toBe('no-text-no-provider');
    expect(x.unreadPages).toEqual([1]);
    expect(x.message).not.toMatch(/§|R13|dossier|W-L/);
  });

  it('reply validation: unknown markers, non-numbers dropped; out-of-bounds values flagged; patient text never kept', () => {
    const v = normaliseVisionReply(
      '```json\n{"rows":[{"marker":"ldl","nameOnReport":"LDL","value":9999,"unit":"mg/dL"},{"marker":"x","value":1,"unit":"%"},{"marker":"tsh","nameOnReport":"Name: Mr. Test Person","value":2,"unit":"µIU/mL","labRange":"Phone 9876543210"},{"marker":"hdl","value":"n/a","unit":"mg/dL"},{"marker":"nonHdl","nameOnReport":"Non-HDL","value":150,"unit":"mg/dL","calculated":true}]}\n```',
    );
    expect(v.dropped).toBe(2);
    expect(v.rows).toHaveLength(2);
    expect(v.rows[0]!.issues[0]).toMatch(/^Vitals accepts/);
    expect(v.rows[0]!.confidence).toBeLessThan(0.3);
    expect(v.rows[1]).toMatchObject({ markerId: 'tsh', nameOnReport: 'TSH' });
    expect(v.rows[1]!.labRange).toBeUndefined();
    expect(v.calculatedShown).toEqual([{ markerId: 'nonHdl', name: 'Non-HDL', value: '150', unit: 'mg/dL' }]);
    expect(normaliseVisionReply('not json').rows).toEqual([]);
  });
});

describe('PDF pages without text', () => {
  const hospital = new Uint8Array(readFileSync(join(DIR, 'hospital-si.pdf')));
  const textItems = (b: Uint8Array, o: { onPage?: (p: number, n: number) => void; signal?: AbortSignal }) =>
    extractTextItems(b, { ...o, load: loadPdfjsLegacy });

  it('go to the provider only with consent, as masked images; rows merge with the text-layer rows', async () => {
    const page = await codec.decode(photo, 'image/png');
    const rendered: number[][] = [];
    const port = spyProvider({
      rows: [
        { marker: 'cortisol', nameOnReport: 'Cortisol (8 AM)', value: 390, unit: 'nmol/L' },
        { marker: 'apoB', nameOnReport: 'Apolipoprotein B', value: 1.21, unit: 'g/L' },
      ],
    });
    const x = await extractFromFile(
      { bytes: hospital, mime: 'application/pdf', name: 'Rohan Fakename.pdf' },
      {
        vision: port,
        allowVision: true,
        imageCodec: codec,
        textItems,
        renderPages: async (_b, pages) => (rendered.push(pages), pages.map(() => page)),
      },
    );
    expect(rendered).toEqual([[2]]);
    expect(port.requests).toHaveLength(1);
    expect(JSON.stringify(port.requests[0])).not.toMatch(
      /Rohan|Fakename|H-55443322|ACC-7788990|Dummy Street|Notreal/,
    );
    expect(ink(await decodeSent(port.requests[0]!.images[0]!.data as string), 0, page.height * 0.22)).toBe(0);
    expect(x.route).toBe('textLayer');
    expect(x.error).toBeUndefined();
    expect(x.unreadPages).toBeUndefined();
    expect(x.rows.find((r) => r.markerId === 'cortisol')).toMatchObject({ value: 390, unit: 'nmol/L' });
    expect(x.notInReport).not.toContain('apoB');
    expect(x.rows.map((r) => r.row)).toEqual(x.rows.map((_, i) => i + 1));
  });

  it('a provider failure leaves the pages unread (partial)', async () => {
    const page = await codec.decode(photo, 'image/png');
    const port: VisionPort = { readRows: async () => Promise.reject(new Error('provider down')) };
    const x = await extractFromFile(
      { bytes: hospital, mime: 'application/pdf' },
      { vision: port, allowVision: true, imageCodec: codec, textItems, renderPages: async () => [page] },
    );
    expect(x.error).toBe('partial');
    expect(x.unreadPages).toEqual([2]);
  });

  it('an all-image PDF without a provider: no-text-no-provider', async () => {
    const fake = async (): Promise<PdfTextResult> => ({
      items: [],
      pages: 3,
      textlessPages: [1, 2, 3],
      pageSizes: [],
    });
    const x = await extractFromFile({ bytes: hospital, mime: 'application/pdf' }, { textItems: fake });
    expect(x.error).toBe('no-text-no-provider');
    expect(x.message).toBe(
      'This PDF has no text Vitals can read on this device. Connect an AI provider to read it as images, or type the values.',
    );
    expect(x.unreadPages).toEqual([1, 2, 3]);
  });
});

describe('not a lab report', () => {
  const letter = (lines: string[]): TextItem[] =>
    lines.map((str, i) => ({ str, x: 40, y: 60 + i * 14, w: str.length * 5, h: 10, page: 1 }));

  it('a letter is not a report', async () => {
    const items = letter([
      'Dear customer,',
      'Your invoice 2026-118 for 3 items is attached.',
      'Total due 4,500 by 12/10/2026.',
      'Thank you',
    ]);
    const x = await extractFromFile(
      { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mime: 'application/pdf' },
      { textItems: async () => ({ items, pages: 1, textlessPages: [], pageSizes: [] }) },
    );
    expect(x.error).toBe('not-a-report');
    expect(x.message).toBe("This doesn't look like a lab report.");
    expect(isLabReportLike(x)).toBe(false);
  });

  it('a file that is neither a PDF nor an image', async () => {
    const x = await extractFromFile({ bytes: new Uint8Array([1, 2, 3]), mime: 'text/plain' });
    expect(x.error).toBe('not-a-report');
  });

  it('two Tier A rows are enough', () => {
    const row = (markerId: 'ldl' | 'hdl') => ({
      row: 1,
      markerId,
      nameOnReport: markerId,
      value: 1,
      unit: 'mmol/L',
      calculated: false,
      confidence: 1,
      issues: [],
    });
    expect(
      isLabReportLike({
        extractionId: 'x',
        route: 'textLayer',
        rows: [row('ldl'), row('hdl')],
        displayOnly: [],
        notInReport: [],
      }),
    ).toBe(true);
    expect(
      isLabReportLike({
        extractionId: 'x',
        route: 'textLayer',
        rows: [row('ldl')],
        displayOnly: [],
        notInReport: [],
      }),
    ).toBe(false);
  });

  it('cancel stops the read', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(extractFromFile({ bytes: photo, mime: 'image/png' }, { signal: ac.signal })).rejects.toThrow(
      /cancelled/,
    );
  });
});
