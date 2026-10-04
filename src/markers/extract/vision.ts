/**
 * Photo / no-text route (docs/SUITE_SPEC.md §13.5.6 step 2): page images → a vision model → strict Tier A rows.
 *
 * HOW TO IMPLEMENT `VisionPort` (the Coach side does this; this folder never talks to a network):
 *
 *   const port: VisionPort = {
 *     async readRows(req, { signal } = {}) {
 *       return askJson(model, {                              // src/ai/coach/modelJson.ts (goes through src/net/net.ts)
 *         system: req.instructions,
 *         user: [{ type: 'text', text: req.prompt },
 *                ...req.images.map((im) => ({ type: 'image', mime: im.mime, source: { kind: 'base64', data: im.data } }))],
 *         schemaName: 'lab_rows', schema: req.schemaHint, signal, maxOutputTokens: 3000,
 *       });
 *     },
 *   };
 *
 * - `req.images` are already masked: the page header band (top 22 % by default) and every known patient-detail box are
 *   filled before encoding. `data` is base64 (no `data:` prefix). Send them as they are; do not add the file name or
 *   any other text from the file.
 * - Return the model's reply as parsed JSON, or the raw text: `readRows` output is validated here (`normaliseVisionReply`)
 *   and rows that fail are dropped. Throw on provider errors; the extraction reports the pages as unread.
 * - At most `maxImagesPerRequest` images go in one call (default 3: the smallest provider limit).
 */
import type { ExtractionRow, MarkerId } from '../types';
import { MARKER_IDS } from '../types';
import { MARKER_UNITS, unitsOf } from '../units';
import { scoreReading } from './layout';
import {
  DEFAULT_HEADER_FRACTION,
  isPatientLine,
  maskImage,
  parseDate,
  type Box,
  type ImageLike,
} from './redact';
import { LDL_CALCULATED_ISSUE } from './synonyms';
import type { LocalDate } from '@/store';

/** JSON Schema (draft-07 subset every provider accepts). */
export type VisionSchemaHint = Record<string, unknown>;

export interface VisionRequest {
  /** Masked page images, base64 without a prefix. */
  images: Array<{ mime: string; data: Uint8Array | string }>;
  /** JSON Schema of the expected reply. */
  schemaHint: VisionSchemaHint;
  /** System prompt. */
  instructions: string;
  /** User text that goes with the images (no patient data: it is built from the marker table only). */
  prompt: string;
}

export interface VisionPort {
  readRows(input: VisionRequest, opts?: { signal?: AbortSignal }): Promise<unknown>;
}

/** Decodes a photo to RGBA and encodes a masked image for sending. */
export interface ImageCodec {
  decode(bytes: Uint8Array, mime: string): Promise<ImageLike>;
  encode(img: ImageLike): Promise<{ mime: string; data: Uint8Array }>;
}

const MAX_SIDE = 2000;

/** Browser / worker codec: createImageBitmap + OffscreenCanvas; JPEG out (quality 0.85). */
export const browserImageCodec: ImageCodec = {
  async decode(bytes, mime) {
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime });
    let bmp = await createImageBitmap(blob);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (k < 1) {
      bmp.close();
      bmp = await createImageBitmap(blob, {
        resizeWidth: Math.round(bmp.width * k),
        resizeHeight: Math.round(bmp.height * k),
        resizeQuality: 'high',
      });
    }
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: d.width, height: d.height, data: d.data };
  },
  async encode(img) {
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return { mime: 'image/jpeg', data: new Uint8Array(await blob.arrayBuffer()) };
  },
};

/** Base64 without a prefix (no Buffer: runs in browsers and workers). */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ------------------------------------------------------------------------------------------- schema and prompt */

export const VISION_SCHEMA: VisionSchemaHint = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    sampleDate: {
      type: 'string',
      description:
        'Sample collection date as YYYY-MM-DD if printed outside the blanked area; omit otherwise.',
    },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['marker', 'nameOnReport', 'value', 'unit'],
        properties: {
          marker: { type: 'string', enum: [...MARKER_IDS] },
          nameOnReport: { type: 'string', description: 'The test name exactly as printed.' },
          value: { type: 'number', description: 'The result as printed, a number.' },
          unit: { type: 'string', description: 'The unit as printed.' },
          labRange: { type: 'string', description: 'The reference range text as printed.' },
          method: { type: 'string', description: 'The method if printed (e.g. direct, calculated).' },
          calculated: { type: 'boolean', description: 'True if the lab marks the row as calculated.' },
          page: { type: 'integer', description: 'Index of the image the row is on, starting at 1.' },
        },
      },
    },
  },
};

const markerList = (): string =>
  MARKER_IDS.map((id) => `${id}: ${MARKER_UNITS[id].label} (${unitsOf(id).join(', ')})`).join('\n');

export const VISION_INSTRUCTIONS = `You read blood test reports for a person's own health log.
Return JSON only, matching the schema. Copy only result rows whose test is one of the MARKERS below; skip every other test.
Copy the number and the unit exactly as printed. Do not convert units, do not round, do not guess a value you cannot read; leave such a row out.
Total T3 is not free T3, and plain CRP is not hs-CRP: leave both out. Mark a row calculated when the lab prints it as calculated.
Parts of the page are blanked on purpose. Never write a person's name, age, sex, phone number, address, patient id, barcode or doctor.`;

export const visionPrompt = (pages: number): string =>
  `MARKERS (id: name (accepted units))\n${markerList()}\n\nThe report has ${pages} image${pages === 1 ? '' : 's'}.`;

/* ------------------------------------------------------------------------------------------- reply validation */

export interface VisionRows {
  rows: ExtractionRow[];
  sampleDate?: LocalDate;
  /** Rows the model returned that failed the schema (unknown marker, no number). */
  dropped: number;
  /** Tier A ids the model saw but that are calculated (shown, not used). */
  calculatedShown: Array<{ markerId: MarkerId; name: string; value: string; unit?: string; range?: string }>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

function parseReply(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const t = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  const body = fence ? fence[1]!.trim() : t;
  try {
    return JSON.parse(body);
  } catch {
    const a = body.indexOf('{');
    const b = body.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(body.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Strictly validate a model reply into extraction rows. Unknown markers, non-numbers and malformed rows are dropped. */
export function normaliseVisionReply(raw: unknown): VisionRows {
  const root = parseReply(raw);
  const out: VisionRows = { rows: [], dropped: 0, calculatedShown: [] };
  if (!isRecord(root) || !Array.isArray(root.rows)) return out;
  const sd = text(root.sampleDate, 40);
  const date = sd ? parseDate(sd) : undefined;
  if (date) out.sampleDate = date;
  const ids = new Set<string>(MARKER_IDS);
  for (const r of root.rows.slice(0, 200)) {
    if (!isRecord(r) || typeof r.marker !== 'string' || !ids.has(r.marker)) {
      out.dropped++;
      continue;
    }
    const id = r.marker as MarkerId;
    const value =
      typeof r.value === 'number'
        ? r.value
        : typeof r.value === 'string' && /^\s*[<>]?\s*[\d.,]+\s*$/.test(r.value)
          ? r.value
          : null;
    if (value === null || (typeof value === 'number' && !Number.isFinite(value))) {
      out.dropped++;
      continue;
    }
    let name = text(r.nameOnReport, 80) ?? MARKER_UNITS[id].label;
    if (isPatientLine(name)) name = MARKER_UNITS[id].label;
    let range = text(r.labRange, 120);
    if (range && isPatientLine(range)) range = undefined;
    let method = text(r.method, 60);
    if (method && isPatientLine(method)) method = undefined;
    const unitText = text(r.unit, 30) ?? '';
    const calc = r.calculated === true || /calc|friedewald|derived/i.test(method ?? '') || /calc/i.test(name);
    if (calc && id !== 'ldl' && id !== 'egfr' && id !== 'uacr') {
      out.calculatedShown.push({
        markerId: id,
        name,
        value: String(value),
        ...(unitText ? { unit: unitText } : {}),
        ...(range ? { range } : {}),
      });
      continue;
    }
    const s = scoreReading(id, String(value), unitText, 'vision');
    const row: ExtractionRow = {
      row: 0,
      markerId: id,
      nameOnReport: name,
      value: s.value,
      unit: s.unit,
      ...(range ? { labRange: range } : {}),
      ...(method ? { method } : {}),
      calculated: false,
      confidence: s.confidence,
      issues: s.issues,
    };
    if (id === 'ldl' && calc) {
      row.calculated = true;
      row.method = 'calculated';
      row.issues = [LDL_CALCULATED_ISSUE, ...row.issues];
      row.confidence = Math.min(row.confidence, 0.8);
    }
    out.rows.push(row);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------- the route */

export interface VisionReadOptions {
  codec: ImageCodec;
  /** Header band to blank on every image (default 0.22 of the height). */
  headerFraction?: number;
  /** Known patient-detail boxes per image, in that image's pixels. */
  boxes?: ReadonlyArray<readonly Box[]>;
  maxImagesPerRequest?: number;
  signal?: AbortSignal;
  onBatch?: (done: number, total: number) => void;
}

export interface VisionResult extends VisionRows {
  /** 0-based indexes of images whose batch failed. */
  failed: number[];
}

/** Mask, encode and send images in batches; validate every reply. */
export async function readWithVision(
  images: readonly ImageLike[],
  port: VisionPort,
  opts: VisionReadOptions,
): Promise<VisionResult> {
  const size = Math.max(1, opts.maxImagesPerRequest ?? 3);
  const result: VisionResult = { rows: [], dropped: 0, calculatedShown: [], failed: [] };
  const encoded: Array<{ mime: string; data: string }> = [];
  for (const [i, img] of images.entries()) {
    const masked = maskImage(img, {
      headerFraction: opts.headerFraction ?? DEFAULT_HEADER_FRACTION,
      boxes: opts.boxes?.[i] ?? [],
    });
    const e = await opts.codec.encode(masked);
    encoded.push({ mime: e.mime, data: toBase64(e.data) });
  }
  const batches = Math.ceil(encoded.length / size);
  for (let b = 0; b < batches; b++) {
    if (opts.signal?.aborted) throw new DOMException('Reading was cancelled.', 'AbortError');
    const slice = encoded.slice(b * size, (b + 1) * size);
    try {
      const reply = await port.readRows(
        {
          images: slice,
          schemaHint: VISION_SCHEMA,
          instructions: VISION_INSTRUCTIONS,
          prompt: visionPrompt(slice.length),
        },
        { signal: opts.signal },
      );
      const v = normaliseVisionReply(reply);
      result.rows.push(...v.rows);
      result.calculatedShown.push(...v.calculatedShown);
      result.dropped += v.dropped;
      if (v.sampleDate && !result.sampleDate) result.sampleDate = v.sampleDate;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      for (let i = b * size; i < Math.min(encoded.length, (b + 1) * size); i++) result.failed.push(i);
    }
    opts.onBatch?.(b + 1, batches);
  }
  return result;
}
