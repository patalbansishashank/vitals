/**
 * Settings › Kitchen (design/COMPONENTS.md §14.5): equipment, cuisines, staples and what is in the kitchen now, each a
 * catalogue picker bound to `kitchen.get` / `pantry.get`. Changes save on their own (debounced) through `kitchen.set` /
 * `pantry.add` with an Undo toast; there is no Save footer.
 */
import { useMemo, type ReactNode } from 'react';
import { Section } from '@/components';
import type { KitchenKind } from '@/catalogues/kitchen';
import { CataloguePicker } from '@/features/components/Picker';
import type { PickerValue } from '@/features/components/PickerTypes';
import { pickerFromKitchen, pickerFromPantry } from '@/features/components/pickerValue';
import { saveKitchenList, savePantry, saveRegions, useAutosave, useKitchenCatalogue, useKitchenRegions, useKitchenView, usePantryView, type KitchenView } from '@/features/food/pantryData';
import { SettingsSection } from './sections';
import { useSavedFlash } from './SettingRow';

type ListKind = Exclude<KitchenKind, 'pantry'>;

const LISTS: ReadonlyArray<{ kind: ListKind; title: string; label: string; help: string }> = [
  { kind: 'equipment', title: 'Equipment', label: 'Cooking equipment', help: 'Recipes are planned around what you have.' },
  { kind: 'cuisines', title: 'Cuisines', label: 'Cuisines you cook or eat', help: 'Tap in order: the first is the one you eat most often.' },
  { kind: 'staples', title: 'Staples', label: 'Staples you keep and cook with', help: 'Recipes lean on these first.' },
];

function Block({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <Section label={title} className="mt-6 first:mt-0">
      <p className="mb-3 mt-0 text-xs leading-[1.45] text-ink-2">{help}</p>
      {children}
    </Section>
  );
}

function KitchenList({ kind, label, view, regions, onSaved }: { kind: ListKind; label: string; view: KitchenView | null; regions: string[]; onSaved: () => void }) {
  const fromView = useMemo(() => (view ? pickerFromKitchen(view, kind) : null), [view, kind]);
  const { value, onChange } = useAutosave(fromView, async (v: PickerValue) => {
    const ok = await saveKitchenList(kind, v);
    if (ok) onSaved();
    return ok;
  });
  return (
    <CataloguePicker
      kind={kind}
      label={label}
      value={value}
      onChange={onChange}
      regions={regions}
      onRegionsChange={(r) => {
        void saveRegions(r).then((ok) => ok && onSaved());
      }}
    />
  );
}

function PantryList({ regions, onSaved }: { regions: string[]; onSaved: () => void }) {
  const pantry = usePantryView();
  const fromView = useMemo(() => (pantry.view ? pickerFromPantry(pantry.view) : null), [pantry.view]);
  const { value, onChange } = useAutosave(fromView, async (v: PickerValue) => {
    const ok = await savePantry(v);
    if (ok) onSaved();
    return ok;
  });
  if (!pantry.view) return <p className="m-0 text-sm text-ink-2">{pantry.error ?? 'Loading…'}</p>;
  return <CataloguePicker kind="pantry" label="What’s in your kitchen now" value={value} onChange={onChange} regions={regions} optional paste />;
}

export function KitchenSection() {
  const [saved, flash] = useSavedFlash();
  const kitchen = useKitchenView();
  const { catalogue } = useKitchenCatalogue();
  const regions = useKitchenRegions(kitchen.view, catalogue);
  return (
    <SettingsSection id="kitchen" title="Kitchen" saved={saved}>
      {kitchen.view ? (
        LISTS.map((l) => (
          <Block key={l.kind} title={l.title} help={l.help}>
            <KitchenList kind={l.kind} label={l.label} view={kitchen.view} regions={regions} onSaved={flash} />
          </Block>
        ))
      ) : (
        <p className="m-0 text-sm text-ink-2">{kitchen.error ?? 'Loading…'}</p>
      )}
      <Block title="Pantry" help="What you have at home now. Optional; nothing is removed on its own.">
        <PantryList regions={regions} onSaved={flash} />
      </Block>
    </SettingsSection>
  );
}
