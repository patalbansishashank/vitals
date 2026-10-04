/**
 * `markers.*` (E20, SUITE_SPEC §13.5.6): blood test results. Readings are typed by hand (`markers.set`) or read from a
 * report (`markers.import` → review → `markers.confirm`); only confirmed readings are ever planned on. Every saved
 * reading also adds a `lab:<markerId>` entry to `measurements` (canonical value) so Progress can trend it.
 *
 * The intake chapter's entry answer ("No, skip" · "Type the key values" · "Let the Coach read my report") is the
 * optional `chapter` of `markers.set` (with `readings: []` when only the answer changes); the sample context
 * (creatine, recent illness, hard training, medicines) is its optional `context`, merged into the document.
 */
import { bodyOf } from '@/store';
import { getBlobStore } from '@/state/blobStore';
import { getDocumentStore } from '@/state/runtime';
import { readingFromInput, removeReading, upsertReadings } from '@/markers/doc';
import { MARKER_IDS, type MarkerContext, type MarkerExtraction, type MarkerId, type MarkerProvenance, type MarkerReading, type MarkersChapter, type MarkersDoc, type MarkersView } from '@/markers/types';
import { aiPorts } from '../aiPorts';
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import type { CommandContext } from '../types';
import { ALL, UNDO } from '../defs/_shared';
import { keepExtraction, pendingExtraction } from './pending';
import { labRangeOf, markerExtractor, sniffMime, type ExtractProgress, type ExtractResult } from './ports';
import { appendHistory, checkRow, markersView, readMarkers, retractHistory, ruleContext, writeMarkers } from './view';

const MarkerIdS = T.Enum(MARKER_IDS);
const DateS = T.Date();
const CHAPTERS = ['skipped', 'manual', 'report'] as const;

const ContextS = T.Object(
  {
    creatineLast2w: T.Optional(T.Boolean({ description: 'Took creatine in the 2 weeks before the sample.' })),
    recentIllness: T.Optional(T.Boolean({ description: 'Was ill in the 2 weeks before the sample.' })),
    hardTraining48h: T.Optional(T.Boolean({ description: 'Trained hard in the 48 h before the sample.' })),
    thyroidMeds: T.Optional(T.Boolean()),
    metformin: T.Optional(T.Boolean()),
    ppi: T.Optional(T.Boolean({ description: 'Takes a stomach-acid medicine (PPI).' })),
  },
  { description: 'Sample context; given fields replace the stored ones.' },
);

const ReadingInputS = T.Object({
  id: MarkerIdS,
  value: T.Number({ description: 'As printed or typed, in `unit`.' }),
  unit: T.String({ minLength: 1, maxLength: 24, description: 'One of the units the marker accepts (mg/dL, mmol/L, %, mmol/mol, U/L, g/dL …).' }),
  date: T.Date({ description: 'Sample date (YYYY-MM-DD), not after today.' }),
  labRange: T.Optional(
    T.Object({
      low: T.Optional(T.Number()),
      high: T.Optional(T.Number()),
      text: T.Optional(T.String({ maxLength: 60 })),
      unit: T.String({ minLength: 1, maxLength: 24 }),
    }),
  ),
  method: T.Optional(T.String({ maxLength: 40, description: "'direct' or 'calculated' (LDL), or the lab's wording." })),
  fasting: T.Optional(T.Boolean()),
});

export const MarkersViewS = T.As<MarkersView>(
  T.Object({
    doc: T.OpenObject({ description: 'vitals.markers/1: readings (value and unit as entered, canonical value, date, provenance), displayOnly rows, sample context, chapter.' }),
    current: T.Array(T.OpenObject({ description: 'Newest confirmed reading per marker with its status (in, above, below range) and whether it is too old to plan on.' })),
    notes: T.Array(T.OpenObject({ description: 'What the results change in the plan, each with the reading it is because of.' })),
  }),
);

const ExtractionS = T.As<MarkerExtraction>(
  T.Object({
    extractionId: T.String(),
    route: T.Enum(['textLayer', 'vision']),
    sampleDate: T.Optional(DateS),
    rows: T.Array(T.OpenObject({ description: '{row, markerId|null, nameOnReport, value|null, unit|null, labRange?, method?, calculated, confidence 0–1, issues[]}' })),
    displayOnly: T.Array(T.OpenObject()),
    notInReport: T.Array(T.String()),
    unreadPages: T.Optional(T.Array(T.Integer())),
    pages: T.Optional(T.Integer({ description: 'Pages in the file (1 for a photo).' })),
    error: T.Optional(T.Enum(['no-text-no-provider', 'not-a-report', 'partial'])),
    message: T.Optional(T.String({ description: 'Plain-language line when the file could not be read (fully or in part).' })),
  }),
);

const view = (ctx: CommandContext, doc: MarkersDoc): MarkersView => markersView(doc, ruleContext(ctx));

function mergeContext(doc: MarkersDoc, context: MarkerContext | undefined): MarkersDoc {
  return context && Object.keys(context).length ? { ...doc, context: { ...doc.context, ...context } } : doc;
}

/* ------------------------------------------------------------------------------------------- markers.get */

export const markersGet = defineCommand({
  id: 'markers.get',
  version: 1,
  title: 'Read your blood test results',
  description:
    'Blood test results: every confirmed reading (value and unit as entered, sample date, where it came from), the newest per marker with its status against the printed or usual range, whether it is too old to plan on (over 12 months), and the notes they add to the plan.',
  input: T.Object({}),
  output: MarkersViewS,
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the markers chapter (intake) reads it when it ships' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (ctx) => view(ctx, await readMarkers(ctx)),
});

/* ------------------------------------------------------------------------------------------- markers.set */

export const markersSet = defineCommand({
  id: 'markers.set',
  version: 1,
  title: 'Save blood test results',
  description:
    'Save blood test values typed by the person (marker, value, unit as printed, sample date). A unit the marker does not accept or an implausible value is refused; a second value for the same marker and date replaces the first. Optional chapter (skipped, manual, report) records the intake answer; optional context records creatine, illness, hard training and medicines around the sample.',
  input: T.Object({
    readings: T.Array(ReadingInputS, { maxItems: 40 }),
    chapter: T.Optional(T.Enum(CHAPTERS)),
    context: T.Optional(ContextS),
  }),
  output: MarkersViewS,
  perm: 'write',
  impact: 'consequential',
  surfaces: ALL,
  excludedReason: { ui: 'the markers chapter (intake) calls it when it ships' },
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs', 'planner'],
  execute: async (ctx, input) => {
    input.readings.forEach((r, i) => checkRow(ctx, r, `/readings/${i}`));
    const doc = await readMarkers(ctx);
    const readings = input.readings.map((r) => readingFromInput(r, 'manual', ctx.now, { confirmed: true }));
    let next = upsertReadings(doc, readings);
    next = mergeContext(next, input.context);
    const chapter: MarkersChapter = input.chapter ?? (readings.length && doc.chapter === null ? 'manual' : doc.chapter);
    next = { ...next, chapter };
    await writeMarkers(ctx, next);
    await appendHistory(ctx, readings);
    return view(ctx, next);
  },
});

/* ------------------------------------------------------------------------------------------- markers.import */

export const markersImport = defineCommand({
  id: 'markers.import',
  version: 1,
  title: 'Read a blood test report',
  description:
    'Read a blood test report the person attached (PDF or photo, by attachmentId). Returns a job; its result is the review table: each row with the marker, value and unit as printed, the printed range, and a confidence 0–1. Nothing is saved: the person checks the table and confirms the rows in the app. Pages without text go to the AI provider only when allowVision is true, with the patient details removed.',
  input: T.Object({
    attachmentId: T.String({ minLength: 1, maxLength: 64 }),
    allowVision: T.Optional(T.Boolean({ description: 'The person agreed to send the pages (patient details removed) to their AI provider. Default: true when the Coach reads it, false otherwise.' })),
  }),
  output: ExtractionS,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  excludedReason: { ui: 'the markers chapter (intake) calls it when it ships' },
  undo: UNDO.none,
  idempotency: 'key',
  longRunning: { kind: 'job', softTimeoutMs: 60_000 },
  sideEffects: ['file', 'network'],
  execute: async (ctx, input) => {
    let bytes: Uint8Array;
    try {
      bytes = await (await getBlobStore()).get(input.attachmentId);
    } catch {
      fail('not_found', 'That file is not on this device.', { path: '/attachmentId' });
    }
    const meta = attachmentMeta(input.attachmentId);
    const mime = sniffMime(bytes!) ?? meta.mime;
    if (!mime || !(mime === 'application/pdf' || mime.startsWith('image/'))) fail('invalid_input', 'That file can’t be read. Send the report as a PDF or a photo.', { path: '/attachmentId' });
    const by = ctx.actor.kind;
    const allowVision = input.allowVision ?? by === 'ai';
    const vision = allowVision ? aiPorts().markerVision : undefined;
    const extract = await markerExtractor();
    return ctx.jobs.start('import', async (job) => {
      const ex = await extract(
        { bytes: bytes!, mime: mime!, ...(meta.name ? { name: meta.name } : {}) },
        { ...(vision ? { vision } : {}), allowVision: allowVision && !!vision, signal: job.signal, newId: ctx.newId, onProgress: (p) => job.progress(p.pages ? p.page / p.pages : 0, stageText(p)) },
      );
      const extraction: ExtractResult = { ...ex, extractionId: ex.extractionId || ctx.newId() };
      keepExtraction({ extraction, attachmentId: input.attachmentId, mime: mime!, by, at: ctx.now });
      return extraction;
    });
  },
});

const STAGE: Record<ExtractProgress['stage'], (p: ExtractProgress) => string> = {
  reading: (p) => `Reading page ${p.page} of ${p.pages}…`,
  rendering: (p) => `Preparing page ${p.page} of ${p.pages}…`,
  sending: () => 'Sending the pages (patient details removed) to your AI provider…',
  checking: () => 'Checking the values…',
};
const stageText = (p: ExtractProgress): string => STAGE[p.stage]?.(p) ?? '';

function attachmentMeta(id: string): { mime?: string; name?: string } {
  try {
    const d = getDocumentStore().peek<Record<string, unknown>>('attachments', id);
    if (!d) return {};
    const b = bodyOf(d);
    return { ...(typeof b.mime === 'string' ? { mime: b.mime } : {}), ...(typeof b.name === 'string' ? { name: b.name } : {}) };
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------------------------------- markers.confirm */

const provenanceOf = (route: MarkerExtraction['route'], mime: string, by: string): MarkerProvenance =>
  by === 'ai' ? 'coach' : route === 'textLayer' || mime === 'application/pdf' ? 'pdf' : 'photo';

export const markersConfirm = defineCommand({
  id: 'markers.confirm',
  version: 1,
  title: 'Confirm results from a report',
  description:
    'Save the rows of a read report that the person checked (row number, the corrected value or unit if any, and the sample date). Only the accepted rows are saved; the rest of the report is dropped. Rows that are shown but never planned on (blood count indices and the like) are kept for display.',
  input: T.Object({
    extractionId: T.String({ minLength: 1, maxLength: 64 }),
    accept: T.Array(
      T.Object({
        row: T.Integer({ minimum: 0 }),
        markerId: T.Optional(MarkerIdS),
        value: T.Optional(T.Number()),
        unit: T.Optional(T.String({ minLength: 1, maxLength: 24 })),
        date: DateS,
        fasting: T.Optional(T.Boolean()),
      }),
      { maxItems: 60 },
    ),
    context: T.Optional(ContextS),
  }),
  output: MarkersViewS,
  perm: 'write',
  impact: 'consequential',
  surfaces: ['ui'],
  excludedReason: {
    ui: 'the markers chapter (intake) and the Coach card call it when they ship',
    ai: 'the person checks and confirms the review table themselves; the Coach only shows it',
    webmcp: 'the person checks and confirms the review table in the app',
    mcp: 'the person checks and confirms the review table in the app',
  },
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs', 'planner'],
  execute: async (ctx, input) => {
    const p = pendingExtraction(input.extractionId) ?? fail('not_found', 'That report is no longer open. Read it again.', { path: '/extractionId' });
    const doc = await readMarkers(ctx);
    if (p.confirmedAt) return view(ctx, doc);
    const ex = p.extraction;
    const provenance = provenanceOf(ex.route, p.mime, p.by);
    const readings: MarkerReading[] = input.accept.map((a, i) => {
      const path = `/accept/${i}`;
      const row = ex.rows.find((r) => r.row === a.row) ?? fail('invalid_input', 'That row is not in the report.', { path: `${path}/row` });
      const id: MarkerId = a.markerId ?? row.markerId ?? fail('invalid_input', `Pick which marker “${row.nameOnReport}” is.`, { path: `${path}/markerId` });
      const value = a.value ?? row.value ?? fail('invalid_input', `Enter the value for ${row.nameOnReport}.`, { path: `${path}/value` });
      const unit = a.unit ?? row.unit ?? fail('invalid_input', `Pick the unit for ${row.nameOnReport}.`, { path: `${path}/unit` });
      checkRow(ctx, { id, value, unit, date: a.date }, path);
      const labRange = labRangeOf(row.labRange, unit);
      const method = row.method ?? (row.calculated ? 'calculated' : undefined);
      return readingFromInput({ id, value, unit, date: a.date, ...(labRange ? { labRange } : {}), ...(method ? { method } : {}), ...(a.fasting !== undefined ? { fasting: a.fasting } : {}) }, provenance, ctx.now, {
        confirmed: true,
        confidence: row.confidence,
        attachmentId: p.attachmentId,
      });
    });
    let next = upsertReadings(doc, readings);
    if (ex.displayOnly.length) {
      const key = (r: { name: string; date: string }) => `${r.name}|${r.date}`;
      const fresh = new Set(ex.displayOnly.map(key));
      next = { ...next, displayOnly: [...next.displayOnly.filter((r) => !fresh.has(key(r))), ...ex.displayOnly] };
    }
    next = mergeContext(next, input.context);
    if (next.chapter === null) next = { ...next, chapter: 'report' };
    await writeMarkers(ctx, next);
    await appendHistory(ctx, readings);
    if (!ctx.dryRun) p.confirmedAt = ctx.now;
    return view(ctx, next);
  },
});

/* ------------------------------------------------------------------------------------------- markers.remove */

export const markersRemove = defineCommand({
  id: 'markers.remove',
  version: 1,
  title: 'Remove a blood test result',
  description: 'Remove one saved blood test reading (marker and sample date). Older readings of the same marker stay; the newest left becomes current.',
  input: T.Object({ markerId: MarkerIdS, date: DateS }),
  output: MarkersViewS,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  excludedReason: { ui: 'the markers chapter (intake) calls it when it ships' },
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs', 'planner'],
  execute: async (ctx, input) => {
    const doc = await readMarkers(ctx);
    const gone = doc.readings.find((r) => r.id === input.markerId && r.date === input.date) ?? fail('not_found', 'There is no such reading.', { path: '/markerId' });
    const next = removeReading(doc, input.markerId, input.date);
    await writeMarkers(ctx, next);
    await retractHistory(ctx, input.markerId, input.date, gone.valueCanonical);
    return view(ctx, next);
  },
});

declare module '../types' {
  interface CommandMap {
    'markers.get': typeof markersGet;
    'markers.set': typeof markersSet;
    'markers.import': typeof markersImport;
    'markers.confirm': typeof markersConfirm;
    'markers.remove': typeof markersRemove;
  }
}
