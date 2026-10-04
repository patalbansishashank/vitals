/**
 * The `markers` document as the commands read and write it (E20, SUITE_SPEC §13.5): the stored document (or, before the
 * first save, the Body page's `profile.labs` values migrated in), the rule context from the profile and screening, the
 * `MarkersView`, row validation shared by `markers.set` and `markers.confirm`, and the history entries in
 * `measurements` (`metric: 'lab:<markerId>'`, canonical value).
 */
import { bodyOf, type Instant } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { bodyValues } from '@/state/internal/profile';
import { safetyAccessNow } from '@/state/internal/safety';
import { simulatorProfileNow } from '@/state/internal/simulatorProfile';
import type { EntrySource } from '@/living';
import { currentReadings, isStale, migrateProfileLabs, normaliseDoc } from '@/markers/doc';
import { markerRuleContext } from '@/markers/context';
import { evaluateMarkers } from '@/markers/rules';
import { readMarkerContextSources } from '@/markers/ui/contextSources';
import { MARKER_IDS, emptyMarkersDoc, type MarkerId, type MarkerReading, type MarkerState, type MarkersDoc, type MarkersView, type RuleContext } from '@/markers/types';
import { MARKER_UNITS, checkBounds, isAcceptedUnit } from '@/markers/units';
import { fail } from '../registry';
import type { CommandContext } from '../types';
import { notInFuture } from './ports';

export const MARKERS_COL = 'markers' as const;
export const MARKERS_KEY = 'me';
export const labMetric = (id: MarkerId): string => `lab:${id}`;

/** The stored document; before the first save, the Body page's marker values (`profile.labs`) migrated in. */
export async function readMarkers(ctx: Pick<CommandContext, 'docs' | 'now'>): Promise<MarkersDoc> {
  const d = await ctx.docs.get<Record<string, unknown>>(MARKERS_COL, MARKERS_KEY);
  if (d) return normaliseDoc(bodyOf(d as unknown as Record<string, unknown>));
  try {
    const profile = getDocumentStore().peek('profile', 'me');
    return migrateProfileLabs(emptyMarkersDoc(), bodyValues().labs, (profile?._updated as Instant | undefined) ?? ctx.now);
  } catch {
    return emptyMarkersDoc();
  }
}

export async function writeMarkers(ctx: CommandContext, doc: MarkersDoc): Promise<void> {
  const { _schema: _s, ...body } = doc;
  void _s;
  await ctx.docs.put(MARKERS_COL, { ...body, _id: MARKERS_KEY });
}

/** Rule context from Your body, the screening, the intake answers and the live plan (`markerRuleContext`, §13.5.3). */
export function ruleContext(ctx: Pick<CommandContext, 'now' | 'today'>): RuleContext {
  let profile: ReturnType<typeof simulatorProfileNow> | undefined;
  let flags: readonly string[] = [];
  try {
    profile = simulatorProfileNow(ctx.now);
  } catch {
    /* profile not loaded: sex unknown, no age or BMI */
  }
  try {
    flags = safetyAccessNow(ctx.now).outcome.flags;
  } catch {
    /* screening not loaded */
  }
  return markerRuleContext({ profile, flags, ...readMarkerContextSources() }, ctx.today);
}

/** `MarkersView`: the document, the current reading per marker with its state, and the notes that fire. */
export function markersView(doc: MarkersDoc, rc: RuleContext): MarkersView {
  const ev = evaluateMarkers(doc, rc);
  const current: MarkerState[] = ev.states.length
    ? ev.states
    : currentReadings(doc).map((r) => ({ markerId: r.id, reading: r, status: 'unknown' as const, stale: isStale(r, rc.today, rc.dietChangeDate), rules: [] }));
  return { doc, current, notes: ev.notes };
}

/** One reading the person typed or accepted; `path` points at the offending input for the error. */
export interface RowToCheck {
  id: MarkerId;
  value: number;
  unit: string;
  date: string;
}

/**
 * Rejects (with `invalid_input`) a unit outside the table, a value outside the plausibility bounds, or a date after
 * today. Values outside the soft bounds pass with a notice.
 */
export function checkRow(ctx: CommandContext, r: RowToCheck, path: string): void {
  if (!MARKER_IDS.includes(r.id)) fail('invalid_input', 'That marker is not one Vitals plans with.', { path: `${path}/id` });
  const label = MARKER_UNITS[r.id].label;
  if (!isAcceptedUnit(r.id, r.unit)) fail('invalid_input', `${label}: unit not recognised.`, { path: `${path}/unit` });
  const b = checkBounds(r.id, r.value, r.unit);
  if (!b.ok && b.level === 'block') fail('invalid_input', b.message.startsWith('unit') ? `${label}: ${b.message}.` : b.message, { path: `${path}/value` });
  if (!b.ok) ctx.notice({ level: 'caution', text: `${label}: ${b.message}` });
  if (!notInFuture(r.date, ctx.today)) fail('invalid_input', `${label}: the sample date is after today.`, { path: `${path}/date` });
}

function sourceOf(ctx: CommandContext): EntrySource {
  const k = ctx.actor.kind;
  const by: EntrySource['by'] = k === 'user' ? 'user' : k === 'system' ? 'system' : k === 'companion' ? 'import' : 'ai';
  return {
    by,
    method: by === 'ai' ? 'aiText' : 'typed',
    ...(ctx.actor.conversationId ? { conversationId: ctx.actor.conversationId } : {}),
    ...(ctx.actor.toolCallId ? { toolCallId: ctx.actor.toolCallId } : {}),
    actorId: ctx.actor.id,
  };
}

interface LabEntry {
  id: string;
  date: string;
  metric: string;
  kind?: string;
  target?: string;
  supersedes?: string;
}

/** Live (not retracted, not superseded) `lab:<id>` history entries of one marker and date. */
function liveLabEntries(metric: string, date: string): LabEntry[] {
  let all: LabEntry[];
  try {
    all = getDocumentStore()
      .peekAll<Omit<LabEntry, 'id'>>('measurements')
      .map((d) => ({ ...bodyOf<Omit<LabEntry, 'id'>>(d), id: d._id }));
  } catch {
    return [];
  }
  const gone = new Set(all.flatMap((e) => [e.kind === 'retract' ? e.target : undefined, e.supersedes]).filter((x): x is string => !!x));
  return all.filter((e) => e.metric === metric && e.date === date && e.kind !== 'retract' && !gone.has(e.id));
}

/** History: one APP `measurements` entry per saved reading (a re-entry of the same day supersedes the earlier one). */
export async function appendHistory(ctx: CommandContext, readings: readonly MarkerReading[]): Promise<void> {
  for (const r of readings) {
    const metric = labMetric(r.id);
    const prev = liveLabEntries(metric, r.date)[0];
    await ctx.docs.append('measurements', {
      _id: ctx.newId(),
      date: r.date,
      at: ctx.now,
      metric,
      value: r.valueCanonical,
      method: 'lab',
      source: sourceOf(ctx),
      ...(prev ? { supersedes: prev.id } : {}),
    });
  }
}

/** History: retract the `lab:<id>` entries of a removed reading. */
export async function retractHistory(ctx: CommandContext, id: MarkerId, date: string, value: number): Promise<void> {
  const metric = labMetric(id);
  for (const e of liveLabEntries(metric, date)) {
    await ctx.docs.append('measurements', { _id: ctx.newId(), date, at: ctx.now, metric, value, kind: 'retract', target: e.id, source: sourceOf(ctx) });
  }
}
