/**
 * A deterministic Coach for tests, the gallery and local demos. No network, no model: canned replies picked from the
 * message, streamed in a few chunks on `setTimeout(0)` so tests can await them. When `actions` is given, logs really go
 * through `LivingActions` (so Undo retracts the entry); plan edits only flip the card (TODO(E5): `plan.shift` /
 * `plan.editDay` through the bus once the real adapter exists). Destructive requests are never completed here — the
 * page runs the typed confirmation and reports `{ outcome: 'confirmed' }` afterwards.
 *
 * The meal numbers below stand in for the app's nutrient estimate (`src/catalogue/food/estimate.ts`): the real adapter
 * gets them from code, never from the model, and the UI only renders them. All numbers are synthetic.
 */
import { addDays, weekdayOf } from '@/living/dates';
import type { LocalDate, TodayView } from '@/living';
import { formatNumber } from '@/components';
import { clockHourOf, currentDay, type LivingClock } from '../clock';
import type { ActionOutcome, LivingActions } from '../data/actions';
import type { LivingDataSource } from '../data/source';
import { fmtClock, fmtDay, kcal, mealName } from '../format';
import { changeCardReducer, type ChangeAction, type ChangeCardModel, type ChangeEvent, type ChangeState } from '../model/changeCard';
import type { ChangeActionExtra, ChangeCardView, MealCardView } from '../components/ChangeCard';
import { COMPOSER_COPY, COACH_COPY } from './copy';
import { MAIN_CONVERSATION, type CoachAdapter, type CoachSendInput, type CoachStatus, type CoachStatusKind, type CoachStreamEvent, type CoachTurn, type ConversationSummary } from './adapter';
import { briefingFromLiving, type BriefingModel } from './briefing';

/* ------------------------------------------------------------------------------------------------ canned content */

const SAY = {
  logged: (total: string, left: string | null) => `Logged. That puts you at about ${total} kcal so far${left ? `, with about ${left} kcal left for today.` : '.'}`,
  loggedNoSource: 'Logged. That puts you at about 1 240 kcal so far, with dinner still to come.',
  loggedQuiet: (slot: string) => `Logged ${slot}. It’s on Today with the rest of your day.`,
  suggested: 'Here’s what I’d log. Nothing is saved until you confirm it.',
  asPlanned: (slot: string) => `Logged ${slot} as planned.`,
  notInPlan: (slot: string) => `There’s no ${slot} in today’s plan. Tell me what you ate and I’ll log it.`,
  photo: 'Logged it from your photo. Tap an amount if you know the grams.',
  photoAsk: 'I need one answer before I log this.',
  proposal: 'Here’s what that would do. Nothing changes until you apply it.',
  nothingToMove: 'There’s no training planned Thursday to Saturday, so nothing needs to change.',
  end: 'Ending a plan needs your own confirmation. It’s below when you’re ready.',
  blocked: 'Your safety settings don’t allow that, so I can’t plan it.',
  fast24: 'Here’s a 24-hour fast instead. Nothing changes until you apply it.',
  uiOnly: 'Only you can change that, in Settings.',
  weight:
    'Day-to-day weight moves with water, salt and food still in transit. Your trend smooths that out, and it is inside the range the plan expects.',
  planning: 'Start on the Plan screen: set your goals and limits, and I can explain the options it finds.',
  noPlan: 'No plan is running, so there’s nothing to log against yet. Once you start one, tell me what you ate and I’ll log it.',
  noPlanEdit: 'No plan is running, so there’s nothing to change.',
  noToolsEdit: 'This model can’t change your plan. You can make the change on Plan details.',
  basicEdit: 'This model can’t change your plan or run simulations. Choose a larger model in Settings for a proposal.',
  other: 'I can log what you ate or did, explain your plan and propose changes you approve. Try “had dal, rice and two eggs for lunch”.',
  adjust: 'Tell me what to change about it.',
  cantNow: 'That can’t be done now.',
  gone: 'That card is no longer here.',
} as const;

interface Food {
  key: RegExp;
  id: string;
  name: string;
  portion: string;
  grams: number;
  lo: number;
  hi: number;
  /** Per gram. */
  kcal: number;
  protein: number;
  carb: number;
  fat: number;
}

const FOODS: Food[] = [
  { key: /\bdal\b/, id: 'dal', name: 'dal', portion: '1 katori', grams: 150, lo: 110, hi: 200, kcal: 230 / 150, protein: 0.1, carb: 0.2, fat: 0.06 },
  { key: /\brice\b/, id: 'rice', name: 'rice', portion: '1 cup', grams: 160, lo: 120, hi: 210, kcal: 210 / 160, protein: 0.025, carb: 0.28, fat: 0.003 },
  { key: /\beggs?\b/, id: 'eggs', name: 'eggs', portion: '2', grams: 100, lo: 90, hi: 110, kcal: 2, protein: 0.14, carb: 0.01, fat: 0.15 },
  { key: /\b(roti|chapati)s?\b/, id: 'roti', name: 'roti', portion: '2', grams: 70, lo: 60, hi: 85, kcal: 155 / 70, protein: 0.13, carb: 0.45, fat: 0.04 },
  { key: /\bpaneer\b/, id: 'paneer', name: 'paneer', portion: '1 cup', grams: 100, lo: 70, hi: 140, kcal: 2.65, protein: 0.18, carb: 0.04, fat: 0.2 },
  { key: /\bchicken\b/, id: 'chicken', name: 'chicken curry', portion: '1 bowl', grams: 200, lo: 150, hi: 260, kcal: 1.5, protein: 0.14, carb: 0.03, fat: 0.08 },
  { key: /\b(oats|porridge)\b/, id: 'oats', name: 'oats', portion: '1 bowl', grams: 250, lo: 200, hi: 300, kcal: 0.7, protein: 0.025, carb: 0.12, fat: 0.015 },
  { key: /\bbananas?\b/, id: 'banana', name: 'banana', portion: '1', grams: 120, lo: 100, hi: 140, kcal: 0.89, protein: 0.011, carb: 0.23, fat: 0.003 },
  { key: /\b(curd|yogh?urt|dahi)\b/, id: 'curd', name: 'curd', portion: '1 katori', grams: 150, lo: 110, hi: 200, kcal: 0.6, protein: 0.035, carb: 0.047, fat: 0.03 },
];

const GENERIC: Food = { key: /$^/, id: 'meal', name: 'meal as described', portion: '1 plate', grams: 350, lo: 250, hi: 450, kcal: 1.6, protein: 0.06, carb: 0.2, fat: 0.06 };

/** The photo the mock "sees": a thali with dal tadka, rice and two roti. */
const PHOTO_FOODS: Food[] = [
  { key: /$^/, id: 'dal', name: 'dal tadka', portion: '1 katori', grams: 150, lo: 100, hi: 210, kcal: 1.6, protein: 0.06, carb: 0.15, fat: 0.07 },
  { key: /$^/, id: 'rice', name: 'rice', portion: '1 plate', grams: 250, lo: 180, hi: 330, kcal: 1.3, protein: 0.024, carb: 0.28, fat: 0.003 },
  { key: /$^/, id: 'roti', name: 'roti', portion: '2', grams: 70, lo: 60, hi: 85, kcal: 155 / 70, protein: 0.13, carb: 0.45, fat: 0.04 },
];
const PHOTO_SEEN = { cue: 'looks glossy: about 2 tsp oil added', saw: ['steel plate (about 26 cm)', 'a katori'], unseen: ['how deep the katori is'] };
const PORTION_ANSWER: Record<string, number> = { small: 180, usual: 250, large: 330 };

/** Display bands by method (energy and protein, low and high factors). */
const BANDS = {
  text: { e: [0.8, 1.22], p: [0.76, 1.24], label: 'Coach · text', confidence: 0.78, band: 'typed meal: about ±20 % for energy' },
  photo: { e: [0.65, 1.35], p: [0.5, 1.5], label: 'Coach · photo', confidence: 0.74, band: 'photo only: about ±35 % for energy' },
  grams: { e: [0.85, 1.15], p: [0.8, 1.2], label: 'Coach · photo + your grams', confidence: 0.9, band: 'your grams: about ±15 % for energy' },
} as const;

type Method = keyof typeof BANDS;

interface MealComp extends Food {
  yours?: boolean;
}

interface MealMeta {
  date: LocalDate;
  slot: string;
  clockH: number;
  text: string;
  method: Method;
  comps: MealComp[];
  photo?: { url: string; alt: string };
  review: boolean;
  ask?: MealCardView['ask'];
}

const round10 = (v: number) => Math.round(v / 10) * 10;
const compKcal = (c: MealComp) => Math.round(c.grams * c.kcal);

function amountOf(c: MealComp): string {
  if (c.yours) return `${formatNumber(c.grams, 0)} g`;
  return `${c.portion} ≈ ${formatNumber(c.grams, 0)} g (${formatNumber(c.lo, 0)}–${formatNumber(c.hi, 0)})`;
}

function totalsOf(meta: MealMeta): string {
  const b = BANDS[meta.method];
  const e = meta.comps.reduce((a, c) => a + compKcal(c), 0);
  const p = Math.round(meta.comps.reduce((a, c) => a + c.grams * c.protein, 0));
  return `≈ ${kcal(e)} kcal (${kcal(round10(e * b.e[0]))}–${kcal(round10(e * b.e[1]))}) · protein ${p} g (${Math.round(p * b.p[0])}–${Math.round(p * b.p[1])})`;
}

function mealCard(id: string, meta: MealMeta, createdAt: string, state: ChangeState): ChangeCardView {
  const b = BANDS[meta.method];
  const when = fmtClock(meta.clockH);
  const meal: MealCardView = {
    components: meta.comps.map((c) => ({ id: c.id, name: c.name, portion: c.portion, grams: c.grams, gramsLow: c.yours ? c.grams : c.lo, gramsHigh: c.yours ? c.grams : c.hi, kcal: compKcal(c), ...(c.yours ? { yours: true } : {}) })),
    ...(meta.photo ? { photo: meta.photo, ...PHOTO_SEEN } : {}),
    ...(meta.review ? { review: true } : {}),
    ...(meta.ask ? { ask: meta.ask } : {}),
  };
  return {
    id,
    class: 'log',
    title: state === 'pending' ? `${meta.slot.charAt(0).toUpperCase()}${meta.slot.slice(1)} · ${when} · not logged yet` : `Logged ${meta.slot} · ${when}`,
    source: { label: b.label, confidence: b.confidence, band: b.band },
    createdAt,
    items: meta.comps.map((c) => ({ label: c.name, before: null, after: `${amountOf(c)} · ${kcal(compKcal(c))} kcal` })),
    totals: totalsOf(meta),
    state,
    meal,
  };
}

function chunks(text: string): string[] {
  const words = text.split(' ');
  const n = Math.max(1, Math.ceil(words.length / 3));
  const out: string[] = [];
  for (let i = 0; i < words.length; i += n) out.push(`${i > 0 ? ' ' : ''}${words.slice(i, i + n).join(' ')}`);
  return out;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function objectUrl(f: File): string {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : '';
  } catch {
    return '';
  }
}

type Intent = 'photo' | 'fast48' | 'end' | 'busy' | 'uiOnly' | 'asPlanned' | 'weight' | 'food' | 'planning' | 'other';

function intentOf(text: string, photo: boolean): Intent {
  const t = text.toLowerCase();
  if (photo) return 'photo';
  if (/\b(3[6-9]|[4-9]\d)[- ]?(hour|h)\b/.test(t) && /\bfast/.test(t)) return 'fast48';
  if (/\b(end|stop|cancel) (my|the|this) plan\b/.test(t)) return 'end';
  if (/\bbusy\b|\bno training\b|\bskip (my )?training\b/.test(t)) return 'busy';
  if (/\bsync\b|\bkeys?\b|\bscreening\b/.test(t)) return 'uiOnly';
  if (/\bas planned\b/.test(t)) return 'asPlanned';
  if (/\bweight\b/.test(t) && /\bwhy\b/.test(t)) return 'weight';
  if (FOODS.some((f) => f.key.test(t)) || /\b(ate|had|eaten|breakfast|lunch|dinner|snack)\b/.test(t)) return 'food';
  if (/\bplan\b|\bwhat if\b|\bwindow\b|\blose\b/.test(t)) return 'planning';
  return 'other';
}

function slotOf(text: string, clockH: number): string {
  const m = /\b(breakfast|lunch|snack|dinner)\b/.exec(text.toLowerCase());
  return m ? m[1]! : mealName('meal1', clockH);
}

/* ------------------------------------------------------------------------------------------------ adapter */

export interface MockCoachOptions {
  clock: LivingClock;
  /** Log through these (Undo then retracts the entry). Without them cards are shown but nothing is logged. */
  actions?: LivingActions;
  /** Read today's plan, totals and quiet mode from here (and build the briefing). */
  source?: LivingDataSource;
  status?: CoachStatusKind | Partial<CoachStatus>;
  providerName?: string;
  model?: string;
  /** Turns already in the conversation (e.g. a long conversation with a segment boundary). */
  seed?: CoachTurn[];
}

export interface MockCoachAdapter extends CoachAdapter {
  /** Switch provider state (offline → ready, rate limited…). */
  setStatus(s: CoachStatusKind | Partial<CoachStatus>): void;
}

export function createMockCoachAdapter(opts: MockCoachOptions): MockCoachAdapter {
  const { clock, actions, source } = opts;
  const providerName = opts.providerName ?? 'Anthropic';
  const model = opts.model ?? 'Claude Sonnet 5.5';
  let status = makeStatus(opts.status);
  const convs = new Map<string, CoachTurn[]>();
  if (opts.seed?.length) convs.set(MAIN_CONVERSATION, opts.seed);
  let summaries: ConversationSummary[] = [];
  let rev = 0;
  let n = 0;
  const listeners = new Set<() => void>();
  /** Per log card: the stored undo of its entry, the meal it logged, and how to log it again (Redo, Log it). */
  const undos = new Map<string, () => Promise<ActionOutcome>>();
  const metas = new Map<string, MealMeta>();
  const loggers = new Map<string, () => Promise<ActionOutcome | null>>();

  function makeStatus(s: MockCoachOptions['status']): CoachStatus {
    const base: CoachStatus = { kind: 'ready', provider: providerName, model, keyOwner: 'your key', vision: true };
    if (!s) return base;
    if (typeof s !== 'string') return { ...base, ...s };
    if (s === 'noProvider') return { kind: 'noProvider', vision: false };
    if (s === 'rateLimited') return { ...base, kind: s, retryInS: 20 };
    if (s === 'basic') return { ...base, kind: s, vision: false };
    return { ...base, kind: s };
  }

  function bump(): void {
    rev += 1;
    summaries = [...convs.entries()]
      .filter(([, turns]) => turns.length > 0)
      .map(([id, turns]) => ({ id, title: COACH_COPY.title, kind: 'coach' as const, updatedAt: turns[turns.length - 1]!.at }));
    listeners.forEach((l) => l());
  }
  if (opts.seed?.length) bump();

  const nextId = (p: string) => `${p}-${++n}`;
  const nowIso = () => clock.now().toISOString();
  const today = () => currentDay(clock);
  const view = (date: LocalDate = today()): TodayView | null => source?.today(date) ?? null;
  /** Unknown without a source: behave as if a plan were running. */
  const hasPlan = () => (source ? !!view()?.plan : true);
  const quiet = () => !!view()?.quietMode;
  const planVersion = () => view()?.plan?.version ?? 3;

  function push(conv: string, turn: CoachTurn): void {
    convs.set(conv, [...(convs.get(conv) ?? []), turn]);
    bump();
  }

  function update(turnId: string, f: (t: CoachTurn) => CoachTurn): void {
    for (const [conv, turns] of convs) {
      const i = turns.findIndex((t) => t.id === turnId);
      if (i >= 0) {
        convs.set(conv, turns.map((t, k) => (k === i ? f(t) : t)));
        bump();
        return;
      }
    }
  }

  function findCard(cardId: string): { conv: string; turn: CoachTurn; card: ChangeCardView } | null {
    for (const [conv, turns] of convs) {
      for (const turn of turns) {
        const card = turn.cards.find((c) => c.id === cardId);
        if (card) return { conv, turn, card };
      }
    }
    return null;
  }

  function replaceCard(cardId: string, next: ChangeCardView): void {
    const found = findCard(cardId);
    if (found) update(found.turn.id, (t) => ({ ...t, cards: t.cards.map((c) => (c.id === cardId ? next : c)) }));
  }

  async function logMeta(meta: MealMeta): Promise<ActionOutcome | null> {
    if (!actions) return null;
    return actions.logMeal(meta.date, {
      slot: meta.slot,
      clockH: meta.clockH,
      text: meta.text,
      components: meta.comps.map((c) => ({ name: c.name, grams: c.grams, energyKcal: compKcal(c), proteinG: c.grams * c.protein, carbG: c.grams * c.carb, fatG: c.grams * c.fat })),
    });
  }

  /* ---------------------------------------------------------------------------------------------- replies */

  /** One beat of a reply: text (fixed, or written when reached), a lookup line, a card, or a side effect. */
  type Step = { text: string | (() => string) } | { read: ChangeCardModel } | { card: () => Promise<ChangeCardView | null> } | { effect: () => Promise<void> };

  function readCard(reads: Array<{ label: string; summary?: string }>): ChangeCardModel {
    return { id: nextId('read'), class: 'read', title: reads.map((r) => r.label).join(' · '), createdAt: nowIso(), items: [], reads, state: 'applied' };
  }

  function foodSteps(input: CoachSendInput, you: CoachTurn): Step[] {
    const date = (input.context?.date as LocalDate | undefined) ?? today();
    const clockH = clockHourOf(clock);
    const slot = slotOf(input.text, clockH);
    const t = input.text.toLowerCase();
    const isPhoto = !!input.photo;
    const comps: MealComp[] = (isPhoto ? PHOTO_FOODS : FOODS.filter((f) => f.key.test(t))).map((f) => ({ ...f }));
    if (!comps.length) comps.push({ ...GENERIC });
    const ask = isPhoto && /\b(not sure|unsure)\b/.test(t);
    const alt = `${COACH_COPY.photoAlt}: ${comps.map((c) => c.name).join(', ')}`;
    const meta: MealMeta = {
      date,
      slot,
      clockH,
      text: input.text,
      method: isPhoto ? 'photo' : 'text',
      comps,
      ...(isPhoto && you.photo ? { photo: { url: you.photo.url, alt } } : {}),
      review: isPhoto && !ask,
      ...(ask ? { ask: { componentId: 'rice', question: 'rice: small, usual or large?', options: [{ id: 'small', label: 'small' }, { id: 'usual', label: 'usual' }, { id: 'large', label: 'large' }] } } : {}),
    };
    const pendingOnly = ask || status.kind === 'noTools';
    const id = nextId('log');
    metas.set(id, meta);
    loggers.set(id, () => logMeta(meta));
    let outcome: ActionOutcome | null = null;
    const reply = (): string => {
      if (outcome && !outcome.ok) return outcome.message ?? SAY.cantNow;
      if (pendingOnly) return ask ? SAY.photoAsk : SAY.suggested;
      if (isPhoto) return SAY.photo;
      if (quiet()) return SAY.loggedQuiet(slot);
      if (!source) return SAY.loggedNoSource;
      const v = view(date);
      const total = v?.logged.totals.energyKcal.value;
      const left = v?.remaining?.energyKcal;
      return total === undefined ? SAY.loggedQuiet(slot) : SAY.logged(kcal(total), left !== undefined && left > 0 ? kcal(left) : null);
    };
    const steps: Step[] = [];
    if (isPhoto) {
      steps.push({ effect: async () => update(you.id, (u) => (u.photo ? { ...u, photo: { ...u.photo, alt } } : u)) });
    } else {
      steps.push({ read: readCard([{ label: 'today’s log', summary: 'What is logged so far today and what is still planned.' }, { label: `plan v${planVersion()}`, summary: `Today’s ${slot} in the plan.` }]) });
    }
    if (!pendingOnly) {
      steps.push({
        effect: async () => {
          outcome = await logMeta(meta);
          if (outcome?.undo) undos.set(id, outcome.undo);
        },
      });
    }
    // written after the log, so it can say where the day stands
    steps.push({ text: reply });
    steps.push({
      card: async () => {
        if (outcome && !outcome.ok) return null;
        return mealCard(id, meta, nowIso(), pendingOnly ? 'pending' : 'applied');
      },
    });
    return steps;
  }

  function asPlannedSteps(input: CoachSendInput): Step[] {
    const date = today();
    const slot = slotOf(input.text, clockHourOf(clock));
    const rx = view(date)?.prescription;
    const m = rx?.meals.find((x) => x.slot === slot);
    if (source && !m) return [{ text: SAY.notInPlan(slot) }];
    const clockH = m?.clockH ?? clockHourOf(clock);
    const id = nextId('log');
    const log = async () => (actions ? actions.logMeal(date, { slot, clockH, components: [], asPlanned: true }) : null);
    loggers.set(id, log);
    let outcome: ActionOutcome | null = null;
    return [
      {
        effect: async () => {
          outcome = await log();
          if (outcome?.undo) undos.set(id, outcome.undo);
        },
      },
      { text: () => (outcome && !outcome.ok ? (outcome.message ?? SAY.cantNow) : SAY.asPlanned(slot)) },
      {
        card: async () => {
          if (outcome && !outcome.ok) return null;
          return {
            id,
            class: 'log',
            title: `Logged ${slot} as planned · ${fmtClock(clockH)}`,
            source: { label: 'Coach · as planned' },
            createdAt: nowIso(),
            items: [{ label: slot, before: null, after: m && !quiet() ? `as planned · ${kcal(m.energyKcal)} kcal` : 'as planned' }],
            state: 'applied',
          };
        },
      },
    ];
  }

  function busySteps(): Step[] {
    const t = today();
    const thu = addDays(t, (3 - weekdayOf(t) + 7) % 7);
    const days = [thu, addDays(thu, 1), addDays(thu, 2)];
    const items: ChangeCardModel['items'] = [];
    for (const d of days) {
      if (source) {
        const rx = view(d)?.prescription;
        const s = rx?.sessions ?? [];
        if (!s.length) continue;
        items.push({
          label: fmtDay(d),
          before: s.map((x) => `${x.kind === 'resistance' ? 'strength' : 'cardio'} session ${fmtClock(x.startH)}`).join(', '),
          after: rx?.steps !== undefined ? 'rest, your usual steps' : 'rest',
        });
      } else items.push({ label: fmtDay(d), before: weekdayOf(d) === 4 ? 'strength session 17:30' : 'cardio session 07:30', after: 'rest, your usual steps' });
    }
    if (!items.length) return [{ text: SAY.nothingToMove }];
    const range = source ? (view()?.drift?.[0]?.goalDate.range ?? null) : ([addDays(t, 81), addDays(t, 90)] as [string, string]);
    const card: ChangeCardModel = {
      id: nextId('edit'),
      class: 'edit',
      title: 'Proposal · no training Thu–Sat',
      source: { label: 'Coach · proposal' },
      createdAt: nowIso(),
      items,
      impact: {
        goalDates: range ? [{ label: 'goal date', before: range, after: [addDays(range[0], 2), addDays(range[1], 2)] }] : [],
        metrics: [{ label: 'weight by the end', delta: 0.2, unit: 'kg', decimals: 1 }],
      },
      state: 'pending',
    };
    return [
      { read: readCard([{ label: `plan v${planVersion()}`, summary: `${items.length} session${items.length === 1 ? '' : 's'} planned Thursday to Saturday.` }, { label: 'what-if: no training Thu–Sat', summary: 'The forecast again, without those sessions.' }]) },
      { text: SAY.proposal },
      { card: async () => card },
    ];
  }

  function endSteps(): Step[] {
    const name = view()?.plan?.name ?? 'your plan';
    const card: ChangeCardModel = {
      id: nextId('confirm'),
      class: 'destructive',
      title: `end ${name}`,
      createdAt: nowIso(),
      items: [],
      confirm: { consequence: 'Ends the plan today. Logs and versions are kept; you can restore it for 7 days.', word: 'end', actionLabel: 'End plan' },
      state: 'pending',
    };
    return [{ text: SAY.end }, { card: async () => card }];
  }

  function blockedSteps(): Step[] {
    const card: ChangeCardModel = {
      id: nextId('blocked'),
      class: 'blocked',
      title: 'a 48-hour fast',
      createdAt: nowIso(),
      items: [],
      blocked: { rule: 'Your fasting opt-in allows up to 24 hours.', alternatives: [{ id: 'fast24', label: 'Plan a 24-hour fast instead' }] },
      state: 'applied',
    };
    return [{ text: SAY.blocked }, { card: async () => card }];
  }

  function uiOnlySteps(text: string): Step[] {
    const t = text.toLowerCase();
    const what = /\bscreening\b/.test(t) ? 'your screening answers' : /\bsync\b/.test(t) ? 'sync' : 'your AI key';
    const card: ChangeCardModel = { id: nextId('ui'), class: 'uiOnly', title: what, createdAt: nowIso(), items: [], setting: { label: COACH_COPY.settingsLink, to: '/settings' }, state: 'applied' };
    return [{ text: SAY.uiOnly }, { card: async () => card }];
  }

  function editBlockedBy(): string | null {
    if (status.kind === 'safetyNoPlanning') return COACH_COPY.safetyNoPlanning;
    if (status.kind === 'noTools') return SAY.noToolsEdit;
    if (status.kind === 'basic') return SAY.basicEdit;
    return null;
  }

  function stepsFor(input: CoachSendInput, you: CoachTurn): Step[] {
    const intent = intentOf(input.text, !!input.photo);
    switch (intent) {
      case 'photo':
        if (!status.vision) return [{ text: COMPOSER_COPY.noVision }];
        return hasPlan() ? foodSteps(input, you) : [{ text: SAY.noPlan }];
      case 'food':
        return hasPlan() ? foodSteps(input, you) : [{ text: SAY.noPlan }];
      case 'asPlanned':
        return hasPlan() ? asPlannedSteps(input) : [{ text: SAY.noPlan }];
      case 'busy':
        if (!hasPlan()) return [{ text: SAY.noPlanEdit }];
        return editBlockedBy() ? [{ text: editBlockedBy()! }] : busySteps();
      case 'end':
        if (!hasPlan()) return [{ text: SAY.noPlanEdit }];
        return status.kind === 'safetyNoPlanning' ? [{ text: COACH_COPY.safetyNoPlanning }] : endSteps();
      case 'fast48':
        return blockedSteps();
      case 'uiOnly':
        return uiOnlySteps(input.text);
      case 'weight':
        return [{ read: readCard([{ label: '14 days of weigh-ins', summary: 'Your weigh-ins and the trend that smooths them.' }, { label: 'today’s log', summary: 'What is logged so far today.' }]) }, { text: SAY.weight }];
      case 'planning':
        return [{ text: SAY.planning }];
      default:
        return [{ text: SAY.other }];
    }
  }

  function errorMessage(s: CoachStatus): string | null {
    const p = s.provider ?? providerName;
    switch (s.kind) {
      case 'noProvider':
        return COACH_COPY.composerReason;
      case 'offline':
        return COACH_COPY.offline;
      case 'keyRefused':
        return COACH_COPY.keyRefused(p);
      case 'outOfCredit':
        return COACH_COPY.outOfCredit;
      case 'rateLimited':
        return COACH_COPY.rateLimited(s.retryInS ?? 20);
      case 'cors':
        return COACH_COPY.cors(p);
      default:
        return null;
    }
  }

  async function send(input: CoachSendInput, onEvent: (e: CoachStreamEvent) => void, signal: AbortSignal): Promise<void> {
    const conv = input.conversationId || MAIN_CONVERSATION;
    const at = nowIso();
    const you: CoachTurn = { id: nextId('you'), role: 'you', at, text: input.text, cards: [], ...(input.photo ? { photo: { url: objectUrl(input.photo), alt: COACH_COPY.photoAlt } } : {}) };
    push(conv, you);
    const failure = errorMessage(status);
    if (failure) {
      push(conv, { id: nextId('coach'), role: 'coach', at, text: '', cards: [], error: { kind: status.kind, message: failure } });
      onEvent({ type: 'error', kind: status.kind, message: failure });
      return;
    }
    const coachId = nextId('coach');
    push(conv, { id: coachId, role: 'coach', at, text: '', cards: [], streaming: true });
    const stop = () => update(coachId, (t) => ({ ...t, streaming: false, stopped: true }));
    for (const step of stepsFor(input, you)) {
      await tick();
      if (signal.aborted) return stop();
      if ('text' in step) {
        for (const delta of chunks(typeof step.text === 'function' ? step.text() : step.text)) {
          update(coachId, (t) => ({ ...t, text: t.text + delta }));
          onEvent({ type: 'text', delta });
          await tick();
          if (signal.aborted) return stop();
        }
      } else if ('read' in step) {
        update(coachId, (t) => ({ ...t, reads: step.read }));
        onEvent({ type: 'read', card: step.read });
      } else if ('card' in step) {
        const card = await step.card();
        if (card) {
          update(coachId, (t) => ({ ...t, cards: [...t.cards, card] }));
          onEvent({ type: 'card', card });
        }
      } else {
        await step.effect();
      }
    }
    update(coachId, (t) => ({ ...t, streaming: false }));
    onEvent({ type: 'done' });
  }

  /* ---------------------------------------------------------------------------------------------- decisions */

  const ok = (message?: string) => ({ ok: true, ...(message ? { message } : {}) });
  const fail = (message: string) => ({ ok: false, message });

  function reduce(card: ChangeCardView, ev: ChangeEvent): ChangeCardView | null {
    const next = changeCardReducer(card, ev, clock.now()) as ChangeCardView;
    return next === card ? null : next;
  }

  /** Retract the card's entry (if logged). */
  async function retract(cardId: string): Promise<{ ok: boolean; message?: string }> {
    const u = undos.get(cardId);
    if (!u) return ok();
    const r = await u();
    if (!r.ok) return fail(r.message ?? SAY.cantNow);
    undos.delete(cardId);
    return ok();
  }

  /** Log the card's entry (again) and keep its undo. */
  async function log(cardId: string): Promise<{ ok: boolean; message?: string }> {
    const r = (await loggers.get(cardId)?.()) ?? null;
    if (r && !r.ok) return fail(r.message ?? SAY.cantNow);
    if (r?.undo) undos.set(cardId, r.undo);
    return ok();
  }

  async function act(cardId: string, action: ChangeAction, extra: ChangeActionExtra = {}): Promise<{ ok: boolean; message?: string }> {
    const found = findCard(cardId);
    if (!found) return fail(SAY.gone);
    const card = found.card;
    const meta = metas.get(cardId);
    switch (action) {
      case 'undo': {
        const next = reduce(card, { type: 'undo' });
        if (!next) return fail(SAY.cantNow);
        // TODO(E5): an applied plan edit is undone through `history.undo` of its ChangeSet
        const r = await retract(cardId);
        if (!r.ok) return r;
        replaceCard(cardId, next);
        return ok();
      }
      case 'redo': {
        const next = reduce(card, { type: 'redo' });
        if (!next) return fail(SAY.cantNow);
        const r = await log(cardId);
        if (!r.ok) return r;
        replaceCard(cardId, next);
        return ok();
      }
      case 'apply': {
        const next = reduce(card, { type: 'apply' });
        if (!next) return fail(SAY.cantNow);
        if (card.class === 'log') {
          const r = await log(cardId);
          if (!r.ok) return r;
          replaceCard(cardId, meta ? mealCard(cardId, meta, next.createdAt, 'applied') : next);
          return ok();
        }
        // TODO(E5): dispatch the staged command (`plan.shift`, `plan.editDay`) with the person as actor
        replaceCard(cardId, next);
        return ok();
      }
      case 'discard': {
        const next = reduce(card, { type: 'discard' });
        if (!next) return fail(SAY.cantNow);
        replaceCard(cardId, next);
        return ok();
      }
      case 'dismiss': {
        if (card.class === 'log' && card.meal?.review) {
          if (meta) meta.review = false;
          replaceCard(cardId, { ...card, meal: { ...card.meal, review: false } });
          return ok();
        }
        const next = reduce(card, { type: 'discard' });
        if (!next) return fail(SAY.cantNow);
        replaceCard(cardId, next);
        return ok();
      }
      case 'review': {
        if (card.class === 'destructive') {
          // the page ran the typed confirmation; the Coach only records that it happened
          if (extra.outcome !== 'confirmed') return ok();
          const next = reduce(card, { type: 'confirmed' });
          if (next) replaceCard(cardId, next);
          return ok();
        }
        const next = reduce(card, { type: 'refresh' });
        if (!next) return fail(SAY.cantNow);
        replaceCard(cardId, next);
        return ok();
      }
      case 'alternative': {
        if (card.class !== 'blocked' || extra.alternativeId !== 'fast24') return fail(SAY.cantNow);
        const next = reduce(card, { type: 'discard' });
        if (next) replaceCard(cardId, next);
        const t = today();
        const sat = addDays(t, (5 - weekdayOf(t) + 7) % 7);
        const rx = view(sat)?.prescription;
        const proposal: ChangeCardModel = {
          id: nextId('edit'),
          class: 'edit',
          title: `Proposal · a 24-hour fast on ${fmtDay(sat)}`,
          source: { label: 'Coach · proposal' },
          createdAt: nowIso(),
          items: [{ label: fmtDay(sat), before: rx?.window ? `eating ${fmtClock(rx.window.startH)}–${fmtClock(rx.window.endH)}` : 'your usual eating window', after: '24-hour fast, dinner to dinner' }],
          impact: { goalDates: [], metrics: [] },
          state: 'pending',
        };
        push(found.conv, { id: nextId('coach'), role: 'coach', at: nowIso(), text: SAY.fast24, cards: [proposal] });
        return ok();
      }
      case 'adjust':
        return ok(SAY.adjust);
      case 'edit': {
        if (!meta || !extra.componentId) return ok();
        const comp = meta.comps.find((c) => c.id === extra.componentId);
        if (!comp) return fail(SAY.gone);
        if (extra.optionId && meta.ask) {
          // the one question answered: set that portion and log the meal
          comp.grams = PORTION_ANSWER[extra.optionId] ?? comp.grams;
          delete meta.ask;
          const r = await log(cardId);
          if (!r.ok) return r;
          replaceCard(cardId, mealCard(cardId, meta, nowIso(), 'applied'));
          return ok();
        }
        if (extra.grams === undefined || !Number.isFinite(extra.grams) || extra.grams <= 0) return fail(SAY.cantNow);
        // your grams: the source becomes "photo + your grams" and the band narrows
        comp.grams = extra.grams;
        comp.yours = true;
        meta.method = 'grams';
        meta.review = false;
        if (card.state === 'applied') {
          const out = await retract(cardId);
          if (!out.ok) return out;
          const r = await log(cardId);
          if (!r.ok) return r;
        }
        replaceCard(cardId, { ...mealCard(cardId, meta, card.createdAt, card.state), ...(card.until ? { until: card.until } : {}) });
        return ok();
      }
      case 'open':
        return ok();
    }
  }

  return {
    status: () => status,
    conversations: () => summaries,
    history: (id) => convs.get(id) ?? NO_TURNS,
    send,
    act,
    briefing: (): BriefingModel =>
      briefingFromLiving(source ?? null, source ? clock : null, { provider: status.kind === 'noProvider' ? null : { name: status.provider ?? providerName, model: status.model ?? model } }),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    revision: () => rev,
    setStatus: (s) => {
      status = makeStatus(s);
      bump();
    },
  };
}

const NO_TURNS: CoachTurn[] = [];
