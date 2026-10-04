/**
 * The markers chapter's only way to change documents: `markers.*` commands through the bus (SUITE_SPEC §13.5.6).
 * The report file is put in the device's blob store first (as the Coach stores an attached photo) to get the
 * `attachmentId` that `markers.import` reads. Every call resolves to `{ ok, … }`; nothing throws to the screen.
 */
import { dispatch, jobs, on } from '@/commands/bus';
import type { CommandResult } from '@/commands/types';
import { getCommand } from '@/commands/registry';
import type { MarkerContext, MarkerExtraction, MarkerReadingInput, MarkersChapter, MarkersView } from '@/markers';
import { getBlobStore } from '@/state/blobStore';

export type ApiResult<T> = { ok: true; value: T } | { ok: false; message: string; code?: string };

const failed = <T>(message: string, code?: string): ApiResult<T> => ({ ok: false, message, ...(code ? { code } : {}) });

/** Whether a command is registered on this build (the chapter degrades instead of failing). */
export const hasCommand = (id: string): boolean => getCommand(id) !== undefined;

/** Settles one dispatch (call sites pass literal command ids: the commands census reads them). */
async function settle<T>(started: () => Promise<CommandResult<unknown>>): Promise<ApiResult<T>> {
  try {
    const r = await started();
    if (!r.ok) return failed(r.error.message, r.error.code);
    if ('output' in r) return { ok: true, value: r.output as T };
    if ('job' in r) {
      const st = await jobs.wait(r.job.jobId);
      if (st.state !== 'done') return failed(st.error?.message ?? st.state, st.error?.code ?? st.state);
      return { ok: true, value: jobs.result(r.job.jobId) as T };
    }
    return failed('pending');
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e));
  }
}

export const getMarkers = (): Promise<ApiResult<MarkersView>> => settle<MarkersView>(() => dispatch('markers.get', {}));

export interface SetInput {
  readings: MarkerReadingInput[];
  chapter?: Exclude<MarkersChapter, null>;
  context?: MarkerContext;
}
export const setMarkers = (input: SetInput): Promise<ApiResult<MarkersView>> => settle<MarkersView>(() => dispatch('markers.set', input));

export interface ConfirmInput {
  extractionId: string;
  accept: Array<{ row: number; value?: number; unit?: string; date: string; fasting?: boolean }>;
  context: MarkerContext;
}
export const confirmExtraction = (input: ConfirmInput): Promise<ApiResult<MarkersView>> => settle<MarkersView>(() => dispatch('markers.confirm', input));

/** Store the chosen report on this device; the blob store's chunk id is the attachment id. */
export async function storeReport(file: File): Promise<ApiResult<string>> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const aadId = `report-${Date.now().toString(36)}`;
    const { chunkId } = await (await getBlobStore()).put(bytes, { purpose: 'photo', aadId });
    return { ok: true, value: chunkId };
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e));
  }
}

export interface ImportProgress {
  /** 0–1. */
  progress: number;
  /** The reader's plain-language stage ("Reading page 3 of 25…"). */
  stage?: string;
}

export interface ImportHandle {
  result: Promise<ApiResult<MarkerExtraction>>;
  cancel: () => void;
}

/**
 * `markers.import {attachmentId}` (a job): progress arrives as job status (progress 0–1 and a stage line); `allowVision`
 * is sent only after the person pressed Send on the consent line (pages without text, photos).
 */
export function importReport(attachmentId: string, opts: { allowVision?: boolean; onProgress?: (p: ImportProgress) => void } = {}): ImportHandle {
  let jobId: string | null = null;
  let cancelled = false;
  const off = on((e) => {
    if (e.type !== 'job' || !jobId || e.status.jobId !== jobId) return;
    opts.onProgress?.({ progress: e.status.progress, ...(e.status.stage ? { stage: e.status.stage } : {}) });
  });
  const result = (async (): Promise<ApiResult<MarkerExtraction>> => {
    try {
      const r = await dispatch('markers.import', opts.allowVision ? { attachmentId, allowVision: true } : { attachmentId });
      if (!r.ok) return failed(r.error.message, r.error.code);
      if ('output' in r) return { ok: true, value: r.output as MarkerExtraction };
      if (!('job' in r)) return failed('pending');
      jobId = r.job.jobId;
      if (cancelled) jobs.cancel(jobId);
      const st = await jobs.wait(jobId);
      if (st.state === 'cancelled') return failed('cancelled', 'cancelled');
      if (st.state !== 'done') return failed(st.error?.message ?? 'failed', st.error?.code);
      return { ok: true, value: jobs.result(jobId) as MarkerExtraction };
    } catch (e) {
      return failed(e instanceof Error ? e.message : String(e));
    } finally {
      off();
    }
  })();
  return {
    result,
    cancel: () => {
      cancelled = true;
      if (jobId) jobs.cancel(jobId);
    },
  };
}

/**
 * Delete the stored report. No command deletes an attachment yet (the blob store has no delete either), so this
 * reports "unavailable" and the screen says so; wire it to the command when one exists.
 */
export async function deleteReport(_attachmentId: string): Promise<ApiResult<true>> {
  return failed('unavailable', 'unavailable');
}
