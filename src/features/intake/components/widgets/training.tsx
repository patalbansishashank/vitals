/** Composite turns of chapter 2 (training and equipment). */
import { useState } from 'react';
import { InlineWarning, Key, KeyBank, Stepper } from '@/components';
import {
  ALL_DAYS,
  CONDITIONS,
  EQUIPMENT_GROUPS,
  FAMILIES,
  INJURIES,
  KITS,
  LOADABLE,
  WEIGHT_CHIPS,
  equipmentLabel,
  expandKits,
  type Condition,
  type Injury,
  type Kit,
  type KitValue,
  type Place,
  type PlaceDaysValue,
  type TrainTimeValue,
  type WeightsValue,
} from '../../chapters/training';
import { T, TURN, WEEKDAY } from '../../copy';
import { isTextEntry, textOf, TEXT_PREFIX } from '../../flow';
import type { TimeOfDay, TrainingFamily, Weekday, Willingness } from '../../types';
import { MultiChips, OtherEntries } from '../AnswerKeys';
import type { WidgetProps } from '../widgetTypes';

/** T1: one no · fine · like bank per family; Done treats rows left alone as "fine". */
export function WillingnessWidget({ value, onCommit }: WidgetProps<Partial<Record<TrainingFamily, Willingness>>>) {
  const [w, setW] = useState<Partial<Record<TrainingFamily, Willingness>>>(() => ({ ...(value ?? {}) }));
  const exceptions = Object.values(w).filter((x) => x && x !== 'fine').length;
  return (
    <div className="lm-ik-row">
      <p className="lm-ik-note">{T.willing.help}</p>
      <div>
        {FAMILIES.map((f) => (
          <div key={f} className="lm-ik-bankrow">
            <span className="lm-ik-bankrow__name" id={`ik-will-${f}`}>
              {T.willing.families[f]}
            </span>
            <KeyBank<Willingness>
              labelledBy={`ik-will-${f}`}
              size="lg"
              value={w[f]}
              onChange={(x) => setW((cur) => ({ ...cur, [f]: x }))}
              options={(['no', 'fine', 'like'] as const).map((x) => ({ value: x, label: T.willing.keys[x] }))}
            />
          </div>
        ))}
      </div>
      <div className="lm-ik-done">
        <Key
          onClick={() => {
            const out: Partial<Record<TrainingFamily, Willingness>> = {};
            for (const f of FAMILIES) if (w[f] && w[f] !== 'fine') out[f] = w[f];
            onCommit(out);
          }}
        >
          {exceptions ? TURN.doneCount(exceptions) : TURN.done}
        </Key>
      </div>
    </div>
  );
}

const weekdayOptions = WEEKDAY.order.map((d) => ({ value: String(d), label: WEEKDAY.short[d] }));

/** Weekday chips (Monday first); the value is the catalogue's `Weekday` (0 = Sunday). */
export function WeekdayChips({ value, onChange, label }: { value: readonly Weekday[]; onChange: (days: Weekday[]) => void; label: string }) {
  return (
    <MultiChips
      label={label}
      options={weekdayOptions}
      value={value.map(String)}
      onChange={(v) => onChange(v.map(Number).filter((d) => ALL_DAYS.includes(d as Weekday)) as Weekday[])}
    />
  );
}

/** T2 follow-up: which days each place can be used (left empty = any day). */
export function PlaceDaysWidget({ value, values, onCommit }: WidgetProps<PlaceDaysValue>) {
  const places = ((values.where as Place[] | undefined) ?? []).filter((p) => p !== 'home' && p !== 'walkRoute');
  const [days, setDays] = useState<PlaceDaysValue>(() => ({ ...(value ?? {}) }));
  return (
    <div className="lm-ik-row">
      {places.map((p) => (
        <div key={p} className="lm-ik-row">
          <span className="lm-ik-row__label">{T.where.options[p]}</span>
          <WeekdayChips label={T.whereDays.place(T.where.options[p])} value={days[p] ?? []} onChange={(d) => setDays((cur) => ({ ...cur, [p]: d }))} />
        </div>
      ))}
      <div className="lm-ik-done">
        <Key
          onClick={() => {
            const out: PlaceDaysValue = {};
            for (const p of places) if (days[p]?.length) out[p] = days[p];
            onCommit(out);
          }}
        >
          {TURN.done}
        </Key>
      </div>
    </div>
  );
}

const KIT_IDS: readonly Kit[] = ['none', 'home', 'bands', 'dumbbells', 'indian', 'gym'];

/** T3: kit keys tick a starting set, then the grouped checklist adjusts it; "something else" is kept as typed. */
export function KitWidget({ value, onCommit }: WidgetProps<KitValue>) {
  const [kits, setKits] = useState<Kit[]>([]);
  const [owned, setOwned] = useState<string[]>(() => [...(value?.owned ?? [])]);
  const [custom, setCustom] = useState<string[]>(() => (value?.custom ?? []).map((c) => `${TEXT_PREFIX}${c}`));
  const toggleKit = (k: Kit) => {
    if (k === 'none') {
      setKits(['none']);
      setOwned([]);
      return;
    }
    const on = kits.includes(k);
    const next = on ? kits.filter((x) => x !== k && x !== 'none') : [...kits.filter((x) => x !== 'none'), k];
    setKits(next);
    if (on) {
      const keep = new Set(expandKits(next));
      setOwned((o) => o.filter((id) => !KITS[k].includes(id) || keep.has(id)));
    } else setOwned((o) => Array.from(new Set([...o, ...KITS[k]])));
  };
  const total = owned.filter((id) => id !== 'plates').length + custom.length;
  return (
    <div className="lm-ik-row">
      <p className="lm-ik-note">{T.kit.lead}</p>
      <div className="lm-ik-chips" role="group" aria-label={T.kit.short}>
        {KIT_IDS.map((k) => (
          <Key key={k} pressed={kits.includes(k)} onClick={() => toggleKit(k)} size="lg">
            {T.kit.kits[k]}
            {k in T.kit.kitExamples ? <span className="lm-sr">{` — for example ${T.kit.kitExamples[k as keyof typeof T.kit.kitExamples]}`}</span> : null}
          </Key>
        ))}
      </div>
      {EQUIPMENT_GROUPS.map((g) => (
        <div key={g.id} className="lm-ik-row">
          <h3 className="lm-ik-group-title" id={`ik-kit-${g.id}`}>
            {T.kit.groups[g.id]}
          </h3>
          <MultiChips
            labelledBy={`ik-kit-${g.id}`}
            options={g.items.map((id) => ({ value: id, label: equipmentLabel(id) }))}
            value={owned.filter((id) => g.items.includes(id))}
            onChange={(picked) => setOwned((o) => [...o.filter((id) => !g.items.includes(id)), ...picked])}
          />
        </div>
      ))}
      <div className="lm-ik-row">
        <h3 className="lm-ik-group-title">{T.kit.somethingElse}</h3>
        <OtherEntries value={custom} onChange={(v) => setCustom(v.filter(isTextEntry))} label={T.kit.somethingElse} placeholder={T.kit.somethingElsePlaceholder} />
        <p className="lm-ik-note">{T.kit.customNote}</p>
      </div>
      <div className="lm-ik-done">
        <Key onClick={() => onCommit({ owned: owned.filter((id) => id !== 'plates'), custom: custom.map(textOf) })}>{total ? TURN.doneCount(total) : TURN.done}</Key>
      </div>
    </div>
  );
}

/** T3a: weights per loadable item (multi) or "not sure". */
export function WeightsWidget({ value, values, onCommit }: WidgetProps<WeightsValue>) {
  const items = (((values.kit as KitValue | undefined)?.owned ?? []) as string[]).filter((id) => LOADABLE.includes(id));
  const [w, setW] = useState<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const id of items) {
      const v = value?.[id];
      out[id] = v === 'unsure' ? ['unsure'] : Array.isArray(v) ? v.map(String) : [];
    }
    return out;
  });
  return (
    <div className="lm-ik-row">
      {items.map((id) => (
        <div key={id} className="lm-ik-row">
          <span className="lm-ik-row__label">{equipmentLabel(id)}</span>
          <MultiChips
            label={T.weights.item(equipmentLabel(id))}
            options={[...WEIGHT_CHIPS.map((kg) => ({ value: String(kg), label: `${kg} kg` })), { value: 'unsure', label: T.weights.notSure, exclusive: true }]}
            value={w[id] ?? []}
            onChange={(v) => setW((cur) => ({ ...cur, [id]: v }))}
          />
        </div>
      ))}
      <div className="lm-ik-done">
        <Key
          onClick={() => {
            const out: WeightsValue = {};
            for (const id of items) {
              const v = w[id] ?? [];
              out[id] = v.length === 0 || v.includes('unsure') ? 'unsure' : v.map(Number).sort((a, b) => a - b);
            }
            onCommit(out);
          }}
        >
          {TURN.done}
        </Key>
      </div>
    </div>
  );
}

const MINUTES = [10, 20, 30, 45, 60, 90] as const;
const BEST: readonly TimeOfDay[] = ['morning', 'midday', 'evening', 'any'];

/** T4: days a week, minutes per session, best time; Done fills what is left with the defaults shown. */
export function TrainTimeWidget({ value, onCommit }: WidgetProps<TrainTimeValue>) {
  const [days, setDays] = useState<number | null>(value?.days ?? null);
  const [minutes, setMinutes] = useState<string | undefined>(value ? String(value.minutes) : undefined);
  const [best, setBest] = useState<TimeOfDay | undefined>(value?.best);
  return (
    <div className="lm-ik-row">
      <div className="lm-ik-inline">
        <span className="lm-ik-row__label">{T.time.days}</span>
        <Stepper name={T.time.days} value={days} onChange={setDays} min={0} max={7} step={1} inputMode="numeric" />
      </div>
      <span className="lm-ik-row__label" id="ik-time-min">
        {T.time.minutes}
      </span>
      <KeyBank labelledBy="ik-time-min" size="lg" block value={minutes} onChange={setMinutes} options={MINUTES.map((m) => ({ value: String(m), label: `${m}` }))} />
      <span className="lm-ik-row__label" id="ik-time-best">
        {T.time.best}
      </span>
      <KeyBank<TimeOfDay> labelledBy="ik-time-best" size="lg" block value={best} onChange={setBest} options={BEST.map((b) => ({ value: b, label: T.time.bestOptions[b] }))} />
      <div className="lm-ik-done">
        <Key onClick={() => onCommit({ days: days ?? 3, minutes: minutes ? Number(minutes) : 30, best: best ?? 'any' })}>{TURN.done}</Key>
      </div>
    </div>
  );
}

/** T5: parts (or none); each picked part asks whether a clinician cleared it; the effect shows inline. */
export function InjuriesWidget({ value, onCommit }: WidgetProps<{ parts: Injury[]; cleared: Injury[] }>) {
  const [picked, setPicked] = useState<string[]>(() => (value ? (value.parts.length ? [...value.parts] : ['none']) : []));
  const [cleared, setCleared] = useState<Injury[]>(() => [...(value?.cleared ?? [])]);
  const parts = picked.filter((p): p is Injury => (INJURIES as readonly string[]).includes(p));
  return (
    <div className="lm-ik-row">
      <MultiChips
        label={T.injuries.short}
        options={[...INJURIES.map((p) => ({ value: p, label: T.injuries.options[p] })), { value: 'none', label: T.injuries.options.none, exclusive: true }]}
        value={picked}
        onChange={setPicked}
      />
      {parts.map((p) => (
        <div key={p} className="lm-ik-row">
          {p !== 'hip' ? (
            <div className="lm-ik-bankrow">
              <span className="lm-ik-bankrow__name" id={`ik-cleared-${p}`}>
                {T.injuries.cleared(T.injuries.options[p])}
              </span>
              <KeyBank<'yes' | 'no'>
                labelledBy={`ik-cleared-${p}`}
                size="lg"
                value={cleared.includes(p) ? 'yes' : undefined}
                onChange={(x) => setCleared((c) => (x === 'yes' ? [...c.filter((y) => y !== p), p] : c.filter((y) => y !== p)))}
                options={[
                  { value: 'yes', label: T.injuries.yes },
                  { value: 'no', label: T.injuries.no },
                ]}
              />
            </div>
          ) : null}
          {!cleared.includes(p) ? (
            <InlineWarning severity="info">
              {T.injuries.effect[p]}
              {p !== 'hip' ? ` ${T.injuries.clearedNote}` : ''}
            </InlineWarning>
          ) : null}
        </div>
      ))}
      <p className="lm-ik-note">{T.injuries.safetyNote}</p>
      <div className="lm-ik-done">
        <Key onClick={() => onCommit({ parts, cleared: cleared.filter((c) => parts.includes(c)) })} disabledReason={picked.length === 0 ? TURN.ifSkip(T.injuries.skip) : undefined}>
          {TURN.done}
        </Key>
      </div>
    </div>
  );
}

/** T6: conditions with their effect shown inline. */
export function ConditionsWidget({ value, onCommit }: WidgetProps<string[]>) {
  const [picked, setPicked] = useState<string[]>(() => [...(value ?? [])]);
  const on = picked.filter((c): c is Condition => (CONDITIONS as readonly string[]).includes(c));
  return (
    <div className="lm-ik-row">
      <MultiChips
        label={T.conditions.short}
        options={[...CONDITIONS.map((c) => ({ value: c, label: T.conditions.options[c] })), { value: 'none', label: T.conditions.options.none, exclusive: true }]}
        value={picked}
        onChange={setPicked}
      />
      {on.map((c) => (
        <InlineWarning key={c} severity="info">
          {T.conditions.effect[c]}
        </InlineWarning>
      ))}
      <div className="lm-ik-done">
        <Key onClick={() => onCommit(picked)} disabledReason={picked.length === 0 ? TURN.ifSkip(T.conditions.skip) : undefined}>
          {TURN.done}
        </Key>
      </div>
    </div>
  );
}
