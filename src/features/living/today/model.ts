/**
 * Today's view model (living-mode.md §4): joins E5's `TodayView` checklist with the frozen prescription into the rows
 * the person ticks (COMPONENTS §13.10), the "so far" lines and the forecast line. Pure; nothing here computes a score,
 * a credit, a band or a goal date — they are read from the contract.
 * TODO(E5): the contract carries no per-meal status; a meal row that is ticked with no meal entry and no day mark is
 * shown as skipped (the stand-in records "skipped" that way). Replace when `TodayView.checklist` gains a status.
 */
import type { LocalDate, PrescribedDaySnapshot, TodayChecklistItem, TodayView } from '@/living';
import { fmtClock, fmtDateRange, fmtHours, grams, kcal, mealName } from '../format';
import { sourceLabel } from '../components/Estimate';
import type { SupplementRow } from '@/catalogues/supplements';
import { mergedSupplementLine, ownTakingRow } from '../food/supplements';

export type RowStatus = 'empty' | 'done' | 'partial' | 'skipped' | 'assumed';
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
  /** Target or the concrete plan: "640 kcal · 40 g protein", "mudgar two-hand swing, dand, baithak", "9 000". */
  target: string;
  /** Numbers in the target that quiet mode hides (meal kcal). */
  quietTarget?: string;
  status: RowStatus;
  /** What was logged against it (meal energy, steps, sleep), with its source. */
  logged?: { value: number; sd?: number; unit: string; approx: boolean; source: string; decimals?: number };
  item: TodayChecklistItem;
  untimed: boolean;
}

function sessionText(rx: PrescribedDaySnapshot, slotKey: string): { label: string; target: string } {
  const s = rx.sessions.find((x) => x.slotKey === slotKey);
  if (!s) return { label: 'session', target: '' };
  const kind = s.kind === 'resistance' ? 'lift' : (s.engine[0]?.kind === 'cardio' ? s.engine[0].modality : 'cardio').replace('other', 'cardio');
  const names = s.concrete?.items.map((i) => shortName(i.name)) ?? [];
  return { label: `${kind} · ${fmtHours(s.durationMin / 60)}`, target: names.length ? names.join(', ') : s.kind === 'resistance' ? 'strength session' : 'steady effort' };
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

/**
 * Who logged steps or sleep, and how: a device's night reads "device · measured"; a person's (or the Coach's) entry
 * that equals the number the tick logs is the "as planned" tick ("you · as planned"); any other number was typed.
 * (`log.sleep`/`log.steps` carry no method and the entry summary only `by`, so the tick is recognised by its number.)
 */
/** The night the sleep tick logs when the plan names no sleep window (data/commands.ts `markRow`). */
const TICK_SLEEP_H = 7.5;

function loggedSource(view: TodayView, kind: 'steps' | 'sleep', value: number, planned: number | undefined): string {
  if (kind === 'sleep' && view.biometrics?.lastNight) return sourceLabel('device', 'biometrics');
  // the entry the contract read the value from (its first of the kind)
  const e = view.logged.entries.find((x) => x.kind === kind);
  if (!e || e.source === 'device') return sourceLabel('device', 'biometrics');
  const asPlanned = planned !== undefined && Math.abs(value - planned) < 0.01;
  return sourceLabel(e.source, asPlanned ? 'asPlanned' : e.aiEstimated || e.source === 'ai' ? 'aiText' : 'typed');
}

/** Extras the contract does not carry: the day's weigh-in when there is no trend yet (from the trend lane's weigh-ins). */
export interface TodayRowExtras {
  weighInKg?: number;
  /** The person's own supplement rows: a plan supplement they already take shows their name and dose (Q6-11). */
  supplements?: readonly SupplementRow[] | null;
}

/** The rows of Today's plan, in time order, untimed rows last (steps, sleep, supplements). */
export function todayRows(view: TodayView, extras: TodayRowExtras = {}): TodayRow[] {
  const rx = view.prescription;
  if (!rx) return [];
  const dayMarked = view.checklist.some((c) => c.id === 'mark:all' && c.done);
  const rows: TodayRow[] = [];
  // the contract's checklist leaves out steps and sleep once a device has measured them (nothing left to tap); Today
  // still shows those rows, so a device-fed stream keeps its value and the Correct action (SUITE_SPEC §14.6)
  const checklist = [...view.checklist];
  const observed = (kind: 'steps' | 'sleep', label: string, command: TodayChecklistItem['command']) => {
    if (!checklist.some((c) => c.kind === kind)) checklist.push({ id: kind, kind, label, done: true, command });
  };
  if (rx.steps !== undefined) observed('steps', 'Steps', { id: 'log.steps', input: { date: view.date } });
  observed('sleep', 'Last night’s sleep', { id: 'log.sleep', input: { date: view.date } });
  for (const c of checklist) {
    if (c.kind === 'mark') continue;
    const base = { id: c.id, at: c.at ?? null, item: c };
    if (c.kind === 'weigh') {
      // the logged weigh-in stays in the field after logging, also before the trend filter has a trend
      const measured = view.trendWeight?.measured ?? extras.weighInKg;
      rows.push({ ...base, itemId: null, glyph: 'weigh', label: 'weigh in', target: c.at !== undefined ? 'before breakfast' : 'once today', status: c.done ? 'done' : 'empty', untimed: false, ...(measured !== undefined ? { logged: { value: measured, unit: 'kg', approx: false, source: 'you · typed', decimals: 1 } } : {}) });
    } else if (c.kind === 'meal') {
      const slot = c.id.slice(5);
      const m = rx.meals.find((x) => x.slot === slot);
      const entry = m ? view.logged.entries.find((e) => e.kind === 'meal' && e.clockH !== undefined && Math.abs(e.clockH - m.clockH) <= 2) : undefined;
      const status: RowStatus = !c.done ? 'empty' : entry || dayMarked ? 'done' : 'skipped';
      rows.push({
        ...base,
        itemId: null,
        glyph: 'meal',
        label: m ? mealName(m.slot, m.clockH) : slot,
        target: m ? `${kcal(m.energyKcal)} kcal · ${grams(m.proteinG)} g protein` : '',
        quietTarget: 'portions on Food',
        status,
        untimed: false,
        ...(entry?.energyKcal ? { logged: { value: entry.energyKcal.value, sd: entry.energyKcal.sd, unit: 'kcal', approx: true, source: sourceLabel(entry.source, entry.aiEstimated ? 'aiText' : undefined) } } : {}),
      });
    } else if (c.kind === 'session') {
      const slotKey = c.id.slice(8);
      const s = rx.sessions.find((x) => x.slotKey === slotKey);
      const itemId = s ? `${s.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${slotKey}` : null;
      const t = sessionText(rx, slotKey);
      rows.push({ ...base, itemId, glyph: 'session', label: t.label, target: t.target, status: (itemId ? statusOfItem(view, itemId) : null) ?? (c.done ? 'done' : 'empty'), untimed: false });
    } else if (c.kind === 'fast') {
      const f = view.logged.fast;
      const target =
        f?.state === 'running' && f.sinceH !== undefined
          ? `${fmtHours(f.sinceH)} done${f.remainingH !== undefined ? `, ${fmtHours(f.remainingH)} to go` : ''}`
          : f?.state === 'broken'
            ? `broken${f.sinceH !== undefined ? ` — ${Math.round(f.sinceH)} of ${Math.round(rx.fast?.hours ?? 0)} h counted` : ''}`
            : `${Math.round(rx.fast?.hours ?? 0)} h`;
      rows.push({ ...base, itemId: 'fast', glyph: 'fast', label: 'fast', target, status: statusOfItem(view, 'fast') ?? (c.done ? 'done' : 'empty'), untimed: c.at === undefined });
    } else if (c.kind === 'steps') {
      rows.push({
        ...base,
        itemId: 'steps',
        glyph: 'steps',
        label: 'steps',
        target: rx.steps !== undefined ? kcal(rx.steps) : '',
        status: statusOfItem(view, 'steps') ?? (c.done ? 'done' : 'empty'),
        untimed: true,
        ...(view.logged.steps !== undefined ? { logged: { value: view.logged.steps, unit: 'steps', approx: false, source: loggedSource(view, 'steps', view.logged.steps, rx.steps) } } : {}),
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
        ...(view.logged.sleepHours !== undefined ? { logged: { value: view.logged.sleepHours, unit: 'h', approx: false, source: loggedSource(view, 'sleep', view.logged.sleepHours, sl ? (sl.wakeH - sl.bedH + 24) % 24 : TICK_SLEEP_H), decimals: 1 } } : {}),
      });
    } else if (c.kind === 'supplement') {
      const id = c.id.slice(11);
      const s = rx.supplements.find((x) => x.supplementId === id);
      const own = ownTakingRow(id, extras.supplements);
      const merged = s && own ? mergedSupplementLine(s, own) : null;
      rows.push({ ...base, itemId: `supplement:${id}`, glyph: 'supplement', label: merged ? shortName(merged.name) : id, target: merged ? merged.line : s ? `${s.dose} ${s.unit}` : '', status: statusOfItem(view, `supplement:${id}`) ?? (c.done ? 'done' : 'empty'), untimed: c.at === undefined });
    }
  }
  const timed = rows.filter((r) => !r.untimed).sort((a, b) => (a.at ?? 99) - (b.at ?? 99));
  const untimed = rows.filter((r) => r.untimed);
  return [...timed, ...untimed];
}

/** "Weigh in at 07:00 before breakfast · missed a session? do it tomorrow" (shown once per day under the title). */
export function intentionsLine(weighInH: number | undefined, missed: 'nextDay' | 'skip' | 'shorter' | undefined, copy: { intentions: (w: string | null, m: string | null) => string; missed: Record<'nextDay' | 'skip' | 'shorter', string> }): string {
  return copy.intentions(weighInH !== undefined ? fmtClock(weighInH) : null, missed ? copy.missed[missed] : null);
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
  if (plan.status === 'scheduled' || today < plan.startDate) return 'scheduled';
  if (date < today) return 'past';
  if (date > today) return 'future';
  if (plan.status === 'paused') return plan.pauses.some((p) => p.to === null && p.reason === 'safety') ? 'safetyPause' : 'paused';
  void view;
  return 'active';
}
