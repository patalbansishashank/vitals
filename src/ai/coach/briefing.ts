/**
 * The standing briefing (SUITE_SPEC §5.3; R8 §5.4): built by code every turn from read commands, never by the model.
 * Static part (role, not medical advice, safety relay rule, confirmation policy, units, style) plus a dynamic part
 * (date, safety mode, profile, active plan and today, goals, proposals, recent log, scores, questions still open),
 * fitted to ≤ 3k tokens by dropping or truncating the lowest-priority sections first (`fitBriefing`).
 *
 * The same data feeds the visible "What the Coach knows" panel (`VisibleBriefingInput`, rendered by the UI's
 * `buildCoachBriefing`), so what the person sees is what the model receives.
 */
import { supplementBriefing, toSectionV2 } from '@/catalogues/supplements';
import { kitchenBlockFromViews, type KitchenBlockInput, type PantryBlockInput } from '@/catalogues/kitchen';
import type { TodayView } from '@/living';
import { BRIEFING_MAX_TOKENS, fitBriefing, type BriefingSection, type FittedBriefing } from '../tools/budget';
import type { CoachBus } from './tools';
import { briefingMarkers } from './markers';

export const BRIEFING_VERSION = 1;

export const MEDICAL_DISCLAIMER =
  'Vitals is education and self-tracking, not medical advice. Never diagnose or prescribe medication. When the safety rules or a danger warning say so, suggest the person sees a clinician, and quote danger warnings word for word.';

export const STATIC_BRIEFING = [
  'You are the Coach inside Vitals, a local-first app that simulates and plans body-composition change (fasting, food, training) with uncertainty bands, and then helps the person live the plan day by day.',
  MEDICAL_DISCLAIMER,
  'How Vitals works: a physiology engine forecasts weight, fat and lean mass; the Planner finds a ladder of plans (rungs); a running plan prescribes each day (eating window, meals, sessions, fasts, steps). Logs are credited by equivalence of stimulus and nutrients, adherence is scored 0–100, drift compares the trend with the forecast, re-plans return proposals with goal-date ranges.',
  'Tools: everything goes through the app\'s commands. read tools only look. log tools apply at once and the person can undo them. Tools that change the plan return a proposal: when a result says pending_user, stop and tell the person what the proposal does (goal-date change included); nothing changes until they apply it. Destructive actions (ending or replacing a plan, deleting) need the person\'s typed confirmation in the app: never ask twice, never claim it is done.',
  'Safety relay rule: when a tool returns safety_blocked, relay the reason in plain words and offer only the allowedAlternatives; never argue around it or retry. You cannot change screening answers, acknowledgements, fasting opt-ins, device sharing, sync, keys, agent permissions or quiet mode, and cannot resume a safety pause. Automatic changes only ever lower load.',
  'Food: pass components with grams (or portions) to log_meal; the app computes energy and nutrients with bands. Never state nutrient numbers yourself except from a label or the person. For a photo, call log_meal_from_photo with its attachmentId; the app shows the person what was seen.',
  'Blood tests: a report the person attaches is read with markers_import; the app shows the rows and the person confirms them, nothing is saved before. Explain results in plain words from the notes; never diagnose.',
  'Units are metric (kg, cm, kcal, g). Dates are YYYY-MM-DD in the person\'s time zone; resolve "tomorrow", "Thursday" against the date below and echo the dates you use.',
  'Use get_* tools for history beyond this briefing (paged: pass the cursor from "more"). Ask before assuming. Style: short, plain words, numbers with their likely range, one suggested action. No name or email is ever sent to you.',
].join('\n');

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

export interface BriefingData {
  /** ISO instant and local date of "now". */
  now: string;
  today: string;
  tz?: string;
  safety?: Rec | null;
  profile?: Rec | null;
  todayView?: TodayView | null;
  goals?: Rec | null;
  /** Entries of the last 7 days (log.get). */
  recentLog?: Rec[] | null;
  adherence?: Rec | null;
  scores?: unknown;
  pending?: Rec[] | null;
  questions?: unknown;
  /** `supplements.get`: stance and rows (taking, at home, not for me) with a one-line summary. */
  supplements?: Rec | null;
  /** `kitchen.get` and `pantry.get` views (SUITE_SPEC §13.3). */
  kitchen?: Rec | null;
  pantry?: Rec | null;
  /** E20: newest confirmed blood test reading per marker, its state and the rule ids of its notes (`markers.get`). */
  markers?: Array<{ id: string; value: number; unit: string; date: string; state: string; notes: string[] }> | null;
}

/** One day of the visible "Last 7 days" (newest first; today comes from `today`). */
export interface VisibleWeekDay {
  date: string;
  score: { score: number | null } | null;
  entries: readonly unknown[];
}

/** What the visible panel needs (the UI's `BriefingInput`). */
export interface VisibleBriefingInput {
  today: TodayView | null;
  /** The days before today that have logs or a score, newest first. */
  week?: VisibleWeekDay[];
  waiting: number;
  provider: { name: string; model: string } | null;
  about: string[];
  ask: string[];
}

export interface BuiltBriefing extends FittedBriefing {
  visible: VisibleBriefingInput;
  /** The safety mode forbids planning (living-mode.md §7.5 "Safety mode without planning"). */
  noPlanning: boolean;
  quiet: boolean;
}

const DROP_KEYS = /^(name|email|displayName|fullName|_.*)$/i;

/** Compact one-line JSON (keys sorted as given, nulls and private fields dropped). */
export function compact(v: unknown, maxChars = 600): string {
  const json = JSON.stringify(v, (k, x) => (DROP_KEYS.test(k) || x === null || (Array.isArray(x) && x.length === 0) ? undefined : typeof x === 'number' && !Number.isInteger(x) ? Math.round(x * 10) / 10 : x)) ?? '';
  return json.length > maxChars ? `${json.slice(0, maxChars - 1)}…` : json;
}

/** The supplements read as a v2 section (null when not answered). */
function supplementsOf(d: Pick<BriefingData, 'supplements'>) {
  const s = d.supplements;
  return s && typeof s.stance === 'string' ? toSectionV2({ _v: 2, stance: s.stance, rows: s.rows }) : null;
}

function aboutLines(d: BriefingData): string[] {
  const out: string[] = [];
  const s = d.safety;
  if (s && typeof s.modeLabel === 'string') out.push(`Safety mode: ${s.modeLabel}${Array.isArray(s.restrictions) && s.restrictions.length ? ` (${(s.restrictions as string[]).join('; ')})` : ''}.`);
  const p = d.profile && isRec(d.profile.profile) ? d.profile.profile : null;
  if (p) {
    const bits: string[] = [];
    if (typeof p.age === 'number') bits.push(`${Math.floor(p.age / 10) * 10}s`);
    if (typeof p.heightCm === 'number') bits.push(`${Math.round(p.heightCm)} cm`);
    if (typeof p.sex === 'string') bits.push(p.sex);
    if (bits.length) out.push(`You: ${bits.join(', ')}.`);
  }
  for (const l of supplementBriefing(supplementsOf(d)).lines) out.push(`${l.charAt(0).toUpperCase()}${l.slice(1)}.`);
  const eq = d.kitchen && Array.isArray(d.kitchen.equipment) ? d.kitchen.equipment.length : 0;
  const home = d.pantry && Array.isArray(d.pantry.items) ? d.pantry.items.length : 0;
  if (eq || home) out.push(`Kitchen: ${eq} ${eq === 1 ? 'piece' : 'pieces'} of equipment, ${home} ${home === 1 ? 'item' : 'items'} at home.`);
  if (d.markers?.length) out.push(`Blood test results: ${d.markers.length} marker${d.markers.length === 1 ? '' : 's'}, newest ${d.markers.map((m) => m.date).sort().at(-1)}.`);
  return out;
}

function questionsOf(q: unknown): string[] {
  const list = Array.isArray(q) ? q : isRec(q) && Array.isArray(q.questions) ? q.questions : isRec(q) && Array.isArray(q.missingFields) ? q.missingFields : [];
  return list
    .map((x) => (typeof x === 'string' ? x : isRec(x) ? String(x.text ?? x.prompt ?? x.question ?? x.id ?? '') : ''))
    .filter(Boolean)
    .slice(0, 6);
}

/** The visible week before `today` (6 days): days with logs or a score, newest first, from the same reads. */
export function visibleWeek(d: Pick<BriefingData, 'today' | 'recentLog' | 'adherence'>, addDays: (d: string, n: number) => string): VisibleWeekDay[] {
  const from = addDays(d.today, -6);
  const byDay = new Map<string, Rec[]>();
  for (const e of d.recentLog ?? []) {
    const date = typeof e.date === 'string' ? e.date : typeof e.localDate === 'string' ? e.localDate : null;
    if (date && date >= from && date < d.today) byDay.set(date, [...(byDay.get(date) ?? []), e]);
  }
  const scores = new Map<string, number | null>();
  const days = isRec(d.adherence) && Array.isArray(d.adherence.days) ? d.adherence.days : [];
  for (const x of days) if (isRec(x) && typeof x.date === 'string' && x.date >= from && x.date < d.today) scores.set(x.date, typeof x.score === 'number' ? x.score : null);
  const out: VisibleWeekDay[] = [];
  for (let i = 1; i <= 6; i++) {
    const date = addDays(d.today, -i);
    const entries = byDay.get(date) ?? [];
    const score = scores.get(date) ?? null;
    if (entries.length || score !== null) out.push({ date, score: { score }, entries });
  }
  return out;
}

function logLines(entries: Rec[]): string {
  const byDay = new Map<string, string[]>();
  for (const e of entries) {
    const date = typeof e.date === 'string' ? e.date : typeof e.localDate === 'string' ? e.localDate : '?';
    const kind = typeof e.kind === 'string' ? e.kind : typeof e.type === 'string' ? e.type : 'entry';
    const label = typeof e.text === 'string' ? `${kind} "${e.text.slice(0, 60)}"` : kind;
    byDay.set(date, [...(byDay.get(date) ?? []), label]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, items]) => `${date}: ${items.slice(0, 8).join(', ')}${items.length > 8 ? ` (+${items.length - 8})` : ''}`)
    .join('\n');
}

/** Pure: sections → fitted text (≤ `max` tokens) and the visible panel input. */
export function buildBriefing(d: BriefingData, opts: { provider?: { name: string; model: string } | null; max?: number; addDays?: (d: string, n: number) => string } = {}): BuiltBriefing {
  const sections: BriefingSection[] = [];
  const quiet = !!d.todayView?.quietMode;
  const noPlanning = d.safety?.plannerAccess === 'blocked';
  sections.push({ id: 'static', priority: 100, text: STATIC_BRIEFING });
  sections.push({
    id: 'date',
    priority: 95,
    text: `Now: ${d.now} · today ${d.today}${d.tz ? ` · time zone ${d.tz}` : ''}${d.todayView ? ` · day rolls over at ${d.todayView.rolloverH}:00` : ''}.`,
  });
  if (d.safety) {
    const s = d.safety;
    sections.push({
      id: 'safety',
      priority: 90,
      text: [
        `Safety: mode ${String(s.modeLabel ?? s.mode ?? 'unknown')}; planner ${String(s.plannerAccess ?? '?')}; longest fast allowed ${String(s.maxFastHours ?? '?')} h${s.fastingTier ? ` (tier ${String(s.fastingTier)})` : ''}.`,
        Array.isArray(s.restrictions) && s.restrictions.length ? `Restrictions: ${(s.restrictions as string[]).join('; ')}.` : '',
        noPlanning ? 'In this safety mode you explain and log but cannot change the plan.' : '',
        quiet ? 'Quiet mode: no calorie talk, no weight-loss suggestions, no numeric scores.' : '',
      ].filter(Boolean).join('\n'),
    });
  }
  const v = d.todayView;
  if (v) {
    const lines: string[] = [];
    if (v.plan) lines.push(`Plan: ${v.plan.name} (rung ${v.plan.rung}), day ${v.plan.day} of ${v.plan.of}, ${v.plan.status}, version ${v.plan.version}.`);
    else lines.push('No plan is running.');
    if (v.prescription) lines.push(`Today prescribes: ${compact(v.prescription, 900)}`);
    lines.push(`Logged today: ${compact({ totals: quiet ? undefined : v.logged.totals, items: v.logged.items, fast: v.logged.fast, steps: v.logged.steps, sleepHours: v.logged.sleepHours }, 500)}`);
    if (v.remaining && !quiet) lines.push(`Remaining today: ${compact(v.remaining)}`);
    if (!quiet) lines.push(`Adherence: today ${v.adherence.today?.score ?? '—'}, 7-day ${v.adherence.a7 ?? '—'}, 28-day ${v.adherence.a28 ?? '—'}, ${v.adherence.daysLogged7} of 7 days logged.`);
    if (v.drift?.length) lines.push(`Drift: ${v.drift.map((g) => `${g.metric} ${g.state}${g.goalDate.range ? `, goal date likely ${g.goalDate.range[0]}–${g.goalDate.range[1]}` : ''}`).join('; ')}.`);
    if (v.trendWeight && !quiet) lines.push(`Trend weight ${v.trendWeight.kg.toFixed(1)} kg (±${v.trendWeight.sd.toFixed(1)}).`);
    const flags = v.biometrics?.flags ?? [];
    if (flags.length) lines.push(`Body-signal flags: ${flags.map((f) => `${f.level}: ${f.text}`).join('; ')}`);
    const danger = v.notices.filter((n) => n.level === 'danger');
    if (danger.length) lines.push(`Danger warnings (quote verbatim): ${danger.map((n) => n.text).join(' | ')}`);
    sections.push({ id: 'plan', priority: 80, text: lines.join('\n') });
  }
  if (d.profile) sections.push({ id: 'profile', priority: 70, text: `Profile: ${compact({ profile: d.profile.profile, estimate: d.profile.estimate, complete: d.profile.complete }, 900)}` });
  if (d.goals) sections.push({ id: 'goals', priority: 60, text: `Goals: ${compact(d.goals, 700)}` });
  const supp = supplementBriefing(supplementsOf(d)).text;
  if (supp) sections.push({ id: 'supplements', priority: 58, text: supp });
  // E20: blood markers (≤ 300 tokens ≈ 1 100 characters)
  if (d.markers?.length) sections.push({ id: 'markers', priority: 58, text: `Blood tests (newest per marker; state in/above/below range, old = over 12 months, not planned on; notes = rules that fire): ${compact(d.markers, 1100)}` });
  if (d.pending?.length) {
    sections.push({ id: 'pending', priority: 55, text: `Proposals waiting for the person: ${d.pending.map((p) => `${String(p.commandId)} (${String(p.pendingId)})`).join(', ')}.` });
  }
  sections.push({ id: 'kitchen', priority: 45, text: kitchenSection(d.kitchen ?? null, d.pantry ?? null) });
  if (d.recentLog?.length) sections.push({ id: 'recent', priority: 40, text: `Last 7 days of logs:\n${logLines(d.recentLog)}` });
  if (d.adherence) sections.push({ id: 'scores', priority: 30, text: `Adherence detail: ${compact(d.adherence, 700)}` });
  if (d.scores !== undefined && d.scores !== null) sections.push({ id: 'bio', priority: 25, text: `Body-signal scores: ${compact(d.scores, 600)}` });
  const ask = questionsOf(d.questions);
  if (ask.length) sections.push({ id: 'ask', priority: 20, text: `Still to ask (one at a time, when it fits): ${ask.join(' | ')}` });

  const fitted = fitBriefing(sections, opts.max ?? BRIEFING_MAX_TOKENS);
  return {
    ...fitted,
    noPlanning,
    quiet,
    visible: { today: v ?? null, ...(opts.addDays ? { week: visibleWeek(d, opts.addDays) } : {}), waiting: d.pending?.length ?? 0, provider: opts.provider ?? null, about: aboutLines(d), ask },
  };
}

/** How the Coach records what the person has at home: the same documents the picker and the Food tab write. */
export const KITCHEN_RULE =
  'When the person says they have food at home ("right now I have…"), record it with pantry_add (pantry_parse_list first for a long list); for equipment ("I also have a soda maker") use kitchen_add. Both apply at once with undo: confirm in one line. Ask "still have it?" only when a recipe depends on an item in askStillHave; never remove items yourself unless the person says they are gone (pantry_remove).';

function kitchenSection(kitchen: Rec | null, pantry: Rec | null): string {
  const k = kitchen && Array.isArray(kitchen.equipment) ? (kitchen as unknown as KitchenBlockInput) : null;
  const p = pantry && Array.isArray(pantry.items) ? (pantry as unknown as PantryBlockInput) : null;
  const block = kitchenBlockFromViews(k ?? { equipment: [], cuisines: [], staples: [] }, p ?? { items: [] });
  const stale = new Set(pantry && Array.isArray(pantry.askStillHave) ? (pantry.askStillHave as unknown[]) : []);
  const staleLabels = (p?.items ?? []).filter((i) => stale.has((i as { id?: unknown }).id)).map((i) => i.label).slice(0, 10);
  const ask = staleLabels.length ? `Not confirmed for 2 weeks (ask only if a recipe needs them): ${staleLabels.join(', ')}.` : '';
  return [block ?? 'Kitchen: not told yet (equipment, cuisines, staples, what is at home).', ask, KITCHEN_RULE].filter(Boolean).join('\n');
}

function outputOf(r: Awaited<ReturnType<CoachBus['dispatch']>>): unknown {
  return r.ok && 'output' in r ? r.output : null;
}

const AI_READ = { kind: 'ai' as const, id: 'coach-briefing' };
let gathers = 0;

/** Reads the briefing's data through read commands (as the `ai` actor, so the same surface rules apply). */
export async function gatherBriefingData(bus: CoachBus, now: Date, localToday: string, addDays: (d: string, n: number) => string): Promise<BriefingData> {
  // one correlation id per gather: the bus counts agent calls per turn by it
  const correlationId = `briefing-${now.getTime()}-${++gathers}`;
  const read = async (id: string, input: unknown = {}): Promise<unknown> => {
    try {
      return bus.getCommand(id) ? outputOf(await bus.dispatch(id, input, { actor: AI_READ, correlationId })) : null;
    } catch {
      return null;
    }
  };
  const [safety, profile, todayView, goals, recentLog, adherence, pending, questions, scores, supplements, kitchen, pantry, markers] = await Promise.all([
    read('safety.status'),
    read('profile.get'),
    read('today.get'),
    read('goals.get'),
    read('log.get', { from: addDays(localToday, -7), to: addDays(localToday, -1) }),
    read('plan.adherence', { from: addDays(localToday, -28), to: localToday }),
    read('coach.pending'),
    read('intake.nextQuestions'),
    read('bio.scores', { from: addDays(localToday, -7), to: localToday }),
    read('supplements.get'),
    read('kitchen.get'),
    read('pantry.get'),
    read('markers.get'),
  ]);
  let tz: string | undefined;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    tz = undefined;
  }
  const tv = isRec(todayView) && 'date' in todayView ? (todayView as unknown as TodayView) : null;
  return {
    now: now.toISOString(),
    today: localToday,
    ...(tz ? { tz } : {}),
    safety: isRec(safety) ? safety : null,
    profile: isRec(profile) ? profile : null,
    todayView: tv,
    goals: isRec(goals) ? goals : null,
    recentLog: Array.isArray(recentLog) ? (recentLog.filter(isRec)) : null,
    adherence: isRec(adherence) ? adherence : null,
    pending: Array.isArray(pending) ? pending.filter(isRec) : null,
    questions,
    scores,
    supplements: isRec(supplements) ? supplements : null,
    kitchen: isRec(kitchen) ? kitchen : null,
    pantry: isRec(pantry) ? pantry : null,
    markers: briefingMarkers(markers),
  };
}
