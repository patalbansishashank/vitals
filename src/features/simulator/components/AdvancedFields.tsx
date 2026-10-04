/**
 * "More detail" — every remaining DayTemplate input the engine contract defines (MODEL_SPEC §5.2), each showing its
 * engine default until set: food quality, carbohydrate and fat detail, protein source, hydration and electrolytes,
 * substances (caffeine, alcohol, creatine, exogenous ketones), modifiers and the energy reference.
 */
import { Plus, X } from 'lucide-react';
import { IconKey, KJ_PER_KCAL, Key, KeyBank, Select, Stepper, Switch, formatNumber } from '@/components';
import type { DayTemplate, EnergyReference, ProteinSource, ResolvedProfile } from '@/engine';
import { DEFAULTS } from '@/engine';
import { DefaultedNumber, TimeField } from './editorParts';
import { useEnergyUnit } from '@/state/settingsStore';

export interface AdvancedFieldsProps {
  t: DayTemplate;
  resolved: ResolvedProfile;
  apply: (recipe: (t: DayTemplate) => DayTemplate, key?: string) => void;
  commit: () => void;
  /** Days of this template that are fasting days (electrolytes apply). */
  zero: boolean;
  scenarioReference: EnergyReference;
}

const SOURCES: Array<{ value: ProteinSource; label: string }> = [
  { value: 'mixedOmnivore', label: 'mixed, omnivore' },
  { value: 'mixedVegetarian', label: 'mixed, vegetarian' },
  { value: 'mixedVegan', label: 'mixed, vegan' },
  { value: 'meat', label: 'meat' },
  { value: 'egg', label: 'egg' },
  { value: 'milk', label: 'milk' },
  { value: 'whey', label: 'whey' },
  { value: 'casein', label: 'casein' },
  { value: 'soy', label: 'soy' },
  { value: 'pea', label: 'pea' },
  { value: 'peaRiceBlend', label: 'pea + rice blend' },
  { value: 'rice', label: 'rice' },
  { value: 'wheat', label: 'wheat' },
  { value: 'collagen', label: 'collagen' },
];

/** Count of advanced fields set on a template (the disclosure's "4 set" badge). */
export function advancedCount(t: DayTemplate): number {
  let n = 0;
  const m = t.macros;
  n += [
    m.viscousFibreShare,
    m.sugarsShare,
    m.fructoseShareOfSugars,
    m.fatTypes?.satShare,
    m.fatTypes?.mufaShare,
    m.fatTypes?.pufaShare,
    m.fatTypes?.omega3G,
    m.fatTypes?.mctG,
  ].filter((v) => v !== undefined).length;
  const f = t.food ?? {};
  n += [
    f.glycaemicIndex,
    f.upfShare,
    f.energyDensityKcalPerG,
    f.nutsG,
    f.liquidKcal,
    f.foodQuality,
    f.cholesterolMg,
    f.dashFraction,
  ].filter((v) => v !== undefined).length;
  const h = t.hydration ?? {};
  n += [h.sodiumG, h.potassiumG, h.magnesiumMg, h.fluidL, h.sweatLPerH].filter((v) => v !== undefined).length;
  const s = t.substances ?? {};
  n +=
    (s.caffeine?.length ?? 0) +
    (s.alcohol?.length ?? 0) +
    (s.exogenousKetones?.length ?? 0) +
    (s.creatineG !== undefined ? 1 : 0);
  const mo = t.modifiers ?? {};
  n += [mo.stress, mo.illness, mo.travelJetLag, mo.hotClimate, mo.saunaSessionsPerWeek].filter(
    (v) => v !== undefined,
  ).length;
  if (t.energy.kind === 'pctMaintenance' && t.energy.reference) n++;
  return n;
}

const pct = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 1000) / 10);
const frac = (v: number | undefined) => (v === undefined ? undefined : v / 100);

export function AdvancedFields({ t, resolved, apply, commit, zero, scenarioReference }: AdvancedFieldsProps) {
  const once = (recipe: (t: DayTemplate) => DayTemplate) => {
    apply(recipe);
    commit();
  };
  const m = t.macros;
  const ft = m.fatTypes ?? {};
  const food = t.food ?? {};
  const hy = t.hydration ?? {};
  const sub = t.substances ?? {};
  const mo = t.modifiers ?? {};
  const setMacros = (patch: Partial<DayTemplate['macros']>) =>
    once((x) => ({ ...x, macros: { ...x.macros, ...patch } }));
  const setFat = (patch: Partial<NonNullable<DayTemplate['macros']['fatTypes']>>) =>
    once((x) => ({ ...x, macros: { ...x.macros, fatTypes: { ...x.macros.fatTypes, ...patch } } }));
  const setFood = (patch: Partial<NonNullable<DayTemplate['food']>>) =>
    once((x) => ({ ...x, food: { ...x.food, ...patch } }));
  const setHy = (patch: Partial<NonNullable<DayTemplate['hydration']>>) =>
    once((x) => ({ ...x, hydration: { ...x.hydration, ...patch } }));
  const setSub = (patch: Partial<NonNullable<DayTemplate['substances']>>) =>
    once((x) => ({ ...x, substances: { ...x.substances, ...patch } }));
  const setMo = (patch: Partial<NonNullable<DayTemplate['modifiers']>>) =>
    once((x) => ({ ...x, modifiers: { ...x.modifiers, ...patch } }));
  const sex = resolved.sex;
  const ref = t.energy.kind === 'pctMaintenance' ? (t.energy.reference ?? 'scenario') : null;
  // Settings › energy unit: display and entry in kJ, stored in kcal
  const kJ = useEnergyUnit() === 'kJ';
  const toU = (kcal: number | undefined, dp = 0) =>
    kcal === undefined ? undefined : kJ ? Math.round(kcal * KJ_PER_KCAL * 10 ** dp) / 10 ** dp : kcal;
  const fromU = (v: number | undefined) => (v === undefined ? undefined : kJ ? v / KJ_PER_KCAL : v);

  return (
    <div className="sim-adv">
      {ref !== null ? (
        <div className="sim-field">
          <span className="lm-eng">energy % is relative to</span>
          <Select
            label="Energy reference"
            value={ref}
            onChange={(v) =>
              once((x) =>
                x.energy.kind === 'pctMaintenance'
                  ? {
                      ...x,
                      energy:
                        v === 'scenario'
                          ? { kind: 'pctMaintenance', pct: x.energy.pct }
                          : { kind: 'pctMaintenance', pct: x.energy.pct, reference: v as EnergyReference },
                    }
                  : x,
              )
            }
            options={[
              {
                value: 'scenario',
                label: `scenario setting (${scenarioReference === 'baseline' ? 'starting maintenance' : scenarioReference === 'current' ? "each day's maintenance" : 'block start'})`,
              },
              { value: 'baseline', label: 'starting maintenance' },
              { value: 'current', label: "each day's maintenance (adapts)" },
              { value: 'blockStart', label: 'maintenance at block start' },
            ]}
          />
        </div>
      ) : null}

      <h4 className="sim-adv__h">Carbohydrate and fibre</h4>
      <DefaultedNumber
        label="sugars, share of net carbs"
        value={pct(m.sugarsShare)}
        def={(DEFAULTS.habitualSugarsG[sex] / Math.max(1, resolved.habitualCarbG)) * 100}
        decimals={0}
        defNote="default: habitual sugars"
        onChange={(v) => setMacros({ sugarsShare: frac(v) })}
        min={0}
        max={100}
        step={5}
        unit="%"
      />
      <DefaultedNumber
        label="fructose, share of sugars"
        value={pct(m.fructoseShareOfSugars)}
        def={DEFAULTS.fructoseShareOfSugars * 100}
        onChange={(v) => setMacros({ fructoseShareOfSugars: frac(v) })}
        min={0}
        max={100}
        step={5}
        unit="%"
      />
      <DefaultedNumber
        label="viscous fibre, share of fibre"
        value={pct(m.viscousFibreShare)}
        def={DEFAULTS.viscousFibreShare * 100}
        onChange={(v) => setMacros({ viscousFibreShare: frac(v) })}
        min={0}
        max={100}
        step={5}
        unit="%"
      />
      <DefaultedNumber
        label="glycaemic index"
        value={food.glycaemicIndex}
        def={DEFAULTS.glycaemicIndex}
        onChange={(v) => setFood({ glycaemicIndex: v })}
        min={20}
        max={100}
        step={5}
      />

      <h4 className="sim-adv__h">Fat types</h4>
      <DefaultedNumber
        label="saturated, share of fat"
        value={pct(ft.satShare)}
        def={DEFAULTS.satShare * 100}
        onChange={(v) => setFat({ satShare: frac(v) })}
        min={0}
        max={100}
        step={1}
        unit="%"
      />
      <DefaultedNumber
        label="monounsaturated"
        value={pct(ft.mufaShare)}
        def={DEFAULTS.mufaShare * 100}
        onChange={(v) => setFat({ mufaShare: frac(v) })}
        min={0}
        max={100}
        step={1}
        unit="%"
      />
      <DefaultedNumber
        label="polyunsaturated"
        value={pct(ft.pufaShare)}
        def={DEFAULTS.pufaShare * 100}
        onChange={(v) => setFat({ pufaShare: frac(v) })}
        min={0}
        max={100}
        step={1}
        unit="%"
      />
      <DefaultedNumber
        label="omega-3 (EPA + DHA)"
        value={ft.omega3G}
        def={DEFAULTS.habitualOmega3G[sex]}
        decimals={2}
        onChange={(v) => setFat({ omega3G: v })}
        min={0}
        max={5}
        step={0.05}
        unit="g"
      />
      <DefaultedNumber
        label="MCT"
        value={ft.mctG}
        def={0}
        onChange={(v) => setFat({ mctG: v })}
        min={0}
        max={100}
        step={5}
        unit="g"
      />

      <h4 className="sim-adv__h">Food</h4>
      <DefaultedNumber
        label="ultra-processed share of energy"
        value={pct(food.upfShare)}
        def={resolved.habits.upfShare * 100}
        onChange={(v) => setFood({ upfShare: frac(v) })}
        min={0}
        max={100}
        step={5}
        unit="%"
      />
      <div className="sim-row">
        <span className="sim-row__label">
          food quality and variety
          <span className="sim-row__def">
            {food.foodQuality === undefined ? 'default' : `default ${resolved.habits.foodQuality}`}
          </span>
        </span>
        <KeyBank
          size="sm"
          label="Food quality"
          options={[
            { value: '1', label: 'low' },
            { value: '2', label: 'typical' },
            { value: '3', label: 'high' },
          ]}
          value={String(food.foodQuality ?? resolved.habits.foodQuality)}
          onChange={(v) => setFood({ foodQuality: Number(v) as 1 | 2 | 3 })}
        />
      </div>
      <DefaultedNumber
        label="energy density (non-drinks)"
        value={toU(food.energyDensityKcalPerG, 1)}
        def={kJ ? 6.7 : 1.6}
        decimals={1}
        defNote="default: from processed share"
        onChange={(v) => setFood({ energyDensityKcalPerG: fromU(v) })}
        min={kJ ? 2 : 0.5}
        max={kJ ? 21 : 5}
        step={kJ ? 0.5 : 0.1}
        unit={kJ ? 'kJ/g' : 'kcal/g'}
      />
      <DefaultedNumber
        label="dietary cholesterol"
        value={food.cholesterolMg}
        def={300}
        defNote="default: your habitual intake"
        onChange={(v) => setFood({ cholesterolMg: v })}
        min={0}
        max={1500}
        step={25}
        unit="mg"
      />
      <DefaultedNumber
        label="DASH-pattern eating (vegetables, fruit, low-fat dairy)"
        value={food.dashFraction === undefined ? undefined : Math.round(food.dashFraction * 100)}
        def={0}
        defNote="default: from food quality"
        onChange={(v) => setFood({ dashFraction: v === undefined ? undefined : v / 100 })}
        min={0}
        max={100}
        step={10}
        unit="%"
      />
      <DefaultedNumber
        label={kJ ? 'energy from drinks' : 'liquid calories'}
        value={toU(food.liquidKcal)}
        def={0}
        onChange={(v) => setFood({ liquidKcal: fromU(v) })}
        min={0}
        max={kJ ? 8400 : 2000}
        step={kJ ? 100 : 25}
        unit={kJ ? 'kJ' : 'kcal'}
      />
      <DefaultedNumber
        label="whole nuts"
        value={food.nutsG}
        def={0}
        onChange={(v) => setFood({ nutsG: v })}
        min={0}
        max={200}
        step={5}
        unit="g"
      />
      {food.nutsG ? (
        <div className="sim-row">
          <span className="sim-row__label">nut form</span>
          <Select
            label="Nut form"
            value={food.nutForm ?? 'wholeRaw'}
            onChange={(v) => setFood({ nutForm: v })}
            options={[
              { value: 'wholeRaw', label: 'whole, raw' },
              { value: 'wholeRoasted', label: 'whole, roasted' },
              { value: 'chopped', label: 'chopped' },
              { value: 'butter', label: 'nut butter' },
            ]}
          />
        </div>
      ) : null}
      <div className="sim-row">
        <span className="sim-row__label">
          protein source
          <span className="sim-row__def">{m.proteinSource ? 'set' : 'default: from your diet'}</span>
        </span>
        <Select
          label="Protein source"
          value={
            m.proteinSource ??
            (resolved.habits.dietAnimalLevel === 'vegan'
              ? 'mixedVegan'
              : resolved.habits.dietAnimalLevel === 'vegetarian'
                ? 'mixedVegetarian'
                : 'mixedOmnivore')
          }
          onChange={(v) => setMacros({ proteinSource: v })}
          options={SOURCES}
        />
      </div>

      <h4 className="sim-adv__h">Fluids and electrolytes</h4>
      {zero ? (
        <Switch
          checked={hy.electrolytes ?? DEFAULTS.fastElectrolytes}
          onChange={(v) => setHy({ electrolytes: v })}
          label="Electrolytes during the fast (salt, potassium, magnesium)"
          labelStyle="sentence"
        />
      ) : null}
      <DefaultedNumber
        label="sodium"
        value={hy.sodiumG}
        def={resolved.habits.habitualSodiumG}
        decimals={1}
        onChange={(v) => setHy({ sodiumG: v })}
        min={0}
        max={8}
        step={0.1}
        unit="g"
      />
      <DefaultedNumber
        label="potassium"
        value={hy.potassiumG}
        def={DEFAULTS.potassiumG}
        decimals={1}
        onChange={(v) => setHy({ potassiumG: v })}
        min={0}
        max={8}
        step={0.1}
        unit="g"
      />
      <DefaultedNumber
        label="magnesium"
        value={hy.magnesiumMg}
        def={DEFAULTS.magnesiumMg}
        onChange={(v) => setHy({ magnesiumMg: v })}
        min={0}
        max={1000}
        step={25}
        unit="mg"
      />
      <DefaultedNumber
        label="fluid"
        value={hy.fluidL}
        def={2.5}
        decimals={1}
        defNote="default: drink to thirst"
        onChange={(v) => setHy({ fluidL: v })}
        min={0.5}
        max={6}
        step={0.25}
        unit="L"
      />
      <DefaultedNumber
        label="sweat rate while training"
        value={hy.sweatLPerH}
        def={0}
        decimals={1}
        onChange={(v) => setHy({ sweatLPerH: v })}
        min={0}
        max={3}
        step={0.1}
        unit="L/h"
      />

      <h4 className="sim-adv__h">Caffeine, alcohol, supplements</h4>
      <DoseList
        title="caffeine"
        empty={`default: ${DEFAULTS.caffeineMg} mg at ${String(DEFAULTS.caffeineClockH).padStart(2, '0')}:00 (your habit: ${formatNumber(resolved.habits.habitualCaffeineMg, 0)} mg)`}
        items={(sub.caffeine ?? []).map((c) => ({ clockH: c.clockH, amount: c.mg }))}
        unit="mg"
        step={25}
        max={600}
        addLabel="Add caffeine"
        onChange={(items) =>
          setSub({
            caffeine: items.length ? items.map((i) => ({ clockH: i.clockH, mg: i.amount })) : undefined,
          })
        }
        newItem={{ clockH: 8, amount: 100 }}
      />
      <DoseList
        title="alcohol"
        empty="none"
        items={(sub.alcohol ?? []).map((c) => ({ clockH: c.clockH, amount: c.drinks }))}
        unit="drinks"
        step={0.5}
        max={10}
        addLabel="Add drinks"
        onChange={(items) =>
          setSub({
            alcohol: items.length
              ? items.map((i) => ({ clockH: i.clockH, drinks: i.amount, withMeal: true }))
              : undefined,
          })
        }
        newItem={{ clockH: 19.5, amount: 1 }}
        note="1 drink = 14 g alcohol"
      />
      <DefaultedNumber
        label="creatine"
        value={sub.creatineG}
        def={0}
        onChange={(v) => setSub({ creatineG: v })}
        min={0}
        max={30}
        step={1}
        unit="g"
      />
      {sub.creatineG ? (
        <Switch
          checked={sub.creatineLoading ?? false}
          onChange={(v) => setSub({ creatineLoading: v })}
          label="Loading phase (about 0.3 g/kg a day, up to a week)"
          labelStyle="sentence"
        />
      ) : null}
      <DoseList
        title="exogenous ketones"
        empty="none"
        items={(sub.exogenousKetones ?? []).map((c) => ({ clockH: c.clockH, amount: c.gBhb }))}
        unit="g BHB"
        step={2.5}
        max={50}
        addLabel="Add ketones"
        onChange={(items) =>
          setSub({
            exogenousKetones: items.length
              ? items.map((i, k) => ({
                  clockH: i.clockH,
                  gBhb: i.amount,
                  form: sub.exogenousKetones?.[k]?.form ?? 'ester',
                }))
              : undefined,
          })
        }
        newItem={{ clockH: 9, amount: 10 }}
      />

      <h4 className="sim-adv__h">Modifiers</h4>
      <div className="sim-row">
        <span className="sim-row__label">
          stress
          <span className="sim-row__def">
            {mo.stress ? `default ${resolved.habits.stress}` : 'default: your usual'}
          </span>
        </span>
        <KeyBank
          size="sm"
          label="Stress"
          options={[
            { value: 'low', label: 'low' },
            { value: 'moderate', label: 'moderate' },
            { value: 'high', label: 'high' },
          ]}
          value={mo.stress ?? resolved.habits.stress}
          onChange={(v) => setMo({ stress: v })}
        />
      </div>
      <Switch
        checked={mo.illness ?? false}
        onChange={(v) => setMo({ illness: v })}
        label="Ill (pauses training effects)"
        labelStyle="sentence"
      />
      <Switch
        checked={mo.travelJetLag ?? false}
        onChange={(v) => setMo({ travelJetLag: v })}
        label="Travel or jet lag"
        labelStyle="sentence"
      />
      <Switch
        checked={mo.hotClimate ?? false}
        onChange={(v) => setMo({ hotClimate: v })}
        label="Hot climate"
        labelStyle="sentence"
      />
      <DefaultedNumber
        label="sauna sessions a week (on these days)"
        value={mo.saunaSessionsPerWeek}
        def={0}
        onChange={(v) => setMo({ saunaSessionsPerWeek: v })}
        min={0}
        max={14}
        step={1}
      />
    </div>
  );
}

interface Dose {
  clockH: number;
  amount: number;
}

function DoseList({
  title,
  empty,
  items,
  unit,
  step,
  max,
  addLabel,
  onChange,
  newItem,
  note,
}: {
  title: string;
  empty: string;
  items: Dose[];
  unit: string;
  step: number;
  max: number;
  addLabel: string;
  onChange: (items: Dose[]) => void;
  newItem: Dose;
  note?: string;
}) {
  return (
    <div className="sim-doses">
      <div className="sim-doses__head">
        <span className="sim-row__label">
          {title}
          <span className="sim-row__def">{items.length === 0 ? empty : (note ?? '')}</span>
        </span>
        <Key
          size="sm"
          variant="quiet"
          icon={Plus}
          onClick={() => onChange([...items, newItem])}
          disabled={items.length >= 6}
        >
          {addLabel}
        </Key>
      </div>
      {items.map((it, i) => (
        <div key={i} className="sim-dose">
          <TimeField
            label="time"
            value={it.clockH}
            onChange={(h) => onChange(items.map((x, k) => (k === i ? { ...x, clockH: h } : x)))}
          />
          <div className="sim-field">
            <span className="lm-eng">amount</span>
            <Stepper
              name={`${title} amount`}
              value={it.amount}
              onChange={(v) => onChange(items.map((x, k) => (k === i ? { ...x, amount: v } : x)))}
              min={step}
              max={max}
              step={step}
              unit={unit}
            />
          </div>
          <IconKey
            size="sm"
            variant="quiet"
            icon={X}
            label={`Remove ${title}`}
            onClick={() => onChange(items.filter((_, k) => k !== i))}
          />
        </div>
      ))}
    </div>
  );
}
