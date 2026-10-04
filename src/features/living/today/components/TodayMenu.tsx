/**
 * The Today menu (⋯ in Today's context row; living-mode.md §2): Re-plan the rest (same goals) · Re-plan from scratch ·
 * Check in now (from 2 days before check-in day) · I'm busy or away… · Log a fast… (any day, prescribed fast or not) · Pause plan / Resume plan · End plan… · Plan
 * details · Planning tools. "I'm busy or away…" tells the plan about the days (`plan.declareEvent`, or `plan.shift` to
 * push the plan back by them); the proposal it makes shows as a change card on Today. Re-plan from scratch and Planning tools navigate first, then set the planning override (the Living route
 * guard clears it on entry). End needs the typed word.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Ellipsis } from 'lucide-react';
import { Checkbox, Field, IconKey, Key, KeyBank, Menu, ResponsivePanel, TextInput, toast } from '@/components';
import { enterPlanningTools } from '@/app/shell';
import { addDays, daysBetween, weekdayOf } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { PlanEventInput } from '../../data/actions';
import { useActivePlanStore, type ActivePlan } from '../../activePlan';
import { TODAY_COPY } from '../../copy';
import { useLivingActions } from '../../data/actions';
import { fmtDay } from '../../format';
import { livingPaths } from '../../paths';
import { TypedConfirmDialog } from '../../components/TypedConfirmDialog';
import { FastSheet } from './FastSheet';

export function TodayMenu({ plan, today, onCheckIn }: { plan: ActivePlan; today: LocalDate; onCheckIn: () => void }) {
  const navigate = useNavigate();
  const actions = useLivingActions();
  const [ending, setEnding] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [away, setAway] = useState(false);
  const [fasting, setFasting] = useState(false);
  const left = Math.max(0, daysBetween(today, plan.plannedEndDate));
  const daysToCheckIn = (plan.policy.checkInWeekday - weekdayOf(today) + 7) % 7;
  const checkInOpen = daysToCheckIn <= 2 && plan.status === 'active';
  const m = TODAY_COPY.menuItems;
  return (
    <>
      <Menu
        label={TODAY_COPY.menu}
        trigger={(tp) => <IconKey {...tp} icon={Ellipsis} label={TODAY_COPY.menu} />}
        items={[
          {
            id: 'replan',
            label: m.replanRest,
            onSelect: () => {
              toast(TODAY_COPY.replanning(left));
              void actions.replanRest().then((o) => toast(o.message ?? (o.ok ? TODAY_COPY.replanReady : TODAY_COPY.replanDidntFinish)));
            },
          },
          {
            id: 'scratch',
            label: m.replanScratch,
            onSelect: () => {
              navigate(livingPaths.replanFromScratch);
              useActivePlanStore.getState().setPlanningOverride(true);
            },
          },
          { id: 'checkin', label: m.checkIn, onSelect: onCheckIn, disabled: !checkInOpen, hint: checkInOpen ? undefined : `from ${fmtDay(addDays(today, daysToCheckIn - 2))}` },
          { id: 'away', label: m.away, onSelect: () => setAway(true), disabled: plan.status !== 'active' && plan.status !== 'scheduled' },
          { id: 'fast', label: m.fast, onSelect: () => setFasting(true) },
          plan.status === 'paused'
            ? { id: 'resume', label: m.resume, onSelect: () => void actions.resume(today).then((o) => toast(o.ok ? 'The plan is running again.' : (o.message ?? 'Couldn’t resume.'))), separatorBefore: true }
            : { id: 'pause', label: m.pause, onSelect: () => setPausing(true), disabled: plan.status !== 'active', separatorBefore: true },
          { id: 'end', label: m.end, onSelect: () => setEnding(true), tone: 'danger' },
          { id: 'details', label: m.details, onSelect: () => navigate(livingPaths.planActive), separatorBefore: true },
          { id: 'planning', label: m.planning, onSelect: () => enterPlanningTools(navigate) },
        ]}
      />
      <TypedConfirmDialog
        open={ending}
        onClose={() => setEnding(false)}
        title={TODAY_COPY.endTitle(plan.name)}
        body={TODAY_COPY.endBody}
        word="end"
        instruction={TODAY_COPY.endType}
        confirmLabel={TODAY_COPY.endKey}
        onConfirm={async (typed) => {
          const o = await actions.end(typed);
          if (!o.ok) {
            toast(o.message ?? 'The plan couldn’t be ended.');
            return;
          }
          setEnding(false);
          toast(`${plan.name} has ended. You can restore it for 7 days.`);
          navigate('/plan');
        }}
      />
      <PauseSheet open={pausing} onClose={() => setPausing(false)} today={today} />
      {away ? <AwaySheet onClose={() => setAway(false)} today={today} /> : null}
      {fasting ? <FastSheet onClose={() => setFasting(false)} /> : null}
    </>
  );
}

/** Pause plan: from · reason (living-mode.md §4.6, IA §4.12). Paused days prescribe the usual day. */
function PauseSheet({ open, onClose, today }: { open: boolean; onClose: () => void; today: LocalDate }) {
  const actions = useLivingActions();
  const [from, setFrom] = useState<'today' | 'tomorrow'>('today');
  const [reason, setReason] = useState('');
  return (
    <ResponsivePanel
      open={open}
      onClose={onClose}
      title={TODAY_COPY.pauseTitle}
      footer={
        <>
          <Key onClick={onClose}>{TODAY_COPY.cancel}</Key>
          <Key
            variant="solid"
            onClick={() =>
              void actions.pause(from === 'today' ? today : addDays(today, 1), reason.trim() || undefined).then((o) => {
                toast(o.ok ? 'The plan is paused. Your usual days until you resume.' : (o.message ?? 'Couldn’t pause.'));
                if (o.ok) onClose();
              })
            }
          >
            {TODAY_COPY.pauseKey}
          </Key>
        </>
      }
    >
      <div className="lv-sheet">
        <p className="lv-sheet__target">{TODAY_COPY.pauseBody}</p>
        <KeyBank
          label="from"
          value={from}
          onChange={setFrom}
          options={[
            { value: 'today', label: 'today' },
            { value: 'tomorrow', label: 'tomorrow' },
          ]}
        />
        <Field label="reason (optional)" help="Only you see this.">
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="travel, illness, a busy week" />
        </Field>
      </div>
    </ResponsivePanel>
  );
}

type EventKind = PlanEventInput['kind'];
const EVENT_KINDS: readonly EventKind[] = ['busy', 'travel', 'illness', 'noTraining', 'socialMeal'];

/**
 * I'm busy or away… (living-mode.md §4.5): what's happening · from · to (a meal out: one day) · note. Defaults to
 * tomorrow until the day after. The plan answers with a proposal on Today (or applies a lighter change at once).
 */
function AwaySheet({ onClose, today }: { onClose: () => void; today: LocalDate }) {
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
    toast(c.awayWorking);
    const o = back ? await actions.shift({ from, days, mode: 'pushBack' }) : await actions.declareEvent({ kind, from, to: end, ...(note.trim() ? { note: note.trim() } : {}) });
    setSending(false);
    toast(o.message ?? (o.ok ? c.replanReady : c.awayDidntFinish));
    if (o.ok) onClose();
  };
  return (
    <ResponsivePanel
      open
      onClose={onClose}
      title={c.awayTitle}
      footer={
        <>
          <Key onClick={onClose}>{c.cancel}</Key>
          <Key variant="solid" loading={sending} onClick={() => void send()}>
            {c.awayKey}
          </Key>
        </>
      }
    >
      <div className="lv-sheet">
        <p className="lv-sheet__target">{c.awayBody}</p>
        <KeyBank label={c.awayKind} value={kind} onChange={setKind} options={EVENT_KINDS.map((k) => ({ value: k, label: c.awayKinds[k] }))} />
        <Field label={oneDay ? c.awayOn : c.awayFrom}>
          <TextInput type="date" value={from} min={today} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </Field>
        {oneDay ? null : (
          <Field label={c.awayTo}>
            <TextInput type="date" value={end} min={from} max={last} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </Field>
        )}
        {oneDay ? null : <Checkbox checked={pushBack} onChange={setPushBack} label={c.awayPushBack} help={c.awayPushBackHelp(days)} />}
        {back ? null : (
          <Field label={c.awayNote} help={c.awayNoteHelp}>
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
        )}
      </div>
    </ResponsivePanel>
  );
}
