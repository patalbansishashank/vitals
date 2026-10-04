/** Composite turns of chapter 3 (food and kitchen). */
import { useState } from 'react';
import { Key, TextInput } from '@/components';
import { presetState, type SupplementRow as SupplementRowValue, type SupplementStance } from '@/catalogues/supplements';
import { SupplementRowList } from '@/features/components/SupplementRowList';
import { DIET_PRESETS, FOOD_KEYS, type DietPreset, type EatValue, type FastingValue, type FoodKey, type StaplesValue } from '../../chapters/food';
import { listComplete, listCounts, rowsOfAnswer } from '../../chapters/supplements';
import { F, TURN } from '../../copy';
import { isTextEntry } from '../../flow';
import type { Weekday } from '../../types';
import { MultiChips, OtherEntries } from '../AnswerKeys';
import type { WidgetProps } from '../widgetTypes';
import { WeekdayChips } from './training';

const PRESETS: readonly DietPreset[] = ['vegetarian', 'eggetarian', 'vegan', 'jain', 'pescatarian', 'everything'];

/** F1: start from a pattern, then adjust the food chips; Done commits. Nothing is assumed when skipped. */
export function EatWidget({ value, onCommit }: WidgetProps<EatValue>) {
  const [preset, setPreset] = useState<DietPreset | undefined>(value?.preset);
  const [foods, setFoods] = useState<FoodKey[]>(() => [...(value?.foods ?? [])]);
  const [touched, setTouched] = useState(value !== undefined);
  return (
    <div className="lm-ik-row">
      <p className="lm-ik-note">{F.eat.lead}</p>
      <div className="lm-ik-chips" role="group" aria-label={F.eat.short}>
        {PRESETS.map((p) => (
          <Key
            key={p}
            size="lg"
            pressed={preset === p}
            onClick={() => {
              setPreset(p);
              setFoods([...DIET_PRESETS[p]]);
              setTouched(true);
            }}
          >
            {F.eat.presets[p]}
          </Key>
        ))}
      </div>
      <MultiChips
        label={F.eat.prompt}
        options={FOOD_KEYS.map((k) => ({ value: k, label: F.eat.foods[k] }))}
        value={foods}
        onChange={(v) => {
          setFoods(v as FoodKey[]);
          setTouched(true);
        }}
      />
      <div className="lm-ik-done">
        <Key onClick={() => onCommit({ ...(preset ? { preset } : {}), foods: FOOD_KEYS.filter((k) => foods.includes(k)) })} disabledReason={touched ? undefined : TURN.ifSkip(F.eat.skip)}>
          {TURN.done}
        </Key>
      </div>
    </div>
  );
}

/** Weekday chips + Done (empty = none). */
export function WeekdaysWidget({ q, value, onCommit }: WidgetProps<Weekday[]>) {
  const [days, setDays] = useState<Weekday[]>(() => [...(value ?? [])]);
  return (
    <div className="lm-ik-row">
      <WeekdayChips label={q.short} value={days} onChange={setDays} />
      <div className="lm-ik-done">
        <Key onClick={() => onCommit(days)}>{days.length ? TURN.doneCount(days.length) : TURN.done}</Key>
      </div>
    </div>
  );
}

const PERIODS = ['Ekadashi', 'Navratri', 'Shravan'] as const;

/** F3 follow-up (Hindu fasting): weekdays and periods, plus "other" typed. */
export function FastingDaysWidget({ value, onCommit }: WidgetProps<FastingValue>) {
  const [days, setDays] = useState<Weekday[]>(() => [...(value?.weekdays ?? [])]);
  const [periods, setPeriods] = useState<string[]>(() => [...(value?.periods ?? [])]);
  return (
    <div className="lm-ik-row">
      <WeekdayChips label={F.fasting.short} value={days} onChange={setDays} />
      <MultiChips label={F.fasting.prompt} options={PERIODS.map((p) => ({ value: p, label: F.fasting.periods[p] }))} value={periods.filter((p) => !isTextEntry(p))} onChange={(v) => setPeriods([...v, ...periods.filter(isTextEntry)])} />
      <OtherEntries value={periods.filter(isTextEntry)} onChange={(v) => setPeriods([...periods.filter((p) => !isTextEntry(p)), ...v.filter(isTextEntry)])} label={F.fasting.periods.custom} />
      <div className="lm-ik-done">
        <Key onClick={() => onCommit({ weekdays: days, periods })}>{TURN.done}</Key>
      </div>
    </div>
  );
}

/** Free text + Done (kept as typed). */
export function TextWidget({ q, value, onCommit }: WidgetProps<string>) {
  const [text, setText] = useState(value ?? '');
  const placeholder = q.id === 'household' ? F.household.placeholder : undefined;
  return (
    <div className="lm-ik-row">
      <TextInput aria-label={q.short} placeholder={placeholder} value={text} onChange={(e) => setText(e.currentTarget.value)} />
      <div className="lm-ik-done">
        <Key onClick={() => onCommit(text.trim())} disabledReason={text.trim() ? undefined : TURN.ifSkip(q.skipText)}>
          {TURN.done}
        </Key>
      </div>
    </div>
  );
}

/**
 * S2: which supplements are taken or kept at home, one dose row each (`SupplementRowList`, E18). New picks start in the
 * state the stance answer implies. Done works with zero rows ("none after all"); with rows, every taking row needs an
 * amount and a time first (the errors show after the first Done).
 */
export function SupplementsWidget({ value, values, onCommit }: WidgetProps<SupplementRowValue[]>) {
  const [rows, setRows] = useState<SupplementRowValue[]>(() => rowsOfAnswer(value));
  const [tried, setTried] = useState(false);
  const preset = presetState((values.supplements as SupplementStance | undefined) ?? 'taking');
  const counts = listCounts(rows);
  return (
    <div className="lm-ik-row">
      <SupplementRowList rows={rows} onChange={setRows} preset={preset} showErrors={tried} />
      <div className="lm-ik-done">
        <Key
          onClick={() => {
            if (!listComplete(rows)) return setTried(true);
            onCommit(rows);
          }}
        >
          {rows.length ? `${TURN.done} · ${counts}` : TURN.done}
        </Key>
      </div>
    </div>
  );
}

/** Later block: staple grains and cooking fats. */
export function StaplesWidget({ value, onCommit }: WidgetProps<StaplesValue>) {
  const [grain, setGrain] = useState<string[]>(() => [...(value?.grain ?? [])]);
  const [fat, setFat] = useState<string[]>(() => [...(value?.fat ?? [])]);
  return (
    <div className="lm-ik-row">
      <MultiChips label={F.staples.short} options={Object.entries(F.staples.grain).map(([v, l]) => ({ value: v, label: l }))} value={grain} onChange={setGrain} />
      <MultiChips label={F.staples.short} options={Object.entries(F.staples.fat).map(([v, l]) => ({ value: v, label: l }))} value={fat} onChange={setFat} />
      <div className="lm-ik-done">
        <Key onClick={() => onCommit({ grain, fat })}>{TURN.done}</Key>
      </div>
    </div>
  );
}
