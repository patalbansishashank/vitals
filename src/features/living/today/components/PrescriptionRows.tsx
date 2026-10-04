/**
 * Today's checklist (COMPONENTS §13.10 PrescriptionRow): time · glyph · what to do + target · what was logged ·
 * tick key · chevron. One tap on an empty tick = "as planned" (the row's command); tapping again within 5 s undoes it;
 * later the toast carries Undo. The chevron opens the row sheet: as planned · partly · skipped · something else, plus
 * the item's own editor (meal → Food, session → Train, fast → "broke it at", weigh-in → a stepper, steps/sleep →
 * value). Rows are sorted by time; untimed rows follow under a hairline.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, ChevronRight, Pill, Scale } from 'lucide-react';
import { Field, Glyphs, Icon, IconKey, Key, KeyBank, NumberField, ResponsivePanel, Stepper, cx, energyInText, toast, type IconComponent } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
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

const GLYPH: Record<RowGlyph, IconComponent> = {
  weigh: Scale,
  meal: Glyphs.MealDot,
  session: Glyphs.DumbbellPlate,
  fast: Glyphs.FastClock,
  steps: Glyphs.Footsteps,
  sleep: Glyphs.SleepArc,
  supplement: Pill,
};

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

export function PrescriptionRows({ rows, date, readOnly, quiet, highlight }: PrescriptionRowsProps) {
  const actions = useLivingActions();
  const clock = useLivingClock();
  const eu = useEnergyUnit();
  const last = useRef<{ id: string; at: number; undo?: () => Promise<ActionOutcome> } | null>(null);
  const [sheet, setSheet] = useState<TodayRow | null>(null);
  const [live, setLive] = useState('');
  const own = useDeviceOwnership(date);
  const [correcting, setCorrecting] = useState<OwnedStream | null>(null);

  const onTick = async (r: TodayRow) => {
    const now = clock.now().getTime();
    const prev = last.current;
    if (prev && prev.id === r.id && now - prev.at < 5000 && prev.undo) {
      last.current = null;
      await prev.undo();
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
    setLive(TODAY_COPY.ticked(r.label));
    report(o, TODAY_COPY.ticked(r.label));
  };

  const timed = rows.filter((r) => !r.untimed);
  const untimed = rows.filter((r) => r.untimed);
  const renderRow = (r: TodayRow) => {
    const kind = OWNED_GLYPH[r.glyph];
    const fed = kind ? own[kind] : undefined;
    return (
    <li key={r.id} className={cx('lv-row', highlight === r.itemId && 'is-highlight')} data-row={r.id} data-item={r.itemId ?? undefined}>
      <span className="lv-row__time lm-num">{r.at !== null && !r.untimed ? fmtClock(r.at) : '—'}</span>
      <Icon icon={GLYPH[r.glyph]} size={20} className="lv-row__glyph" />
      <span className="lv-row__what">
        <span className="lv-row__label">{r.label}</span>
        <span className="lv-row__target">{quiet && r.quietTarget ? r.quietTarget : energyInText(r.target, eu)}</span>
      </span>
      <span className="lv-row__logged">
        {fed ? (
          <FedBy stream={fed} date={date} readOnly={readOnly} onCorrect={() => setCorrecting(fed)} />
        ) : r.glyph === 'weigh' && !readOnly ? (
          <NumberField
            value={r.logged?.value ?? null}
            onChange={(kg) => void actions.logWeight(date, kg).then((o) => report(o, `Weight ${kg.toFixed(1)} kg logged.`))}
            min={30}
            max={300}
            step={0.1}
            decimals={1}
            unit="kg"
            name={TODAY_COPY.weighInName}
            className="lv-row__weigh"
            id={weighFieldId(date)}
          />
        ) : r.logged && !(quiet && r.logged.unit === 'kcal') ? (
          <EstimateReadout value={r.logged.value} {...(r.logged.sd !== undefined ? { sd: r.logged.sd } : {})} unit={r.logged.unit} approx={r.logged.approx} decimals={r.logged.decimals ?? 0} short source={{ label: r.logged.source }} />
        ) : null}
      </span>
      {fed || r.glyph === 'weigh' ? (
        <span className={cx('lv-tick', `is-${fed ? (fed.value !== null ? 'done' : 'empty') : r.status}`)} aria-hidden="true">
          {(fed ? fed.value !== null : r.status === 'done') ? <Icon icon={Check} size={20} /> : null}
        </span>
      ) : (
        <button
          type="button"
          className={cx('lv-tick', `is-${r.status}`)}
          aria-label={r.status === 'empty' ? TODAY_COPY.tickName(r.label) : `${r.label}: ${STATUS_WORD[r.status]}. Change`}
          aria-pressed={r.status !== 'empty'}
          disabled={readOnly}
          onClick={() => void onTick(r)}
        >
          {r.status === 'done' ? <Icon icon={Check} size={20} /> : null}
        </button>
      )}
      {fed ? <span aria-hidden="true" /> : <IconKey icon={ChevronRight} label={`More for ${r.label}`} size="sm" variant="quiet" onClick={() => setSheet(r)} disabled={readOnly} />}
    </li>
    );
  };

  return (
    <>
      <ul className="lv-rows">{timed.map(renderRow)}</ul>
      {untimed.length ? (
        <>
          <div className="lv-rows__rule">
            <span className="lm-eng">{TODAY_COPY.untimed}</span>
          </div>
          <ul className="lv-rows">{untimed.map(renderRow)}</ul>
        </>
      ) : null}
      <span className="lm-sr" role="status" aria-live="polite">
        {live}
      </span>
      <CorrectionSheet stream={correcting} date={date} onClose={() => setCorrecting(null)} />
      <RowSheet row={sheet} date={date} onClose={() => setSheet(null)} />
    </>
  );
}

/** The row sheet (T1): as planned · partly · skipped · something else + the item's editor. */
function RowSheet({ row, date, onClose }: { row: TodayRow | null; date: LocalDate; onClose: () => void }) {
  const actions = useLivingActions();
  const navigate = useNavigate();
  const eu = useEnergyUnit();
  const [brokeAt, setBrokeAt] = useState<number | null>(14.5);
  const [value, setValue] = useState<number | null>(null);
  if (!row) return <ResponsivePanel open={false} onClose={onClose} title="" />;
  const mark = async (m: RowMark) => {
    const o = await actions.markRow(date, row.id, m);
    report(o, `${row.label}: ${TODAY_COPY.rowSheet[m]}.`);
    if (o.ok) onClose();
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
        <p className="lv-sheet__target">{energyInText(row.target, eu)}</p>
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
                void p.then((o) => (report(o, `${row.label} logged.`), o.ok && onClose()));
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
