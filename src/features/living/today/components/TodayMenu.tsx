/**
 * Today's items in the header's one ⋯ (SPEC §4): Busy or away · Log a fast · (quiet mode) Show numbers. Actions only
 * (r068 U14): Plan details is a place, in the sidebar's and More's "Your plan" group, never in the ⋯. Check-ins live in
 * the header's status capsule; pause, end and re-plan live once, in Plan details.
 *
 * "Busy or away" tells the plan about the days (`plan.declareEvent`, or `plan.shift` to push the plan back by them); the
 * proposal it makes waits on Today behind the "changes waiting" capsule. The sheets render in the page (never inside the
 * header), so the header's control sizing never reaches them.
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Checkbox, Field, ResponsivePanel, TextInput, toast, type MenuEntry } from '@/components';
import { addDays, daysBetween, isLocalDate } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { PlanEventInput } from '../../data/actions';
import type { ActivePlan } from '../../activePlan';
import { TODAY_COPY } from '../../copy';
import { useLivingActions } from '../../data/actions';
import { DateTarget } from '../../components/DateTarget';
import { FastSheet } from './FastSheet';

export interface TodayMenuOptions {
  plan: ActivePlan;
  today: LocalDate;
  /** Quiet mode is on: offer Show numbers / Hide numbers. */
  quietMode?: boolean;
  showNumbers?: boolean;
  onToggleNumbers?: () => void;
}

/** The page items for `<TopBar menu={…} />` and the sheets they open (render `sheets` in the page). */
export function useTodayMenu({ plan, today, quietMode = false, showNumbers = false, onToggleNumbers }: TodayMenuOptions): { menu: MenuEntry[]; sheets: ReactNode } {
  const [away, setAway] = useState(false);
  const [fasting, setFasting] = useState(false);
  const m = TODAY_COPY.menuItems;
  const canDeclare = plan.status === 'active' || plan.status === 'scheduled';
  const menu: MenuEntry[] = [
    { id: 'away', label: m.away, onSelect: () => setAway(true), disabled: !canDeclare, ...(canDeclare ? {} : { hint: TODAY_COPY.status.paused.toLowerCase() }) },
    { id: 'fast', label: m.fast, onSelect: () => setFasting(true) },
    ...(quietMode && onToggleNumbers ? [{ id: 'numbers', label: showNumbers ? m.hideNumbers : m.showNumbers, onSelect: onToggleNumbers }] : []),
  ];
  const sheets = (
    <>
      {away ? <AwaySheet onClose={() => setAway(false)} today={today} /> : null}
      {fasting ? <FastSheet onClose={() => setFasting(false)} /> : null}
    </>
  );
  return { menu, sheets };
}

type EventKind = PlanEventInput['kind'];
const EVENT_KINDS: readonly EventKind[] = ['busy', 'travel', 'illness', 'noTraining', 'socialMeal'];

/** A wrapping row of pill choices that acts as one radio group (five reasons do not fit a segmented track). */
function ChoiceChips<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: ReadonlyArray<{ value: V; label: string }>; onChange: (v: V) => void }) {
  const refs = useRef(new Map<V, HTMLButtonElement>());
  const labelId = useId();
  const move = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = options[(i + d + options.length) % options.length]!;
    onChange(next.value);
    refs.current.get(next.value)?.focus();
  };
  return (
    <div className="lv-choices">
      <span className="lv-choices__label" id={labelId}>
        {label}
      </span>
      <div className="lv-choices__row" role="radiogroup" aria-labelledby={labelId}>
        {options.map((o, i) => (
          <button
            key={o.value}
            ref={(el) => {
              if (el) refs.current.set(o.value, el);
              else refs.current.delete(o.value);
            }}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            tabIndex={o.value === value ? 0 : -1}
            className="lm-chip"
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => move(e, i)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Busy or away (living-mode.md §4.5): what's happening · from · to (a meal out: one day) · note. Defaults to tomorrow
 * until the day after. The two dates are Lumen date targets side by side (the platform picker opens on tap); pushing
 * the plan back is the themed checkbox on its own 48 px row. The plan answers with a proposal on Today (or applies a
 * lighter change at once).
 */
export function AwaySheet({ onClose, today }: { onClose: () => void; today: LocalDate }) {
  const actions = useLivingActions();
  const [kind, setKind] = useState<EventKind>('busy');
  const [from, setFrom] = useState<LocalDate>(addDays(today, 1));
  const [to, setTo] = useState<LocalDate>(addDays(today, 2));
  const [note, setNote] = useState('');
  const [pushBack, setPushBack] = useState(false);
  const [sending, setSending] = useState(false);
  const oneDay = kind === 'socialMeal';
  const last = addDays(from, 27);
  const end = oneDay ? from : to < from ? from : to > last ? last : to;
  const days = daysBetween(from, end) + 1;
  const back = pushBack && !oneDay;
  const c = TODAY_COPY;
  const send = async () => {
    setSending(true);
    const o = back ? await actions.shift({ from, days, mode: 'pushBack' }) : await actions.declareEvent({ kind, from, to: end, ...(note.trim() ? { note: note.trim() } : {}) });
    setSending(false);
    toast(o.message ?? (o.ok ? c.replanReady : c.awayDidntFinish));
    if (o.ok) onClose();
  };
  return (
    <ResponsivePanel open onClose={onClose} title={c.awayTitle} defaultDetent="full" onDone={() => void send()} doneLabel={c.awayKey} doneDisabled={sending}>
      <div className="lv-sheet">
        <ChoiceChips label={c.awayKind} value={kind} onChange={setKind} options={EVENT_KINDS.map((k) => ({ value: k, label: c.awayKinds[k] }))} />
        <div className="lv-dates">
          <Field label={oneDay ? c.awayOn : c.awayFrom}>
            <DateTarget value={from} min={today} onChange={(v) => isLocalDate(v) && v >= today && setFrom(v)} />
          </Field>
          {oneDay ? null : (
            <Field label={c.awayTo}>
              <DateTarget value={end} min={from} max={last} onChange={(v) => isLocalDate(v) && setTo(v)} />
            </Field>
          )}
        </div>
        {oneDay ? null : <Checkbox checked={pushBack} onChange={setPushBack} label={c.awayPushBack(days)} />}
        {back ? null : (
          <Field label={c.awayNote}>
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
        )}
      </div>
    </ResponsivePanel>
  );
}
