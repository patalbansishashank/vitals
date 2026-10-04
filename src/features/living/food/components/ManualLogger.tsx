/**
 * "I ate something else": the manual logger (sheet on mobile, side panel on desktop). Search foods, pick household
 * units or grams, or describe the meal in words with optional energy and protein; recents ("same as yesterday's
 * lunch") log in one tap; "Tell the Coach instead" opens the Coach with this meal as context.
 *
 * Food values come from the catalogue's food table through its pure arithmetic (`mealTotals`); the screen never adds
 * nutrients itself. TODO(E8): search the bundled food table instead of the test fixture once it ships.
 */
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Engraved, Field, IconKey, Key, KeyBank, NumberField, ResponsivePanel, Section, TextInput, energyInText, formatNumber, fromEnergyUnit } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import { createFoodTable, mealTotals } from '@/catalogues';
import type { FoodRecord } from '@/catalogues/types';
import { FOOD_FIXTURE } from '@/content/catalogues';
import type { LogEntrySummary } from '@/living';
import type { ManualMealInput } from '../../data/actions';
import { kcal as fmtKcal } from '../../format';
import { FOOD_COPY } from '../copy';
import type { MealSlotTarget } from '../recipes';

const L = FOOD_COPY.logger;

/** The food table the logger searches (fixture until the bundled table lands). */
export const LOGGER_FOODS = createFoodTable(FOOD_FIXTURE, 'fixture');

interface Picked {
  food: FoodRecord;
  /** The name the person searched for ("dal"). */
  name: string;
  mode: 'portion' | 'grams';
  count: number;
  grams: number;
}

function displayName(f: FoodRecord, query: string): string {
  const q = query.trim().toLowerCase();
  const alias = q ? f.aliases.find((a) => a.toLowerCase().includes(q)) : undefined;
  return alias ?? f.name;
}

function unitLabel(f: FoodRecord): string | null {
  const p = f.portions[0];
  return p ? p.label.replace(/^1\s+/, '') : null;
}

function gramsOf(p: Picked): number {
  const portion = p.food.portions[0];
  return p.mode === 'portion' && portion ? p.count * portion.g : p.grams;
}

function componentOf(p: Picked): ManualMealInput['components'][number] {
  const g = gramsOf(p);
  const t = mealTotals([{ foodId: p.food.id, grams: g }], LOGGER_FOODS);
  const unit = unitLabel(p.food);
  const amount = p.mode === 'portion' && unit ? L.portion(formatNumber(p.count, p.count % 1 ? 1 : 0), unit) : `${formatNumber(g, 0)} g`;
  return { name: `${p.name} · ${amount}`, foodId: p.food.id, grams: g, energyKcal: t.energyKcal, proteinG: t.proteinG, carbG: t.netCarbG + t.fibreG, fatG: t.fatG };
}

export interface ManualLoggerProps {
  open: boolean;
  onClose(): void;
  /** The slot being logged; null = food outside the slots. */
  target: MealSlotTarget | null;
  /** Clock hour for food outside the slots. */
  clockH: number;
  /** Yesterday's meal entries in the same slot ("same as yesterday's lunch"). */
  sameSlotYesterday: readonly LogEntrySummary[];
  /** Yesterday's other meal entries (one-tap recents). */
  recents: readonly LogEntrySummary[];
  quiet: boolean;
  onLog(input: ManualMealInput): Promise<boolean>;
  /** "Tell the Coach instead", with what was typed (the description, else the search, else the picked foods). */
  onCoach(text: string): void;
}

function fromEntries(entries: readonly LogEntrySummary[]): ManualMealInput['components'] {
  return entries.map((e) => ({ name: e.label, ...(e.energyKcal && e.energyKcal.value > 0 ? { energyKcal: e.energyKcal.value } : {}) }));
}

export function ManualLogger({ open, onClose, target, clockH, sameSlotYesterday, recents, quiet, onLog, onCoach }: ManualLoggerProps) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [text, setText] = useState('');
  const [energy, setEnergy] = useState<number | null>(null);
  // typed energy is in the person's unit (Settings › Units › energy) and stored in kcal
  const eu = useEnergyUnit();
  const [protein, setProtein] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const results = useMemo(() => (query.trim() ? LOGGER_FOODS.search(query, 6) : []), [query]);
  const slotName = target?.name ?? null;
  const base = target ? { slot: target.slot, clockH: target.clockH } : { clockH };

  const components = picked.map(componentOf);
  const described = text.trim();
  const canLog = components.length > 0 || described.length > 0;
  const estimated = picked.some((p) => !p.food.verified);

  const submit = async (input: ManualMealInput) => {
    setBusy(true);
    try {
      const ok = await onLog(input);
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  };

  const logTyped = () => {
    if (!canLog) return;
    // A description alone is parsed by the app (components and amounts); typed numbers make it one component with them.
    const comps =
      components.length > 0
        ? components
        : energy !== null || protein !== null
          ? [{ name: described, ...(energy !== null ? { energyKcal: Math.round(fromEnergyUnit(energy, eu)) } : {}), ...(protein !== null ? { proteinG: protein } : {}) }]
          : [];
    void submit({ ...base, components: comps, ...(described ? { text: described } : {}) });
  };

  const add = (f: FoodRecord) => {
    setPicked((ps) => [...ps, { food: f, name: displayName(f, query), mode: f.portions.length ? 'portion' : 'grams', count: 1, grams: f.portions[0]?.g ?? 100 }]);
    setQuery('');
  };
  const update = (i: number, patch: Partial<Picked>) => setPicked((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  const footer = (
    <>
      <Key variant="solid" onClick={logTyped} disabledReason={canLog ? undefined : L.needSomething} loading={busy}>
        {L.log(slotName)}
      </Key>
      <Key variant="quiet" onClick={() => onCoach(described || query.trim() || picked.map((p) => p.name).join(', '))}>
        {L.coach}
      </Key>
    </>
  );

  return (
    <ResponsivePanel open={open} onClose={onClose} title={L.title(slotName)} footer={footer} defaultDetent="full">
      <div className="lv-food-logger">
        {sameSlotYesterday.length > 0 || recents.length > 0 ? (
          <Section label={L.recents}>
            <div className="lv-food-logger__recents">
              {target && sameSlotYesterday.length > 0 ? (
                <Key size="sm" onClick={() => void submit({ ...base, components: fromEntries(sameSlotYesterday) })}>
                  {L.sameAs(target.name)}
                </Key>
              ) : null}
              {recents.slice(0, 3).map((e) => (
                <Key key={e.id} size="sm" variant="quiet" onClick={() => void submit({ ...base, components: fromEntries([e]) })}>
                  {L.yesterday(e.label)}
                </Key>
              ))}
            </div>
          </Section>
        ) : null}

        <Field label={L.search} help={L.searchHelp}>
          <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
        </Field>
        {query.trim() ? (
          results.length > 0 ? (
            <ul className="lv-food-logger__results">
              {results.map((f) => (
                <li key={f.id}>
                  <Key size="sm" variant="quiet" block onClick={() => add(f)} aria-label={L.add(displayName(f, query))}>
                    {displayName(f, query)}
                    {displayName(f, query) !== f.name ? <span className="lv-food-note"> · {f.name}</span> : null}
                  </Key>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lv-food-note">{L.noResults}</p>
          )
        ) : null}

        {picked.length > 0 ? (
          <Section label={L.picked}>
            <ul className="lv-food-logger__picked">
              {picked.map((p, i) => {
                const unit = unitLabel(p.food);
                const c = components[i]!;
                return (
                  <li key={`${p.food.id}-${i}`} className="lv-food-logger__item">
                    <span className="lv-food-logger__name">{p.name}</span>
                    {unit ? (
                      <KeyBank
                        size="sm"
                        label={L.unit(p.name)}
                        value={p.mode}
                        onChange={(m) => update(i, { mode: m })}
                        options={[
                          { value: 'portion', label: unit },
                          { value: 'grams', label: L.grams },
                        ]}
                      />
                    ) : null}
                    {p.mode === 'portion' ? (
                      <NumberField name={L.howMany(p.name)} value={p.count} min={0.5} max={10} step={0.5} decimals={1} onChange={(v) => update(i, { count: v })} />
                    ) : (
                      <NumberField name={L.gramsOf(p.name)} value={p.grams} min={1} max={2000} step={5} decimals={0} unit="g" onChange={(v) => update(i, { grams: v })} />
                    )}
                    {quiet || c.energyKcal === undefined ? null : <span className="lv-food-logger__kcal lm-num">{energyInText(L.about(fmtKcal(c.energyKcal)), eu)}</span>}
                    <IconKey icon={X} size="sm" label={L.remove(p.name)} onClick={() => setPicked((ps) => ps.filter((_, k) => k !== i))} />
                  </li>
                );
              })}
            </ul>
            {estimated ? (
              <p className="lv-food-note">
                <Engraved className="lv-food-mark">{L.estimated}</Engraved> {L.estimatedNote}
              </p>
            ) : null}
          </Section>
        ) : null}

        <Field label={L.describe} help={L.describeHelp}>
          <TextInput value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </Field>
        {picked.length === 0 ? (
          <div className="lv-food-logger__numbers">
            <Field label={L.kcal}>
              <NumberField name="energy" value={energy} min={0} max={eu === 'kJ' ? 21000 : 5000} step={eu === 'kJ' ? 50 : 10} decimals={0} unit={eu} onChange={setEnergy} />
            </Field>
            <Field label={L.protein}>
              <NumberField name="protein" value={protein} min={0} max={300} step={1} decimals={0} unit="g" onChange={setProtein} />
            </Field>
          </div>
        ) : null}
      </div>
    </ResponsivePanel>
  );
}
