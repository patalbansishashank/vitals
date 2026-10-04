/**
 * Report-reading worker: pdf.js text layer and page images off the main thread (docs/SUITE_SPEC.md §13.5.6).
 * pdf.js is imported dynamically inside `pdf.ts`, so it is fetched the first time a PDF is read, never with the app.
 * Started by `pdfClient.ts`.
 */
import * as Comlink from 'comlink';
import { extractTextItems, renderPages, type PdfTextResult } from './pdf';
import type { ImageLike } from './redact';

const api = {
  async readText(bytes: Uint8Array, onPage?: (page: number, pages: number) => void): Promise<PdfTextResult> {
    return extractTextItems(bytes, { onPage });
  },
  async render(
    bytes: Uint8Array,
    pages: number[],
    onPage?: (page: number, pages: number) => void,
  ): Promise<ImageLike[]> {
    const images = await renderPages(bytes, pages, { onPage });
    return Comlink.transfer(
      images,
      images.map((i) => i.data.buffer as ArrayBuffer),
    );
  },
};

export type PdfWorkerApi = typeof api;

Comlink.expose(api);
