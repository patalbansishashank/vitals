/**
 * "Add a measurement" (living-mode.md §8.2 Body): a sheet on mobile, a side panel on desktop. Metric units only.
 * Girths take 2–3 repeats and send them as `repeats` — the action keeps their mean. Consumer body-fat readings are kept
 * as rough readings (±2 points); a DXA reading resets the composition estimate. Labs are listed but not yet available.
 */
import { useState } from 'react';
import { Field, HelpText, InlineWarning, Key, KeyBank, NumberField, ResponsivePanel, Select, decimalsOf, formatNumber, toast } from '@/components';
import type { LocalDate, MeasurementEntry } from '@/living';
import { useLivingActions, type ActionOutcome } from '../../data/actions';
import { fmtDay } from '../../format';
import { MEASURE_COPY as C } from '../copy';

type Method = NonNullable<MeasurementEntry['method']>;
export type MeasureKey = keyof typeof C.metrics;
type Loggable = Exclude<MeasureKey, 'labs'>;

interface MetricSpec {
  metric: MeasurementEntry['metric'];
  unit: string;
  min: number;
  max: number;
  step: number;
  girth?: boolean;
  methods: readonly Method[];
}

const SPEC: Record<Loggable, MetricSpec> = {
  weight: { metric: 'weightKg', unit: 'kg', min: 30, max: 300, step: 0.1, methods: ['scale'] },
  waist: { metric: 'waistCm', unit: 'cm', min: 40, max: 200, step: 0.1, girth: true, methods: ['tape'] },
  hip: { metric: 'hipCm', unit: 'cm', min: 50, max: 200, step: 0.1, girth: true, methods: ['tape'] },
  neck: { metric: 'neckCm', unit: 'cm', min: 20, max: 80, step: 0.1, girth: true, methods: ['tape'] },
  chest: { metric: 'chestCm', unit: 'cm', min: 50, max: 200, step: 0.1, girth: true, methods: ['tape'] },
  arm: { metric: 'armCm', unit: 'cm', min: 15, max: 70, step: 0.1, girth: true, methods: ['tape'] },
  thigh: { metric: 'thighCm', unit: 'cm', min: 30, max: 120, step: 0.1, girth: true, methods: ['tape'] },
  bodyFat: { metric: 'bodyFatPct', unit: '%', min: 3, max: 70, step: 0.1, methods: ['scale', 'bia', 'dxa', 'skinfold'] },
  bloodPressure: { metric: 'sbpMmHg', unit: 'mmHg', min: 60, max: 250, step: 1, methods: ['meter'] },
  ketones: { metric: 'ketonesMmolL', unit: 'mmol/L', min: 0, max: 10, step: 0.1, methods: ['meter'] },
  glucose: { metric: 'glucoseMmolL', unit: 'mmol/L', min: 1, max: 30, step: 0.1, methods: ['meter'] },
};

const ORDER: readonly MeasureKey[] = ['weight', 'waist', 'hip', 'neck', 'chest', 'arm', 'thigh', 'bodyFat', 'bloodPressure', 'ketones', 'glucose', 'labs'];

export interface MeasurementPanelProps {
  open: boolean;
  onClose: () => void;
  /** The day the measurement is for (today). */
  date: LocalDate;
  initial?: Loggable;
}

export function MeasurementPanel({ open, onClose, date, initial = 'waist' }: MeasurementPanelProps) {
  const actions = useLivingActions();
  const [key, setKey] = useState<Loggable>(initial);
  const [value, setValue] = useState<number | null>(null);
  const [repeats, setRepeats] = useState<Array<number | null>>([null, null, null]);
  const [diastolic, setDiastolic] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>(SPEC[initial].methods[0]!);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const spec = SPEC[key];

  const reset = (k: Loggable) => {
    setKey(k);
    setValue(null);
    setRepeats([null, null, null]);
    setDiastolic(null);
    setMethod(SPEC[k].methods[0]!);
    setError(null);
  };
  const close = () => {
    reset(key);
    onClose();
  };

  const save = async () => {
    if (busy) return;
    const label = C.metrics[key];
    let outcomes: ActionOutcome[];
    let shown: string;
    if (spec.girth) {
      const rs = repeats.filter((r): r is number => r !== null);
      if (rs.length < 2) {
        setError(C.needTwo);
        return;
      }
      setBusy(true);
      // the action keeps the mean of the repeats
      outcomes = [await actions.logMeasurement(date, { metric: spec.metric, value: rs[0]!, repeats: rs, method })];
      shown = C.meanOf(rs.length);
    } else if (key === 'bloodPressure') {
      if (value === null || diastolic === null) {
        setError(C.needValue);
        return;
      }
      setBusy(true);
      outcomes = [
        await actions.logMeasurement(date, { metric: 'sbpMmHg', value, method }),
        await actions.logMeasurement(date, { metric: 'dbpMmHg', value: diastolic, method }),
      ];
      shown = `${formatNumber(value, 0)}/${formatNumber(diastolic, 0)} mmHg`;
    } else {
      if (value === null) {
        setError(C.needValue);
        return;
      }
      setBusy(true);
      outcomes = [await actions.logMeasurement(date, { metric: spec.metric, value, method, ...(key === 'weight' ? { context: 'morningFasted' as const } : {}) })];
      shown = `${formatNumber(value, decimalsOf(spec.step))} ${spec.unit}`;
    }
    setBusy(false);
    const failed = outcomes.find((o) => !o.ok);
    if (failed) {
      for (const o of outcomes) if (o.ok) void o.undo?.();
      setError(failed.message ?? C.needValue);
      return;
    }
    const undos = outcomes.map((o) => o.undo).filter((u): u is NonNullable<ActionOutcome['undo']> => !!u);
    toast(C.logged(label, shown), undos.length ? { action: { label: C.undo, onClick: () => undos.forEach((u) => void u()) } } : {});
    close();
  };

  return (
    <ResponsivePanel
      open={open}
      onClose={close}
      title={C.title}
      footer={
        <>
          <Key onClick={close}>{C.cancel}</Key>
          <Key variant="solid" loading={busy} onClick={() => void save()}>
            {C.save}
          </Key>
        </>
      }
    >
      <div className="lv-measure">
        <p className="lv-measure__date lm-eng">{C.forDate(fmtDay(date))}</p>
        <Field label={C.metric}>
          <Select<MeasureKey>
            value={key}
            onChange={(k) => {
              if (k !== 'labs') reset(k);
            }}
            options={ORDER.map((k) => ({ value: k, label: C.metrics[k], ...(k === 'labs' ? { disabled: true } : {}) }))}
          />
        </Field>

        {spec.girth ? (
          <fieldset className="lv-measure__repeats">
            <legend className="lm-field__label">{C.value}</legend>
            {repeats.map((r, i) => (
              <Field key={i} label={C.repeat(i + 1)}>
                <NumberField
                  name={`${C.metrics[key]} ${C.repeat(i + 1)}`}
                  value={r}
                  onChange={(v) => {
                    setError(null);
                    setRepeats((xs) => xs.map((x, k) => (k === i ? v : x)));
                  }}
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  unit={spec.unit}
                />
              </Field>
            ))}
            <HelpText>{C.repeatsHelp}</HelpText>
          </fieldset>
        ) : key === 'bloodPressure' ? (
          <div className="lv-measure__pair">
            <Field label={C.systolic}>
              <NumberField
                name={C.systolic}
                value={value}
                onChange={(v) => {
                  setError(null);
                  setValue(v);
                }}
                min={60}
                max={250}
                step={1}
                unit="mmHg"
              />
            </Field>
            <Field label={C.diastolic}>
              <NumberField
                name={C.diastolic}
                value={diastolic}
                onChange={(v) => {
                  setError(null);
                  setDiastolic(v);
                }}
                min={30}
                max={150}
                step={1}
                unit="mmHg"
              />
            </Field>
          </div>
        ) : (
          <Field label={C.metrics[key]}>
            <NumberField
              name={C.metrics[key]}
              value={value}
              onChange={(v) => {
                setError(null);
                setValue(v);
              }}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              unit={spec.unit}
            />
          </Field>
        )}

        {spec.methods.length > 1 ? (
          <Field label={C.method}>
            <KeyBank<Method> value={method} onChange={setMethod} options={spec.methods.map((m) => ({ value: m, label: C.methods[m as keyof typeof C.methods] ?? m }))} />
          </Field>
        ) : null}

        {key === 'bodyFat' && method === 'dxa' ? <InlineWarning severity="info">{C.dxaNote}</InlineWarning> : null}
        {key === 'bodyFat' && method !== 'dxa' ? <InlineWarning severity="info">{C.roughNote}</InlineWarning> : null}
        {error ? (
          <InlineWarning severity="caution" alert>
            {error}
          </InlineWarning>
        ) : null}
      </div>
    </ResponsivePanel>
  );
}
