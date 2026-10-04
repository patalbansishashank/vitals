/**
 * Report extraction entry point (docs/SUITE_SPEC.md §13.5.6; design onboarding-intake-v3 §8.3).
 *
 *   extractFromFile({ bytes, mime, name }, { vision, allowVision, onProgress, signal })
 *
 * - PDF with a text layer → read on the device (pdf.js in a worker), rows by y, columns by x (layout.ts).
 * - Pages without text, and photos → the vision route (vision.ts) only when `allowVision` is true and a `VisionPort` is
 *   given; the UI asks first ("Sending 12 pages without text to {provider}. Patient details are cut off first.").
 *   Without it they come back in `unreadPages` with `error: 'partial'` (some rows read) or 'no-text-no-provider'.
 * - The file name is never sent anywhere. Nothing is saved here: the result goes to the review table and
 *   `markers.confirm`.
 */
import type { LocalDate } from '@/store';
import { ulid } from '@/store/ids';
import type { DisplayOnlyRow, ExtractionRow, MarkerExtraction, MarkerId } from '../types';
import { MARKER_IDS } from '../types';
import { buildLines, extractFromTextItems, type TextItem } from './layout';
import type { PdfTextResult } from './pdf';
import { DEFAULT_HEADER_FRACTION, patientBoxes, type Box, type ImageLike } from './redact';
import { browserImageCodec, readWithVision, type ImageCodec, type VisionPort } from './vision';

export type { VisionPort, VisionRequest, ImageCodec } from './vision';
export type { TextItem } from './layout';
export { redactText, maskImage, maskCanvas, isPatientLine, patientBoxes, findSampleDate } from './redact';

export type ExtractErrorCode = 'no-text-no-provider' | 'not-a-report' | 'partial';

export interface ExtractProgress {
  page: number;
  pages: number;
  /** 'reading' (text layer) · 'rendering' (pages to images) · 'sending' (to the AI provider) · 'checking'. */
  stage: 'reading' | 'rendering' | 'sending' | 'checking';
}

export interface ExtractResult extends MarkerExtraction {
  error?: ExtractErrorCode;
  /** Plain-English line for the error state. */
  message?: string;
  /** Pages in the file (1 for a photo). */
  pages: number;
}

export interface ExtractDeps {
  vision?: VisionPort;
  onProgress?: (p: ExtractProgress) => void;
  signal?: AbortSignal;
  /** The person agreed to send pages without text (masked) to the AI provider. */
  allowVision?: boolean;
  /** Text-layer loader; default reads in a Web Worker. Tests pass `(b, o) => extractTextItems(b, { ...o, load: loadPdfjsLegacy })`. */
  textItems?: (
    bytes: Uint8Array,
    opts: { onPage?: (page: number, pages: number) => void; signal?: AbortSignal },
  ) => Promise<PdfTextResult>;
  /** Page renderer for textless pages; default renders in a Web Worker. */
  renderPages?: (
    bytes: Uint8Array,
    pages: number[],
    opts: { onPage?: (page: number, pages: number) => void; signal?: AbortSignal },
  ) => Promise<ImageLike[]>;
  /** Photo decoder / image encoder; default uses createImageBitmap + OffscreenCanvas. */
  imageCodec?: ImageCodec;
  /** Header band blanked on every image sent (default 0.22). */
  headerFraction?: number;
  maxImagesPerRequest?: number;
  newId?: () => string;
}

export const MESSAGES: Readonly<Record<ExtractErrorCode, string>> = {
  'no-text-no-provider':
    'This PDF has no text Vitals can read on this device. Connect an AI provider to read it as images, or type the values.',
  'not-a-report': "This doesn't look like a lab report.",
  partial: 'Some pages couldn’t be read.',
};

const PHOTO_NO_PROVIDER =
  'Vitals reads photos of a report with an AI provider. Connect one to read it, or type the values.';

const partialMessage = (n: number): string => `${n} page${n === 1 ? '' : 's'} couldn’t be read.`;

const isPdf = (bytes: Uint8Array, mime: string): boolean =>
  mime === 'application/pdf' ||
  (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46); // %PDF

/** Rows that look like results (a Tier A row or a shown-only row with a number). */
const resultLike = (x: MarkerExtraction): number =>
  x.rows.length + x.displayOnly.filter((d) => /\d/.test(d.value)).length;

/** False when the file is probably not a lab report: fewer than 2 Tier A rows and fewer than 6 result-like rows. */
export function isLabReportLike(x: MarkerExtraction): boolean {
  const tierA = x.rows.filter((r) => r.markerId !== null).length;
  return tierA >= 2 || resultLike(x) >= 6;
}

function finish(x: MarkerExtraction, pages: number, unread: number[]): ExtractResult {
  const out: ExtractResult = { ...x, pages };
  if (unread.length) out.unreadPages = unread;
  else delete out.unreadPages;
  if (unread.length && x.rows.length === 0) {
    out.error = 'no-text-no-provider';
    out.message = MESSAGES['no-text-no-provider'];
  } else if (unread.length) {
    out.error = 'partial';
    out.message = partialMessage(unread.length);
  } else if (!isLabReportLike(x)) {
    out.error = 'not-a-report';
    out.message = MESSAGES['not-a-report'];
  }
  return out;
}

function mergeVision(
  base: MarkerExtraction,
  rows: ExtractionRow[],
  shown: DisplayOnlyRow[],
  sampleDate: LocalDate | undefined,
): MarkerExtraction {
  const all = [...base.rows, ...rows].map((r, i) => ({ ...r, row: i + 1 }));
  const seen = new Set<MarkerId>(all.flatMap((r) => (r.markerId ? [r.markerId] : [])));
  for (const id of MARKER_IDS) if (!base.notInReport.includes(id)) seen.add(id);
  const date = base.sampleDate ?? sampleDate;
  return {
    ...base,
    ...(date ? { sampleDate: date } : {}),
    rows: all,
    displayOnly: [
      ...base.displayOnly,
      ...shown.map((d) => ({ ...d, date: d.date || ((date ?? '') as LocalDate) })),
    ],
    notInReport: MARKER_IDS.filter((id) => !seen.has(id)),
  };
}

const empty = (route: 'textLayer' | 'vision', newId: () => string): MarkerExtraction => ({
  extractionId: newId(),
  route,
  rows: [],
  displayOnly: [],
  notInReport: [...MARKER_IDS],
});

async function defaultTextItems(
  bytes: Uint8Array,
  opts: { onPage?: (p: number, n: number) => void; signal?: AbortSignal },
): Promise<PdfTextResult> {
  const { readPdfInWorker } = await import('./pdfClient');
  return readPdfInWorker(bytes, opts);
}

async function defaultRenderPages(
  bytes: Uint8Array,
  pages: number[],
  opts: { onPage?: (p: number, n: number) => void; signal?: AbortSignal },
): Promise<ImageLike[]> {
  const { renderPagesInWorker } = await import('./pdfClient');
  return renderPagesInWorker(bytes, pages, opts);
}

/** Read a lab report (PDF or photo) into rows to review. Never throws for an unreadable file; throws on cancel. */
export async function extractFromFile(
  input: { bytes: Uint8Array; mime: string; name?: string },
  deps: ExtractDeps = {},
): Promise<ExtractResult> {
  const newId = deps.newId ?? ulid;
  const signal = deps.signal;
  const cancelled = () => {
    if (signal?.aborted) throw new DOMException('Reading was cancelled.', 'AbortError');
  };
  const canSend = !!(deps.allowVision && deps.vision);
  const codec = deps.imageCodec ?? browserImageCodec;
  const progress = deps.onProgress;
  const headerFraction = deps.headerFraction ?? DEFAULT_HEADER_FRACTION;
  cancelled();

  if (isPdf(input.bytes, input.mime)) {
    const text = await (deps.textItems ?? defaultTextItems)(input.bytes, {
      signal,
      onPage: (page, pages) => progress?.({ page, pages, stage: 'reading' }),
    });
    cancelled();
    const { extraction } = extractFromTextItems(text.items, { newId });
    let x: MarkerExtraction = extraction;
    let unread = [...text.textlessPages];
    if (unread.length && canSend) {
      const images = await (deps.renderPages ?? defaultRenderPages)(input.bytes, unread, {
        signal,
        onPage: (page, pages) => progress?.({ page, pages, stage: 'rendering' }),
      });
      cancelled();
      // boxes of patient lines are only known where there is text; a textless page gets the header band
      const v = await readWithVision(images, deps.vision!, {
        codec,
        headerFraction,
        maxImagesPerRequest: deps.maxImagesPerRequest,
        signal,
        onBatch: (page, pages) => progress?.({ page, pages, stage: 'sending' }),
      });
      const shown = v.calculatedShown.map((c) => ({
        name: c.name,
        value: c.value,
        ...(c.unit ? { unit: c.unit } : {}),
        ...(c.range ? { range: c.range } : {}),
        date: '' as LocalDate,
      }));
      x = mergeVision(x, v.rows, shown, v.sampleDate);
      unread = v.failed.map((i) => unread[i]!);
    }
    progress?.({ page: text.pages, pages: text.pages, stage: 'checking' });
    return finish(x, text.pages, unread);
  }

  if (input.mime.startsWith('image/')) {
    if (!canSend) return { ...finish(empty('vision', newId), 1, [1]), message: PHOTO_NO_PROVIDER };
    const img = await codec.decode(input.bytes, input.mime);
    cancelled();
    const v = await readWithVision([img], deps.vision!, {
      codec,
      headerFraction,
      maxImagesPerRequest: deps.maxImagesPerRequest,
      signal,
      onBatch: (page, pages) => progress?.({ page, pages, stage: 'sending' }),
    });
    const shown = v.calculatedShown.map((c) => ({
      name: c.name,
      value: c.value,
      ...(c.unit ? { unit: c.unit } : {}),
      ...(c.range ? { range: c.range } : {}),
      date: '' as LocalDate,
    }));
    const x = mergeVision(empty('vision', newId), v.rows, shown, v.sampleDate);
    progress?.({ page: 1, pages: 1, stage: 'checking' });
    return finish(x, 1, v.failed.length ? [1] : []);
  }

  return { ...empty('textLayer', newId), pages: 0, error: 'not-a-report', message: MESSAGES['not-a-report'] };
}

/**
 * Patient-detail boxes on text pages, in image pixels, for callers that render a page that has text (not used by the
 * textless route, kept for a caller that sends a text page as an image).
 */
export function patientBoxesForPage(items: readonly TextItem[], page: number, scale: number): Box[] {
  const lines = buildLines(items.filter((i) => i.page === page));
  return patientBoxes(lines).map((b) => ({
    page,
    x: b.x * scale,
    y: b.y * scale,
    w: b.w * scale,
    h: b.h * scale,
  }));
}
