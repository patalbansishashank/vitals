import '../cards/sheets.css';
/**
 * Log a fast (Today's ⋯): a whole fast entered by hand — started · ended, each a date target that opens the platform's
 * date-and-time picker — on any day, whether or not the day's prescription has a fast (`log.fast` record, LIVING_PLAN
 * §Today). The prescribed fast row keeps its own "broke it at" editor. Defaults: a 16 h fast ending now (to the quarter
 * hour). The end can't be after now or before the start, and a fast logged here is at most 72 h.
 * Ember (SPEC §5 Sheet): the header is Cancel · "Log a fast" · Log; the body holds the two ends and the length they
 * make, as a value. There is no commit key in the body.
 */
import { useId, useState } from 'react';
import { EM_DASH, Field, ResponsivePanel, toast } from '@/components';
import { useLivingClock } from '../../clock';
import { DateTarget } from '../../components/DateTarget';
import { TODAY_COPY } from '../../copy';
import { useLivingActions } from '../../data/actions';
import { fmtHours } from '../../format';

/** Longest fast this sheet logs (hours). */
export const MAX_FAST_H = 72;

const pad = (n: number) => String(n).padStart(2, '0');
/** A Date as a `datetime-local` value (local wall time, minutes). */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** A `datetime-local` value as a Date (read as local), or null. */
function fromLocalInput(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function FastSheet({ onClose }: { onClose: () => void }) {
  const actions = useLivingActions();
  const clock = useLivingClock();
  const [now] = useState(() => {
    const n = clock.now();
    n.setSeconds(0, 0);
    return n;
  });
  const [start, setStart] = useState(() => {
    const end = new Date(now);
    end.setMinutes(Math.floor(end.getMinutes() / 15) * 15);
    return toLocalInput(new Date(end.getTime() - 16 * 3600_000));
  });
  const [end, setEnd] = useState(() => {
    const e = new Date(now);
    e.setMinutes(Math.floor(e.getMinutes() / 15) * 15);
    return toLocalInput(e);
  });
  const [sending, setSending] = useState(false);
  const lengthId = useId();
  const c = TODAY_COPY;
  const a = fromLocalInput(start);
  const b = fromLocalInput(end);
  const hours = a && b ? (b.getTime() - a.getTime()) / 3600_000 : null;
  const startError = a ? undefined : c.fastMissing;
  const endError = !b
    ? c.fastMissing
    : b.getTime() > now.getTime()
      ? c.fastFuture
      : hours !== null && hours <= 0
        ? c.fastEndBeforeStart
        : hours !== null && hours > MAX_FAST_H
          ? c.fastTooLong(MAX_FAST_H)
          : undefined;
  const valid = !startError && !endError && hours !== null;
  const send = async () => {
    if (sending || !valid || !a || !b || hours === null) return;
    setSending(true);
    const o = await actions.logFast(a.toISOString(), b.toISOString());
    setSending(false);
    if (!o.ok) {
      toast(o.message ?? c.failed);
      return;
    }
    toast(
      c.fastLogged(fmtHours(hours)),
      o.undo ? { action: { label: c.undo, onClick: () => void o.undo?.() } } : {},
    );
    onClose();
  };
  // the length the two ends make: shown while it is a real span, even one the sheet refuses (the error says why)
  const length = hours !== null && hours > 0 ? fmtHours(hours) : null;
  return (
    <ResponsivePanel
      open
      onClose={onClose}
      title={c.fastTitle}
      onDone={() => void send()}
      doneLabel={c.logKey}
      doneDisabled={sending}
      {...(valid ? {} : { doneDisabledReason: startError ?? endError })}
    >
      <div className="lv-sheet lv-sheet--fast" data-domain="energy">
        <Field label={c.fastStart} error={startError}>
          <DateTarget type="datetime-local" value={start} max={toLocalInput(now)} onChange={setStart} />
        </Field>
        <Field label={c.fastEnd} error={endError}>
          <DateTarget type="datetime-local" value={end} max={toLocalInput(now)} onChange={setEnd} />
        </Field>
        <div className="lv-sheet__value">
          <span id={lengthId} className="lv-sheet__value-label">
            {c.fastLength}
          </span>
          <output aria-labelledby={lengthId} className="lv-sheet__value-num lm-num">
            {length ?? EM_DASH}
          </output>
        </div>
      </div>
    </ResponsivePanel>
  );
}
