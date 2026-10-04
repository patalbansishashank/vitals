/**
 * Change cards from command results (SUITE_SPEC §5.5; living-mode.md §7.2–§7.3). Numbers on cards come from the
 * command outputs (the app's estimates), never from the model. Output shapes are read tolerantly: the executors of
 * `log.meal`, `log.mealFromPhoto`, `plan.shift` … are other packages' and only their documented fields are used.
 */
import { SERIES } from '@/engine/types/metrics';
import type { CardModel, CardView, MealCard, MealComponentCard } from './types';
import { dateText, describeInput, localDateOf, plainValue, words } from './describe';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : isRec(v) && typeof v.value === 'number' ? v.value : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : undefined);

const fmt = (n: number, d = 0) => (d ? n.toFixed(d) : String(Math.round(n)));

function clockText(h: number | undefined): string | null {
  if (h === undefined) return null;
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** "a thing" → "A thing". */
const upper = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** Low/high of an estimate: explicit bounds, or ±1.645 sd (90 %). */
function band(v: unknown): [number, number] | null {
  if (!isRec(v)) return null;
  const lo = num(v.low ?? v.lo ?? v.p10);
  const hi = num(v.high ?? v.hi ?? v.p90);
  if (lo !== undefined && hi !== undefined) return [lo, hi];
  const value = num(v.value);
  const sd = num(v.sd);
  if (value !== undefined && sd !== undefined) return [Math.max(0, value - 1.645 * sd), value + 1.645 * sd];
  return null;
}

const round10 = (n: number) => Math.round(n / 10) * 10;

/** "≈ 640 kcal (510–780) · protein 33 g (25–41)" from a totals object. */
export function totalsLine(totals: unknown, quiet = false): string | undefined {
  if (!isRec(totals)) return undefined;
  const parts: string[] = [];
  const e = num(totals.energyKcal ?? totals.kcal);
  const eb = band(totals.energyKcal);
  if (e !== undefined && !quiet) parts.push(`≈ ${fmt(round10(e))} kcal${eb ? ` (${fmt(round10(eb[0]))}–${fmt(round10(eb[1]))})` : ''}`);
  const p = num(totals.proteinG ?? totals.protein);
  const pb = band(totals.proteinG);
  if (p !== undefined) parts.push(`protein ${fmt(p)} g${pb ? ` (${fmt(pb[0])}–${fmt(pb[1])})` : ''}`);
  return parts.length ? parts.join(' · ') : undefined;
}

function portionText(p: unknown): string | undefined {
  if (typeof p === 'string') return p;
  if (isRec(p) && typeof p.unit === 'string') return `${num(p.count) ?? 1} ${p.unit}`;
  return undefined;
}

const kcalOf = (c: Rec): number | undefined => num(c.energyKcal ?? c.kcal ?? (isRec(c.nutrients) ? c.nutrients.energyKcal : undefined));

function mealComponents(list: unknown, fallbackInput?: unknown): MealComponentCard[] {
  const src = Array.isArray(list) ? list : isRec(fallbackInput) && Array.isArray(fallbackInput.components) ? fallbackInput.components : [];
  return src.filter(isRec).map((c, i) => {
    const grams = num(c.grams) ?? 0;
    const yours = c.yours === true || c.userGrams === true;
    return {
      id: str(c.id) ?? str(c.foodId) ?? `c${i + 1}`,
      name: str(c.name) ?? str(c.localName) ?? `item ${i + 1}`,
      ...(portionText(c.portion) ? { portion: portionText(c.portion)! } : {}),
      grams,
      gramsLow: yours ? grams : (num(c.gramsLow) ?? grams),
      gramsHigh: yours ? grams : (num(c.gramsHigh) ?? grams),
      ...(kcalOf(c) !== undefined ? { kcal: Math.round(kcalOf(c)!) } : {}),
      ...(yours ? { yours: true } : {}),
    };
  });
}

function amountOf(c: MealComponentCard, quiet: boolean): string {
  const g = c.yours || c.gramsLow === c.gramsHigh ? `${fmt(c.grams)} g` : `${c.portion ? `${c.portion} ≈ ` : '≈ '}${fmt(c.grams)} g (${fmt(c.gramsLow)}–${fmt(c.gramsHigh)})`;
  return c.kcal !== undefined && !quiet ? `${g} · ${fmt(c.kcal)} kcal` : g;
}

export interface MealMeta {
  slot?: string;
  clockH?: number;
  photo?: { url: string; alt: string };
}

const METHOD_LABEL: Record<string, string> = {
  aiText: 'Coach · text',
  aiPhoto: 'Coach · photo',
  aiPhotoUserGrams: 'Coach · photo + your grams',
  typed: 'Coach · your numbers',
  label: 'Coach · from the label',
  asPlanned: 'Coach · as planned',
};

/** A meal log card ("Logged lunch · 13:10", or "What I saw" for photos) from `log.meal` / `log.mealFromPhoto` output. */
export function mealCard(id: string, output: unknown, input: unknown, opts: { createdAt: string; state: CardModel['state']; meta?: MealMeta; quiet?: boolean; fromPhoto?: boolean }): CardView {
  const out = isRec(output) ? output : {};
  const inp = isRec(input) ? input : {};
  const entry = isRec(out.entry) ? out.entry : {};
  const comps = mealComponents(out.components ?? entry.components, input);
  const slot = str(out.slot) ?? str(entry.slot) ?? str(inp.slot) ?? opts.meta?.slot ?? 'meal';
  const when = clockText(num(out.clockH) ?? num(entry.clockH) ?? num(inp.clockH) ?? opts.meta?.clockH);
  const method = str(out.method) ?? str(entry.method) ?? str(inp.method) ?? (opts.fromPhoto ? 'aiPhoto' : 'aiText');
  const confidence = num(out.confidence) ?? num(entry.confidence) ?? num(inp.confidence);
  const bandText = str(out.band) ?? str(out.bandText);
  const saw = str(out.saw);
  const meal: MealCard = {
    components: comps,
    ...(opts.meta?.photo ? { photo: { url: opts.meta.photo.url, alt: saw ? `What the Coach saw: ${saw}` : opts.meta.photo.alt } } : {}),
    ...(str(out.cue) ? { cue: str(out.cue)! } : {}),
    ...(strs(out.referenceObjects ?? out.sawObjects) ? { saw: strs(out.referenceObjects ?? out.sawObjects)! } : saw && opts.fromPhoto ? { saw: [saw] } : {}),
    ...(strs(out.unseen ?? out.uncertainties) ? { unseen: strs(out.unseen ?? out.uncertainties)! } : {}),
    ...(opts.fromPhoto && opts.state === 'applied' ? { review: true } : {}),
    ...(isRec(out.ask) && typeof out.ask.question === 'string' && Array.isArray(out.ask.options) ? { ask: out.ask as unknown as NonNullable<MealCard['ask']> } : {}),
  };
  const pending = opts.state === 'pending';
  const question = str(out.question);
  return {
    id,
    class: 'log',
    title: pending ? `${upper(slot)}${when ? ` · ${when}` : ''} · not logged yet` : `Logged ${slot}${when ? ` · ${when}` : ''}`,
    source: { label: METHOD_LABEL[method] ?? 'Coach', ...(confidence !== undefined ? { confidence } : {}), ...(bandText ? { band: bandText } : {}) },
    createdAt: opts.createdAt,
    items: comps.map((c) => ({ label: c.name, before: null, after: amountOf(c, !!opts.quiet) })),
    ...(totalsLine(out.totals ?? entry.totals ?? out.estimate, opts.quiet) ? { totals: totalsLine(out.totals ?? entry.totals ?? out.estimate, opts.quiet)! } : {}),
    ...(question ? { note: question } : {}),
    state: opts.state,
    meal,
  };
}

/** Plain-language value for a card row (no field names, no JSON). */
const show = plainValue;

/** Share of the prescribed stimulus a swap or session keeps: `plan.swapExercise` (weekly mean, else the day's), `log.session`. */
function creditOf(out: Rec): number | undefined {
  if (isRec(out.weekly) && num(out.weekly.meanCredit) !== undefined) return num(out.weekly.meanCredit);
  if (isRec(out.equivalence)) return num(out.equivalence.credit);
  return num(out.equivalence ?? out.credit ?? out.similarity);
}

/** `plan.swapExercise`: the day, the stimulus it keeps and its own sentence (no exercise ids or slot keys). */
function swapCard(id: string, title: string, input: unknown, out: Rec, opts: { createdAt: string; state: CardModel['state'] }): CardView {
  const inp = isRec(input) ? input : {};
  const credit = creditOf(out);
  const proposed = out.status === 'proposed' && typeof out.cardId === 'string';
  const notes = strs(out.notes) ?? [];
  return {
    id,
    class: 'log',
    title: out.everyWeek === true ? `${title} · every week` : title,
    source: { label: 'Coach' },
    createdAt: opts.createdAt,
    items: [
      ...(str(inp.date) ? [{ label: out.everyWeek === true ? 'from' : 'date', before: null, after: str(inp.date)! }] : []),
      ...(credit !== undefined ? [{ label: 'stimulus kept', before: null, after: `${Math.round(credit * 100)} %` }] : []),
    ],
    ...(notes.length || proposed ? { note: [...notes.slice(0, 2), ...(proposed ? ['A proposal is waiting on Today; nothing changes until it is applied.'] : [])].join(' ') } : {}),
    state: opts.state,
  };
}

/** A generic applied log card (`log.session`, `log.measurement`, `plan.swapExercise` …). */
export function logCard(id: string, title: string, input: unknown, output: unknown, opts: { createdAt: string; state: CardModel['state']; summary?: string; commandId?: string }): CardView {
  const out = isRec(output) ? output : {};
  if (isRec(out.swap) && isRec(out.equivalence)) return swapCard(id, title, input, out, opts);
  // Q4-13: every change in plain words ("Lose 6 kg of fat in 90 days"), never op or field names
  const items: CardModel['items'] = describeInput(opts.commandId ?? '', input, localDateOf(opts.createdAt)).slice(0, 8);
  const equiv = creditOf(out);
  if (equiv !== undefined) items.push({ label: 'stimulus match', before: null, after: `${Math.round(equiv <= 1 ? equiv * 100 : equiv)} %` });
  return {
    id,
    class: 'log',
    title: opts.state === 'pending' ? `${title} · not logged yet` : title,
    source: { label: 'Coach' },
    createdAt: opts.createdAt,
    items,
    ...(opts.summary ? { note: opts.summary } : {}),
    state: opts.state,
  };
}

function pairOf(v: unknown): [string, string] | null {
  if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string') return [v[0], v[1]];
  if (typeof v === 'string') return [v, v];
  return null;
}

/** Edit-card impact from a re-plan proposal (`goalDates`, `impact`/metrics) wherever it sits in the preview. */
export function impactOf(preview: unknown): CardModel['impact'] | undefined {
  const p = isRec(preview) ? (isRec(preview.proposal) ? preview.proposal : preview) : null;
  if (!p) return undefined;
  const goalDates: NonNullable<CardModel['impact']>['goalDates'] = [];
  if (Array.isArray(p.goalDates)) {
    for (const g of p.goalDates.filter(isRec)) {
      const label = str(g.label) ?? (typeof g.goal === 'number' ? (g.goal === 0 ? 'goal date' : `goal ${g.goal + 1} date`) : 'goal date');
      const before = pairOf(g.beforeRange ?? g.before);
      const after = pairOf(g.range ?? g.afterRange ?? g.after);
      goalDates.push({ label, before, after: Array.isArray(g.after) ? pairOf(g.after) : after });
    }
  }
  const metrics: NonNullable<CardModel['impact']>['metrics'] = [];
  const imp = Array.isArray(p.impact) ? p.impact : Array.isArray(p.metrics) ? p.metrics : [];
  for (const m of imp.filter(isRec)) {
    const delta = num(m.endP50Delta ?? m.delta);
    if (delta === undefined) continue;
    const metric = str(m.label) ?? str(m.metric) ?? 'change';
    // a metric id (`fatMass`) reads as its name ("fat mass by the end"), never as the id
    const series = SERIES.find((x) => x.id === metric);
    const label = metric === 'weight' || metric === 'scaleWeight' ? 'weight by the end' : series ? `${lower(series.label)} by the end` : metric;
    metrics.push({ label, delta, unit: str(m.unit) ?? series?.unit ?? (/weight|mass/i.test(metric) ? 'kg' : ''), decimals: 1 });
  }
  return goalDates.length || metrics.length ? { goalDates, metrics } : undefined;
}

/** Diff rows of a proposal (`diff[{date, field, before, after}]`) or of the staged documents. */
function diffItems(preview: unknown, input: unknown, commandId: string, today: string | undefined): CardModel['items'] {
  const p = isRec(preview) ? (isRec(preview.proposal) ? preview.proposal : preview) : null;
  const rows = p && Array.isArray(p.diff) ? p.diff.filter(isRec) : [];
  if (rows.length) {
    return rows.slice(0, 12).map((r) => ({ label: [str(r.date) ? dateText(r.date, today) : undefined, str(r.field) ? words(str(r.field)!) : undefined].filter(Boolean).join(' · ') || 'change', before: r.before === undefined ? null : show(r.before), after: r.after === undefined ? null : show(r.after) }));
  }
  return describeInput(commandId, input, today).slice(0, 8);
}

/** Where the device's own value for a correction target comes from (hours / steps / kg); the app registers it at start. */
type DeviceLookup = (kind: 'sleep' | 'steps' | 'weight', date: string) => number | null;
let deviceLookup: DeviceLookup = () => null;
export function setCorrectionDeviceLookup(fn: DeviceLookup): void {
  deviceLookup = fn;
}
const deviceValueOf = (kind: 'sleep' | 'steps' | 'weight', date: string): number | null => {
  try {
    return deviceLookup(kind, date);
  } catch {
    return null;
  }
};

/** "Correct your sleep for 2 Oct: Device 5 h 10 min → Yours 6 h 00 min" (a staged `biometrics.correct`). */
function correctionProposal(id: string, input: unknown, preview: unknown, opts: { createdAt: string; until?: string }): CardView | null {
  if (!isRec(input) || !isRec(input.target) || !isRec(input.value)) return null;
  const t = input.target;
  const v = input.value;
  const date = str(t.localDate);
  const kind = t.kind === 'sleep' ? 'sleep' : t.metric === 'steps' ? 'steps' : t.metric === 'weight_kg' ? 'weight' : null;
  if (!date || !kind) return null;
  const mine = kind === 'sleep' ? num(v.asleepS) : kind === 'steps' ? num(isRec(v.fields) ? v.fields.steps : undefined) : num(v.value);
  if (mine === undefined) return null;
  const show = (n: number | null) => {
    if (n === null) return 'no reading';
    if (kind === 'steps') return Math.round(n).toLocaleString('en-US');
    if (kind === 'weight') return `${n.toFixed(1)} kg`;
    const m = Math.round(n * 60);
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  };
  const pv = isRec(preview) ? num(preview.deviceValue) : undefined;
  const device = pv ?? deviceValueOf(kind, date);
  const yours = show(kind === 'sleep' ? mine / 3600 : mine);
  const when = dateText(date, localDateOf(opts.createdAt));
  const note = str(input.note);
  return {
    id,
    class: 'edit',
    title: `Correct your ${kind} for ${when}: Device ${show(device)} → Yours ${yours}`,
    source: { label: 'Coach · proposal' },
    createdAt: opts.createdAt,
    ...(opts.until ? { until: opts.until } : {}),
    items: [{ label: kind, before: `Device ${show(device)}`, after: `Yours ${yours}` }],
    impact: { goalDates: [], metrics: [] },
    ...(note ? { note } : {}),
    state: 'pending',
  };
}

/** A proposal card (`edit`). */
export function proposalCard(id: string, title: string, input: unknown, preview: unknown, opts: { createdAt: string; until?: string; summary?: string; commandId?: string }): CardView {
  if (opts.commandId === 'biometrics.correct') {
    const c = correctionProposal(id, input, preview, opts);
    if (c) return c;
  }
  const impact = impactOf(preview) ?? { goalDates: [], metrics: [] };
  const notes = isRec(preview) && Array.isArray(preview.notes) ? strs(preview.notes) : isRec(preview) && Array.isArray(preview.explanation) ? strs(preview.explanation) : undefined;
  return {
    id,
    class: 'edit',
    title: `Proposal · ${lower(title)}`,
    source: { label: 'Coach · proposal' },
    createdAt: opts.createdAt,
    ...(opts.until ? { until: opts.until } : {}),
    items: diffItems(preview, input, opts.commandId ?? '', localDateOf(opts.createdAt)),
    impact,
    ...(notes?.length ? { note: notes.slice(0, 2).join(' ') } : opts.summary ? { note: opts.summary } : {}),
    state: 'pending',
  };
}

/** Typed-confirmation word and wording per destructive command (the page completes `end` itself). */
const CONFIRM: Record<string, { word: string; actionLabel: string; consequence: string }> = {
  'plan.end': { word: 'end', actionLabel: 'End plan', consequence: 'Ends the plan today. Logs and versions are kept; you can restore it for 7 days.' },
  'plan.replace': { word: 'replace', actionLabel: 'Replace plan', consequence: 'Ends the running plan and starts the new one. Logs and versions are kept.' },
};

export function destructiveCard(id: string, commandId: string, title: string, planName: string | null, createdAt: string): CardView {
  const c = CONFIRM[commandId] ?? { word: 'confirm', actionLabel: title, consequence: `${title}. This can't be undone from the conversation.` };
  return {
    id,
    class: 'destructive',
    title: commandId === 'plan.end' ? `end ${planName ?? 'your plan'}` : lower(title),
    createdAt,
    items: [],
    confirm: c,
    state: 'pending',
  };
}

export function blockedCard(id: string, title: string, rule: string, alternatives: string[], createdAt: string): CardView {
  return {
    id,
    class: 'blocked',
    title: lower(title),
    createdAt,
    items: [],
    blocked: { rule, alternatives: alternatives.map((a) => ({ id: a, label: ALTERNATIVE_LABEL[a] ?? a })) },
    state: 'applied',
  };
}

const ALTERNATIVE_LABEL: Record<string, string> = {
  'nav.open': 'Open it in the app',
  'sim.whatIf': 'Try it in a what-if',
  'scenario.edit': 'Edit a scenario instead',
};

export function uiOnlyCard(id: string, title: string, to: string, createdAt: string): CardView {
  return { id, class: 'uiOnly', title: lower(title), createdAt, items: [], setting: { label: 'Open Settings', to }, state: 'applied' };
}

export function readCard(id: string, reads: Array<{ label: string; summary?: string }>, createdAt: string): CardModel {
  return { id, class: 'read', title: reads.map((r) => r.label).join(' · '), createdAt, items: [], reads, state: 'applied' };
}
