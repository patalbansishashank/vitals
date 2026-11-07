/**
 * Supplement row (design/COMPONENTS.md §14.4; SUITE_SPEC §13.2): one row per supplement, used in the intake's
 * "which supplements" question, Settings › Supplements and the Food tab.
 *
 * Left: name, evidence badge, the catalogue's usual dose. Right: the state (taking · have it, don't take · not for me).
 * Under them, two lines that take the row's full width: the amount (the field grows, then its unit and "each time") and
 * the four times of day as a multi-toggle bank of equal 44 px keys, at any row width. The row lays itself out by its own
 * width (container queries in `SupplementRow.css`): below 480 px the state becomes a Select. Controls never shrink
 * under their minimum width: the row wraps instead, so nothing overlaps.
 *
 * Controlled: every change calls `onChange` with the whole row (callers dispatch `supplements.set` or keep a draft).
 * Variant `today` (Food tab) shows "5 g · morning" with a Taken key and an Edit key that turns the row into `edit`.
 */
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { X } from 'lucide-react';
import {
  ErrorText,
  GradeBadge,
  IconKey,
  Key,
  KeyBank,
  MonoMeta,
  NumberField,
  RailNode,
  Select,
} from '@/components';
import {
  TIMES_OF_DAY,
  catalogueDoseLine,
  dailyAmount,
  doseText,
  doseUnits,
  setRowDose,
  setRowState,
  supplementGrade,
  supplementShortName,
  toggleTime,
  validateDose,
  type SupplementRow as Row,
  type SupplementState,
} from '@/catalogues/supplements';
import { occasionActives } from '@/catalogues/supplements/exposure';
import type { ExposureId } from '@/lib/bodyContracts';
import { SUPPLEMENT_ROW_COPY as C } from './SupplementRow.copy';
import './SupplementRow.css';

type ShownState = Exclude<SupplementState, 'unknown'>;
const STATES: readonly ShownState[] = ['taking', 'onHand', 'notForMe'];

/** Short safety status words of a row (C6 vocabulary). */
const SAFETY_WORD = {
  review: 'Review',
  unchecked: 'Unchecked',
  clinicianStop: 'Stopped by your clinician',
} as const;

/** Plain names of the actives a row can carry (canonical exposure ids). */
const ACTIVE_NAME: Readonly<Partial<Record<ExposureId, string>>> = {
  magnesium: 'magnesium',
  calcium: 'calcium',
  iron: 'iron',
  zinc: 'zinc',
  iodine: 'iodine',
  vitD: 'vitamin D',
  b12: 'vitamin B12',
  folateDfe: 'folate',
  vitARae: 'vitamin A',
  vitC: 'vitamin C',
  potassium: 'potassium',
  sodium: 'sodium',
  caffeine: 'caffeine',
  creatine: 'creatine',
  epaDha: 'EPA + DHA',
  protein: 'protein',
  nitrate: 'nitrate',
  exogenousBhb: 'BHB',
  leucine: 'leucine',
};
const UNIT_TEXT: Readonly<Record<string, string>> = { ug: 'µg' };
/** D7-04 status word: the record is valid, its potency or dose is not known (safety Unchecked). */
export const DOSE_UNKNOWN = 'Dose unknown';

/**
 * D7-04: what one occasion of a taken row carries, as known amounts ("200 mg magnesium", "elemental" when the label says
 * so), or "Dose unknown" when the potency or the dose is not known (a valid record whose safety is Unchecked, never a
 * pass). Null for rows that are not taken or have no active identity (free text without a label).
 */
export function activeText(row: Row): string | null {
  if (row.state !== 'taking') return null;
  const acts = occasionActives(row);
  if (!acts.length) return null;
  const known = acts.filter((a) => a.value !== null && ACTIVE_NAME[a.ingredient]);
  if (!known.length) return acts.some((a) => a.value === null) ? DOSE_UNKNOWN : null;
  // a dose already typed in the active's own unit says it (5 g creatine): no second line
  if (known.every((a) => a.provenance === 'catalogueUnit' && (UNIT_TEXT[a.unit] ?? a.unit) === row.unit))
    return null;
  return known
    .map((a) => {
      const v = a.value!;
      const dec = v >= 10 || Number.isInteger(v) ? 0 : v >= 1 ? 1 : 2;
      return `${+v.toFixed(dec)} ${UNIT_TEXT[a.unit] ?? a.unit} ${a.form === 'elemental' ? 'elemental ' : ''}${ACTIVE_NAME[a.ingredient]}`;
    })
    .join(' · ');
}

/** Units typed as whole numbers (others take one decimal: 2.5 g, 1.5 scoops). */
const WHOLE_UNITS = new Set(['mg', 'µg', 'IU', 'ml']);

/** Below this row width the state control is a Select (the bank of three would not fit beside the name). */
export const NARROW_ROW_PX = 480;

function useRowWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setW(Math.round(width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export interface SupplementRowProps {
  row: Row;
  onChange(row: Row): void;
  variant?: 'edit' | 'today';
  /** Today variant: taken today (the tick key is pressed). */
  taken?: boolean;
  /** Today variant: the tick key (absent = no tick key). */
  onTaken?(): void;
  /** A safety answer advises against it: shown as a caution line under the name (the row is never hidden). */
  caution?: string | null;
  /** Free-text or picked rows can be removed (intake list, Settings). */
  onRemove?(): void;
  /** Show the dose errors (after the person tried to finish); warnings always show. */
  showErrors?: boolean;
  /** Local date given to a row that moves into taking (its `since`). */
  today?: string;
  className?: string;
}

export function SupplementRow({
  row,
  onChange,
  variant = 'edit',
  taken = false,
  onTaken,
  caution,
  onRemove,
  showErrors = false,
  today,
  className,
}: SupplementRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useRowWidth(ref);
  const narrow = width < NARROW_ROW_PX;
  const [editing, setEditing] = useState(variant === 'edit');
  const nameId = useId();
  const doseErrId = useId();
  const timeErrId = useId();
  const name = supplementShortName(row);
  const grade = supplementGrade(row.supplementId);
  const usual = catalogueDoseLine(row.supplementId);
  const units = doseUnits(row.supplementId);
  const unit = row.unit && units.includes(row.unit) ? row.unit : units[0]!;
  const check = validateDose(row);
  const err = (codes: string[]) =>
    showErrors ? check.issues.find((i) => i.kind === 'error' && codes.includes(i.code))?.message : undefined;
  const doseErr = err(['noDose', 'notPositive', 'tooLarge', 'unit']);
  const timeErr = err(['noTime']);
  const warning = check.issues.find((i) => i.kind === 'warning')?.message;
  const taking = row.state === 'taking';
  const shownState = row.state === 'unknown' ? undefined : row.state;
  const perDay =
    taking && row.dose !== undefined && row.timesOfDay.length > 1
      ? C.perDay(String(+(dailyAmount(row) ?? 0).toFixed(2)), unit)
      : null;
  // D7-03/D7-04: the row's own safety status as a short word (the log itself stays accurate and recordable): a clinician
  // stop, a known problem to review, or Unchecked when the product's potency is unknown (never a pass)
  const safetyWord = taking
    ? row.clinicianStop
      ? SAFETY_WORD.clinicianStop
      : row.safetyCheck === 'violation'
        ? SAFETY_WORD.review
        : row.safetyCheck === 'unchecked'
          ? SAFETY_WORD.unchecked
          : null
    : null;

  const stateControl = narrow ? (
    <Select<ShownState>
      size="sm"
      label={shownState ? C.stateNow(name, C.states[shownState]) : C.stateLabel(name)}
      placeholder={C.chooseState}
      value={shownState}
      onChange={(s) => onChange(setRowState(row, s, today))}
      options={STATES.map((s) => ({ value: s, label: C.states[s] }))}
    />
  ) : (
    <KeyBank<ShownState>
      fit
      size="md"
      label={shownState ? C.stateNow(name, C.states[shownState]) : C.stateLabel(name)}
      value={shownState}
      onChange={(s) => onChange(setRowState(row, s, today))}
      options={STATES.map((s) => ({ value: s, label: C.states[s] }))}
    />
  );

  const showTodayLine = variant === 'today' && !editing;
  return (
    <div
      ref={ref}
      role="group"
      aria-labelledby={nameId}
      className={['lm-supprow', className].filter(Boolean).join(' ')}
      data-state={row.state}
      data-variant={showTodayLine ? 'today' : 'edit'}
    >
      <div className="lm-supprow__grid">
        {showTodayLine && onTaken && taking ? (
          <div className="lm-supprow__tick">
            <RailNode
              hue="food"
              status={taken ? 'done' : 'empty'}
              label={taken ? C.undoTakenName(name) : C.takenName(name)}
              onPress={onTaken}
            />
          </div>
        ) : null}
        <div className="lm-supprow__left">
          <div className="lm-supprow__title">
            <span id={nameId} className="lm-supprow__name">
              {name}
            </span>
            {grade ? <GradeBadge grade={grade} size="sm" /> : null}
          </div>
          {showTodayLine ? (
            <>
              <MonoMeta as="p" className="lm-supprow__line">
                {taking
                  ? doseText(row) || C.unknown
                  : row.state === 'onHand'
                    ? C.onHand
                    : row.state === 'notForMe'
                      ? C.notForMe
                      : C.unknown}
              </MonoMeta>
              {/* D7-04: the active amount when known, else "Dose unknown"; the safety word below is a separate status */}
              {activeText(row) ? (
                <MonoMeta as="p" className="lm-supprow__line">
                  {activeText(row)}
                </MonoMeta>
              ) : null}
            </>
          ) : (
            <>
              {row.state !== 'notForMe' ? (
                <p className="lm-supprow__line">{row.supplementId ? usual : C.yourOwn}</p>
              ) : null}
              {row.state === 'onHand' ? <p className="lm-supprow__line">{C.onHand}</p> : null}
              {row.state === 'notForMe' ? (
                <p className="lm-supprow__line lm-supprow__line--quiet">{C.notForMe}</p>
              ) : null}
            </>
          )}
          {caution ? <p className="lm-supprow__caution">{caution}</p> : null}
          {safetyWord && !caution ? <p className="lm-supprow__caution">{safetyWord}</p> : null}
          {taking && warning ? <p className="lm-supprow__caution">{warning}</p> : null}
        </div>

        {showTodayLine ? (
          <div className="lm-supprow__today">
            <Key variant="text" size="md" onClick={() => setEditing(true)}>
              {C.edit}
            </Key>
          </div>
        ) : (
          <>
            <div className="lm-supprow__state">
              {stateControl}
              {onRemove ? (
                <IconKey icon={X} label={C.removeName(name)} variant="text" size="sm" onClick={onRemove} />
              ) : null}
              {variant === 'today' ? (
                <Key variant="text" size="sm" onClick={() => setEditing(false)}>
                  {C.done}
                </Key>
              ) : null}
            </div>
            {taking ? (
              <div className="lm-supprow__controls">
                <div className="lm-supprow__dose">
                  <NumberField
                    className="lm-supprow__dosefield"
                    name={C.doseName(name, C.unitWords[unit] ?? unit)}
                    value={row.dose ?? null}
                    onChange={(n) => onChange(setRowDose(row, n, unit))}
                    min={0}
                    max={100_000}
                    step={WHOLE_UNITS.has(unit) ? 1 : 0.5}
                    decimals={WHOLE_UNITS.has(unit) ? 0 : 1}
                    unit={units.length === 1 ? unit : undefined}
                    unitText={unit}
                  />
                  {units.length > 1 ? (
                    <Select<string>
                      size="md"
                      className="lm-supprow__unit"
                      label={C.unitLabel(name)}
                      value={unit}
                      onChange={(u) => onChange(setRowDose(row, row.dose, u))}
                      options={units.map((u) => ({ value: u, label: u }))}
                    />
                  ) : null}
                  <span className="lm-supprow__each">{perDay ?? C.each}</span>
                  {doseErr ? <ErrorText id={doseErrId}>{doseErr}</ErrorText> : null}
                </div>
                <div className="lm-supprow__times">
                  <div
                    role="group"
                    aria-label={C.timesLabel(name)}
                    aria-describedby={timeErr ? timeErrId : undefined}
                    className="lm-bank lm-supprow__bank"
                    data-size="md"
                  >
                    {TIMES_OF_DAY.map((t) => {
                      const on = row.timesOfDay.includes(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          className="lm-bank__key"
                          aria-pressed={on}
                          data-selected={on}
                          aria-label={C.timeName(name, t)}
                          onClick={() => onChange(toggleTime(row, t))}
                        >
                          {C.times[t]}
                        </button>
                      );
                    })}
                  </div>
                  {timeErr ? <ErrorText id={timeErrId}>{timeErr}</ErrorText> : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
