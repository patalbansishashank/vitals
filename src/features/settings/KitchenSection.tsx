/**
 * Settings › Kitchen (design/COMPONENTS.md §14.5): the region once, then equipment, cuisines and staples as one row each
 * (closed by default; a row opens its catalogue picker in place), bound to `kitchen.get`. Changes save on their own
 * (debounced) through `kitchen.set` with an Undo toast; there is no Save footer. What is in the kitchen now is day-to-day
 * food state: with a live plan it is edited in Food › Pantry; before there is a plan, its picker opens here.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { Icon, Select } from '@/components';
import type { KitchenKind } from '@/catalogues/kitchen';
import { CataloguePicker } from '@/features/components/Picker';
import { shortRegion } from '@/features/components/PickerModel';
import type { PickerValue } from '@/features/components/PickerTypes';
import { pickerFromKitchen, pickerFromPantry } from '@/features/components/pickerValue';
import {
  pantryGroupsHiddenFor,
  saveKitchenList,
  savePantry,
  saveRegions,
  useAutosave,
  useKitchenCatalogue,
  useKitchenRegions,
  useKitchenView,
  usePantryView,
  type KitchenView,
} from '@/features/food/pantryData';
import { useFoodProfile } from '@/features/living/food/profile';
import { useAppMode } from '@/features/living/mode';
import { SettingsSection } from './sections';
import { SettingRow, SettingsDisclosure, SettingsGroup, SettingsItem, useSavedFlash } from './SettingRow';

type ListKind = Exclude<KitchenKind, 'pantry'>;

export const KITCHEN_COPY = {
  region: 'Region',
  regionPlaceholder: 'Choose a region',
  none: 'None',
  items: (n: number) => (n === 1 ? '1 item' : `${n} items`),
  more: (n: number) => `+${n}`,
  cuisinesOrder: 'The first is the one you eat most often.',
  pantry: 'Pantry',
  loading: 'Loading…',
} as const;
const C = KITCHEN_COPY;

const LISTS: ReadonlyArray<{ kind: ListKind; title: string; label: string }> = [
  { kind: 'equipment', title: 'Equipment', label: 'Cooking equipment' },
  { kind: 'cuisines', title: 'Cuisines', label: 'Cuisines you cook or eat' },
  { kind: 'staples', title: 'Staples', label: 'Staples you keep and cook with' },
];

/** "None", "5 items", or the first two cuisines in order ("South Indian, Gujarati +1"). */
function summary(view: KitchenView, kind: ListKind): string {
  if (kind === 'cuisines') {
    const names = [...view.cuisines].sort((a, b) => a.rank - b.rank).map((c) => c.label);
    if (!names.length) return C.none;
    return names.length > 2
      ? `${names.slice(0, 2).join(', ')} ${C.more(names.length - 2)}`
      : names.join(', ');
  }
  const n = view[kind].length;
  return n ? C.items(n) : C.none;
}

function KitchenList({
  kind,
  label,
  view,
  regions,
  onSaved,
}: {
  kind: ListKind;
  label: string;
  view: KitchenView;
  regions: string[];
  onSaved: () => void;
}) {
  const fromView = useMemo(() => pickerFromKitchen(view, kind), [view, kind]);
  const { value, onChange } = useAutosave(fromView, async (v: PickerValue) => {
    const ok = await saveKitchenList(kind, v);
    if (ok) onSaved();
    return ok;
  });
  // the region is chosen once, above the lists: each picker only offers its region's usual items
  return (
    <CataloguePicker
      kind={kind}
      label={label}
      value={value}
      onChange={onChange}
      regions={regions}
      openFirstTicked={false}
    />
  );
}

function PantryList({ regions, onSaved }: { regions: string[]; onSaved: () => void }) {
  const pantry = usePantryView();
  // the same diet filter as Food › Pantry: a vegetarian sees no meat or fish groups (unless something in them is picked)
  const { dietKind } = useFoodProfile();
  const hiddenGroups = useMemo(() => pantryGroupsHiddenFor(dietKind), [dietKind]);
  const fromView = useMemo(() => (pantry.view ? pickerFromPantry(pantry.view) : null), [pantry.view]);
  const { value, onChange } = useAutosave(fromView, async (v: PickerValue) => {
    const ok = await savePantry(v);
    if (ok) onSaved();
    return ok;
  });
  if (!pantry.view) return <p className="settings-note">{pantry.error ?? C.loading}</p>;
  return (
    <CataloguePicker
      kind="pantry"
      label="What’s in your kitchen now"
      value={value}
      onChange={onChange}
      regions={regions}
      hiddenGroups={hiddenGroups}
      openFirstTicked={false}
    />
  );
}

function RegionRow({ regions, onSaved }: { regions: string[]; onSaved: () => void }) {
  const { catalogue } = useKitchenCatalogue();
  const options = useMemo(
    () =>
      catalogue ? catalogue.cat.regions().map((r) => ({ value: r.id, label: shortRegion(r.label) })) : [],
    [catalogue],
  );
  return (
    <SettingRow
      label={C.region}
      wide
      info={{
        title: 'Region',
        body: 'Your region only decides which items each list pre-ticks and offers first. You can clear the defaults or use another region; nothing is removed unless you remove it.',
      }}
    >
      {() => (
        <Select
          size="sm"
          label={C.region}
          placeholder={C.regionPlaceholder}
          value={regions[0]}
          options={options}
          disabled={!options.length}
          onChange={(rid) => {
            void saveRegions([rid]).then((ok) => ok && onSaved());
          }}
        />
      )}
    </SettingRow>
  );
}

export function KitchenSection() {
  const [saved, flash] = useSavedFlash();
  const kitchen = useKitchenView();
  const { catalogue } = useKitchenCatalogue();
  const regions = useKitchenRegions(kitchen.view, catalogue);
  const { plan } = useAppMode();
  const [open, setOpen] = useState<KitchenKind | null>(null);
  // the pantry's count, like the lists above it (r068 V9)
  const pantry = usePantryView().view;
  const pantryValue = pantry ? (pantry.items.length ? C.items(pantry.items.length) : C.none) : undefined;
  const toggle = (kind: KitchenKind) => setOpen((o) => (o === kind ? null : kind));
  return (
    <SettingsSection id="kitchen" title="Kitchen" saved={saved}>
      <SettingsGroup>
        <RegionRow regions={regions} onSaved={flash} />
        {kitchen.view ? (
          LISTS.map((l) => (
            <SettingsDisclosure
              key={l.kind}
              title={l.title}
              value={summary(kitchen.view!, l.kind)}
              open={open === l.kind}
              onToggle={() => toggle(l.kind)}
            >
              {l.kind === 'cuisines' ? <p className="settings-note mb-3">{C.cuisinesOrder}</p> : null}
              <KitchenList
                kind={l.kind}
                label={l.label}
                view={kitchen.view!}
                regions={regions}
                onSaved={flash}
              />
            </SettingsDisclosure>
          ))
        ) : (
          <SettingsItem>
            <p className="settings-note">{kitchen.error ?? C.loading}</p>
          </SettingsItem>
        )}
        {plan ? (
          <Link className="settings-row" to="/food/pantry">
            <span className="settings-row__title">{C.pantry}</span>
            {pantryValue ? <span className="settings-row__value">{pantryValue}</span> : null}
            <Icon icon={ChevronRight} size={18} className="settings-row__chev" />
          </Link>
        ) : (
          <SettingsDisclosure
            title={C.pantry}
            value={pantryValue}
            open={open === 'pantry'}
            onToggle={() => toggle('pantry')}
          >
            <PantryList regions={regions} onSaved={flash} />
          </SettingsDisclosure>
        )}
      </SettingsGroup>
    </SettingsSection>
  );
}
