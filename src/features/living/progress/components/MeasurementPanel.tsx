/**
 * "Add a measurement" (living-mode.md §8.2 Body): a sheet on mobile (Cancel · title · Save), a side panel on desktop.
 * Metric units only. A girth is one field labelled with the girth; "Repeat" adds a second and third reading, sent as
 * `repeats` (the action keeps their mean). A body-fat reading is kept exactly as entered with its method (D5-07): what it
 * does to the composition estimate is method- and device-specific uncertainty, never a fixed ±2 points or a reset, and
 * no note about it sits under the field. A weigh-in's context is optional and stays unknown unless stated (D5-04).
 * Blood pressure is one paired sitting (systolic + diastolic share an episode id, D4-05) with an optional setting; a
 * ketone reading has an optional sample type (D2-08). Every optional fact left unanswered stays unknown.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Field, Key, KeyBank, NumberField, ResponsivePanel, Select, decimalsOf, formatNumber, toast } from '@/components';
import type { LocalDate, MeasurementEntry } from '@/living';
import { useLivingActions, type ActionOutcome } from '../../data/actions';
import { WEIGH_CONTEXTS, WEIGH_CONTEXT_LABEL, type WeighContext } from '../../today/components/WeighSheet';
import { MEASURE_COPY as C } from '../copy';

type Method = NonNullable<MeasurementEntry['method']>;
type Specimen = keyof typeof C.specimens;
type Setting = keyof typeof C.settings;
const SPECIMENS = (Object.keys(C.specimens) as Specimen[]).map((v) => ({ value: v, label: C.specimens[v] }));
const SETTINGS = (Object.keys(C.settings) as Setting[]).map((v) => ({ value: v, label: C.settings[v] }));
let episodeSeq = 0;
/** One blood-pressure sitting: its systolic and diastolic readings share this id (D4-05). */
const newEpisodeId = (date: LocalDate): string => `bp-${date}-${Date.now().toString(36)}-${(episodeSeq += 1)}`;
export type MeasureKey = keyof typeof C.metrics;

interface MetricSpec {
  metric: MeasurementEntry['metric'];
  unit: string;
  min: number;
  max: number;
  step: number;
  girth?: boolean;
  methods: readonly Method[];
}

const SPEC: Record<MeasureKey, MetricSpec> = {
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

const ORDER: readonly MeasureKey[] = ['weight', 'waist', 'hip', 'neck', 'chest', 'arm', 'thigh', 'bodyFat', 'bloodPressure', 'ketones', 'glucose'];
/** Readings a girth can take (the first one plus two repeats). */
const MAX_READINGS = 3;

export interface MeasurementPanelProps {
  open: boolean;
  onClose: () => void;
  /** The day the measurement is for (today). */
  date: LocalDate;
  initial?: MeasureKey;
}

export function MeasurementPanel({ open, onClose, date, initial = 'waist' }: MeasurementPanelProps) {
  const actions = useLivingActions();
  const [key, setKey] = useState<MeasureKey>(initial);
  const [value, setValue] = useState<number | null>(null);
  const [repeats, setRepeats] = useState<Array<number | null>>([null]);
  const [diastolic, setDiastolic] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>(SPEC[initial].methods[0]!);
  const [context, setContext] = useState<WeighContext | undefined>(undefined);
  const [specimen, setSpecimen] = useState<Specimen | undefined>(undefined);
  const [setting, setSetting] = useState<Setting | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const spec = SPEC[key];

  const reset = (k: MeasureKey) => {
    setKey(k);
    setValue(null);
    setRepeats([null]);
    setDiastolic(null);
    setMethod(SPEC[k].methods[0]!);
    setContext(undefined);
    setSpecimen(undefined);
    setSetting(undefined);
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
    const dec = decimalsOf(spec.step);
    if (spec.girth) {
      const rs = repeats.filter((r): r is number => r !== null);
      if (rs.length === 0) {
        setError(C.needValue);
        return;
      }
      setBusy(true);
      // the action keeps the mean of the repeats
      outcomes = [await actions.logMeasurement(date, { metric: spec.metric, value: rs[0]!, ...(rs.length > 1 ? { repeats: rs } : {}), method })];
      shown = `${formatNumber(rs.reduce((a, b) => a + b, 0) / rs.length, dec)} ${spec.unit}`;
    } else if (key === 'bloodPressure') {
      if (value === null || diastolic === null) {
        setError(C.needValue);
        return;
      }
      setBusy(true);
      const sitting = { episodeId: newEpisodeId(date), ...(setting ? { setting } : {}) };
      outcomes = [
        await actions.logMeasurement(date, { metric: 'sbpMmHg', value, method, ...sitting }),
        await actions.logMeasurement(date, { metric: 'dbpMmHg', value: diastolic, method, ...sitting }),
      ];
      shown = `${formatNumber(value, 0)}/${formatNumber(diastolic, 0)} mmHg`;
    } else {
      if (value === null) {
        setError(C.needValue);
        return;
      }
      setBusy(true);
      // C4/D5-04: a weigh-in's context only as the person stated it (unanswered stays unknown)
      outcomes = [
        await actions.logMeasurement(date, {
          metric: spec.metric,
          value,
          method,
          ...(key === 'weight' && context ? { context } : {}),
          ...(key === 'ketones' && specimen ? { specimen } : {}),
        }),
      ];
      shown = `${formatNumber(value, dec)} ${spec.unit}`;
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
    <ResponsivePanel open={open} onClose={close} title={C.title} onDone={() => void save()} doneLabel={C.save} cancelLabel={C.cancel} doneDisabled={busy}>
      <div className="lv-measure">
        <Field label={C.metric}>
          <Select<MeasureKey> value={key} onChange={reset} options={ORDER.map((k) => ({ value: k, label: C.metrics[k] }))} />
        </Field>

        {spec.girth ? (
          <div className="lv-measure__repeats">
            {repeats.map((r, i) => (
              <Field key={i} label={i === 0 ? C.metrics[key] : C.repeat(i + 1)} error={i === 0 && error ? error : undefined}>
                <NumberField
                  name={i === 0 ? C.metrics[key] : C.repeat(i + 1)}
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
            {repeats.length < MAX_READINGS ? (
              <div>
                <Key size="sm" variant="outlined" icon={Plus} onClick={() => setRepeats((xs) => [...xs, null])}>
                  {C.addRepeat}
                </Key>
              </div>
            ) : null}
          </div>
        ) : key === 'bloodPressure' ? (
          <div className="lv-measure__pair">
            <Field label={C.systolic} error={error ?? undefined}>
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
          <Field label={C.metrics[key]} error={error ?? undefined}>
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

        {key === 'weight' ? (
          <Field label={WEIGH_CONTEXT_LABEL}>
            <KeyBank<WeighContext> label={WEIGH_CONTEXT_LABEL} size="sm" value={context} onChange={setContext} options={WEIGH_CONTEXTS} />
          </Field>
        ) : null}

        {key === 'ketones' ? (
          <Field label={C.specimen}>
            <KeyBank<Specimen> label={C.specimen} size="sm" value={specimen} onChange={setSpecimen} options={SPECIMENS} />
          </Field>
        ) : null}

        {key === 'bloodPressure' ? (
          <Field label={C.setting}>
            <KeyBank<Setting> label={C.setting} size="sm" value={setting} onChange={setSetting} options={SETTINGS} />
          </Field>
        ) : null}

        {spec.methods.length > 1 ? (
          <Field label={C.method}>
            <KeyBank<Method> value={method} onChange={setMethod} options={spec.methods.map((m) => ({ value: m, label: C.methods[m as keyof typeof C.methods] ?? m }))} />
          </Field>
        ) : null}
      </div>
    </ResponsivePanel>
  );
}
