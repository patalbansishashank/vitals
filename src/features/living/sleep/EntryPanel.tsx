/**
 * "Lights out and up" (D11, r071 restyle only): the person's own times, which give the time to fall asleep and sleep
 * efficiency. Applies through `log.sleepTimes` and waits for it: a refused write keeps the sheet open with its reason.
 */
import { useState, type FormEvent } from 'react';
import { Field, ResponsivePanel, TextInput } from '@/components';
import { clockOf } from '@/features/ring/model';
import { SLEEP_COPY as C } from './copy';
import { clockOfIso, saveSleepTimes, timeAfter, timeOnNight, useSleepEntry } from './entry';
import './sleep.css';

export function EntryPanel({ open, onClose, date, onset, wake }: { open: boolean; onClose: () => void; date: string; onset: string | null; wake: string | null }) {
  const current = useSleepEntry(date);
  // (Claude UI P2-13) start from the person's own times only: the ring's onset and wake are a hint, never pre-filled, so
  // one tap on Save cannot attest the ring's inference as the person's (D11)
  const [lightsOut, setLightsOut] = useState(() => clockOfIso(current?.lightsOutAt));
  const [outOfBed, setOutOfBed] = useState(() => clockOfIso(current?.outOfBedAt));
  const hint = onset && wake ? C.ringSaw(clockOf(onset), clockOf(wake)) : null;
  const lo = timeOnNight(date, lightsOut);
  const ob = outOfBed ? (lo ? timeAfter(lo, outOfBed) : timeOnNight(date, outOfBed)) : null;
  const bad = !lo || (outOfBed !== '' && (!ob || Date.parse(ob) <= Date.parse(lo)));
  const formId = `sl-entry-${date}`;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // (Codex UI #18) wait for the command: a refused or failed write keeps the editor open with its message
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (bad || !lo || saving) return;
    setSaving(true);
    setError(null);
    const o = await saveSleepTimes(date, { lightsOutAt: lo, outOfBedAt: ob });
    setSaving(false);
    if (o.ok) onClose();
    else setError(o.message || C.saveFailed);
  };
  return (
    <ResponsivePanel
      open={open}
      onClose={onClose}
      title={C.entryTitle}
      doneForm={formId}
      doneLabel="Save"
      doneDisabled={bad || saving}
      doneDisabledReason={bad ? 'Lights out comes before getting up.' : saving ? 'Saving' : undefined}
    >
      <form id={formId} className="sl-entry" onSubmit={(e) => void submit(e)}>
        {hint ? <p className="rg-note">{hint}</p> : null}
        <Field label={C.lightsOut}>
          <TextInput type="time" value={lightsOut} onChange={(e) => setLightsOut(e.target.value)} required />
        </Field>
        <Field label={C.outOfBed}>
          <TextInput type="time" value={outOfBed} onChange={(e) => setOutOfBed(e.target.value)} />
        </Field>
        {error ? (
          <p className="rg-note sl-entry__error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </ResponsivePanel>
  );
}
