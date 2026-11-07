/**
 * Today's view model (living-mode.md §4): joins E5's `TodayView` checklist with the frozen prescription into the rows
 * the person ticks (COMPONENTS §13.10), what to do next, and the goal-date line. Pure; nothing here computes a score,
 * a credit, a band or a goal date — they are read from the contract. Rows carry no provenance: what was logged reads as
 * the value against the plan ("430 of 1 332 kcal"), never "you · typed".
 * A meal reads its food first (by amount, ../components/mealMark); with no food, its own answer (`TodayView.marks.meals`,
 * that slot's only), else the day's food or whole-day mark. A meal never takes another meal's answer.
 */
import type { LocalDate, Mark, PrescribedDaySnapshot, TodayChecklistItem, TodayView } from '@/living';
import { fmtClock, fmtDateRange, fmtHours, grams, kcal, mealName } from '../format';
import type { SupplementRow } from '@/catalogues/supplements';
import { mergedSupplementLine, ownTakingRow } from '../food/supplements';
import { groupEntries, labelInSlot, slotTargets, visibleSlots } from '../food/slots';
import { mealMarkOf } from '../components/mealMark';

export type RowStatus = 'empty' | 'done' | 'partial' | 'skipped' | 'assumed';

/** Entered sleep quality as a word (D8-06). */
const SLEEP_QUALITY_WORD: Readonly<Record<NonNullable<TodayView['logged']['sleepQuality']>, string>> = { good: 'Good', fair: 'Fair', poor: 'Poor' };

/** A mark as a row's status: as planned → done, partly → partial, not → skipped. */
const STATUS_OF_MARK: Record<Mark, RowStatus> = { asPlanned: 'done', partly: 'partial', not: 'skipped' };
export type RowGlyph = 'weigh' | 'meal' | 'session' | 'fast' | 'steps' | 'sleep' | 'supplement';

export interface TodayRow {
  /** Checklist id (`weigh`, `meal:lunch`, `session:14:0`, `fast`, `steps`, `sleep`, `supplement:creatine`). */
  id: string;
  /** The adherence item it addresses, when there is one (`rtSession:14:0`, `steps`…). */
  itemId: string | null;
  at: number | null;
  glyph: RowGlyph;
  /** "lunch", "lift · 45 min", "steps". */
  label: string;
  /** Target or the concrete plan: "640 kcal · 40 g protein", "mudgar two-hand swing, dand, baithak", "9 000 steps". */
  target: string;
  /** Numbers in the target that quiet mode hides (meal kcal). */
  quietTarget?: string;
  /** A second line of detail: a meal's carbs and fat. */
  detail?: string;
  status: RowStatus;
  /** What was logged against it (meal energy, steps, sleep, the weigh-in), and the planned amount it is read against. */
  logged?: { value: number; unit: string; decimals?: number; planned?: number };
  item: TodayChecklistItem;
  untimed: boolean;
}

function sessionText(rx: PrescribedDaySnapshot, slotKey: string): { label: string; target: string } {
  const s = rx.sessions.find((x) => x.slotKey === slotKey);
  if (!s) return { label: 'session', target: '' };
  const kind = s.kind === 'resistance' ? 'lift' : (s.engine[0]?.kind === 'cardio' ? s.engine[0].modality : 'cardio').replace('other', 'cardio');
  const names = s.concrete?.items.map((i) => shortName(i.name)) ?? [];
  return { label: `${kind} · ${fmtHours(s.durationMin / 60)}`, target: names.join(', ') };
}

/** "Mudgar swing, single heavy club two-handed" → "mudgar swing"; "Dand (Hindu push-up)" → "dand". Honest short forms only. */
export function shortName(name: string): string {
  const base = name.split(/[,(:]/)[0]!.trim();
  return base.charAt(0).toLowerCase() + base.slice(1);
}

function statusOfItem(view: TodayView, itemId: string): RowStatus | null {
  const it = view.logged.items.find((i) => i.itemId === itemId);
  if (!it || it.status === 'unknown') return null;
  return it.status === 'done' ? 'done' : it.status === 'partial' ? 'partial' : 'skipped';
}

/** Extras the contract does not carry: the day's weigh-in when there is no trend yet (from the trend lane's weigh-ins). */
export interface TodayRowExtras {
  weighInKg?: number;
  /** The person's own supplement rows: a plan supplement they already take shows their name and dose (Q6-11). */
  supplements?: readonly SupplementRow[] | null;
  /** The day's accepted recipes by meal slot: one serving of one counts as the meal as planned (as in the meal sheet). */
  recipes?: AcceptedRecipes | null;
}

/** Accepted recipes by meal slot: the dish's name and one serving's energy (kcal). */
export type AcceptedRecipes = Readonly<Record<string, { dish: string; energyKcal: number }>>;

/** The rows of Today's plan, in time order, untimed rows last (steps, sleep, supplements). */
export function todayRows(view: TodayView, extras: TodayRowExtras = {}): TodayRow[] {
  const rx = view.prescription;
  if (!rx) return [];
  const rows: TodayRow[] = [];
  // the day-wide answer every meal without food or an answer of its own reads (the food mark, else the whole day's)
  const dayMark = view.marks?.food ?? view.marks?.all;
  const dayMarked = view.checklist.some((c) => c.id === 'mark:all' && c.done);
  // the contract's checklist leaves out steps and sleep once a device has measured them (nothing left to tap); Today
  // still shows those rows, so a device-fed stream keeps its value and the Correct action (SUITE_SPEC §14.6)
  const checklist = [...view.checklist];
  const observed = (kind: 'steps' | 'sleep', label: string, command: TodayChecklistItem['command']) => {
    if (!checklist.some((c) => c.kind === kind)) checklist.push({ id: kind, kind, label, done: true, command });
  };
  // meal entries by slot, grouped as the meal sheet and Food group them, so a meal row and its sheet read the same food
  const { bySlot: mealsBySlot, other: otherMeals } = groupEntries(view.logged.entries, visibleSlots(rx, slotTargets(rx)));
  if (rx.steps !== undefined) observed('steps', 'Steps', { id: 'log.steps', input: { date: view.date } });
  observed('sleep', 'Last night’s sleep', { id: 'log.sleep', input: { date: view.date } });
  for (const c of checklist) {
    if (c.kind === 'mark') continue;
    const base = { id: c.id, at: c.at ?? null, item: c };
    if (c.kind === 'weigh') {
      // the logged weigh-in stays in the field after logging, also before the trend filter has a trend
      const measured = view.trendWeight?.measured ?? extras.weighInKg;
      rows.push({ ...base, itemId: null, glyph: 'weigh', label: 'weigh in', target: '', status: c.done ? 'done' : 'empty', untimed: false, ...(measured !== undefined ? { logged: { value: measured, unit: 'kg', decimals: 1 } } : {}) });
    } else if (c.kind === 'meal') {
      const slot = c.id.slice(5);
      const m = rx.meals.find((x) => x.slot === slot);
      // food that belongs to no meal, at about this one's time (never another meal's food)
      const entry = m ? otherMeals.find((e) => e.clockH !== undefined && Math.abs(e.clockH - m.clockH) <= 2) : undefined;
      const name = m ? mealName(m.slot, m.clockH) : slot;
      // the food logged for the meal: the slot's entries (the sheet's), else the entry at about its time
      const food = mealsBySlot.get(slot) ?? (entry ? [entry] : []);
      const foodKcal = food.reduce((sum, e) => sum + (e.energyKcal?.value ?? 0), 0);
      const said = view.marks?.meals?.[slot] ?? dayMark;
      // with nothing logged or said for it, a ticked meal is done only by the whole day's mark: another meal's food near
      // its time is that meal's
      let status: RowStatus = food.length > 0 ? 'done' : said ? STATUS_OF_MARK[said] : c.done && dayMarked ? 'done' : 'empty';
      // logged food reads as its answer in the meal sheet (./components/mealMark): less than the plan is Partly, so
      // the row's mark never says "done" beside "430 of 1 332 kcal" while the sheet says Partly
      if (status === 'done' && m && food.length > 0) {
        const words = food.map((e) => labelInSlot(e.label, name)).filter((w): w is string => !!w);
        const mark = mealMarkOf({ status, words, hasFood: true, loggedKcal: foodKcal, plannedKcal: m.energyKcal, recipe: extras.recipes?.[slot] ?? null });
        if (mark === 'partly') status = 'partial';
      }
      rows.push({
        ...base,
        itemId: null,
        glyph: 'meal',
        label: name,
        target: m ? `${kcal(m.energyKcal)} kcal · ${grams(m.proteinG)} g protein` : '',
        quietTarget: 'portions on Food',
        ...(m ? { detail: `${grams(m.carbG)} g carbs · ${grams(m.fatG)} g fat` } : {}),
        status,
        untimed: false,
        ...(foodKcal > 0 ? { logged: { value: foodKcal, unit: 'kcal', ...(m ? { planned: m.energyKcal } : {}) } } : {}),
      });
    } else if (c.kind === 'session') {
      const slotKey = c.id.slice(8);
      const s = rx.sessions.find((x) => x.slotKey === slotKey);
      const itemId = s ? `${s.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${slotKey}` : null;
      const t = sessionText(rx, slotKey);
      rows.push({ ...base, itemId, glyph: 'session', label: t.label, target: t.target, status: (itemId ? statusOfItem(view, itemId) : null) ?? (c.done ? 'done' : 'empty'), untimed: false });
    } else if (c.kind === 'fast') {
      const f = view.logged.fast;
      const planned = rx.fast?.hours;
      const plannedText = planned !== undefined ? `planned ${fmtHours(planned)}` : null;
      // D2-01: the observed elapsed time and the planned length are separate facts (the plan never extends what was
      // observed); D5-05: an ended fast reads its counted length and its end clock, or "End unknown"
      const ended = (word: string | null) =>
        [word, f?.sinceH !== undefined ? fmtHours(f.sinceH) : null, f?.endedClockH !== undefined ? `ended ${fmtClock(f.endedClockH)}` : 'End unknown'].filter(Boolean).join(' · ');
      const target =
        f?.state === 'running' && f.sinceH !== undefined
          ? [`elapsed ${fmtHours(f.sinceH)}`, plannedText].filter(Boolean).join(' · ')
          : f?.state === 'broken'
            ? ended('broken')
            : f?.state === 'done' && f.endedClockH !== undefined
              ? ended(null)
              : planned !== undefined
                ? fmtHours(planned)
                : '';
      rows.push({ ...base, itemId: 'fast', glyph: 'fast', label: 'fast', target, status: statusOfItem(view, 'fast') ?? (c.done ? 'done' : 'empty'), untimed: c.at === undefined });
    } else if (c.kind === 'steps') {
      rows.push({
        ...base,
        itemId: 'steps',
        glyph: 'steps',
        label: 'steps',
        target: rx.steps !== undefined ? `${kcal(rx.steps)} steps` : '',
        status: statusOfItem(view, 'steps') ?? (c.done ? 'done' : 'empty'),
        untimed: true,
        ...(view.logged.steps !== undefined ? { logged: { value: view.logged.steps, unit: 'steps', ...(rx.steps !== undefined ? { planned: rx.steps } : {}) } } : {}),
      });
    } else if (c.kind === 'sleep') {
      const sl = rx.sleep;
      rows.push({
        ...base,
        itemId: 'sleep',
        glyph: 'sleep',
        label: 'sleep',
        target: sl ? `${fmtClock(sl.bedH)}–${fmtClock(sl.wakeH)} · ${fmtHours((sl.wakeH - sl.bedH + 24) % 24)}` : '',
        status: statusOfItem(view, 'sleep') ?? (c.done ? 'done' : 'empty'),
        untimed: true,
        // D8-06: the quality only as the person entered it (never derived from physiology)
        ...(view.logged.sleepQuality ? { detail: `quality ${SLEEP_QUALITY_WORD[view.logged.sleepQuality]}` } : {}),
        ...(view.logged.sleepHours !== undefined ? { logged: { value: view.logged.sleepHours, unit: 'h', decimals: 1 } } : {}),
      });
    } else if (c.kind === 'supplement') {
      const id = c.id.slice(11);
      const s = rx.supplements.find((x) => x.supplementId === id);
      const own = ownTakingRow(id, extras.supplements);
      const merged = s && own ? mergedSupplementLine(s, own) : null;
      rows.push({ ...base, itemId: `supplement:${id}`, glyph: 'supplement', label: merged ? shortName(merged.name) : id, target: merged ? merged.line : s ? `${s.dose} ${s.unit}` : '', status: statusOfItem(view, `supplement:${id}`) ?? (c.done ? 'done' : 'empty'), untimed: c.at === undefined });
    }
  }
  // the weigh-in with no set time comes first: it is the morning's first thing, before any food
  const timed = rows.filter((r) => !r.untimed).sort((a, b) => (a.at ?? (a.glyph === 'weigh' ? -1 : 99)) - (b.at ?? (b.glyph === 'weigh' ? -1 : 99)));
  const untimed = rows.filter((r) => r.untimed);
  return [...timed, ...untimed];
}

/** The weigh-in stops being "next" after this clock hour (it belongs to the morning). */
const WEIGH_UNTIL_H = 11;

/**
 * What to do next on the real today: the weigh-in while it is still morning (it comes before any food), then the first
 * open timed row from now on, else the earliest one still open; untimed rows (steps, sleep, supplements) are never
 * "next". Null when nothing is left.
 */
export function nextUp(rows: readonly TodayRow[], nowH: number): TodayRow | null {
  const open = rows.filter((r) => !r.untimed && r.status === 'empty' && !(r.glyph === 'weigh' && (r.logged || nowH >= WEIGH_UNTIL_H)));
  return open.find((r) => r.glyph === 'weigh') ?? open.find((r) => r.at !== null && r.at >= nowH - 0.5) ?? open[0] ?? null;
}

/** The last timed row's clock hour (the day's "Mark all as planned" waits until it has passed). */
export function lastTimedAt(rows: readonly TodayRow[]): number | null {
  const at = rows.filter((r) => !r.untimed && r.at !== null).map((r) => r.at as number);
  return at.length ? Math.max(...at) : null;
}

/** Open (not yet logged) items, heaviest first: "the lift · 45 min is still open — it carries 30 % of today". */
export function openItems(view: TodayView, label: (itemId: string) => string): string[] {
  const s = view.adherence.today;
  if (!s) return [];
  return [...s.items]
    .filter((i) => i.credit === null)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((i) => `${label(i.itemId)} is still open — it carries ${Math.round(i.weight * 100)} % of today`);
}

/** Goal-date line pieces from the first drift goal: range text and the shift (only when ≥ 3 days). */
export function goalDateLine(view: TodayView): { range: string | null; shift: { days: number; sd: number } | null } {
  const g = view.drift?.[0];
  const r = g?.goalDate.range;
  const shift = g?.goalDate.shiftDays ?? null;
  return {
    range: r ? fmtDateRange(r[0], r[1]) : null,
    shift: shift !== null && Math.abs(shift) >= 3 ? { days: shift, sd: g?.goalDate.shiftSd ?? 0 } : null,
  };
}

/** Today's state for the screen (living-mode.md §4.6). */
export type TodayState = 'scheduled' | 'active' | 'paused' | 'safetyPause' | 'complete' | 'past' | 'future';

export function todayState(view: TodayView | null, plan: { status: string; startDate: LocalDate; plannedEndDate: LocalDate; pauses: Array<{ from: LocalDate; to: LocalDate | null; reason?: string }> } | null, date: LocalDate, today: LocalDate): TodayState {
  if (!plan) return 'active';
  if (today >= plan.plannedEndDate && date >= plan.plannedEndDate) return 'complete';
  // dates decide, not the stored status: a plan saved as 'scheduled' is running once its start date has come
  if (today < plan.startDate) return 'scheduled';
  if (date < today) return 'past';
  if (date > today) return 'future';
  if (plan.status === 'paused') return plan.pauses.some((p) => p.to === null && p.reason === 'safety') ? 'safetyPause' : 'paused';
  void view;
  return 'active';
}

// ------------------------------------------------------------------------------------------- so far: eaten and protein
/**
 * (UI audit #7) What the "So far" strips may say, from the day's channel coverage (A.3.3, §1.2: unknown is never 0): a
 * figure; a lower bound ("at least", when every meal's energy is known but some meal's protein is not); or nothing known
 * (no food logged, or the logged food carries no protein). A zero is shown only when coverage confirms it.
 */
export type IntakeFigure = { kind: 'value'; value: number } | { kind: 'atLeast'; value: number } | { kind: 'unknown'; why: 'nothingLogged' | 'notInFood' };

const CONFIRMS = new Set(['complete', 'confirmedZero']);

export function intakeFigures(view: Pick<TodayView, 'logged' | 'coverage'>): { eaten: IntakeFigure; protein: IntakeFigure } {
  const cov = view.coverage;
  const kcal = view.logged.totals.energyKcal.value;
  const prot = view.logged.totals.proteinG.value;
  const meals = view.logged.entries.some((e) => e.kind === 'meal');
  const eaten: IntakeFigure = kcal > 0 || CONFIRMS.has(cov?.energy ?? '') ? { kind: 'value', value: kcal } : { kind: 'unknown', why: 'nothingLogged' };
  let protein: IntakeFigure;
  if (CONFIRMS.has(cov?.protein ?? '')) protein = { kind: 'value', value: prot };
  else if (cov?.energy === 'complete' && cov.protein === 'partial') protein = prot > 0 ? { kind: 'atLeast', value: prot } : { kind: 'unknown', why: 'notInFood' };
  else if (prot > 0) protein = { kind: 'value', value: prot };
  else protein = { kind: 'unknown', why: kcal > 0 || meals ? 'notInFood' : 'nothingLogged' };
  return { eaten, protein };
}

export const INTAKE_UNKNOWN_TEXT: Record<'nothingLogged' | 'notInFood', string> = { nothingLogged: 'Nothing logged yet', notInFood: 'Not known for what was logged' };
