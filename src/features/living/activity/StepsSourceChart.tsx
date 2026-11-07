/**
 * Steps by source (§V4.1, §2.3): what the ring saw, what the phone saw and what was counted, hour by hour. One source is
 * selected per interval (never the larger, never the sum); an hour where ring and phone disagree by more than a fifth
 * carries a gold dot. The ring's daily total that no interval holds is unlocated evidence, named beside the total and
 * never added to it. A source that gave no reading all day reads "No reading", never 0 (UI audit #6); (r068 B1) a ring
 * that gave a day total but no step by hour reads that total ("total only"), never "No reading", and the figures under
 * the lanes name each number once (counted by hour, the ring's day total as by hour + with no time, what the day shows),
 * so they add up on screen; "Table" opens the
 * twin of the three lanes hour by hour, missing hours named (UI audit #13). Below the chart the person can say which
 * source counts the day or some of its hours (`log.stepsCorrection`, SPEC §2.3 4(a)); in quiet mode only the whole day,
 * in words. Quiet mode (0.6.3 INT) is words only for the whole panel, aria too: each lane says whether it has readings,
 * the hours where ring and phone disagree are parts of the day, and the table twin (all figures) and the clock axis go.
 */
import { useEffect, useId, useState } from 'react';
import { Key, KeyBank, ResponsivePanel, Select, TwinKey, VizTwinTable, clockText, formatNumber, toCSV } from '@/components';
import { useQuietMode } from '@/state/settingsStore';
import { ACTIVITY_COPY as C } from '../copy';
import { laneTotal, partOfDayWords, type StepsHour } from './model';
import { listStepsCorrections, removeStepsCorrection, saveStepsCorrection, type CorrectionUse, type StepsCorrectionRow } from './stepsCorrections';
import { StepsDayChart, STEPS_DAY_WORDS } from './StepsDayChart';
import type { DayMark } from './ActivityLane';
import type { StepsBin } from './stepsTime';
import './activity.css';

/** (r069 D3) The lanes' heading under the day chart. */
const SOURCE_HEADING = 'By source, hour by hour';

export interface StepsSourceChartProps {
  hours: readonly StepsHour[];
  /** The counted total (located) and the headline (D3). */
  located: number | null;
  headline?: number | null;
  headlinePolicy?: 'located' | 'atLeast' | null;
  /** The ring's daily total not placed in time. */
  residual?: number | null;
  /** (r068 B1) The ring's own total for the day (what its residual is the rest of). */
  ringDailyTotal?: number | null;
  nowMs?: number;
  /** Words only (aria too); the setting in effect when absent. */
  quiet?: boolean;
}

/** Quiet mode: the ring's unplaced steps without their number. */
export const QUIET_RESIDUAL = 'The ring counted some steps it could not place in time (beside the total, never added)';

const LANES = [
  { key: 'ring', label: C.ring },
  { key: 'phone', label: C.phone },
  { key: 'selected', label: C.counted },
] as const;

/** What a lane's total reads: the number, or "No reading" when the source saw nothing. */
export const NO_READING = 'No reading';
const totalText = (v: number | null) => (v === null ? NO_READING : formatNumber(v, 0));
const cell = (v: number | null) => (v === null ? '—' : formatNumber(v, 0));

/** Quiet mode: a lane's total as words. */
export const QUIET_LANE = { some: 'Readings', none: NO_READING } as const;

/**
 * (r068 B1) The words of the day's figures under the lanes: what was counted hour by hour, the ring's own day total and
 * the part of it with no time, and what the day shows. Each figure is named once, so the numbers add up on screen.
 */
export const SUM_WORDS = {
  counted: 'Counted by hour',
  ringDay: "Ring's day total",
  ringByHour: (byHour: string, rest: string) => `${byHour} by hour + ${rest} with no time`,
  dayShows: 'Day shows',
  atLeast: (n: string) => `at least ${n}`,
  why: "The ring's day total is higher than the steps counted by hour. Steps with no time are never added to the hours.",
  /** The ring lane when the ring gave a day total but no step by hour. */
  ringNoHours: 'total only',
  /** Without the ring's day total: the ring's steps with no time, on their own row. */
  noTime: 'Ring steps with no time (not added)',
} as const;

/**
 * "Steps by hour: ring 8 410, phone no reading, counted 8 410; …" (unknown never spoken as 0). Quiet: "Steps by hour: ring
 * readings, phone no reading, counted readings; ring and phone disagree in the morning" (no digits).
 */
export function spokenSteps(hours: readonly StepsHour[], located: number | null, quiet = false, ringDayOnly: number | null = null): string {
  // (r068 B1) a ring with a day total but no step by hour is spoken as that total, never "no reading"
  const ring = laneTotal(hours, 'ring') ?? ringDayOnly;
  const phone = laneTotal(hours, 'phone');
  const counted = located ?? laneTotal(hours, 'selected');
  const say = (v: number | null) => (v === null ? 'no reading' : quiet ? 'readings' : formatNumber(v, 0));
  const dis = hours.filter((h) => h.disagree);
  const at = quiet ? [...new Set(dis.map((h) => partOfDayWords(h.start)))].join(', ') : `at ${dis.map((h) => clockText(h.start)).join(', ')}`;
  return `Steps by hour: ring ${say(ring)}, phone ${say(phone)}, counted ${say(counted)}${dis.length ? `; ring and phone disagree ${at}` : ''}.`;
}

export function StepsSourceChart({ hours, located, headline, headlinePolicy, residual, ringDailyTotal, nowMs, quiet: quietProp }: StepsSourceChartProps) {
  const quietMode = useQuietMode().on;
  const quiet = quietProp ?? quietMode;
  const [table, setTable] = useState(false);
  const tableId = `schart-table-${useId().replace(/:/g, '')}`;
  const max = Math.max(1, ...hours.flatMap((h) => [h.ring ?? 0, h.phone ?? 0, h.selected ?? 0]));
  // (r068 S6) the lanes always span the whole day (hours still ahead stay empty), so the bars sit at their clock time
  const n = Math.max(24, hours.length);
  const day0 = hours[0]?.start ?? null;
  // (r068 V13) the Counted lane reads what its bars add up to, so it is never more than the source it names; the day's
  // own total, when it differs (steps counted outside the hours drawn), is a figure of its own under the lanes
  const byHour = laneTotal(hours, 'selected');
  const total = (k: 'ring' | 'phone' | 'selected') => (k === 'selected' ? (byHour ?? located) : laneTotal(hours, k));
  const ringDay = ringDailyTotal !== null && ringDailyTotal !== undefined && ringDailyTotal > 0 ? ringDailyTotal : null;
  // (r068 B1) a ring that gave a day total but no step by hour has data: never "No reading"
  const ringTotalOnly = laneTotal(hours, 'ring') === null && ringDay !== null;
  const laneText = (k: 'ring' | 'phone' | 'selected') => {
    if (k === 'ring' && ringTotalOnly) return quiet ? QUIET_LANE.some : `${formatNumber(ringDay!, 0)} · ${SUM_WORDS.ringNoHours}`;
    const v = total(k);
    return quiet ? (v === null ? QUIET_LANE.none : QUIET_LANE.some) : totalText(v);
  };
  const spoken = spokenSteps(hours, located, quiet, ringTotalOnly ? ringDay : null);
  const rest = residual !== null && residual !== undefined && residual > 0 ? residual : null;
  const atLeast = headlinePolicy === 'atLeast' && headline !== null && headline !== undefined && located !== null && headline > located ? headline : null;
  return (
    <div className="lv-schart">
      <div className="lv-schart__lanes" role="img" aria-label={spoken}>
        {LANES.map((l) => {
          // (r068 B1) a source with no reading all day is one line, not a full-height empty lane
          const empty = total(l.key) === null && !(l.key === 'ring' && ringTotalOnly);
          return (
          <div key={l.key} className="lv-schart__lane" data-lane={l.key} data-empty={empty || undefined}>
            <span className="lv-schart__label" aria-hidden="true">
              {l.label}
              <span className="lv-schart__sum lm-num" data-none={(total(l.key) === null && !(l.key === 'ring' && ringTotalOnly)) || undefined}>
                {laneText(l.key)}
              </span>
            </span>
            {empty ? null : (
            <svg viewBox={`0 0 ${n} 32`} preserveAspectRatio="none" aria-hidden="true" className="lv-schart__plot">
              {hours.map((h, i) => {
                const v = h[l.key];
                const future = nowMs !== undefined && h.start >= nowMs;
                if (v === null) return future ? null : <rect key={i} x={i + 0.2} y={30} width={0.6} height={1} className="lv-schart__none" />;
                const ht = Math.max(v > 0 ? 1 : 0, (v / max) * 30);
                return <rect key={i} x={i + 0.15} y={31 - ht} width={0.7} height={ht} className="lv-schart__bar" data-from={l.key === 'selected' ? (h.from ?? undefined) : undefined} />;
              })}
            </svg>
            )}
            {/* (Claude P2-20) the disagreement dots sit over the stretched plot as round HTML marks, never a squashed circle */}
            {l.key === 'selected' && hours.some((h) => h.disagree) ? (
              <span className="lv-schart__dots" aria-hidden="true">
                {hours.map((h, i) => (h.disagree ? <span key={`d${i}`} className="lv-schart__dot" style={{ left: `${((i + 0.5) / n) * 100}%` }} /> : null))}
              </span>
            ) : null}
          </div>
          );
        })}
        {quiet ? null : (
          <div className="lv-schart__axis" aria-hidden="true">
            {day0 !== null ? [0, 6, 12, 18].map((k) => <span key={k} style={{ left: `${(k / n) * 100}%` }}>{clockText(day0 + k * 3_600_000)}</span>) : null}
            {day0 !== null ? (
              <span key="end" style={{ left: '100%' }}>
                24:00
              </span>
            ) : null}
          </div>
        )}
      </div>
      {hours.some((h) => h.disagree) || !quiet ? (
        <div className="lv-schart__foot">
          {hours.some((h) => h.disagree) ? (
            <p className="lv-act__fact">
              <span className="lv-schart__key" aria-hidden="true" />
              {C.disagree}
            </p>
          ) : null}
          {quiet ? null : <TwinKey open={table} onToggle={() => setTable((t) => !t)} controls={tableId} />}
        </div>
      ) : null}
      {quiet ? (
        rest !== null ? <p className="lv-act__fact">{QUIET_RESIDUAL}</p> : null
      ) : ringDay !== null || atLeast !== null || rest !== null || (byHour !== null && located !== null && located !== byHour) ? (
        <StepsSum located={byHour ?? located} dayTotal={byHour !== null && located !== null && located !== byHour && atLeast === null ? located : null} ringDay={ringDay} ringByHour={laneTotal(hours, 'ring')} rest={rest} atLeast={atLeast} />
      ) : null}
      {table && !quiet ? <StepsTable id={tableId} hours={hours} nowMs={nowMs} /> : null}
    </div>
  );
}

/**
 * (r068 B1) The day's figures, each named once: counted by hour (the located total), the ring's own day total as its
 * steps by hour plus the ones with no time, and, when the ring's total is the higher, what the day shows ("at least").
 * Without the ring's day total (an older caller), the steps with no time keep their own row.
 */
function StepsSum({ located, dayTotal = null, ringDay, ringByHour, rest, atLeast }: { located: number | null; dayTotal?: number | null; ringDay: number | null; ringByHour: number | null; rest: number | null; atLeast: number | null }) {
  return (
    <div className="lv-schart__sums">
      <dl className="lv-schart__sumlist">
        {located !== null ? (
          <div className="lv-schart__sumrow">
            <dt>{SUM_WORDS.counted}</dt>
            <dd className="lm-num">{formatNumber(located, 0)}</dd>
          </div>
        ) : null}
        {ringDay !== null ? (
          <div className="lv-schart__sumrow">
            <dt>{SUM_WORDS.ringDay}</dt>
            <dd className="lm-num">
              {formatNumber(ringDay, 0)}
              {rest !== null && ringByHour !== null ? <span className="lv-schart__sumnote">{SUM_WORDS.ringByHour(formatNumber(ringByHour, 0), formatNumber(rest, 0))}</span> : null}
            </dd>
          </div>
        ) : rest !== null ? (
          <div className="lv-schart__sumrow">
            <dt>{SUM_WORDS.noTime}</dt>
            <dd className="lm-num">{formatNumber(rest, 0)}</dd>
          </div>
        ) : null}
        {dayTotal !== null ? (
          <div className="lv-schart__sumrow" data-key="shows">
            <dt>{SUM_WORDS.dayShows}</dt>
            <dd className="lm-num">{formatNumber(dayTotal, 0)}</dd>
          </div>
        ) : null}
        {atLeast !== null ? (
          <div className="lv-schart__sumrow" data-key="shows">
            <dt>{SUM_WORDS.dayShows}</dt>
            <dd className="lm-num">{SUM_WORDS.atLeast(formatNumber(atLeast, 0))}</dd>
          </div>
        ) : null}
      </dl>
      {atLeast !== null ? <p className="lv-act__fact">{SUM_WORDS.why}</p> : null}
    </div>
  );
}

const FROM_WORD: Record<'ring' | 'phone' | 'both', string> = { ring: C.ring, phone: C.phone, both: `${C.ring} and ${C.phone.toLowerCase()}` };

/** The twin: each hour's ring, phone and counted steps, where the counted steps came from and a disagreement. */
function StepsTable({ id, hours, nowMs }: { id: string; hours: readonly StepsHour[]; nowMs: number | undefined }) {
  const shown = hours.filter((h) => nowMs === undefined || h.start < nowMs);
  const head = ['Hour', C.ring, C.phone, C.counted, 'From', 'Note'];
  const note = (h: StepsHour) => (h.disagree ? C.disagree : '');
  const csv = () => toCSV([head, ...shown.map((h) => [clockText(h.start), h.ring ?? '', h.phone ?? '', h.selected ?? '', h.from ? FROM_WORD[h.from] : '', note(h)])]);
  return (
    <VizTwinTable id={id} title={`${C.stepsTitle} table`} caption={`${C.stepsTitle}, hour by hour; a dash is no reading`} rows={shown.length} fileName="steps-by-source.csv" csv={csv} rowNoun={['hour', 'hours']}>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shown.map((h) => (
          <tr key={h.start}>
            <th scope="row" className="lm-num">
              {clockText(h.start)}
            </th>
            <td className="lm-num">{cell(h.ring)}</td>
            <td className="lm-num">{cell(h.phone)}</td>
            <td className="lm-num">{cell(h.selected)}</td>
            <td>{h.from ? FROM_WORD[h.from] : ''}</td>
            <td>{note(h)}</td>
          </tr>
        ))}
      </tbody>
    </VizTwinTable>
  );
}

/** The words of the correction form (kept here: only this panel uses them). */
export const CORRECT_WORDS = {
  title: 'Correct the count',
  help: 'Choose which source counts. The other one stays as evidence.',
  scope: 'What to correct',
  wholeDay: 'The whole day',
  someHours: 'Some hours',
  from: 'From',
  to: 'Until',
  use: 'Switch counting to',
  save: 'Save correction',
  saved: 'Saved. The count follows at the next update.',
  removed: 'Correction removed.',
  remove: 'Remove',
  inForce: 'Corrections in force',
  forDay: 'for the whole day',
  forPart: 'for part of the day',
  // (r068 final M2) "mostly": the other source can still fill an hour this one missed
  now: (from: 'ring' | 'phone' | 'both') => (from === 'both' ? 'Counted now from the ring and the phone.' : `Counted now mostly from the ${from}; the ${from === 'ring' ? 'phone' : 'ring'} fills gaps.`),
} as const;

/**
 * (r068 B1) Which source the shown day's counted steps came from: the one that gave at least 90 % of them, else both;
 * null when nothing was counted.
 */
export function countedFrom(hours: readonly StepsHour[]): 'ring' | 'phone' | 'both' | null {
  let ring = 0;
  let phone = 0;
  for (const h of hours) {
    if (!h.selected || !h.from) continue;
    if (h.from === 'ring') ring += h.selected;
    else if (h.from === 'phone') phone += h.selected;
    else {
      ring += h.selected / 2;
      phone += h.selected / 2;
    }
  }
  const all = ring + phone;
  if (all <= 0) return null;
  return ring >= 0.9 * all ? 'ring' : phone >= 0.9 * all ? 'phone' : 'both';
}

const USE_WORD = (use: string) => (use === 'ring' ? C.ring : use === 'phone' ? C.phone : 'Another app');
const HOUR_MS = 3_600_000;

/** "Phone · 08:00–09:00", or in quiet mode "Phone for part of the day" (words only). */
export function correctionText(c: Pick<StepsCorrectionRow, 'startMs' | 'endMs' | 'use'>, day: { startMs: number; endMs: number }, quiet: boolean): string {
  const whole = c.startMs <= day.startMs && c.endMs >= day.endMs;
  if (quiet) return `${USE_WORD(c.use)} ${whole ? CORRECT_WORDS.forDay : CORRECT_WORDS.forPart}`;
  return whole ? `${USE_WORD(c.use)} ${CORRECT_WORDS.forDay}` : `${USE_WORD(c.use)} · ${clockText(c.startMs)}–${clockText(c.endMs)}`;
}

/**
 * The correction form: the whole shown day or a run of its hours (hours that have begun), ring or phone; the corrections
 * in force on the day with Remove. A save or a removal asks for an import, so the counted steps follow.
 */
export function StepsCorrections({ hours, nowMs, quiet: quietProp }: { hours: readonly StepsHour[]; nowMs?: number; quiet?: boolean }) {
  const quietMode = useQuietMode().on;
  const quiet = quietProp ?? quietMode;
  const titleId = `scorrect-${useId().replace(/:/g, '')}`;
  const day = hours.length ? { startMs: hours[0]!.start, endMs: hours[hours.length - 1]!.start + HOUR_MS } : null;
  const begun = hours.filter((h) => nowMs === undefined || h.start < nowMs);
  const [scope, setScope] = useState<'day' | 'hours'>('day');
  const [from, setFrom] = useState<string>(begun[0] ? String(begun[0].start) : '');
  const [to, setTo] = useState<string>(begun[0] ? String(begun[0].start + HOUR_MS) : '');
  const now = countedFrom(hours);
  // (r068 V13) a source that gave no reading all day cannot be counted: its key is off
  const has = { ring: laneTotal(hours, 'ring') !== null, phone: laneTotal(hours, 'phone') !== null };
  // (r068 B1) the form starts on the source that does not count now (the one a correction would switch to), when it has
  // readings; else on the one that counts
  const other: 'ring' | 'phone' = now === 'phone' ? 'ring' : 'phone';
  const [use, setUse] = useState<CorrectionUse>(has[other] ? other : other === 'ring' ? 'phone' : 'ring');
  const [rows, setRows] = useState<StepsCorrectionRow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState(0);
  const dayStart = day?.startMs;
  const dayEnd = day?.endMs;
  useEffect(() => {
    if (dayStart === undefined || dayEnd === undefined) return;
    let live = true;
    listStepsCorrections(dayStart, dayEnd).then(
      (r) => {
        if (live) setRows(r);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [dayStart, dayEnd, rev]);
  const reload = () => setRev((n) => n + 1);
  if (!day || begun.length === 0) return null;
  const hoursMode = !quiet && scope === 'hours';
  const startMs = hoursMode ? Number(from) : day.startMs;
  const endMs = hoursMode ? Number(to) : day.endMs;
  // nothing to save: the whole day already counted from the chosen source, or a source with no reading
  const noChange = !has[use] || (!hoursMode && use === now);
  const valid = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs && !noChange;
  const save = async () => {
    setBusy(true);
    const r = await saveStepsCorrection(startMs, endMs, use);
    setBusy(false);
    setNote(r.ok ? CORRECT_WORDS.saved : r.message);
    if (r.ok) reload();
  };
  const remove = async (id: string) => {
    setBusy(true);
    const r = await removeStepsCorrection(id);
    setBusy(false);
    setNote(r.ok ? CORRECT_WORDS.removed : r.message);
    if (r.ok) reload();
  };
  const fromOptions = begun.map((h) => ({ value: String(h.start), label: clockText(h.start) }));
  const toOptions = begun.filter((h) => h.start + HOUR_MS > Number(from)).map((h) => ({ value: String(h.start + HOUR_MS), label: clockText(h.start + HOUR_MS) }));
  return (
    <section className="lv-scorrect" aria-labelledby={titleId}>
      <h3 id={titleId} className="lv-scorrect__title">
        {CORRECT_WORDS.title}
      </h3>
      <p className="lv-act__fact">{now ? `${CORRECT_WORDS.now(now)} ${CORRECT_WORDS.help}` : CORRECT_WORDS.help}</p>
      {quiet ? null : (
        <KeyBank
          label={CORRECT_WORDS.scope}
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'day', label: CORRECT_WORDS.wholeDay },
            { value: 'hours', label: CORRECT_WORDS.someHours },
          ]}
        />
      )}
      {hoursMode ? (
        <div className="lv-scorrect__span">
          <Select
            label={CORRECT_WORDS.from}
            size="sm"
            value={from}
            options={fromOptions}
            onChange={(v) => {
              setFrom(v);
              if (!(Number(to) > Number(v))) setTo(String(Number(v) + HOUR_MS));
            }}
          />
          <Select label={CORRECT_WORDS.to} size="sm" value={to} options={toOptions} onChange={setTo} />
        </div>
      ) : null}
      {/* (r068 final M2) the bank says what its choice does: the preselected key is the source to switch to, not the
          one counting now */}
      <span className="lv-scorrect__label" id={`${titleId}-use`}>
        {CORRECT_WORDS.use}
      </span>
      <KeyBank
        labelledBy={`${titleId}-use`}
        size="sm"
        value={use}
        onChange={setUse}
        options={[
          { value: 'phone', label: C.phone, disabled: !has.phone },
          { value: 'ring', label: C.ring, disabled: !has.ring },
        ]}
      />
      {/* (r068 final M2) the form's commit: a full-width filled key at its foot, not a small key among the fields */}
      <Key variant="primary" block disabled={busy || !valid} loading={busy} onClick={() => void save()} className="lv-scorrect__save">
        {CORRECT_WORDS.save}
      </Key>
      {note ? (
        <p className="lv-act__fact" role="status">
          {note}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <>
          <h4 className="lv-scorrect__sub">{CORRECT_WORDS.inForce}</h4>
          <ul className="lv-scorrect__list">
            {rows.map((c) => (
              <li key={c.id} className="lv-scorrect__row">
                <span>{correctionText(c, day, quiet)}</span>
                <Key variant="danger" size="sm" disabled={busy} onClick={() => void remove(c.id)} aria-label={`${CORRECT_WORDS.remove}: ${correctionText(c, day, quiet)}`}>
                  {CORRECT_WORDS.remove}
                </Key>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** (r069 D3) The day's steps in time with its activities, drawn first in the panel (where the steps happened). */
export interface StepsPanelDay {
  bins: readonly StepsBin[];
  marks: readonly DayMark[];
  updatedAt: number | null;
  headline?: number | null;
}

export function StepsSourcePanel({ open, onClose, day, ...props }: StepsSourceChartProps & { open: boolean; onClose: () => void; day?: StepsPanelDay }) {
  const quietMode = useQuietMode().on;
  return (
    <ResponsivePanel open={open} onClose={onClose} title={C.stepsTitle}>
      <div className="lv-apanel">
        {day && day.bins.length > 0 ? (
          <section className="lv-apanel__part" aria-label={STEPS_DAY_WORDS.title}>
            <h3 className="lv-scorrect__title">{STEPS_DAY_WORDS.title}</h3>
            <StepsDayChart bins={day.bins} marks={day.marks} {...(props.nowMs !== undefined ? { nowMs: props.nowMs } : {})} updatedAt={day.updatedAt} headline={day.headline ?? null} quiet={props.quiet ?? quietMode} />
          </section>
        ) : null}
        {day && day.bins.length > 0 ? <h3 className="lv-scorrect__title">{SOURCE_HEADING}</h3> : null}
        <StepsSourceChart {...props} />
        <StepsCorrections hours={props.hours} {...(props.nowMs !== undefined ? { nowMs: props.nowMs } : {})} {...(props.quiet !== undefined ? { quiet: props.quiet } : {})} />
      </div>
    </ResponsivePanel>
  );
}
