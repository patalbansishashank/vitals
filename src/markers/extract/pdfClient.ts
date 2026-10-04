/**
 * Main-thread side of the report-reading worker (`pdf.worker.ts`). One worker per read; it is terminated when the read
 * ends or is cancelled, so pdf.js's memory goes with it.
 */
import * as Comlink from 'comlink';
import type { PdfTextResult } from './pdf';
import type { PdfWorkerApi } from './pdf.worker';
import type { ImageLike } from './redact';

export interface WorkerReadOptions {
  onPage?: (page: number, pages: number) => void;
  signal?: AbortSignal;
}

async function withWorker<T>(
  opts: WorkerReadOptions,
  run: (api: Comlink.Remote<PdfWorkerApi>, onPage?: (page: number, pages: number) => void) => Promise<T>,
): Promise<T> {
  if (opts.signal?.aborted) throw new DOMException('Reading was cancelled.', 'AbortError');
  const worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), {
    type: 'module',
    name: 'vitals-report-reader',
  });
  const api = Comlink.wrap<PdfWorkerApi>(worker);
  let stop: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    stop = () => reject(new DOMException('Reading was cancelled.', 'AbortError'));
    opts.signal?.addEventListener('abort', stop, { once: true });
  });
  try {
    return await Promise.race([run(api, opts.onPage ? Comlink.proxy(opts.onPage) : undefined), cancelled]);
  } finally {
    opts.signal?.removeEventListener('abort', stop);
    api[Comlink.releaseProxy]();
    worker.terminate();
  }
}

/** The PDF's positional text, read in a worker. */
export function readPdfInWorker(bytes: Uint8Array, opts: WorkerReadOptions = {}): Promise<PdfTextResult> {
  return withWorker(opts, (api, onPage) => api.readText(bytes, onPage));
}

/** Pages (1-based) as RGBA images, rendered in a worker. */
export function renderPagesInWorker(
  bytes: Uint8Array,
  pages: number[],
  opts: WorkerReadOptions = {},
): Promise<ImageLike[]> {
  return withWorker(opts, (api, onPage) => api.render(bytes, pages, onPage));
}
