/** Composite turns of chapter 1 (a normal day): work days × hours, step numbers, sport rows, sleep. */
import { useState } from 'react';
import { Checkbox, InlineWarning, Key, KeyBank, ScaleRange, Stepper, TextInput, formatNumber } from '@/components';
import type { RecreationEntry, RecreationIntensity } from '@/engine/types/profile';
import { looksLikeTraining, SLEEP_PRESETS, sleepText, type SleepRange, type StepsValue, type WorkTimeValue } from '../../chapters/activity';
import { A, TURN } from '../../copy';
import { AnswerKeys } from '../AnswerKeys';
import type { WidgetProps } from '../widgetTypes';

const HOURS = [4, 6, 8, 10, 12] as const;

/** A3: days Stepper (1–7; halves when "it varies") + hours keys; an hours key commits the pair. */
export function WorkTimeWidget({ value, values, onCommit, labelledBy }: WidgetProps<WorkTimeValue>) {
  const varies = values.work === 'varies';
  const [days, setDays] = useState<number>(value?.days ?? 5);
  return (
    <div className="lm-ik-row">
      <div className="lm-ik-inline">
        <span className="lm-ik-row__label" id={`${labelledBy}-days`}>
          {A.workTime.days}
        </span>
        <Stepper name={A.workTime.daysName} value={days} onChange={setDays} min={1} max={7} step={varies ? 0.5 : 1} decimals={varies ? 1 : 0} inputMode={varies ? 'decimal' : 'numeric'} />
      </div>
      <span className="lm-ik-row__label" id={`${labelledBy}-hours`}>
        {A.workTime.hours}
      </span>
      <AnswerKeys
        labelledBy={`${labelledBy}-hours`}
        className="lm-ik-keys--presets"
        options={HOURS.map((h) => ({ value: String(h), label: `${h} h` }))}
        value={value ? String(value.hours) : undefined}
        defaultValue="8"
        onCommit={(h) => onCommit({ days, hours: Number(h) })}
      />
    </div>
  );
}

const STEP_CHIPS = [3000, 5000, 7000, 9000, 12000, 15000] as const;

/** A5a: step presets (a tap commits), an exact number, or two numbers when work days and days off differ. */
export function StepsWidget({ value, values, onCommit, labelledBy }: WidgetProps<StepsValue>) {
  const [split, setSplit] = useState(value?.workday !== undefined || value?.offDay !== undefined);
  const [mean, setMean] = useState<number | null>(value?.mean ?? null);
  const [workday, setWorkday] = useState<number | null>(value?.workday ?? null);
  const [offDay, setOffDay] = useState<number | null>(value?.offDay ?? null);
  const working = values.work === 'yes' || values.work === 'varies';
  return (
    <div className="lm-ik-row">
      {!split ? (
        <>
          <AnswerKeys
            labelledBy={labelledBy}
            className="lm-ik-keys--presets"
            options={STEP_CHIPS.map((n) => ({ value: String(n), label: formatNumber(n, 0) }))}
            value={value?.mean !== undefined ? String(value.mean) : undefined}
            onCommit={(n) => onCommit({ mean: Number(n) })}
          />
          <div className="lm-ik-inline">
            <Stepper name={A.stepsNumber.name} value={mean} onChange={setMean} min={0} max={40000} step={100} inputMode="numeric" />
            <Key onClick={() => mean !== null && onCommit({ mean })} disabledReason={mean === null ? TURN.exact : undefined}>
              {TURN.done}
            </Key>
          </div>
        </>
      ) : (
        <div className="lm-ik-row">
          <div className="lm-ik-inline">
            <span className="lm-ik-row__label">{A.stepsNumber.workday}</span>
            <Stepper name={A.stepsNumber.workday} value={workday} onChange={setWorkday} min={0} max={40000} step={100} inputMode="numeric" />
          </div>
          <div className="lm-ik-inline">
            <span className="lm-ik-row__label">{A.stepsNumber.offDay}</span>
            <Stepper name={A.stepsNumber.offDay} value={offDay} onChange={setOffDay} min={0} max={40000} step={100} inputMode="numeric" />
          </div>
          <div className="lm-ik-done">
            <Key
              onClick={() => onCommit({ ...(workday !== null ? { workday } : {}), ...(offDay !== null ? { offDay } : {}) })}
              disabledReason={workday === null && offDay === null ? TURN.exact : undefined}
            >
              {TURN.done}
            </Key>
          </div>
        </div>
      )}
      <div className="lm-ik-inline">
        {working ? <Checkbox checked={split} onChange={setSplit} label={A.stepsNumber.split} /> : null}
        <Key variant="quiet" size="sm" onClick={() => onCommit({ importLater: true })}>
          {A.stepsNumber.importLater}
        </Key>
      </div>
      <p className="lm-ik-note">{A.stepsNumber.importNote}</p>
    </div>
  );
}

const clock = (h: number) => sleepText({ bed: h, wake: h }).slice(0, 5);

const INTENSITIES: RecreationIntensity[] = ['light', 'moderate', 'vigorous'];
type Row = { label: string; intensity: RecreationIntensity; minPerWeek: number | null; moved?: boolean };

/** A8: "none", or rows of name + light / moderate / hard + minutes a week. Training-like names offer a move. */
export function SportRowsWidget({ value, onCommit, labelledBy }: WidgetProps<RecreationEntry[]>) {
  const [rows, setRows] = useState<Row[]>(() => (value ?? []).map((r) => ({ ...r })));
  const [moved, setMoved] = useState<string[]>([]);
  const [kept, setKept] = useState<string[]>([]);
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const valid = rows.filter((r) => r.label.trim() && (r.minPerWeek ?? 0) > 0);
  return (
    <div className="lm-ik-row">
      {rows.length === 0 ? (
        <div className="lm-ik-actions">
          <Key onClick={() => onCommit([])} aria-describedby={labelledBy}>
            {A.sport.none}
          </Key>
          <Key variant="quiet" onClick={() => setRows([{ label: '', intensity: 'moderate', minPerWeek: null }])}>
            {A.sport.addRow}
          </Key>
        </div>
      ) : (
        <>
          {rows.map((r, i) => {
            const who = r.label.trim() || A.sport.rowName(i + 1);
            const training = r.label.trim() && looksLikeTraining(r.label) && !kept.includes(r.label.trim());
            return (
              <div key={i} className="lm-ik-sportrow">
                <div className="lm-ik-inline">
                  <TextInput
                    aria-label={A.sport.rowName(i + 1)}
                    placeholder={A.sport.namePlaceholder}
                    value={r.label}
                    onChange={(e) => set(i, { label: e.currentTarget.value })}
                    style={{ flex: '1 1 10rem', minWidth: 0 }}
                  />
                  <Key variant="quiet" size="sm" aria-label={TURN.remove(who)} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                    ×
                  </Key>
                </div>
                <KeyBank<RecreationIntensity>
                  label={`${who}: intensity`}
                  size="lg"
                  value={r.intensity}
                  onChange={(x) => set(i, { intensity: x })}
                  options={INTENSITIES.map((x) => ({ value: x, label: A.sport.intensity[x] }))}
                />
                <div className="lm-ik-inline">
                  <Stepper name={`${who} ${A.sport.minutes}`} value={r.minPerWeek} onChange={(n) => set(i, { minPerWeek: n })} min={0} max={2520} step={15} unit="min" inputMode="numeric" />
                  <span className="lm-ik-row__label">{A.sport.minutes}</span>
                </div>
                {training ? (
                  <InlineWarning
                    severity="info"
                    action={
                      <span className="lm-ik-actions">
                        <Key
                          size="sm"
                          onClick={() => {
                            setMoved((m) => [...m, r.label.trim()]);
                            setRows((rs) => rs.filter((_, j) => j !== i));
                          }}
                        >
                          {A.sport.moveToTraining}
                        </Key>
                        <Key size="sm" variant="quiet" onClick={() => setKept((k) => [...k, r.label.trim()])}>
                          {A.sport.keepHere}
                        </Key>
                      </span>
                    }
                  >
                    {A.sport.looksLikeTraining}
                  </InlineWarning>
                ) : null}
              </div>
            );
          })}
          <div className="lm-ik-actions">
            <Key variant="quiet" onClick={() => setRows((rs) => [...rs, { label: '', intensity: 'moderate', minPerWeek: null }])}>
              {A.sport.addRow}
            </Key>
            <Key
              onClick={() => onCommit(valid.map((r) => ({ label: r.label.trim(), intensity: r.intensity, minPerWeek: r.minPerWeek ?? 0 })))}
              disabledReason={valid.length === 0 ? A.sport.namePlaceholder : undefined}
            >
              {valid.length ? TURN.doneCount(valid.length) : TURN.done}
            </Key>
          </div>
        </>
      )}
      {moved.map((m) => (
        <p key={m} className="lm-ik-note" role="status">
          {A.sport.moved(m)}
        </p>
      ))}
    </div>
  );
}

/** A10: sleep presets (a tap commits) or "other" with a bed/wake range. */
export function SleepWidget({ value, onCommit, labelledBy }: WidgetProps<SleepRange>) {
  const presetOf = (r: SleepRange | undefined) =>
    r ? (Object.entries(SLEEP_PRESETS).find(([, p]) => p.bed === r.bed && p.wake === r.wake)?.[0] ?? 'other') : undefined;
  const [other, setOther] = useState(presetOf(value) === 'other');
  // the range runs 18:00 → 36:00 (= 12:00 next day) so a night never wraps
  const [range, setRange] = useState<[number, number]>(() => {
    const r = value ?? { bed: 23, wake: 7 };
    const bed = r.bed < 12 ? r.bed + 24 : r.bed;
    const wake = r.wake + 24;
    return [bed, wake];
  });
  return (
    <div className="lm-ik-row">
      <AnswerKeys
        labelledBy={labelledBy}
        className="lm-ik-keys--presets"
        options={[...Object.entries(SLEEP_PRESETS).map(([k, r]) => ({ value: k, label: sleepText(r) })), { value: 'other', label: A.sleep.other }]}
        value={presetOf(value)}
        defaultValue="23-07"
        onCommit={(k) => {
          if (k === 'other') return setOther(true);
          onCommit({ ...SLEEP_PRESETS[k as keyof typeof SLEEP_PRESETS] });
        }}
      />
      {other ? (
        <div className="lm-ik-row">
          <ScaleRange
            label={A.sleep.rangeLabel}
            value={range}
            onChange={setRange}
            min={18}
            max={36}
            step={0.5}
            minGap={3}
            thumbLabels={A.sleep.thumbs}
            format={(h: number) => clock(h)}
            valueText={(h: number, which) => `${which === 'low' ? A.sleep.thumbs[0] : A.sleep.thumbs[1]} ${clock(h)}`}
          />
          <div className="lm-ik-done">
            <Key onClick={() => onCommit({ bed: range[0] % 24, wake: range[1] % 24 })}>{TURN.done}</Key>
          </div>
        </div>
      ) : null}
    </div>
  );
}
