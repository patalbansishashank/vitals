/**
 * Log weight: a small dialog with one number field in the person's units (kg or lb) and the time of the weigh-in.
 * Weight is always typed by the person (or imported from a scale app); the ring never measures it. Saves through
 * `log.weight` (undoable from the toast).
 */
import { useState } from 'react';
import { Dialog, Field, Key, NumberField, toast } from '@/components';
import { kgToLb, lbToKg } from '@/lib/units';
import { useSettingsStore } from '@/state/settingsStore';
import type { LocalDate } from '@/living';
import { TODAY_COPY } from '../../copy';
import { useLivingActions } from '../../data/actions';
import { fmtDay } from '../../format';

export function WeighSheet({ open, date, lastKg, onClose, onSaved }: { open: boolean; date: LocalDate; lastKg?: number | undefined; onClose: () => void; /** The saved weigh-in's undo, for the row's own Undo key. */ onSaved?: (undo: (() => Promise<unknown>) | undefined) => void }) {
  const actions = useLivingActions();
  const imperial = useSettingsStore((s) => s.units) === 'imperial';
  const unit = imperial ? 'lb' : 'kg';
  const toUnit = (kg: number) => (imperial ? kgToLb(kg) : kg);
  // the parent mounts the dialog only while it is open, so the field starts from the last weight each time
  const [value, setValue] = useState<number | null>(() => (lastKg !== undefined ? Math.round(toUnit(lastKg) * 10) / 10 : null));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (value === null) return;
    const kg = imperial ? lbToKg(value) : value;
    setBusy(true);
    const o = await actions.logWeight(date, kg);
    setBusy(false);
    if (!o.ok) {
      toast(o.message ?? 'That didn’t work. Try again.');
      return;
    }
    onSaved?.(o.undo);
    toast(`Weight ${value.toFixed(1)} ${unit} saved.`, o.undo ? { action: { label: TODAY_COPY.undo, onClick: () => void o.undo?.() } } : {});
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Log weight"
      footer={
        <>
          <Key onClick={onClose}>{TODAY_COPY.cancel}</Key>
          <Key onClick={() => void save()} {...(value === null || busy ? { disabledReason: 'Type your weight first.' } : {})}>
            Save
          </Key>
        </>
      }
    >
      <form
        className="lv-weigh"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={`weight · ${fmtDay(date)}`}>
          <NumberField value={value} onChange={setValue} min={imperial ? 66 : 30} max={imperial ? 660 : 300} step={0.1} decimals={1} unit={unit} name="weight" />
        </Field>
        <p className="lv-weigh__hint">Same time each day, after the bathroom, before eating.</p>
      </form>
    </Dialog>
  );
}
