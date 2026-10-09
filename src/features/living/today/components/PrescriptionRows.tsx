/**
 * Today's plan as a day rail (COMPONENTS §13.10, redrawn 2026-10-09): a thin time spine down the card, one stop per
 * thing to do. Each stop reads time · status node · what · its targets as a compact readout, and carries ONE key for the
 * common case (Log weight, As planned, Done, Taken) plus a quiet ⋯ for the rest (Log meal / Log session in Food or
 * Train, Details). Tapping the stop's text opens the row sheet (as planned · partly · skipped · something else, plus
 * the item's own editor). A logged stop turns its node solid, shows what was logged and offers Undo. On the real today
 * a "now" tick sits on the spine between what is behind and what is ahead. Future days are a read-only preview: the
 * same rail with no keys. Untimed stops (steps, sleep, supplements) follow under "any time".
 */
import { Fragment, useId, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Ellipsis } from 'lucide-react';
import { Field, IconKey, Key, KeyBank, Menu, NumberField, ResponsivePanel, Stepper, cx, energyInText, toast, type MenuItem } from '@/components';
import { useEnergyUnit, useSettingsStore } from '@/state/settingsStore';
import { kgToLb } from '@/lib/units';
import type { LocalDate } from '@/living';
import { useLivingClock } from '../../clock';
import { TODAY_COPY } from '../../copy';
import { useLivingActions, type ActionOutcome, type RowMark } from '../../data/actions';
import { EstimateReadout } from '../../components/Estimate';
import { CorrectionSheet, FedBy } from '../../components/Correction';
import { useDeviceOwnership, type OwnedKind, type OwnedStream } from '../../data/useDeviceOwnership';
import { fmtClock } from '../../format';
import { livingPaths } from '../../paths';
import type { RowGlyph, TodayRow } from '../model';
import { WeighSheet } from './WeighSheet';
import { TargetReadout } from '../../components/TargetReadout';

const STATUS_WORD: Record<TodayRow['status'], string> = { empty: 'not logged', done: 'as planned', partial: 'partly', skipped: 'skipped', assumed: 'filled in as planned' };

/** The row sheet's answer for what is logged (Q6-12); empty and filled-in-for-you rows have no answer yet. */
const STATUS_MARK: Partial<Record<TodayRow['status'], RowMark>> = { done: 'asPlanned', partial: 'partly', skipped: 'skipped' };

const OWNED_GLYPH: Partial<Record<RowGlyph, OwnedKind>> = { weigh: 'weight', steps: 'steps', sleep: 'sleep' };

export interface PrescriptionRowsProps {
  rows: readonly TodayRow[];
  date: LocalDate;
  /** Future dates are read-only previews. */
  readOnly: boolean;
  quiet: boolean;
  /** Item to highlight (the dial's arc was clicked). */
  highlight?: string | null;
  /** Why the actions are closed on a read-only day ("Opens on Wed 7 Oct"). */
  closedReason?: string;
  /** The clock hour on the real today: draws the "now" tick on the rail. */
  nowH?: number | null;
}

/** Id of the weigh-in field for a date (the `W` shortcut focuses it). */
export const weighFieldId = (date: LocalDate) => `lv-weigh-${date}`;

/** Announce + toast an outcome; failures read as plain sentences. */
function report(o: ActionOutcome, ok: string) {
  if (!o.ok) {
    toast(o.message ?? 'That didn’t work. Try again.');
    return;
  }
  toast(ok, o.undo ? { action: { label: TODAY_COPY.undo, onClick: () => void o.undo?.() } } : {});
}

export function PrescriptionRows({ rows, date, readOnly, quiet, highlight, closedReason, nowH = null }: PrescriptionRowsProps) {
  const actions = useLivingActions();
  const clock = useLivingClock();
  const eu = useEnergyUnit();
  const uid = useId();
  const last = useRef<{ id: string; at: number; undo?: () => Promise<ActionOutcome> } | null>(null);
  const [sheet, setSheet] = useState<TodayRow | null>(null);
  const [live, setLive] = useState('');
  const own = useDeviceOwnership(date);
  const [correcting, setCorrecting] = useState<OwnedStream | null>(null);
  const [weighing, setWeighing] = useState(false);
  // the row's own Undo after a log made here (the toast carries one too, but it goes away)
  const [undos, setUndos] = useState<Record<string, () => Promise<unknown>>>({});
  const keepUndo = (id: string, undo: (() => Promise<unknown>) | undefined) => setUndos((u) => {
    const { [id]: _drop, ...rest } = u;
    void _drop;
    return undo ? { ...rest, [id]: undo } : rest;
  });
  const undoRow = async (r: TodayRow) => {
    const undo = undos[r.id];
    keepUndo(r.id, undefined);
    if (!undo) return;
    await undo();
    setLive(`${r.label}: undone.`);
    toast(`${r.label.charAt(0).toUpperCase()}${r.label.slice(1)}: undone.`);
  };
  const navigate = useNavigate();
  const imperial = useSettingsStore((s) => s.units) === 'imperial';

  const onTick = async (r: TodayRow) => {
    const now = clock.now().getTime();
    const prev = last.current;
    if (prev && prev.id === r.id && now - prev.at < 5000 && prev.undo) {
      last.current = null;
      await prev.undo();
      keepUndo(r.id, undefined);
      setLive(`${r.label}: undone.`);
      return;
    }
    if (r.status !== 'empty') {
      setSheet(r);
      return;
    }
    const o = await actions.tick(date, r.item);
    if (!o.ok) {
      toast(o.message ?? 'That didn’t work. Try again.');
      return;
    }
    last.current = { id: r.id, at: now, ...(o.undo ? { undo: o.undo } : {}) };
    keepUndo(r.id, o.undo);
    setLive(TODAY_COPY.ticked(r.label));
    report(o, TODAY_COPY.ticked(r.label));
  };

  const timed = rows.filter((r) => !r.untimed);
  const untimed = rows.filter((r) => r.untimed);
  const off = readOnly ? { disabledReason: closedReason ?? TODAY_COPY.futureDay } : {};
  const weighRowId = rows.find((r) => r.glyph === 'weigh')?.id ?? 'weigh';

  /** Is this stop finished for the day (solid node, Undo in place of the main key)? */
  const isDone = (r: TodayRow, fed: OwnedStream | undefined) => r.status !== 'empty' || (r.glyph === 'weigh' && !!r.logged) || (!!fed && fed.value != null);

  /** The one key a stop carries: the common case while open, Undo once logged here. */
  const primaryFor = (r: TodayRow, done: boolean): ReactNode => {
    if (done) {
      if (undos[r.id])
        return (
          <Key size="sm" variant="quiet" aria-label={`Undo ${r.label}`} onClick={() => void undoRow(r)}>
            {TODAY_COPY.undo}
          </Key>
        );
      // logged earlier (no undo held here): the weigh-in keeps a direct way to change it, and the `W` shortcut
      return r.glyph === 'weigh' ? (
        <Key size="sm" variant="quiet" {...off} id={weighFieldId(date)} onClick={() => setWeighing(true)}>
          Change
        </Key>
      ) : r.glyph === 'sleep' || r.glyph === 'steps' ? (
        <Key size="sm" variant="quiet" {...off} onClick={() => setSheet(r)}>
          Change
        </Key>
      ) : null;
    }
    const tick = (label: string) => (
      <Key size="sm" {...off} aria-label={TODAY_COPY.tickName(r.label)} onClick={() => void onTick(r)}>
        {label}
      </Key>
    );
    switch (r.glyph) {
      case 'weigh':
        return (
          <Key size="sm" {...off} id={weighFieldId(date)} onClick={() => setWeighing(true)}>
            Log weight
          </Key>
        );
      case 'session':
        return tick('Done');
      case 'supplement':
        return tick('Taken');
      default:
        return tick('As planned');
    }
  };

  /** The rest, behind the quiet ⋯: the full log in Food or Train, the row sheet, a typed value. */
  const moreFor = (r: TodayRow, done: boolean): MenuItem[] => {
    const items: MenuItem[] = [];
    if (r.glyph === 'meal') items.push({ id: 'food', label: 'Log meal in Food', onSelect: () => navigate(livingPaths.food(date, 'meals')) });
    if (r.glyph === 'session') items.push({ id: 'train', label: 'Log session in Train', onSelect: () => navigate(livingPaths.train(date, 'session')) });
    if (r.glyph === 'sleep' || r.glyph === 'steps') items.push({ id: 'value', label: r.logged ? `Change ${r.label}` : r.glyph === 'sleep' ? 'Log hours of sleep' : 'Log steps', onSelect: () => setSheet(r) });
    if (r.glyph === 'weigh' && done && undos[r.id]) items.push({ id: 'weigh', label: 'Change weight', onSelect: () => setWeighing(true) });
    if (r.glyph !== 'weigh' && r.glyph !== 'sleep' && r.glyph !== 'steps') items.push({ id: 'details', label: done ? 'Change how it went' : 'Partly, skipped or a note', onSelect: () => setSheet(r) });
    return items;
  };

  const loggedFor = (r: TodayRow, fed: OwnedStream | undefined): ReactNode => {
    if (fed) return <FedBy stream={fed} date={date} readOnly={readOnly} onCorrect={() => setCorrecting(fed)} />;
    if (r.glyph === 'weigh' && r.logged)
      return <TargetReadout text={`${(imperial ? kgToLb(r.logged.value) : r.logged.value).toFixed(1)} ${imperial ? 'lb' : 'kg'}`} />;
    const word = r.status !== 'empty' ? STATUS_WORD[r.status] : null;
    const value =
      r.logged && !(quiet && r.logged.unit === 'kcal') ? (
        <EstimateReadout value={r.logged.value} {...(r.logged.sd !== undefined ? { sd: r.logged.sd } : {})} unit={r.logged.unit} approx={r.logged.approx} decimals={r.logged.decimals ?? 0} short source={{ label: r.logged.source }} />
      ) : null;
    return (
      <>
        {word ? <span className="lv-item__word">{word}</span> : null}
        {value}
      </>
    );
  };

  const renderRow = (r: TodayRow) => {
    const kind = OWNED_GLYPH[r.glyph];
    // a ring never weighs anyone: the weigh-in shows a device only once a scale import has sent a weight; until then
    // the person logs it (no "waiting for the ring" state)
    const owned = kind ? own[kind] : undefined;
    const fed = r.glyph === 'weigh' && owned?.value == null ? undefined : owned;
    const done = isDone(r, fed);
    const state = fed ? 'done' : r.glyph === 'weigh' ? (done ? 'done' : 'empty') : r.status;
    const target = quiet && r.quietTarget ? r.quietTarget : energyInText(r.target, eu);
    const subId = `${uid}-${r.id}`;
    // the stop's text opens the row sheet, where there is one (not the weigh-in, not a device-fed stream, not a preview)
    const opens = !readOnly && !fed && r.glyph !== 'weigh';
    const more = readOnly || fed ? [] : moreFor(r, done);
    const primary = readOnly || fed ? null : primaryFor(r, done);
    const time = r.at !== null && !r.untimed ? fmtClock(r.at) : r.glyph === 'weigh' ? 'morning' : '';
    return (
      <li key={r.id} className={cx('lv-item', highlight != null && highlight === r.itemId && 'is-highlight', opens && 'is-open')} data-state={state} data-row={r.id} data-item={r.itemId ?? undefined}>
        <span className="lv-item__time lm-num">{time}</span>
        <span className="lv-item__node" aria-hidden="true" />
        {opens ? (
          <button type="button" className="lv-item__label" aria-label={`Details for ${r.label}`} aria-describedby={subId} onClick={() => setSheet(r)}>
            {r.label}
          </button>
        ) : (
          <span className="lv-item__label">{r.label}</span>
        )}
        <span className="lv-item__sub" id={subId}>
          {done ? (
            <span className="lv-item__logged">{loggedFor(r, fed)}</span>
          ) : (
            <>
              {target ? <TargetReadout text={target} /> : null}
              {r.detail && !quiet ? <TargetReadout text={r.detail} className="lv-rd--extra" /> : null}
            </>
          )}
        </span>
        {readOnly ? null : (
          <span className="lv-item__keys">
            {primary}
            {more.length ? (
              <Menu label={`More for ${r.label}`} items={more} trigger={(t) => <IconKey {...t} size="sm" icon={Ellipsis} label={`More for ${r.label}`} />} />
            ) : (
              <span className="lv-item__nomore" aria-hidden="true" />
            )}
          </span>
        )}
      </li>
    );
  };

  // the "now" tick sits before the first timed stop still ahead of the clock (the weigh-in counts as early morning)
  const nowAt = nowH === null || readOnly ? -1 : timed.findIndex((r) => (r.at ?? -1) > nowH);
  const nowIdx = nowH === null || readOnly ? -1 : nowAt === -1 ? timed.length : nowAt;
  const nowMark =
    nowH !== null ? (
      <li className="lv-item lv-item--now" key="now">
        <span className="lv-item__time lm-num">{fmtClock(nowH)}</span>
        <span className="lv-item__node" aria-hidden="true" />
        <span className="lv-item__label lm-eng">now</span>
      </li>
    ) : null;

  return (
    <>
      <ol className="lv-day" aria-label="The day in order">
        {timed.map((r, i) => (
          <Fragment key={r.id}>
            {i === nowIdx ? nowMark : null}
            {renderRow(r)}
          </Fragment>
        ))}
        {nowIdx === timed.length && timed.length ? nowMark : null}
      </ol>
      {untimed.length ? (
        <>
          <div className="lv-day__rule">
            <span className="lm-eng">{TODAY_COPY.untimed}</span>
          </div>
          <ul className="lv-day">{untimed.map(renderRow)}</ul>
        </>
      ) : null}
      <span className="lm-sr" role="status" aria-live="polite">
        {live}
      </span>
      <CorrectionSheet stream={correcting} date={date} onClose={() => setCorrecting(null)} />
      <RowSheet row={sheet} date={date} onClose={() => setSheet(null)} onUndo={keepUndo} />
      {weighing ? <WeighSheet open={weighing} date={date} lastKg={rows.find((r) => r.glyph === 'weigh')?.logged?.value} onClose={() => setWeighing(false)} onSaved={(undo) => keepUndo(weighRowId, undo)} /> : null}
    </>
  );
}

/** The row sheet (T1): as planned · partly · skipped · something else + the item's editor. */
function RowSheet({ row, date, onClose, onUndo }: { row: TodayRow | null; date: LocalDate; onClose: () => void; onUndo: (id: string, undo: (() => Promise<unknown>) | undefined) => void }) {
  const actions = useLivingActions();
  const navigate = useNavigate();
  const eu = useEnergyUnit();
  const [brokeAt, setBrokeAt] = useState<number | null>(14.5);
  const [value, setValue] = useState<number | null>(null);
  if (!row) return <ResponsivePanel open={false} onClose={onClose} title="" />;
  const mark = async (m: RowMark) => {
    const o = await actions.markRow(date, row.id, m);
    report(o, `${row.label}: ${TODAY_COPY.rowSheet[m]}.`);
    if (o.ok) {
      onUndo(row.id, o.undo);
      onClose();
    }
  };
  const options: Array<{ value: RowMark | 'else'; label: string }> = [
    { value: 'asPlanned', label: TODAY_COPY.rowSheet.asPlanned },
    { value: 'partly', label: TODAY_COPY.rowSheet.partly },
    { value: 'skipped', label: TODAY_COPY.rowSheet.skipped },
    { value: 'else', label: TODAY_COPY.rowSheet.else },
  ];
  return (
    <ResponsivePanel open onClose={onClose} title={`${row.label.charAt(0).toUpperCase()}${row.label.slice(1)}`} defaultDetent="half">
      <div className="lv-sheet">
        <p className="lv-sheet__target">
          <TargetReadout text={[energyInText(row.target, eu), row.detail].filter(Boolean).join(' · ')} />
        </p>
        {row.glyph !== 'weigh' ? (
          <KeyBank
            label={`How did ${row.label} go?`}
            size="lg"
            block
            options={options}
            {...(STATUS_MARK[row.status] ? { defaultValue: STATUS_MARK[row.status] } : {})}
            onChange={(v) => {
              if (v === 'else') {
                if (row.glyph === 'meal') navigate(livingPaths.food(date, 'meals'));
                else if (row.glyph === 'session') navigate(livingPaths.train(date, 'session'));
                return;
              }
              void mark(v);
            }}
          />
        ) : null}
        {row.glyph === 'meal' ? (
          <Key onClick={() => navigate(livingPaths.food(date, 'meals'))}>Open in Food</Key>
        ) : row.glyph === 'session' ? (
          <Key onClick={() => navigate(livingPaths.train(date, 'session'))}>Open in Train</Key>
        ) : row.glyph === 'fast' ? (
          <div className="lv-sheet__editor">
            <Field label="broke it at">
              <Stepper value={brokeAt} onChange={setBrokeAt} min={0} max={23.75} step={0.25} decimals={2} name="time the fast ended" unit="h" />
            </Field>
            <Key onClick={() => brokeAt !== null && void actions.logFastBroken(date, brokeAt).then((o) => (report(o, `Fast ended at ${fmtClock(brokeAt)} logged.`), o.ok && onClose()))}>Log</Key>
          </div>
        ) : row.glyph === 'weigh' ? (
          <div className="lv-sheet__editor">
            <Field label="weight">
              <Stepper value={value ?? row.logged?.value ?? null} onChange={setValue} min={30} max={300} step={0.1} decimals={1} name="weight" unit="kg" />
            </Field>
            <Key onClick={() => value !== null && void actions.logWeight(date, value).then((o) => (report(o, `Weight ${value.toFixed(1)} kg logged.`), o.ok && onClose()))}>Log</Key>
          </div>
        ) : row.glyph === 'steps' || row.glyph === 'sleep' ? (
          <div className="lv-sheet__editor">
            <Field label={row.glyph === 'steps' ? 'steps' : 'hours asleep'}>
              <NumberField value={value} onChange={setValue} min={0} max={row.glyph === 'steps' ? 100000 : 16} step={row.glyph === 'steps' ? 100 : 0.25} decimals={row.glyph === 'steps' ? 0 : 2} name={row.glyph === 'steps' ? 'steps' : 'sleep'} unit={row.glyph === 'steps' ? 'steps' : 'h'} />
            </Field>
            <Key
              onClick={() => {
                if (value === null) return;
                const p = row.glyph === 'steps' ? actions.logSteps(date, value) : actions.logSleep(date, value);
                void p.then((o) => (report(o, `${row.label} logged.`), o.ok && (onUndo(row.id, o.undo), onClose())));
              }}
            >
              Log
            </Key>
          </div>
        ) : null}
      </div>
    </ResponsivePanel>
  );
}
