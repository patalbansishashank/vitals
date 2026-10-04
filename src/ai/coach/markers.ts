/**
 * Blood test reports in the Coach (E20, SUITE_SPEC §13.5.6–§13.5.7): the review card `markers.import` renders, the wait
 * for its job, and the briefing's `markers` line. The Coach only shows the review table: saving goes through
 * `markers.confirm`, which the person applies from the card (as themselves) or from the app's review table.
 *
 * Tier H: no UI imports; numbers on the card come from the extraction (the app's reader), never from the model.
 */
import type { CommandResult } from '@/commands/types';
import type { MarkerVisionPort } from '@/commands/markers/ports';
import type { ChatModel, Part } from '../providers/types';
import { askJson } from './modelJson';
import type { CardView, MarkersReviewCard } from './types';
import type { CoachBus } from './tools';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

export const MARKERS_IMPORT = 'markers.import';
export const MARKERS_CONFIRM = 'markers.confirm';

/** Rows below this confidence are shown unticked on the card and are not part of the default "save all". */
export const REVIEW_MIN_CONFIDENCE = 0.8;

function round(x: number): string {
  return String(Math.round(x * 1000) / 1000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A real calendar day 'YYYY-MM-DD' (a misread date such as 2026-45-01 is not one). */
function isDay(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const t = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso;
}

function dayText(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return isDay(iso) ? `${d} ${MONTHS[m! - 1]} ${y}` : iso;
}

/** The review data from a `markers.import` result (tolerant: unknown fields are dropped). */
export function reviewOf(output: unknown, attachmentId: string): MarkersReviewCard | null {
  if (!isRec(output) || typeof output.extractionId !== 'string' || !Array.isArray(output.rows)) return null;
  const rows: MarkersReviewCard['rows'] = output.rows.filter(isRec).map((r) => ({
    row: typeof r.row === 'number' ? r.row : 0,
    markerId: typeof r.markerId === 'string' ? r.markerId : null,
    name: typeof r.nameOnReport === 'string' ? r.nameOnReport : '',
    value: typeof r.value === 'number' ? r.value : null,
    unit: typeof r.unit === 'string' ? r.unit : null,
    ...(typeof r.labRange === 'string' ? { range: r.labRange } : {}),
    confidence: typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.max(0, Math.min(1, r.confidence)) : 0,
    calculated: r.calculated === true,
    issues: Array.isArray(r.issues) ? r.issues.filter((x): x is string => typeof x === 'string') : [],
  }));
  return {
    extractionId: output.extractionId,
    attachmentId,
    route: output.route === 'vision' ? 'vision' : 'textLayer',
    // a date that is not a real day counts as not found: the person picks it in the review table
    ...(typeof output.sampleDate === 'string' && isDay(output.sampleDate) ? { sampleDate: output.sampleDate } : {}),
    rows,
    displayOnly: Array.isArray(output.displayOnly) ? output.displayOnly.filter(isRec).length : 0,
    notInReport: Array.isArray(output.notInReport) ? output.notInReport.filter((x): x is string => typeof x === 'string') : [],
  };
}

/** Rows saved by "Save these" without opening the table: read, matched, confident, not recomputed. */
export function defaultAccept(review: MarkersReviewCard): Array<{ row: number; date: string }> {
  if (!review.sampleDate) return [];
  return review.rows
    .filter((r) => r.markerId && r.value !== null && r.unit && !r.calculated && r.confidence >= REVIEW_MIN_CONFIDENCE && !r.issues.length)
    .map((r) => ({ row: r.row, date: review.sampleDate! }));
}

/** The `markers.confirm` input the card's Apply sends (the app's review table may replace `accept` and add `context`). */
export function confirmInputOf(review: MarkersReviewCard): { extractionId: string; accept: Array<{ row: number; date: string }> } {
  return { extractionId: review.extractionId, accept: defaultAccept(review) };
}

/** The review card: one line per row (value and unit as printed, the printed range, how sure the reader is). */
export function markersReviewCard(id: string, review: MarkersReviewCard, createdAt: string): CardView {
  const items = review.rows.slice(0, 40).map((r) => {
    const value = r.value === null ? 'not read' : `${round(r.value)}${r.unit ? ` ${r.unit}` : ''}`;
    const bits = [value, r.range ? `range ${r.range}` : '', r.calculated ? 'worked out by the lab' : '', `${Math.round(r.confidence * 100)} % sure`].filter(Boolean);
    return { label: r.name || 'row', before: null, after: bits.join(' · ') };
  });
  const save = defaultAccept(review).length;
  const unsure = review.rows.length - save;
  const note = [
    review.sampleDate ? `Sample date ${dayText(review.sampleDate)}: check it.` : 'The sample date was not found: pick it in the review table.',
    unsure > 0 ? `${unsure} row${unsure === 1 ? '' : 's'} need${unsure === 1 ? 's' : ''} a look before saving.` : '',
    'Nothing is saved until you confirm.',
  ].filter(Boolean).join(' ');
  const minConf = review.rows.length ? Math.min(...review.rows.map((r) => r.confidence)) : undefined;
  return {
    id,
    class: 'log',
    title: 'Blood test report · not saved yet',
    source: { label: review.route === 'vision' ? 'Coach · read from the pages' : 'Coach · read from the PDF', ...(minConf !== undefined ? { confidence: minConf } : {}) },
    createdAt,
    items,
    note,
    state: 'pending',
    markers: review,
  };
}

/** The reader's own plain-language line when nothing (or not everything) could be read. */
export function readerMessage(output: unknown): string | undefined {
  return isRec(output) && typeof output.message === 'string' && output.message.trim() ? output.message : undefined;
}

/** What the model is told: the rows (so it can talk about them) and that the person confirms them in the app. */
export function reviewSummary(review: MarkersReviewCard): string {
  const read = review.rows.filter((r) => r.value !== null).length;
  return `Read ${read} result${read === 1 ? '' : 's'} from the report. Nothing is saved: the person checks the table on the card and confirms it in the app. Tell them it is waiting below; do not ask them to repeat the values.`;
}

/** Waits for a job through the bus (its status events, then `job.result`). */
export async function settleJob(bus: CoachBus, jobId: string, actor: { kind: 'ai'; id: string; conversationId?: string; toolCallId?: string }, signal?: AbortSignal): Promise<CommandResult> {
  const done = (s: unknown) => isRec(s) && (s.state === 'done' || s.state === 'failed' || s.state === 'cancelled');
  let settled: Rec | null = null;
  await new Promise<void>((resolve) => {
    if (signal?.aborted) {
      // an already-aborted signal never fires `abort`
      settled = { state: 'cancelled' };
      return resolve();
    }
    let off: () => void = () => undefined;
    const onAbort = () => finish({ state: 'cancelled' });
    const finish = (s: Rec) => {
      settled = s;
      off();
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    off = bus.on((e) => {
      if (e.type === 'job' && e.status.jobId === jobId && done(e.status)) finish(e.status as unknown as Rec);
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    void bus
      .dispatch('job.status', { jobId }, { actor })
      .then((r) => {
        if (r.ok && 'output' in r && done(r.output)) finish(r.output as Rec);
      })
      .catch(() => undefined); // the job's own event still settles it
  });
  const s = settled as Rec | null;
  if (!s || s.state !== 'done') {
    const error = isRec(s?.error) ? (s!.error as { code: string; message: string }) : { code: 'cancelled', message: 'Reading the report stopped.' };
    return { ok: false, error: { code: (error.code as never) ?? 'internal', message: error.message } };
  }
  const r = await bus.dispatch('job.result', { jobId }, { actor });
  // `job.result` answers `{status, result}`: the command's own output is `result`
  return r.ok && 'output' in r && isRec(r.output) && 'result' in r.output ? { ...r, output: r.output.result } : r;
}

/** The briefing's `markers` line (≤ 300 tokens): newest confirmed reading per marker, its state and the notes' rule ids. */
export function briefingMarkers(view: unknown): Array<{ id: string; value: number; unit: string; date: string; state: string; notes: string[] }> {
  if (!isRec(view) || !Array.isArray(view.current)) return [];
  const notes = Array.isArray(view.notes) ? view.notes.filter(isRec) : [];
  return view.current.filter(isRec).flatMap((s) => {
    const r = isRec(s.reading) ? s.reading : null;
    if (!r || typeof s.markerId !== 'string' || typeof r.value !== 'number') return [];
    const state = s.stale === true ? 'old' : typeof s.status === 'string' ? s.status : 'unknown';
    const ids = notes.filter((n) => n.markerId === s.markerId && typeof n.rule === 'string').map((n) => n.rule as string);
    return [{ id: s.markerId, value: r.value, unit: typeof r.unit === 'string' ? r.unit : '', date: typeof r.date === 'string' ? r.date : '', state, notes: ids }];
  });
}

/** Base64 without a prefix. */
function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * The vision side of the report reader over the Coach's model (installed as `aiPorts().markerVision` when the model can
 * see). The request is exactly what the reader built: masked page images and its own instructions and prompt (made
 * from the marker table only). Nothing from the person's profile, the file name or the conversation is added.
 * Network only through the provider, which goes through `src/net/net.ts`.
 */
export function createMarkerVisionPort(model: ChatModel): MarkerVisionPort {
  return {
    async readRows(req, opts = {}) {
      const user: Part[] = [
        { type: 'text', text: req.prompt },
        ...req.images.map((im): Part => ({ type: 'image', mime: im.mime, source: { kind: 'base64', data: typeof im.data === 'string' ? im.data : base64(im.data) } })),
      ];
      return askJson(model, { system: req.instructions, user, schemaName: 'lab_rows', schema: req.schemaHint, maxOutputTokens: 3000, ...(opts.signal ? { signal: opts.signal } : {}) });
    },
  };
}
