/**
 * PDF text layer and page images with pdf.js (docs/SUITE_SPEC.md §13.5.6 step 1).
 *
 * pdf.js is never in the main bundle: it is imported dynamically here, and in the browser this module only runs inside
 * `pdf.worker.ts` (a module Web Worker, see `pdfClient.ts`). pdf.js would normally start its own worker; inside ours it
 * runs its parser in the same thread instead ("fake worker"): `loadPdfjs` sets `globalThis.pdfjsWorker` to pdf.js's
 * worker module before the first document is opened, so no `GlobalWorkerOptions.workerSrc` and no nested worker are
 * needed, and the strict CSP (no eval: `isEvalSupported: false`) holds.
 *
 * Node tests pass `load: loadPdfjsLegacy` (the legacy build) and call `extractTextItems` directly on fixture bytes.
 */
import type { ImageLike } from './redact';
import type { TextItem } from './layout';

/** The part of the pdf.js API used here (kept structural so the modern and legacy builds both fit). */
export interface PdfjsLib {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDoc>; destroy(): Promise<void> };
  Util: { transform(a: number[], b: number[]): number[] };
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
interface PdfViewport {
  width: number;
  height: number;
  transform: number[];
}
interface PdfPage {
  getViewport(o: { scale: number }): PdfViewport;
  getTextContent(): Promise<{
    items: Array<{ str?: string; transform?: number[]; width?: number; height?: number }>;
  }>;
  render(o: Record<string, unknown>): { promise: Promise<void> };
  cleanup(): void;
}

export type PdfjsLoader = () => Promise<PdfjsLib>;

/** Browser / worker: the modern build, its parser in this thread. */
export const loadPdfjs: PdfjsLoader = async () => {
  const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.mjs')]);
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  return lib as unknown as PdfjsLib;
};

/** Node (tests, scripts): the legacy build. */
export const loadPdfjsLegacy: PdfjsLoader = async () => {
  const [lib, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ]);
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  return lib as unknown as PdfjsLib;
};

export interface PdfTextResult {
  items: TextItem[];
  pages: number;
  /** 1-based pages with (almost) no text layer: scans and photos saved as PDF. */
  textlessPages: number[];
  /** Page sizes in PDF points (index = page − 1). */
  pageSizes: Array<{ width: number; height: number }>;
}

export interface PdfReadOptions {
  load?: PdfjsLoader;
  onPage?: (page: number, pages: number) => void;
  signal?: AbortSignal;
}

/** Fewer printable characters than this on a page = no text layer. */
const MIN_PAGE_CHARS = 12;

const docOptions = (bytes: Uint8Array) => ({
  data: bytes.slice(), // pdf.js may transfer (detach) the buffer it is given
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  verbosity: 0,
  stopAtErrors: false,
});

const aborted = (signal?: AbortSignal) => {
  if (signal?.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Reading was cancelled.', 'AbortError');
};

/** Positional text of every page. y is the baseline from the top of the page, in points. */
export async function extractTextItems(bytes: Uint8Array, opts: PdfReadOptions = {}): Promise<PdfTextResult> {
  const pdfjs = await (opts.load ?? loadPdfjs)();
  const task = pdfjs.getDocument(docOptions(bytes));
  const doc = await task.promise;
  try {
    const items: TextItem[] = [];
    const textlessPages: number[] = [];
    const pageSizes: PdfTextResult['pageSizes'] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      aborted(opts.signal);
      opts.onPage?.(p, doc.numPages);
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      pageSizes.push({ width: vp.width, height: vp.height });
      const tc = await page.getTextContent();
      let chars = 0;
      for (const it of tc.items) {
        if (typeof it.str !== 'string' || !it.transform) continue;
        chars += it.str.replace(/\s/g, '').length;
        if (!it.str.trim()) continue;
        const t = pdfjs.Util.transform(vp.transform, it.transform);
        const h = Math.hypot(t[2]!, t[3]!) || it.height || 0;
        items.push({ str: it.str, x: t[4]!, y: t[5]!, w: it.width ?? 0, h, page: p });
      }
      if (chars < MIN_PAGE_CHARS) textlessPages.push(p);
      page.cleanup();
    }
    return { items, pages: doc.numPages, textlessPages, pageSizes };
  } finally {
    await task.destroy();
  }
}

/** pdf.js canvas factory backed by OffscreenCanvas (a worker has no `document`). */
class OffscreenCanvasFactory {
  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }
  reset(cc: { canvas: OffscreenCanvas }, width: number, height: number) {
    cc.canvas.width = Math.max(1, Math.ceil(width));
    cc.canvas.height = Math.max(1, Math.ceil(height));
  }
  destroy(cc: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (cc.canvas) cc.canvas.width = cc.canvas.height = 0;
    cc.canvas = null;
    cc.context = null;
  }
}

export interface RenderOptions extends PdfReadOptions {
  /** Pixels per point (default 2: ~144 dpi, enough for a model to read 9 pt type). */
  scale?: number;
  /** Longest side cap in pixels (default 2000). */
  maxSide?: number;
}

/** Render pages (1-based) to RGBA images. Needs OffscreenCanvas (browsers and workers); throws elsewhere. */
export async function renderPages(
  bytes: Uint8Array,
  pages: readonly number[],
  opts: RenderOptions = {},
): Promise<ImageLike[]> {
  if (typeof OffscreenCanvas === 'undefined') throw new Error('Pages cannot be turned into images here.');
  const pdfjs = await (opts.load ?? loadPdfjs)();
  const task = pdfjs.getDocument({
    ...docOptions(bytes),
    CanvasFactory: OffscreenCanvasFactory,
    isOffscreenCanvasSupported: true,
  });
  const doc = await task.promise;
  try {
    const out: ImageLike[] = [];
    for (const [i, p] of pages.entries()) {
      aborted(opts.signal);
      opts.onPage?.(i + 1, pages.length);
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(opts.scale ?? 2, (opts.maxSide ?? 2000) / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      const canvas = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport: vp, background: 'white' }).promise;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      out.push({ width: img.width, height: img.height, data: img.data });
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy();
  }
}
