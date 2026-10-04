/**
 * Plain words for a command's input on a Coach change card (Q4-13): "Lose 6 kg of fat in 90 days", "Start the Hard
 * plan today". No field names, op names or ids reach the card; a command or op without its own sentence falls back to
 * a generic plain row (field names split into words, ids left out), never JSON.
 */
import { SERIES } from '@/engine/types/metrics';
import type { CardModel } from './types';

type Rec = Record<string, unknown>;
type Items = CardModel['items'];
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const upper = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const row = (label: string, after: string): Items[number] => ({ label, before: null, after });

/* ------------------------------------------------------------------------------------------------ words */

/** "fatMass" → "fat mass", "barbell-back_squat" → "barbell back squat". */
export function words(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WD_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The local calendar date of an instant (YYYY-MM-DD). */
export function localDateOf(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;

/** "today", "tomorrow", "5 Oct" (this year) or "5 Oct 2027". */
export function dateText(d: unknown, today?: string): string {
  const s = str(d);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s ?? 'a date';
  if (today) {
    const diff = dayNumber(s) - dayNumber(today);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
  }
  const text = `${+s.slice(8, 10)} ${MONTHS[+s.slice(5, 7) - 1]}`;
  return today && today.slice(0, 4) === s.slice(0, 4) ? text : `${text} ${s.slice(0, 4)}`;
}

/** "on 5 Oct" / "today". */
const onDate = (d: unknown, today?: string) => {
  const t = dateText(d, today);
  return t === 'today' || t === 'tomorrow' || t === 'yesterday' ? t : `on ${t}`;
};

function clock(h: unknown): string | undefined {
  const n = num(h);
  if (n === undefined) return undefined;
  const hh = Math.floor(n);
  const mm = Math.round((n - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function range(v: unknown): string | undefined {
  if (!Array.isArray(v) || num(v[0]) === undefined || num(v[1]) === undefined) return undefined;
  const [a, b] = [v[0] as number, v[1] as number];
  return a === b ? fmtNum(a) : `${fmtNum(a)}–${fmtNum(b)}`;
}

const weekdayList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && x >= 0 && x <= 6).map((x) => WD_SHORT[x]).join(', ') : undefined);

/* ------------------------------------------------------------------------------------------------ goals.edit */

/** Short nouns for the common goal metrics ("Lose 6 kg of fat"); others use the metric's own name. */
const METRIC_NOUN: Record<string, string> = {
  fatMass: 'fat',
  scaleWeight: 'weight',
  weight: 'weight',
  leanTissue: 'lean tissue',
  leanMass: 'lean mass',
  bodyFatPct: 'body fat',
};

function metricOf(id: unknown): { noun: string; unit: string } {
  const s = str(id) ?? '';
  const def = SERIES.find((x) => x.id === s);
  const noun = METRIC_NOUN[s] ?? (def ? def.label.replace(/\s*\(.*\)\s*$/, '').replace(/^[A-Z][a-z]/, (m) => m.toLowerCase()) : words(s) || 'a measure');
  return { noun, unit: def?.unit ?? (/weight|mass/i.test(s) ? 'kg' : '') };
}

const amountText = (amount: number, unit: string) => `${fmtNum(Math.abs(amount))}${unit ? ` ${unit === '%' ? '% points' : unit}` : ''}`;

/** "Lose 6 kg of fat", "Keep lean tissue", "Raise VO₂max by 3 mL/kg/min", "Bring weight to 80 kg". */
export function goalSentence(goal: Rec, days?: number): string {
  const { noun, unit } = metricOf(goal.metric);
  const amount = num(goal.amount);
  const mode = str(goal.mode) ?? 'reach';
  let s: string;
  if (mode === 'lose' || mode === 'gain') s = amount ? `${upper(mode)} ${amountText(amount, unit)} of ${noun}` : `${upper(mode)} ${noun}`;
  else if (mode === 'keep') s = `Keep ${noun} where it is`;
  else if (mode === 'raise' || mode === 'lower') s = amount ? `${upper(mode)} ${noun} by ${amountText(amount, unit)}` : `${upper(mode)} ${noun}`;
  else s = amount !== undefined ? `Bring ${noun} to ${amountText(amount, unit)}` : `Set a target for ${noun}`;
  if (days !== undefined) s += ` in ${fmtNum(days)} days`;
  if (goal.strength === 'must') s += ' (a must)';
  if (goal.strength === 'nice') s += ' (nice to have)';
  if (goal.functional === 'mean') s += ', on average over the plan';
  return s;
}

/** A goal key reads as its metric ("the fat goal") when it is one, else "a goal". */
const goalRef = (key: unknown) => {
  const s = str(key);
  return s && (SERIES.some((x) => x.id === s) || METRIC_NOUN[s]) ? `the ${metricOf(s).noun} goal` : 'a goal';
};

const LIMIT: Record<string, (v: unknown) => string | undefined> = {
  trainingDays: (v) => (range(v) ? `Strength training ${range(v)} days a week` : undefined),
  trainingWeekdays: (v) => (weekdayList(v) ? `Train on ${weekdayList(v)}` : 'Train on any day'),
  trainingTimeH: (v) => (clock(v) ? `Train around ${clock(v)}` : undefined),
  maxSessionMin: (v) => (num(v) !== undefined ? `Sessions up to ${fmtNum(num(v)!)} min` : undefined),
  cardioDays: (v) => (range(v) ? `Cardio ${range(v)} days a week` : undefined),
  cardioModality: (v) => (str(v) ? `Cardio by ${words(str(v)!)}` : undefined),
  earliestH: (v) => (clock(v) ? `First meal no earlier than ${clock(v)}` : undefined),
  latestH: (v) => (clock(v) ? `Last meal no later than ${clock(v)}` : undefined),
  mealsPerDay: (v) => (range(v) ? `${range(v)} meals a day` : undefined),
  steps: (v) => (range(v) ? `${range(v)} steps a day` : undefined),
  longestFastH: (v) => (num(v) !== undefined ? `Longest fast ${fmtNum(num(v)!)} h` : undefined),
  prefersFasting: (v) => (v === true ? 'Fasting can be part of the plan' : 'Leave fasting out of the plan'),
  excluded: (v) => (Array.isArray(v) && v.length ? `Leave out ${v.length} option${v.length === 1 ? '' : 's'} you refused` : 'Nothing left out'),
  proteinFloor: (v) => (num(v) !== undefined ? `At least ${fmtNum(num(v)!)} g protein per kg a day` : 'Protein at the evidence minimum'),
  carbFloorG: (v) => (num(v) ? `At least ${fmtNum(num(v)!)} g carbohydrate a day` : 'No carbohydrate floor'),
  sleepFixed: (v) => (v === true ? 'Keep sleep as it is' : 'Sleep can be part of the plan'),
  hungerTolerance: (v) => (str(v) ? `Hunger tolerance ${str(v)}` : undefined),
};

const STRICTNESS: Record<string, string> = {
  strict: 'Hold every goal strictly',
  balanced: 'Balance the goals against each other',
  flexible: 'Keep the goals flexible',
};

function goalOpItems(op: Rec, today?: string, days?: number): Items {
  switch (op.op) {
    case 'add':
      return [row('goal', isRec(op.goal) ? goalSentence(op.goal, days) : 'Add a goal')];
    case 'remove':
      return [row('goal', `Remove ${goalRef(op.key)}`)];
    case 'move': {
      const to = num(op.to);
      return [row('goal order', num(op.from) !== undefined && to !== undefined ? `Move goal ${num(op.from)! + 1} to place ${Math.max(1, to + 1)}` : 'Reorder the goals')];
    }
    case 'update': {
      const p = isRec(op.patch) ? op.patch : {};
      const ref = goalRef(op.key);
      const parts: string[] = [];
      if (p.mode !== undefined || p.amount !== undefined) {
        const metric = str(op.key) && (SERIES.some((x) => x.id === op.key) || METRIC_NOUN[op.key as string]) ? op.key : undefined;
        parts.push(metric ? goalSentence({ metric, mode: p.mode ?? 'reach', amount: p.amount ?? null }).replace(/^./, (c) => c.toLowerCase()) : `${str(p.mode) ?? 'a new amount'}${num(p.amount) !== undefined ? ` ${fmtNum(Math.abs(num(p.amount)!))}` : ''}`);
      }
      if (p.strength === 'must') parts.push('make it a must');
      if (p.strength === 'should') parts.push('make it a should');
      if (p.strength === 'nice') parts.push('make it nice to have');
      if (p.functional === 'mean') parts.push('count the average over the plan');
      if (p.functional === 'end') parts.push('count the value at the end');
      return [row('goal', parts.length ? `Change ${ref}: ${parts.join(', ')}` : `Change ${ref}`)];
    }
    case 'setHorizon':
      return [row('time frame', num(op.days) !== undefined ? `Plan over ${fmtNum(num(op.days)!)} days` : 'Change the time frame')];
    case 'setStartDate':
      return [row('start', op.date === null ? 'Start as soon as possible' : `Start ${onDate(op.date, today)}`)];
    case 'setLimits': {
      const p = isRec(op.patch) ? op.patch : {};
      const out = Object.entries(p)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => LIMIT[k]?.(v) ?? 'Change a practical limit');
      return (out.length ? out : ['Change the practical limits']).map((s) => row('limit', s));
    }
    case 'resetLimits':
      return [row('limits', 'Reset the practical limits to the defaults')];
    case 'setStrictness':
      return [row('strictness', STRICTNESS[str(op.value) ?? ''] ?? 'Change how strictly the goals are held')];
    case 'setSuggested':
      return [row('suggestion', op.record === null ? 'Forget the applied goal suggestion' : 'Remember the goal suggestion that was applied')];
    default:
      return [row('goals', 'Change the goals')];
  }
}

function goalsEditItems(input: Rec, today?: string): Items {
  const ops = Array.isArray(input.ops) ? input.ops.filter(isRec) : [];
  const horizon = ops.find((o) => o.op === 'setHorizon' && num(o.days) !== undefined);
  const adds = ops.filter((o) => o.op === 'add' && isRec(o.goal));
  const items: Items = [];
  for (const op of ops) {
    // "Lose 6 kg of fat in 90 days": the time frame joins the goals added with it
    if (op === horizon && adds.length) continue;
    items.push(...goalOpItems(op, today, horizon ? num(horizon.days) : undefined));
  }
  return items.length ? items : [row('goals', 'Change the goals')];
}

/* ------------------------------------------------------------------------------------------------ plan.* */

function planSource(source: unknown): string {
  if (isRec(source) && str(source.rung)) return `the ${upper(words(str(source.rung)!))} plan`;
  if (isRec(source) && str(source.scenarioId)) return 'the plan from your saved scenario';
  return 'a plan';
}

const MISSED: Record<string, string> = {
  nextDay: 'A missed session moves to the next day',
  skip: 'A missed session is skipped',
  shorter: 'A missed session is made up with a shorter one',
};

function planStartExtras(input: Rec): Items {
  const items: Items = [];
  const name = str(input.name);
  if (name && !/^coach\b/i.test(name)) items.push(row('name', name));
  const i = isRec(input.intentions) ? input.intentions : {};
  if (clock(i.weighInClockH)) items.push(row('weigh-in', `Weigh in around ${clock(i.weighInClockH)}`));
  if (weekdayList(i.trainingWeekdays)) items.push(row('training', `Train on ${weekdayList(i.trainingWeekdays)}`));
  if (MISSED[str(i.missedSessionPlan) ?? '']) items.push(row('missed sessions', MISSED[str(i.missedSessionPlan)!]!));
  const wd = num(input.checkInWeekday);
  if (wd !== undefined && WEEKDAYS[wd]) items.push(row('check-in', `Weekly check-in on ${WEEKDAYS[wd]}s`));
  return items;
}

const END_REASON: Record<string, string> = {
  completed: 'End the plan as completed',
  abandoned: 'End the plan early',
  replaced: 'End the plan to start another',
  safety: 'End the plan for safety',
};

const EVENT: Record<string, string> = {
  noTraining: 'No training',
  illness: 'Ill',
  travel: 'Travelling',
  socialMeal: 'A social meal',
  busy: 'A busy stretch',
};

function span(from: unknown, to: unknown, today?: string): string {
  if (!str(to) || from === to) return onDate(from, today);
  return `from ${dateText(from, today)} to ${dateText(to, today)}`;
}

function extraFood(kcal: unknown, carb: unknown): string {
  const parts = [num(kcal) ? `${fmtNum(num(kcal)!)} kcal` : '', num(carb) ? `${fmtNum(num(carb)!)} g carbohydrate` : ''].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')} extra)` : '';
}

function exerciseName(v: unknown): string {
  if (isRec(v)) return str(v.name) ?? str(v.label) ?? 'another exercise';
  const s = str(v);
  return s ? words(s) : 'an exercise';
}

const SCOPE: Record<string, (date: unknown, today?: string) => string> = {
  day: (d, t) => `${onDate(d, t)} only`,
  weekday: (d) => {
    const s = str(d);
    const wd = s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? (new Date(`${s}T12:00:00Z`).getUTCDay() + 6) % 7 : undefined;
    return wd !== undefined ? `every ${WEEKDAYS[wd]} from ${dateText(d)}` : 'on that weekday every week';
  },
  rest: (d, t) => `from ${dateText(d, t)} to the end of the plan`,
};

function planItems(id: string, input: Rec, today?: string): Items | null {
  switch (id) {
    case 'plan.start':
      return [row('plan', `Start ${planSource(input.source)} ${onDate(input.startDate, today)}`), ...planStartExtras(input)];
    case 'plan.replace':
      return [row('plan', `Replace the running plan with ${planSource(input.source)}, starting ${dateText(input.startDate, today)}`), ...planStartExtras(input)];
    case 'plan.end':
      return [row('plan', END_REASON[str(input.reason) ?? ''] ?? 'End the plan'), ...(str(input.note) ? [row('note', str(input.note)!)] : [])];
    case 'plan.pause':
      return [row('plan', `Pause the plan${input.from ? ` from ${dateText(input.from, today)}` : ''}${input.until ? ` until ${dateText(input.until, today)}` : ''}`), ...(str(input.reason) ? [row('reason', str(input.reason)!)] : [])];
    case 'plan.resume':
      return [row('plan', `Resume the plan${input.from ? ` from ${dateText(input.from, today)}` : ''}`)];
    case 'plan.declareEvent': {
      const kind = str(input.kind) ?? '';
      const what = kind === 'socialMeal' ? `${EVENT[kind]} ${span(input.from, input.to, today)}${extraFood(input.extraKcal, input.extraCarbG)}` : `${EVENT[kind] ?? 'An event'} ${span(input.from, input.to, today)}`;
      return [row('event', what), ...(str(input.note) ? [row('note', str(input.note)!)] : [])];
    }
    case 'plan.shift': {
      const days = num(input.days) ?? 1;
      const n = `${days} day${days === 1 ? '' : 's'}`;
      const from = dateText(input.from, today);
      const MODE: Record<string, string> = {
        noTraining: `No training for ${n} from ${from}`,
        habitual: `Eat and move as usual for ${n} from ${from}`,
        pushBack: `Push the plan back ${n} from ${from}`,
        swap: `Swap ${from} with ${dateText(input.withDate, today)}`,
      };
      const items = [row('days', MODE[str(input.mode) ?? ''] ?? `Change ${n} from ${from}`)];
      if (isRec(input.absorb)) items.push(row('occasion', `Make room for an occasion ${onDate(input.absorb.date, today)}${extraFood(input.absorb.extraKcal, input.absorb.extraCarbG)}`));
      if (input.replanRest === true) items.push(row('rest of plan', 'Re-plan the rest of the plan'));
      return items;
    }
    case 'plan.editDay': {
      const patch = isRec(input.patch) ? Object.keys(input.patch).map(words) : [];
      const what = patch.length ? `the ${patch.length > 1 ? `${patch.slice(0, -1).join(', ')} and ${patch[patch.length - 1]}` : patch[0]}` : 'what the day prescribes';
      const scope = SCOPE[str(input.scope) ?? 'day'] ?? SCOPE.day!;
      return [row('day', `Change ${what} ${scope(input.date, today)}`)];
    }
    case 'plan.replan':
      return [row('plan', 'Re-plan the rest of the plan from today'), ...(str(input.reason) ? [row('reason', str(input.reason)!)] : [])];
    case 'plan.swapExercise':
      return [row('exercise', `Swap ${exerciseName(input.from)} for ${exerciseName(input.to)} ${input.everyWeek === true ? `every week from ${dateText(input.date, today)}` : onDate(input.date, today)}`)];
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------------------------------ generic */

/** Keys that never reach a card: ids, keys and tokens. */
const HIDDEN = /^(id|ids|idempotencyKey|cursor|limit|slotKey)$|Ids?$|Key$/;

/** Plain-language value for a card row (no field names, no JSON). */
export function plainValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') {
    const t = v.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try {
        return plainValue(JSON.parse(t));
      } catch {
        return v;
      }
    }
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? dateText(t) : v;
  }
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.length ? v.map(plainValue).join(', ') : 'none';
  if (isRec(v)) {
    const name = str(v.name) ?? str(v.label) ?? str(v.title);
    if (name) return name;
    const parts = Object.entries(v)
      .filter(([k, x]) => x !== undefined && x !== null && typeof x !== 'object' && !HIDDEN.test(k))
      .slice(0, 4)
      .map(([k, x]) => `${words(k)} ${plainValue(x)}`);
    return parts.length ? parts.join(', ') : 'a change';
  }
  return String(v);
}

/** Generic rows: field names as words, ids left out. */
function genericItems(input: Rec): Items {
  return Object.entries(input)
    .filter(([k, v]) => v !== undefined && !HIDDEN.test(k))
    .slice(0, 6)
    .map(([k, v]) => row(words(k), plainValue(v)));
}

/**
 * The card rows of a command's input: a sentence per change for `goals.edit` and the `plan.*` commands the Coach
 * uses, generic plain rows otherwise. `today` (YYYY-MM-DD) turns dates into "today" / "tomorrow".
 */
export function describeInput(commandId: string, input: unknown, today?: string): Items {
  if (!isRec(input)) return [];
  if (commandId === 'goals.edit') return goalsEditItems(input, today);
  return planItems(commandId, input, today) ?? genericItems(input);
}
