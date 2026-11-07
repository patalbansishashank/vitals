/**
 * Today's plan as a day rail (COMPONENTS §13.10, Ember 2026-10-17): a thin time spine down the card, one stop per thing
 * to do. Each stop reads time · tick · what · its targets. The node on the spine IS the tick: one tap marks the stop as
 * planned (a gold check), a second tap undoes it while the toast's Undo would; a stop logged earlier opens its sheet
 * instead. Tapping the stop's text opens the row sheet (as planned · partly · skipped, plus the item's own editor); a
 * meal opens the meal sheet Food opens too (../../components/MealSheet), with the recipe and the manual logger. The
 * weigh-in is the one stop with a key ("Log"); once logged its value opens the weight sheet to change it. What was
 * logged reads as the value against the plan ("430 of 1 332 kcal"), never a provenance chip or a range. On the real today
 * a gold "now" bar sits on the spine. Future days are a read-only preview: the same rail with no ticks or keys. Untimed
 * stops (steps, sleep, supplements) follow after a gap.
 */
import { Fragment, useEffect, useId, useState, type ReactNode } from 'react';
import './prescription-rows.css';
import { useNavigate } from 'react-router';
import {
  ChevronDown,
  MoonStar,
  Sunrise,
  Scale,
  Utensils,
  Dumbbell,
  Flame,
  Footprints,
  Pill,
} from 'lucide-react';
import {
  DottedTrack,
  Field,
  Icon,
  Key,
  KeyBank,
  NumberField,
  ResponsivePanel,
  Rail,
  RailNode,
  StateStrip,
  Stepper,
  MonoMeta,
  MQ,
  useMediaQuery,
  energyInText,
  formatEnergy,
  formatNumber,
  toast,
  type StateSegment,
} from '@/components';
import { addDays } from '@/living/dates';
import { useEnergyUnit, useSettingsStore } from '@/state/settingsStore';
import { kgToLb } from '@/lib/units';
import type { LocalDate } from '@/living';
import { TODAY_COPY } from '../../copy';
import { useLivingActions, type ActionOutcome, type RowMark } from '../../data/actions';
import { localDateOf, useLivingClock, useToday } from '../../clock';
import { ACTIVITY_COPY } from '../../copy';
import { clockOfIso, saveSleepTimes, useSleepEntry } from '../../sleep/entry';
import {
  DAY_PART_LABEL,
  DAY_STRIP_STATES,
  dayGroups,
  sleepAction,
  wakingDateOf,
  type DayPart,
} from '../../activity/model';
import { fmtClock } from '../../format';
import { livingPaths } from '../../paths';
import { useMealLogger } from '../../food/useMealLogger';
import type { TodayRow } from '../model';
import { WeighSheet } from './WeighSheet';
import { TargetReadout } from '../../components/TargetReadout';
import { MARK_OF_STATUS as STATUS_MARK, MealSheet, useMealAnswer } from '../../components/MealSheet';
import { useRingNightHours } from '@/features/ring';

type Undo = () => Promise<unknown>;

export interface PrescriptionRowsProps {
  rows: readonly TodayRow[];
  /** The hero keeps the next three stops on phones, with the whole day one disclosure away. */
  compact?: boolean;
  /** Open the same editor from the hero headline. */
  openRowId?: string | null;
  onOpenRowHandled?: () => void;
  date: LocalDate;
  /** Future dates are read-only previews. */
  readOnly: boolean;
  quiet: boolean;
  /** Item to highlight (the dial's arc was clicked). */
  highlight?: string | null;
  /** The clock hour on the real today: draws the "now" bar on the rail. */
  nowH?: number | null;
  /** The latest weigh-in (kg): the weight sheet starts from it. */
  lastKg?: number | undefined;
  /** The plan day as a 24 h strip above the rail (D18): sleep, the eating window, the fast, training. */
  strip?: { from: number; to: number; now: number | null; segments: StateSegment[] } | null;
  /** The planned bed time (the evening's "Going to sleep" key shows from an hour before it). */
  bedH?: number | null;
  /** The planned sleep in hours (the sleep row's strip). */
  sleepTargetH?: number | null;
  /** The planned fast in hours and the hours elapsed so far (the fast row's strip). */
  fastTargetH?: number | null;
  fastElapsedH?: number | null;
  /** The planned steps (the steps row's dot fill). */
  stepsTarget?: number | null;
}

/** Id of the weigh-in control for a date (the `W` shortcut clicks it). */
export const weighFieldId = (date: LocalDate) => `lv-weigh-${date}`;

const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
/** (Claude P2-17) The untimed stops' head. */
const ANY_TIME = 'Any time';

/** Why the fast's end can't be logged yet: its time is entered, never assumed. */
const FAST_END_NEEDED = 'Enter the time the fast ended.';

/** Toast an outcome; failures read as plain sentences. */
function report(o: ActionOutcome, ok: string) {
  if (!o.ok) {
    toast(o.message ?? TODAY_COPY.failed);
    return;
  }
  toast(ok, o.undo ? { action: { label: TODAY_COPY.undo, onClick: () => void o.undo?.() } } : {});
}

/** A value in the row's unit, in the person's units ("430" kcal, "6 120" steps, "7.2" h). */
function amount(
  value: number,
  unit: string,
  decimals: number,
  eu: 'kcal' | 'kJ',
): { n: string; unit: string } {
  if (unit === 'kcal') return { n: formatEnergy(value, eu, { withUnit: false }), unit: eu };
  return { n: formatNumber(value, decimals), unit };
}
const withUnit = (a: { n: string; unit: string }) => `${a.n} ${a.unit}`;

/** "7 h 12", "8 h": hours as the strips print them. */
function hoursText(h: number): string {
  const m = Math.round(h * 60);
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${hh} h` : `${hh} h ${String(mm).padStart(2, '0')}`;
}

const ROW_GLYPHS = {
  weigh: { icon: Scale, hue: 'body' },
  meal: { icon: Utensils, hue: 'food' },
  session: { icon: Dumbbell, hue: 'steps' },
  fast: { icon: Flame, hue: 'energy' },
  steps: { icon: Footprints, hue: 'steps' },
  sleep: { icon: MoonStar, hue: 'sleep' },
  supplement: { icon: Pill, hue: 'food' },
} as const;

/** Plan clock times remain visible; body measurements and target amounts become words. */
export function quietRowLabel(row: TodayRow, quiet: boolean): string {
  if (!quiet) return row.label;
  return (
    row.label
      .split(' · ')[0]!
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:g|mg|kg|min|h)\b/gi, '')
      .trim() || row.glyph
  );
}

export function quietRowTarget(row: TodayRow): string {
  if (row.quietTarget && !/\d/.test(row.quietTarget)) return row.quietTarget;
  return {
    weigh: 'Your weigh-in',
    meal: 'Portions on Food',
    session: 'Your planned session',
    fast: 'Your planned fast',
    steps: 'Your walking goal',
    sleep: 'Your sleep goal',
    supplement: 'Your planned supplement',
  }[row.glyph];
}

/** Keep overdue stops in reach; a compact hero never silently skips an unanswered meal. */
export function compactPreview(rows: readonly TodayRow[], nowH: number | null): TodayRow[] {
  if (nowH === null) return rows.slice(0, 3);
  const open = rows.filter((r) => r.status === 'empty' && !(r.glyph === 'weigh' && (r.logged || nowH >= 12)));
  return (open.length ? open : rows).slice(0, 3);
}

export function PrescriptionRows({
  rows,
  date,
  readOnly,
  quiet,
  highlight,
  compact = false,
  openRowId = null,
  onOpenRowHandled,
  nowH = null,
  lastKg,
  strip = null,
  bedH = null,
  fastTargetH = null,
  fastElapsedH = null,
}: PrescriptionRowsProps) {
  const actions = useLivingActions();
  const answerMeal = useMealAnswer(date);
  const logger = useMealLogger({ date, quiet, screen: 'today' });
  const navigate = useNavigate();
  const today = useToday();
  const eu = useEnergyUnit();
  const uid = useId();
  const [sheet, setSheet] = useState<TodayRow | null>(null);
  const [said, setLive] = useState('');
  const [weighing, setWeighing] = useState(false);
  const lg = useMediaQuery(MQ.lg);
  const [wholeDay, setWholeDay] = useState(false);
  useEffect(() => {
    if (!openRowId || readOnly) return;
    const row = rows.find((r) => r.id === openRowId);
    if (!row) return;
    if (row.glyph === 'weigh') setWeighing(true);
    else setSheet(row);
    onOpenRowHandled?.();
  }, [openRowId, readOnly, rows, onOpenRowHandled]);
  // undo for a stop logged here, so a second tap on its tick reverses it (the toast carries one too, but it goes away)
  const [undos, setUndos] = useState<Record<string, Undo>>({});
  const keepUndo = (id: string, undo: Undo | undefined) =>
    setUndos((u) => {
      const { [id]: _drop, ...rest } = u;
      void _drop;
      return undo ? { ...rest, [id]: undo } : rest;
    });
  const imperial = useSettingsStore((s) => s.units) === 'imperial';
  const weighRow = rows.find((r) => r.glyph === 'weigh');
  const clock = useLivingClock();
  // D21: one tap for "Going to sleep" (lights out for the night ending tomorrow) and "I'm up" (out of bed this morning)
  const live = date === today && !readOnly && nowH !== null;
  // (Claude P1-3) tonight is the night ending on the waking date of now's CALENDAR date and hour: after midnight on the
  // same app day that is the calendar date, not the app date + 1 (and never the night that already ended)
  const calNow = clock.now();
  const wakeDate = live
    ? wakingDateOf(localDateOf(calNow), calNow.getHours() + calNow.getMinutes() / 60)
    : addDays(date, 1);
  const lastNight = useSleepEntry(date);
  const tonight = useSleepEntry(wakeDate);
  const action = live
    ? sleepAction(nowH, { bedH, lightsOutTonight: !!tonight?.lightsOutAt, upToday: !!lastNight?.outOfBedAt })
    : null;
  const tapSleep = async () => {
    if (!action || nowH === null) return;
    const at = clock.now().toISOString();
    const o =
      action === 'goingToSleep'
        ? await saveSleepTimes(wakeDate, { lightsOutAt: at })
        : await saveSleepTimes(date, { outOfBedAt: at });
    if (!o.ok) return void toast(o.message ?? TODAY_COPY.failed);
    const text =
      action === 'goingToSleep'
        ? ACTIVITY_COPY.lightsOutSaved(clockOfIso(at))
        : ACTIVITY_COPY.upSaved(clockOfIso(at));
    setLive(text);
    toast(text, o.undo ? { action: { label: TODAY_COPY.undo, onClick: () => void o.undo?.() } } : {});
  };
  // D18: the timed stops by part of the day; a finished part before now folds away, the rest stay open
  const [folded, setFolded] = useState<Partial<Record<DayPart, boolean>>>({});
  const [anyFolded, setAnyFolded] = useState(true);

  const tick = async (r: TodayRow) => {
    // a meal ticks the way its sheet and Food's key do: an accepted recipe is what "as planned" logs
    const o =
      r.glyph === 'meal'
        ? await answerMeal({ slot: r.id.slice(5) }, 'asPlanned')
        : await actions.tick(date, r.item);
    if (!o.ok) {
      toast(o.message ?? TODAY_COPY.failed);
      return;
    }
    keepUndo(r.id, o.undo);
    setLive(TODAY_COPY.ticked(quietRowLabel(r, quiet)));
    report(o, TODAY_COPY.ticked(quietRowLabel(r, quiet)));
  };
  const untick = async (r: TodayRow) => {
    const undo = undos[r.id];
    keepUndo(r.id, undefined);
    if (!undo) return;
    await undo();
    setLive(`${cap(quietRowLabel(r, quiet))}: undone`);
  };

  const timed = rows.filter((r) => !r.untimed);
  const untimed = rows.filter((r) => r.untimed);

  /** A stop is finished for the day once it has an answer (the weigh-in once a weight is logged). */
  const isDone = (r: TodayRow) => r.status !== 'empty' || (r.glyph === 'weigh' && !!r.logged);
  /** (Claude P2-17) What a group counts as done: done or assumed as planned (a skipped or partial stop is answered, not done). */
  const countsDone = (r: TodayRow) =>
    r.status === 'done' || r.status === 'assumed' || (r.glyph === 'weigh' && !!r.logged);

  const loggedFor = (r: TodayRow): ReactNode => {
    if (quiet) return <span>{r.status !== 'empty' ? TODAY_COPY.rowWord[r.status] : 'Logged'}</span>;
    if (r.glyph === 'weigh' && r.logged)
      return (
        <TargetReadout
          text={`${(imperial ? kgToLb(r.logged.value) : r.logged.value).toFixed(1)} ${imperial ? 'lb' : 'kg'}`}
        />
      );
    const hide = quiet && r.logged?.unit === 'kcal';
    if (r.logged && !hide) {
      const v = amount(r.logged.value, r.logged.unit, r.logged.decimals ?? 0, eu);
      const of =
        r.logged.planned !== undefined
          ? amount(r.logged.planned, r.logged.unit, r.logged.decimals ?? 0, eu)
          : null;
      return (
        <span>
          <span className="lv-item__value lm-num">{v.n}</span> {of ? `of ${of.n} ${of.unit}` : v.unit}
        </span>
      );
    }
    return r.status !== 'empty' ? (
      <span className="lv-item__word">{TODAY_COPY.rowWord[r.status]}</span>
    ) : null;
  };

  const renderRow = (r: TodayRow) => {
    const done = isDone(r);
    const needsValue = r.glyph === 'sleep' && !r.target;
    const rowLabel = quietRowLabel(r, quiet);
    const target = quiet ? quietRowTarget(r) : energyInText(r.target, eu);
    const nodeLabel = !done
      ? needsValue
        ? TODAY_COPY.changeName(rowLabel)
        : TODAY_COPY.tickName(rowLabel)
      : undos[r.id]
        ? TODAY_COPY.untickName(rowLabel)
        : TODAY_COPY.changeName(rowLabel);
    const open = () => (r.glyph === 'weigh' ? setWeighing(true) : setSheet(r));
    const onPress = () => {
      if (r.glyph === 'weigh' || needsValue) return open();
      if (!done) return void tick(r);
      if (undos[r.id]) return void untick(r);
      open();
    };
    const glyph = ROW_GLYPHS[r.glyph];
    const isFastRunning = r.glyph === 'fast' && fastTargetH && fastElapsedH !== null && fastElapsedH > 0;
    return (
      <li
        key={r.id}
        className="lm-rail__row lv-prescription__row"
        data-state={r.glyph === 'weigh' ? (done ? 'done' : 'empty') : r.status}
        data-row={r.id}
        data-item={r.itemId ?? undefined}
        data-highlight={(highlight != null && highlight === r.itemId) || undefined}
        data-open={!readOnly || undefined}
      >
        {r.at !== null && !r.untimed ? <span className="lm-rail__time">{fmtClock(r.at)}</span> : null}
        <RailNode
          status={r.glyph === 'weigh' ? (done ? 'done' : 'empty') : r.status}
          glyph={glyph.icon}
          hue={glyph.hue}
          label={nodeLabel}
          {...(!readOnly && r.glyph !== 'weigh' ? { onPress } : {})}
        />
        <div className="lm-rail__body">
          {!readOnly ? (
            <button
              type="button"
              className="lm-rail__title"
              id={r.glyph === 'weigh' && done ? weighFieldId(date) : undefined}
              aria-label={r.glyph === 'weigh' ? TODAY_COPY.changeName('weight') : `Details for ${rowLabel}`}
              onClick={open}
            >
              {rowLabel}
            </button>
          ) : (
            <span className="lm-rail__title">{rowLabel}</span>
          )}
          <MonoMeta as="div" className="lm-rail__meta" tone="hue" size="sm">
            {done ? loggedFor(r) : target || null}
            {!quiet && r.detail && !done ? <span className="lv-prescription__detail">{r.detail}</span> : null}
          </MonoMeta>
          {isFastRunning ? (
            <DottedTrack
              label="Fast"
              value={fastElapsedH}
              goal={fastTargetH}
              valueText={quiet ? 'Fast running' : `Elapsed ${hoursText(fastElapsedH!)}`}
              goalText={quiet ? 'Planned fast' : `Planned ${hoursText(fastTargetH as number)}`}
              hue="energy"
              quiet={quiet}
              twin={false}
            />
          ) : null}
        </div>
        <div className="lm-rail__trail">
          {!readOnly && r.glyph === 'weigh' && !done ? (
            <Key
              variant="action"
              size="sm"
              id={weighFieldId(date)}
              aria-label="Log weight"
              onClick={() => setWeighing(true)}
            >
              {TODAY_COPY.weighKey}
            </Key>
          ) : null}
          {r.glyph === 'sleep' && action ? (
            <Key
              variant="action"
              size="sm"
              icon={action === 'goingToSleep' ? MoonStar : Sunrise}
              onClick={() => void tapSleep()}
            >
              {action === 'goingToSleep' ? ACTIVITY_COPY.goingToSleep : ACTIVITY_COPY.imUp}
            </Key>
          ) : null}
        </div>
      </li>
    );
  };

  // the "now" bar sits before the first timed stop still ahead of the clock
  const nowAt = nowH === null || readOnly ? -1 : timed.findIndex((r) => (r.at ?? -1) > nowH);
  const nowIdx = nowH === null || readOnly ? -1 : nowAt === -1 ? timed.length : nowAt;
  const nowMark =
    nowH !== null ? (
      <li className="lv-prescription__now" key="now">
        <MonoMeta>{fmtClock(nowH)} · now</MonoMeta>
      </li>
    ) : null;

  const groups = dayGroups(timed, countsDone, live ? nowH : null, isDone);
  const nowGroup = groups.findIndex((g) => g.now);
  // the now bar's place inside its part of the day
  const nextRow = nowIdx >= 0 && nowIdx < timed.length ? timed[nowIdx]! : null;
  // (r068 V16) when the next stop belongs to a later part of the day, the bar closes the part the clock is in (09:40
  // under Morning's last stop, not over Afternoon's Lunch)
  const nowElsewhere = nextRow !== null && nowGroup >= 0 && !groups[nowGroup]!.rows.includes(nextRow);
  const nowRow = nowElsewhere ? null : nextRow;
  const isOpen = (gi: number) => {
    const g = groups[gi]!;
    const f = folded[g.part];
    if (f !== undefined) return !f;
    if (!live || nowGroup < 0) return true;
    // The current part stays open; once answered, the next part opens with it.
    return (
      gi === nowGroup || (gi === nowGroup + 1 && groups[nowGroup]!.answered === groups[nowGroup]!.rows.length)
    );
  };

  const preview = compactPreview(rows, nowH);
  const collapsed = compact && !lg && !wholeDay;
  const countText = (done: number, total: number) =>
    quiet ? (done === 0 ? 'None done' : done >= total ? 'All done' : 'Some done') : `${done} / ${total}`;
  return (
    <>
      {/* The day-strip table belongs to the hero’s information panel. */}
      {strip ? (
        <StateStrip
          label={ACTIVITY_COPY.dayStrip}
          from={strip.from}
          to={strip.to}
          now={strip.now}
          segments={strip.segments}
          stateLabels={[...DAY_STRIP_STATES]}
          stateHues={['food', 'energy', 'steps', 'sleep']}
          mode="category"
          labels
          twin={false}
          quiet={quiet}
          ticks="day"
          className="lv-daystrip"
        />
      ) : null}
      {collapsed ? (
        <Rail label="Next stops" className="lv-prescription">
          {preview.map(renderRow)}
        </Rail>
      ) : (
        <>
          <div className="lv-groups lv-prescription">
            {groups.map((g, gi) => {
              const open = isOpen(gi);
              const listId = `${uid}-g-${g.part}`;
              const endsWithNow =
                (nowIdx === timed.length && g.now && gi === groups.length - 1) ||
                (nowElsewhere && gi === nowGroup);
              return (
                <section
                  key={g.part}
                  className="lv-group"
                  data-now={g.now || undefined}
                  aria-label={DAY_PART_LABEL[g.part]}
                >
                  {/* (UI audit #27, DATAVIZ P12) a real heading holding the disclosure, its count in the name */}
                  <h3 className="lv-group__h">
                    <button
                      type="button"
                      className="lv-group__head"
                      aria-expanded={open}
                      aria-controls={listId}
                      onClick={() => setFolded((f) => ({ ...f, [g.part]: open }))}
                    >
                      <span className="lv-group__name">{DAY_PART_LABEL[g.part]}</span>
                      {g.now ? (
                        <span className="lv-group__now">
                          <span className="lv-group__dot" aria-hidden="true" />
                          {ACTIVITY_COPY.now}
                        </span>
                      ) : null}
                      {/* (r068 T8) a preview day counts nothing done */}
                      {readOnly ? null : (
                        <span className="lv-group__count lm-num">{countText(g.done, g.rows.length)}</span>
                      )}
                      <Icon icon={ChevronDown} size={18} className="lv-group__chev" />
                    </button>
                  </h3>
                  {open ? (
                    <div id={listId}>
                      <Rail label={`${DAY_PART_LABEL[g.part]}, in order`}>
                        {g.rows.map((r) => (
                          <Fragment key={r.id}>
                            {nowRow === r ? nowMark : null}
                            {renderRow(r)}
                          </Fragment>
                        ))}
                        {endsWithNow ? nowMark : null}
                      </Rail>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
          {untimed.length ? (
            // (Claude P2-17) the untimed stops have their own head, so they never read as part of Evening
            // (r068 T6) the same head as a part of the day: a disclosure with its count and chevron, under a rule
            <section className="lv-group lv-group--any" aria-label={ANY_TIME}>
              <h3 className="lv-group__h">
                <button
                  type="button"
                  className="lv-group__head"
                  aria-expanded={!anyFolded}
                  aria-controls={`${uid}-g-any`}
                  onClick={() => setAnyFolded((f) => !f)}
                >
                  <span className="lv-group__name">{ANY_TIME}</span>
                  {readOnly ? null : (
                    <span className="lv-group__count lm-num">
                      {countText(untimed.filter(countsDone).length, untimed.length)}
                    </span>
                  )}
                  <Icon icon={ChevronDown} size={18} className="lv-group__chev" />
                </button>
              </h3>
              {anyFolded ? null : (
                <div id={`${uid}-g-any`}>
                  <Rail className="lv-prescription" label={ACTIVITY_COPY.anyTime}>
                    {untimed.map(renderRow)}
                  </Rail>
                </div>
              )}
            </section>
          ) : null}
        </>
      )}
      {compact && !lg ? (
        <Key
          variant="text"
          className="lv-prescription__whole"
          aria-expanded={wholeDay}
          onClick={() => setWholeDay((v) => !v)}
        >
          {wholeDay ? 'Next stops' : 'Whole day'}
          <Icon icon={ChevronDown} size={16} />
        </Key>
      ) : null}
      <span className="lm-sr" role="status" aria-live="polite">
        {said}
      </span>
      <RowSheet
        quiet={quiet}
        row={sheet && sheet.glyph !== 'meal' ? sheet : null}
        date={date}
        onClose={() => setSheet(null)}
        onUndo={keepUndo}
      />
      <MealSheet
        date={date}
        slot={sheet?.glyph === 'meal' ? sheet.id.slice(5) : null}
        quiet={quiet}
        onClose={() => setSheet(null)}
        onLogOther={logger.open}
        onRecipe={(t) =>
          navigate(
            `${livingPaths.food(date === today ? undefined : date)}?recipe=${encodeURIComponent(t.slot)}`,
          )
        }
        onAnswered={(t, _mark, undo) => keepUndo(`meal:${t.slot}`, undo)}
      />
      {logger.element}
      {weighing ? (
        <WeighSheet
          open={weighing}
          date={date}
          lastKg={weighRow?.logged?.value ?? lastKg}
          onClose={() => setWeighing(false)}
          onSaved={(undo) => keepUndo(weighRow?.id ?? 'weigh', undo)}
        />
      ) : null}
    </>
  );
}

/**
 * The row sheet (T1) for every row but a meal: as planned · partly · skipped (an answer applies at once), then the item's
 * own editor or its page. DESIGN.md overlay grammar: a row whose editor commits a value (the time a fast ended, steps,
 * hours asleep) reads Cancel · title · Log and its verb is the header's, never a key in the body; a row with nothing to
 * commit reads title · ✕. Closing never logs anything.
 */
function RowSheet({
  row,
  date,
  quiet,
  onClose,
  onUndo,
}: {
  quiet: boolean;
  row: TodayRow | null;
  date: LocalDate;
  onClose: () => void;
  onUndo: (id: string, undo: Undo | undefined) => void;
}) {
  const actions = useLivingActions();
  const navigate = useNavigate();
  const eu = useEnergyUnit();
  // C1/D5-05: the time the fast ended is the person's, never a default clock (a guessed point would truncate the fast)
  const [brokeAt, setBrokeAt] = useState<number | null>(null);
  const [value, setValue] = useState<number | null>(null);
  // (r068 V24) without a logged night, the hours start on the ring's night (when there is one)
  const ringHours = useRingNightHours(date);
  // a new row starts its editor afresh (the sheet stays mounted between rows)
  const [forId, setForId] = useState<string | null>(row?.id ?? null);
  if ((row?.id ?? null) !== forId) {
    setForId(row?.id ?? null);
    setValue(null);
    setBrokeAt(null);
  }
  if (!row) return <ResponsivePanel open={false} onClose={onClose} title="" />;
  const label = cap(quietRowLabel(row, quiet));
  const mark = async (m: RowMark) => {
    // the answer it already has changes nothing (and never logs the item twice)
    if (m === STATUS_MARK[row.status]) return onClose();
    const o = await actions.markRow(date, row.id, m);
    report(o, `${label}: ${TODAY_COPY.rowSheet[m].toLowerCase()}`);
    if (o.ok) {
      onUndo(row.id, o.undo);
      onClose();
    }
  };
  const logged = row.logged;
  const fact =
    !quiet && logged && logged.planned !== undefined
      ? TODAY_COPY.loggedOf(
          withUnit(amount(logged.value, logged.unit, logged.decimals ?? 0, eu)),
          withUnit(amount(logged.planned, logged.unit, logged.decimals ?? 0, eu)),
        )
      : null;
  const target = quiet
    ? quietRowTarget(row)
    : [energyInText(row.target, eu), row.detail].filter(Boolean).join(' · ');
  const noTarget = row.glyph === 'sleep' && !row.target;
  const fastEditor = row.glyph === 'fast';
  const valueEditor = row.glyph === 'steps' || row.glyph === 'sleep';
  // (r068 V24) the field starts on what is already logged (the hours asleep, the steps), never empty beside an answer
  const shown =
    value ?? (valueEditor && row.logged ? row.logged.value : row.glyph === 'sleep' ? ringHours : null);
  // the header verb of a row whose editor commits (the fast's end time, steps, hours asleep)
  const commit = fastEditor
    ? {
        onDone: () => {
          if (brokeAt === null) return;
          void actions
            .logFastBroken(date, brokeAt)
            .then((o) => (report(o, `Fast ended at ${fmtClock(brokeAt)} logged`), o.ok && onClose()));
        },
        disabledReason: brokeAt === null ? FAST_END_NEEDED : undefined,
      }
    : valueEditor
      ? {
          onDone: () => {
            if (shown === null) return;
            const p = row.glyph === 'steps' ? actions.logSteps(date, shown) : actions.logSleep(date, shown);
            void p.then((o) => (report(o, `${label} logged`), o.ok && (onUndo(row.id, o.undo), onClose())));
          },
          disabledReason:
            shown === null
              ? row.glyph === 'steps'
                ? 'Enter the steps first.'
                : 'Enter the hours first.'
              : undefined,
        }
      : null;
  return (
    <ResponsivePanel
      open
      onClose={onClose}
      title={label}
      {...(commit
        ? {
            onDone: commit.onDone,
            doneLabel: TODAY_COPY.logKey,
            ...(commit.disabledReason ? { doneDisabledReason: commit.disabledReason } : {}),
          }
        : {})}
    >
      <div className="lv-sheet lv-prescription-sheet" data-domain={ROW_GLYPHS[row.glyph].hue}>
        {fact ? (
          <p className="lv-sheet__fact">{fact}</p>
        ) : target ? (
          <p className="lv-sheet__target">
            <TargetReadout text={target} />
          </p>
        ) : null}
        {noTarget ? null : (
          <KeyBank
            key={`${row.id}:${STATUS_MARK[row.status] ?? ''}`}
            label={TODAY_COPY.howDidItGo(quietRowLabel(row, quiet))}
            size="lg"
            block
            options={(['asPlanned', 'partly', 'skipped'] as const).map((v) => ({
              value: v,
              label: TODAY_COPY.rowSheet[v],
            }))}
            {...(STATUS_MARK[row.status] ? { defaultValue: STATUS_MARK[row.status] } : {})}
            onChange={(v) => void mark(v)}
          />
        )}
        {row.glyph === 'session' ? (
          <Key
            variant="outlined"
            className="lv-rowsheet__open"
            onClick={() => navigate(livingPaths.train(date, 'session'))}
          >
            {TODAY_COPY.openTrain}
          </Key>
        ) : fastEditor ? (
          <div className="lv-sheet__editor lv-rowsheet__editor">
            <Field label={TODAY_COPY.brokeAt}>
              <Stepper
                value={brokeAt}
                onChange={setBrokeAt}
                min={0}
                max={23.75}
                step={0.25}
                decimals={2}
                name="time the fast ended"
                unit="h"
              />
            </Field>
          </div>
        ) : valueEditor ? (
          <div className="lv-sheet__editor lv-rowsheet__editor">
            <Field label={row.glyph === 'steps' ? TODAY_COPY.steps : TODAY_COPY.hoursAsleep}>
              <NumberField
                value={shown}
                onChange={setValue}
                min={0}
                max={row.glyph === 'steps' ? 100000 : 16}
                step={row.glyph === 'steps' ? 100 : 0.25}
                decimals={row.glyph === 'steps' ? 0 : 2}
                name={row.glyph === 'steps' ? 'steps' : 'sleep'}
                unit={row.glyph === 'steps' ? 'steps' : 'h'}
              />
            </Field>
          </div>
        ) : null}
      </div>
    </ResponsivePanel>
  );
}
