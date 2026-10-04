/**
 * Pause the plan (IA §4.12): from today or tomorrow, until you resume, with an optional reason. Paused days prescribe
 * your usual day; what you log still counts. TODO(E5): `plan.pause` has no "until" yet — the plan stays paused until
 * the person resumes, which is what the sheet says.
 */
import { useState } from 'react';
import { Field, InlineWarning, Key, KeyBank, KeyValueList, ResponsivePanel, TextInput, toast } from '@/components';
import { addDays } from '@/living/dates';
import type { LocalDate } from '@/living';
import { useLivingActions } from '../../data/actions';
import { fmtDay } from '../../format';
import { PLAN_COPY as C } from '../copy';

type From = 'today' | 'tomorrow';

export function PausePanel({ open, onClose, today }: { open: boolean; onClose: () => void; today: LocalDate }) {
  const actions = useLivingActions();
  const [from, setFrom] = useState<From>('today');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fromDate = from === 'today' ? today : addDays(today, 1);

  const close = () => {
    setFrom('today');
    setReason('');
    setError(null);
    onClose();
  };
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const r = await actions.pause(fromDate, reason.trim() || undefined);
    setBusy(false);
    if (!r.ok) {
      setError(r.message ?? C.failed);
      return;
    }
    toast(C.pausedToast(fmtDay(fromDate)));
    close();
  };

  return (
    <ResponsivePanel
      open={open}
      onClose={close}
      title={C.pauseTitle}
      footer={
        <>
          <Key onClick={close}>{C.cancel}</Key>
          <Key variant="solid" loading={busy} onClick={() => void confirm()}>
            {C.pauseConfirm}
          </Key>
        </>
      }
    >
      <div className="lv-plan-pause">
        <p className="lv-plan-prose">{C.pauseBody}</p>
        <Field label={C.from} help={fmtDay(fromDate)}>
          <KeyBank<From> value={from} onChange={setFrom} options={(Object.keys(C.fromChoices) as From[]).map((k) => ({ value: k, label: C.fromChoices[k] }))} />
        </Field>
        <KeyValueList items={[{ key: C.until, value: C.untilText }]} />
        <Field label={C.reason}>
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder={C.reasonHint} autoComplete="off" />
        </Field>
        {error ? (
          <InlineWarning severity="caution" alert>
            {error}
          </InlineWarning>
        ) : null}
      </div>
    </ResponsivePanel>
  );
}
