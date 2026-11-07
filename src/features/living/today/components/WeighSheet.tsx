import '../cards/sheets.css';
/**
 * Log weight: a bottom sheet (a side panel on desktop) with one number field in the person's units (kg or lb), starting
 * from the latest weigh-in, and an optional "When" row (on waking before food · evening · after training). Weight is
 * always typed by the person (or imported from a scale app). C4/D5-04: the weighing context is the person's answer, never
 * assumed — left unanswered it stays unknown (unstandardized precision in the trend), never "morning, fasted". Saves
 * through `log.measurement` (undoable from the toast).
 */
import { useId, useState } from 'react';
import { Field, KeyBank, NumberField, ResponsivePanel, toast } from '@/components';
import type { MeasurementEntry } from '@/living';
import { kgToLb, lbToKg } from '@/lib/units';
import { useSettingsStore } from '@/state/settingsStore';
import type { LocalDate } from '@/living';
import { TODAY_COPY } from '../../copy';
import { useLivingActions } from '../../data/actions';
import { useToday } from '../../clock';
import { fmtDay } from '../../format';

/** The weighing contexts a person can state (C4/D5-04); unanswered = unknown. */
export type WeighContext = Exclude<NonNullable<MeasurementEntry['context']>, 'unknown'>;
export const WEIGH_CONTEXT_LABEL = 'When';
export const WEIGH_CONTEXTS: ReadonlyArray<{ value: WeighContext; label: string }> = [
  { value: 'morningFasted', label: 'On waking' },
  { value: 'evening', label: 'Evening' },
  { value: 'postWorkout', label: 'After training' },
];

export function WeighSheet({
  open,
  date,
  lastKg,
  onClose,
  onSaved,
}: {
  open: boolean;
  date: LocalDate;
  lastKg?: number | undefined;
  onClose: () => void;
  /** The saved weigh-in's undo (the tick's second tap). */ onSaved?: (
    undo: (() => Promise<unknown>) | undefined,
  ) => void;
}) {
  const actions = useLivingActions();
  const today = useToday();
  const imperial = useSettingsStore((s) => s.units) === 'imperial';
  const unit = imperial ? 'lb' : 'kg';
  const toUnit = (kg: number) => (imperial ? kgToLb(kg) : kg);
  // the parent mounts the sheet only while it is open, so the field starts from the latest weight each time
  const [value, setValue] = useState<number | null>(() =>
    lastKg !== undefined ? Math.round(toUnit(lastKg) * 10) / 10 : null,
  );
  const [busy, setBusy] = useState(false);
  const [context, setContext] = useState<WeighContext | undefined>(undefined);
  const formId = useId();

  const save = async () => {
    if (value === null || busy) return;
    const kg = imperial ? lbToKg(value) : value;
    setBusy(true);
    // the context only as stated: an unanswered weigh-in is unknown, never stamped "morning, fasted"
    const o = await actions.logMeasurement(date, {
      metric: 'weightKg',
      value: kg,
      method: 'scale',
      ...(context ? { context } : {}),
    });
    setBusy(false);
    if (!o.ok) {
      toast(o.message ?? TODAY_COPY.failed);
      return;
    }
    onSaved?.(o.undo);
    toast(
      TODAY_COPY.weighSaved(`${value.toFixed(1)} ${unit}`),
      o.undo ? { action: { label: TODAY_COPY.undo, onClick: () => void o.undo?.() } } : {},
    );
    onClose();
  };

  return (
    <ResponsivePanel
      open={open}
      onClose={onClose}
      title={date === today ? TODAY_COPY.weighTitle : TODAY_COPY.weighTitleOn(fmtDay(date))}
      doneForm={formId}
      doneLabel="Save"
      doneDisabled={busy}
      {...(value === null ? { doneDisabledReason: 'Type your weight first.' } : {})}
    >
      <form
        id={formId}
        className="lv-sheet lv-sheet--weight"
        data-domain="body"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={TODAY_COPY.weighTitle} hideLabel>
          <NumberField
            value={value}
            onChange={setValue}
            min={imperial ? 66 : 30}
            max={imperial ? 660 : 300}
            step={0.1}
            decimals={1}
            unit={unit}
            name="weight"
          />
        </Field>
        <Field label={WEIGH_CONTEXT_LABEL}>
          <KeyBank<WeighContext>
            label={WEIGH_CONTEXT_LABEL}
            size="sm"
            value={context}
            onChange={setContext}
            options={WEIGH_CONTEXTS}
          />
        </Field>
      </form>
    </ResponsivePanel>
  );
}
