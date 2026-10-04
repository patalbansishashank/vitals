/**
 * The catalogue picker as an intake turn (widget ids `cataloguePicker:<kind>`, registered by
 * `features/intake/chapters/food-kitchen.ts` as `INTAKE_WIDGETS`). The first view starts from the region's pre-ticked
 * items (region: the cuisines answered just before, else the locale); Done saves the list to the kitchen or pantry
 * document and commits the same list as the turn's answer. Pantry: "Skip this list" commits an empty list, answered.
 */
import { useEffect, useMemo, useState } from 'react';
import { Key } from '@/components';
import { dispatch } from '@/commands';
import { chooseRegions, type KitchenKind } from '@/catalogues/kitchen';
import { loadKitchen, type LoadedKitchen } from '@/content/catalogues/kitchenCatalogue';
import { pickerToKitchenInput, pickerToPantryInput } from './pickerValue';
import { CataloguePicker } from './Picker';
import { withRegionDefaults } from './PickerModel';
import type { PickerEntry, PickerValue } from './PickerTypes';

/** Structural slice of the intake's widget props (`features/intake/components/widgetTypes.ts`). */
export interface PickerWidgetProps {
  q: { id: string; widget: string; prompt: string };
  value: unknown;
  values: Readonly<Record<string, unknown>>;
  ctx: { india: boolean };
  onCommit: (value: PickerValue) => void;
  labelledBy: string;
}

const isEntryList = (v: unknown): v is PickerEntry[] => Array.isArray(v) && v.every((e) => !!e && typeof e === 'object' && typeof (e as PickerEntry).id === 'string');

async function save(kind: KitchenKind, value: PickerValue): Promise<void> {
  if (kind === 'pantry') await dispatch('pantry.add', pickerToPantryInput(value));
  else await dispatch('kitchen.set', pickerToKitchenInput(kind, value));
}

export function PickerIntakeWidget({ q, value, values, ctx, onCommit, labelledBy }: PickerWidgetProps) {
  const kind = q.widget.split(':')[1] as KitchenKind;
  const [loaded, setLoaded] = useState<LoadedKitchen | null>(null);
  const [draft, setDraft] = useState<PickerValue | null>(null);
  const [regions, setRegions] = useState<string[] | null>(null);
  const cuisineIds = useMemo(() => (isEntryList(values['food.cuisines']) ? values['food.cuisines'].map((e) => e.id) : []), [values]);

  useEffect(() => {
    let live = true;
    void loadKitchen().then((k) => {
      if (!live) return;
      const r = chooseRegions(k.cat, { cuisines: cuisineIds, india: ctx.india });
      setLoaded(k);
      setRegions(r);
      setDraft(isEntryList(value) ? value : withRegionDefaults(k.cat, kind, r, []));
    });
    return () => {
      live = false;
    };
  }, [kind, ctx.india, cuisineIds, value]);

  const done = async (v: PickerValue) => {
    const clean = v.map(({ assumed: _a, name: _n, ...e }) => e);
    await save(kind, clean);
    // the answer carries each catalogue item's name for the answered list (Q3-J1-08); the documents never see it
    onCommit(
      clean.map((e) => {
        const name = e.label ? undefined : loaded?.cat.get(e.id)?.label;
        return name ? { ...e, name } : e;
      }),
    );
  };

  if (!loaded || !draft || !regions) return <CataloguePicker kind={kind} value={[]} onChange={() => undefined} label={q.prompt} />;
  return (
    <div aria-labelledby={labelledBy}>
      <CataloguePicker
        kind={kind}
        value={draft}
        onChange={setDraft}
        regions={regions}
        onRegionsChange={(r) => {
          setRegions(r);
          setDraft(withRegionDefaults(loaded.cat, kind, r, draft));
        }}
        optional={kind === 'pantry'}
        label={q.prompt}
      />
      <div className="lm-pk__intake-footer">
        {kind === 'pantry' ? (
          <Key variant="quiet" onClick={() => void done([])}>
            Skip this list
          </Key>
        ) : null}
        <Key variant="solid" onClick={() => void done(draft)}>
          {`Done (${draft.length})`}
        </Key>
      </div>
    </div>
  );
}
