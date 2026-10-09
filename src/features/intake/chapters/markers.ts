/**
 * Chapter 4 (optional) · Blood markers (`markers`), design/screens/onboarding-intake-v3.md §8, SUITE_SPEC §13.5.5.
 *
 * The readings are never stored in `intake/me`: every widget saves through a `markers.*` command on the person's
 * `markers` document (`chapter: 'skipped' | 'manual' | 'report'` records how the chapter was answered). The questions
 * below are an ordinary v3 chapter (hosted by the QuestionCard); their turns in `intake.markers.turns` only say which
 * way was taken. `markersTurns` derives the same turns from the markers document (Coach imports, older documents).
 * Pure: no React, no store (see ./markersStore.ts and ./markersApi.ts).
 */
// submodules, not the '@/markers' index: the index carries the interaction table, which the intake must not load
import { formatMarkerDate } from '@/markers/because';
import { GROUP_LABEL, GROUP_ORDER, MARKER_UNITS, convert, displayValue, markersOfGroup, normaliseUnit } from '@/markers/units';
import { CONFIDENCE, type ExtractionRow, type MarkerGroupId, type MarkerId, type MarkerReading, type MarkersDoc } from '@/markers/types';
import type { Question } from '../flow';
import type { ChapterAnswers } from '../types';
import type { ChapterPart } from './index';

/* ------------------------------------------------------------------------------------------- copy */

/** Every visible string of the chapter (plain words; no internal references). */
export const M = {
  name: 'Blood markers',
  short: 'blood markers',
  intro: 'Optional. Results from a recent blood test can make plans safer and more specific.',
  /** SUITE_SPEC §13.5.5, verbatim. */
  statement1: 'This is the most detailed option; many values are involved.',
  statement2: 'Vitals is not medical advice; it does not diagnose or treat.',
  /** design intake-v3 §8.1's addition, after the spec sentence. */
  statement3: 'Anything your lab marks as abnormal should be discussed with a doctor.',
  has: {
    prompt: 'Do you have results from a recent blood test that you want Vitals to use?',
    why: 'Some results change what a plan may do, for example how much saturated fat or how long a fast it allows. Values only adjust the simulation and its safety checks.',
    skipText: 'plans start from typical values for your age and sex',
    short: 'blood test results',
    options: { skip: 'No, skip this chapter', manual: 'Type the values', report: 'Let the Coach read my report' },
    reportSub: 'PDF or photo. Text PDFs are read on this device; photos need an AI provider.',
  },
  manual: {
    prompt: 'Type the values from your blood test',
    short: 'values typed',
    skipText: 'plans start from typical values for your age and sex',
  },
  report: {
    prompt: 'Choose the lab report you want Vitals to read',
    short: 'report read',
    skipText: 'plans start from typical values for your age and sex',
  },
  table: {
    lead: 'Type only what your report shows. Leave the rest empty.',
    testedOn: 'tested on',
    fasting: 'fasting?',
    fastingOptions: { yes: 'yes', no: 'no', unsure: 'not sure' },
    entered: (n: number, m: number) => `${n} of ${m} entered`,
    clear: 'clear group',
    clearLabel: (g: string) => `Clear ${g}`,
    cols: { marker: 'marker', value: 'value', unit: 'unit', range: "your lab's range", date: 'date', status: 'status' },
    value: (label: string) => `${label}, value`,
    unit: (label: string) => `${label}, unit`,
    low: (label: string) => `${label}, lab range low end`,
    high: (label: string) => `${label}, lab range high end`,
    rangeText: (label: string) => `${label}, lab range as printed`,
    rangeAsText: 'type the range as text',
    rangeAsNumbers: 'type low and high',
    rangeTextPlaceholder: 'e.g. desirable < 200',
    dateLabel: (group: string) => `${group}, tested on`,
    fastingLabel: (group: string) => `${group}, fasting`,
    converted: (v: string, unit: string) => `= ${v} ${unit}`,
    noConvert: 'Lp(a) is not converted: mg/dL and nmol/L measure different things. The unit label changes; check it matches your report.',
    status: { in: 'in range', above: 'above range', below: 'below range' },
    askYes: 'Yes, keep it',
    askEdit: 'Edit',
    enterNumber: 'Enter a number, for example 5.6.',
    save: (n: number) => `Save ${n} value${n === 1 ? '' : 's'}`,
    saveNone: 'Enter at least one value, or skip',
    saveAsk: 'Answer the question under a value first',
    saveBlocked: 'Fix the values Vitals can\'t accept first',
    skipTable: 'Skip this table',
    back: 'Back',
    saving: 'Saving…',
    saveFailed: 'Could not save the values. Try again.',
  },
  report2: {
    choose: 'PDF or photo',
    chooseLabel: 'Choose a lab report, PDF or photo',
    privacy: 'Your name and patient details are removed before anything is read. The file stays on this device; you can delete it after review.',
    photoNeedsProvider: 'Reading photos needs an AI provider. Connect one in Settings, or type the values.',
    reading: 'Reading the report…',
    readingPage: (p: number, n: number) => `Reading page ${p} of ${n}…`,
    cancel: 'Cancel',
    consent: (n: number, provider: string, photo: boolean) =>
      photo ? `Sending the photo to ${provider}. Patient details are cut off first.` : `Sending ${n} page${n === 1 ? '' : 's'} without text to ${provider}. Patient details are cut off first.`,
    send: 'Send',
    typeInstead: 'Type instead',
    noTextNoProvider: 'This PDF has no text Vitals can read on this device. Connect an AI provider to read it as images, or type the values.',
    typeValues: 'Type the values',
    notReport: "This doesn't look like a lab report.",
    chooseAnother: 'Choose another file',
    partial: (n: number) => `${n} page${n === 1 ? '' : 's'} couldn't be read.`,
    failed: 'Could not read the report. Try again, or type the values.',
    tryAgain: 'Try again',
    unavailable: 'Reading reports is not available yet on this device. Type the values instead.',
    contextTitle: 'A few questions about the test',
    testDate: 'test date',
    testDateHelp: 'From the report; check it.',
    fasting: 'were you fasting?',
    creatine: 'creatine in the last 2 weeks?',
    ill: 'ill in the last 2 weeks?',
    hardTraining: 'hard training in the last 48 h?',
    meds: 'taking any of these medicines?',
    medsOptions: { thyroid: 'thyroid medicine', metformin: 'metformin', ppi: 'acid-reducing medicine', none: 'none of these' },
    yes: 'yes',
    no: 'no',
    unsure: 'not sure',
    reviewLead: 'Confirm what Vitals read. Nothing is saved until you tick it.',
    tickHigh: (n: number) => `Tick all high-confidence (${n})`,
    cols: { tick: 'use', marker: 'marker', asRead: 'as read', converted: 'converted', range: 'lab range', date: 'date', confidence: 'confidence' },
    confidence: { high: 'high', medium: 'medium', low: 'low' },
    confidenceLabel: (c: string) => `read with ${c} confidence`,
    tickLabel: (marker: string, value: string) => `Use ${marker}, ${value}`,
    tickNeedsValue: 'Enter the value and unit first',
    tickBlocked: 'Fix the value first',
    edit: 'Edit',
    editDone: 'Done',
    editLabel: (marker: string) => `Edit ${marker}`,
    notInReport: (marker: string) => `${marker} · not in your report`,
    shownNotUsed: (n: number) => `Shown, not used for planning (${n})`,
    calculatedNote: 'calculated by the lab',
    deleteFile: 'Delete the report file',
    fileDeleted: 'Report file deleted.',
    deleteUnavailable: 'Deleting the file is not available yet.',
    save: (n: number) => `Save ${n} confirmed value${n === 1 ? '' : 's'}`,
    saveNone: 'Tick at least one value, or go back',
    saveFailed: 'Could not save. Try again.',
  },
  receipt: {
    title: 'Your blood test',
    skipped: 'skipped · plans start from typical values for your age and sex',
    /** Skipped after values were saved: the saved readings still feed the plan (the skip does not delete them). */
    skippedKept: (n: number) => (n === 1 ? 'skipped · the value you saved before still counts in plans' : `skipped · the ${n} values you saved before still count in plans`),
    change: 'Change',
    changeLabel: (what: string) => `Change: ${what}`,
    effects: 'What these change in your plan',
    noEffects: 'Nothing in these results changes your plan right now.',
    clinician: (marker: string) => `Your lab marked ${marker} at a level a doctor should see soon.`,
    next: 'Next part',
    backToBody: 'Back to Your body',
  },
} as const;

/* ------------------------------------------------------------------------------------------- questions */

export type MarkersHas = 'skip' | 'manual' | 'report';

const hasLabel = (v: unknown): string | null =>
  v === 'manual' ? M.has.options.manual : v === 'report' ? M.has.options.report : v === 'skip' ? M.has.options.skip : null;
const because = (v: Readonly<Record<string, unknown>>): string | null => {
  const l = hasLabel(v.has);
  return l ? `blood test results · ${l}` : null;
};

/**
 * The chapter's v3 question graph (SUITE_SPEC §13.1, §13.5.5): the entry gate `has` (no "ask me later": skipping is an
 * answer, "skipped by choice") with the two statements in its widget, then the typed table or the report reading as its
 * child. Every widget saves through `markers.*` before it commits, so the turns (in `intake.markers.turns`) only record
 * how the chapter was answered; the readings live in the `markers` document.
 */
export const MARKERS_QUESTIONS: readonly Question[] = [
  {
    id: 'has',
    chapter: 'markers',
    section: 'markers',
    kind: 'custom',
    widget: 'markersEntry',
    askLater: false,
    prompt: M.has.prompt,
    why: M.has.why,
    skipText: M.has.skipText,
    short: M.has.short,
    receipt: (v) => (v === 'skip' ? 'skipped' : (hasLabel(v) ?? String(v ?? ''))),
  },
  {
    id: 'manual',
    parent: 'has',
    chapter: 'markers',
    section: 'markers',
    kind: 'custom',
    widget: 'markersTable',
    ownFooter: true,
    contextLine: because,
    prompt: M.manual.prompt,
    skipText: M.manual.skipText,
    short: M.manual.short,
    applies: (v) => v.has === 'manual',
    receipt: (v) => String(v ?? ''),
  },
  {
    id: 'report',
    parent: 'has',
    chapter: 'markers',
    section: 'markers',
    kind: 'custom',
    widget: 'markersReport',
    ownFooter: true,
    contextLine: because,
    prompt: M.report.prompt,
    skipText: M.report.skipText,
    short: M.report.short,
    applies: (v) => v.has === 'report',
    receipt: (v) => String(v ?? ''),
  },
];

/** E16's chapter-part contract: the registry (`./index.ts`) picks these up as the `markers` chapter. */
export const INTAKE_PARTS: readonly ChapterPart[] = [{ chapter: 'markers', questions: MARKERS_QUESTIONS }];

/** The chapter's turns, derived from the markers document (null = never answered). */
export function markersTurns(doc: MarkersDoc | null): ChapterAnswers {
  const ch = doc?.chapter ?? null;
  if (ch === 'skipped') return { values: { has: 'skip' }, status: { has: 'answered' } };
  if (ch === 'manual' || ch === 'report') {
    const line = savedSummary(doc!);
    return { values: { has: ch, [ch]: line }, status: { has: 'answered', [ch]: 'answered' } };
  }
  return { values: {}, status: {} };
}

/** "4 values · lipids, sugar". */
export function savedSummary(doc: MarkersDoc): string {
  const cur = currentReadings(doc);
  const groups = GROUP_ORDER.filter((g) => cur.some((r) => MARKER_UNITS[r.id].group === g)).map((g) => GROUP_LABEL[g]);
  return `${cur.length} value${cur.length === 1 ? '' : 's'}${groups.length ? ` · ${groups.join(', ')}` : ''}`;
}

/** The summary line ("What we'll use"); null when the chapter was never opened. */
export function markersChapterLine(doc: MarkersDoc | null): string | null {
  if (!doc || doc.chapter === null) return null;
  if (doc.chapter === 'skipped') {
    const kept = currentReadings(doc).length;
    return kept ? M.receipt.skippedKept(kept) : `skipped · ${M.has.skipText}`;
  }
  return savedSummary(doc);
}

/* ------------------------------------------------------------------------------------------- readings */

/** Newest confirmed reading per marker. */
export function currentReadings(doc: MarkersDoc): MarkerReading[] {
  const by = new Map<MarkerId, MarkerReading>();
  for (const r of doc.readings) {
    if (!r.confirmed) continue;
    const prev = by.get(r.id);
    if (!prev || r.date > prev.date || (r.date === prev.date && r.enteredAt > prev.enteredAt)) by.set(r.id, r);
  }
  return [...by.values()];
}

/** "LDL" from "LDL cholesterol"; "vitamin D" stays. */
export const shortLabel = (id: MarkerId): string => MARKER_UNITS[id].label.replace(/ cholesterol$/, '').replace(/ \(.*\)$/, '');

/** "1 234.5" without grouping commas; numbers are shown as typed when possible. */
export const showNumber = (id: MarkerId, v: number, unit: string): string => displayValue(id, v, unit);

export interface GroupReceipt {
  group: MarkerGroupId;
  date: string;
  /** "lipids · LDL 192, HDL 41 mg/dL · 14 Sep 2026" */
  text: string;
  /** The same line in parts: "lipids", "LDL 192, HDL 41 mg/dL", "14 Sep 2026". */
  label: string;
  values: string;
  dateText: string;
}

/** One receipt line per group (and test date) of the current readings, in group order. */
export function groupReceipts(readings: readonly MarkerReading[], style: 'day-month' | 'month-day' = 'day-month'): GroupReceipt[] {
  const out: GroupReceipt[] = [];
  for (const g of GROUP_ORDER) {
    const order = markersOfGroup(g);
    const rs = readings.filter((r) => MARKER_UNITS[r.id].group === g).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const dates = [...new Set(rs.map((r) => r.date))].sort().reverse();
    for (const date of dates) {
      const list = rs.filter((r) => r.date === date);
      const units = new Set(list.map((r) => r.unit));
      const one = units.size === 1;
      const parts = list.map((r) => `${shortLabel(r.id)} ${showNumber(r.id, r.value, r.unit)}${one ? '' : unitSuffix(r.unit)}`);
      const values = `${parts.join(', ')}${one ? unitSuffix(list[0]!.unit) : ''}`;
      const dateText = formatMarkerDate(date, style);
      out.push({ group: g, date, text: `${GROUP_LABEL[g]} · ${values} · ${dateText}`, label: GROUP_LABEL[g], values, dateText });
    }
  }
  return out;
}

const unitSuffix = (u: string): string => (u === '%' ? '%' : ` ${u}`);

/* ------------------------------------------------------------------------------------------- entry helpers */

/** Parse a typed number ("5,6" and "1 234" accepted); null when not a number. */
export function parseTyped(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  if (t === '' || !/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A number for an input after a unit switch (no trailing zeros, ≤ 3 decimals). */
export function formatTyped(n: number): string {
  const dp = Math.abs(n) >= 100 ? 1 : Math.abs(n) >= 10 ? 2 : 3;
  return String(Math.round(n * 10 ** dp) / 10 ** dp);
}

/** Convert a typed value for a unit switch: the new text, or null when the marker never converts (Lp(a)). */
export function convertTyped(id: MarkerId, text: string, from: string, to: string): string | null {
  const n = parseTyped(text);
  if (n === null) return text;
  const c = convert(id, n, from, to);
  return c === null ? null : formatTyped(c);
}

export type RangeStatus = 'in' | 'above' | 'below';

/** Status against the lab range the person typed (no range → null). */
export function rangeStatus(value: number | null, low: number | null, high: number | null): RangeStatus | null {
  if (value === null || (low === null && high === null)) return null;
  if (low !== null && value < low) return 'below';
  if (high !== null && value > high) return 'above';
  return 'in';
}

export const todayIso = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Lipids and sugar are the groups whose values depend on fasting. */
export const FASTING_GROUPS: ReadonlySet<MarkerGroupId> = new Set(['lipids', 'sugar']);

/* ------------------------------------------------------------------------------------------- review helpers */

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** Extraction confidence 0–1 → the chip's word (`CONFIDENCE`: ≥ 0.9 high, ≥ 0.7 medium). */
export const confidenceLevel = (c: number): ConfidenceLevel => (c >= CONFIDENCE.high ? 'high' : c >= CONFIDENCE.medium ? 'medium' : 'low');

/** A row the person may tick: a planned-on marker, not calculated by the lab. */
export const isConfirmable = (r: ExtractionRow): r is ExtractionRow & { markerId: MarkerId } => r.markerId !== null && !r.calculated;

/** The unit as the table spells it, if the marker accepts it. */
export function acceptedUnit(id: MarkerId, unit: string | null): string | null {
  if (!unit) return null;
  const u = normaliseUnit(unit) ?? unit;
  return MARKER_UNITS[id].units.some((d) => d.unit === u) ? u : null;
}

/** "41 mmol/mol" in the canonical unit, or null when nothing to convert (same unit, Lp(a), unknown unit). */
export function convertedText(id: MarkerId, value: number | null, unit: string | null): string | null {
  if (value === null) return null;
  const spec = MARKER_UNITS[id];
  const u = acceptedUnit(id, unit);
  if (!u || spec.noConversion || u === spec.canonical) return null;
  const c = convert(id, value, u, spec.canonical);
  return c === null ? null : `${displayValue(id, c, spec.canonical)}${unitSuffix(spec.canonical)}`;
}
