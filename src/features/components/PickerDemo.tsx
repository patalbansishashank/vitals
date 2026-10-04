/** Dev page for the catalogue picker (`/dev/picker`): all four lists with local state and Kerala defaults. */
import { useEffect, useState } from 'react';
import { Faceplate, KeyBank, Page } from '@/components';
import type { KitchenKind } from '@/catalogues/kitchen';
import { loadKitchen } from '@/content/catalogues/kitchenCatalogue';
import { CataloguePicker } from './Picker';
import { withRegionDefaults } from './PickerModel';
import type { PickerValue } from './PickerTypes';

const KINDS: ReadonlyArray<{ value: KitchenKind; label: string; title: string }> = [
  { value: 'equipment', label: 'equipment', title: 'Cooking equipment' },
  { value: 'cuisines', label: 'cuisines', title: 'Cuisines' },
  { value: 'staples', label: 'staples', title: 'Staples' },
  { value: 'pantry', label: 'pantry', title: 'In your kitchen now' },
];

type Values = Record<KitchenKind, PickerValue>;
const EMPTY: Values = { equipment: [], cuisines: [], staples: [], pantry: [] };

export function PickerDemoPage() {
  const [kind, setKind] = useState<KitchenKind>('equipment');
  const [regions, setRegions] = useState<string[]>(['IN-south-kerala']);
  const [values, setValues] = useState<Values | null>(null);

  useEffect(() => {
    let live = true;
    loadKitchen().then(
      ({ cat }) => {
        if (!live) return;
        const v = { ...EMPTY };
        for (const k of KINDS) v[k.value] = withRegionDefaults(cat, k.value, ['IN-south-kerala'], []);
        setValues(v);
      },
      () => live && setValues(EMPTY),
    );
    return () => {
      live = false;
    };
  }, []);

  const meta = KINDS.find((k) => k.value === kind)!;
  return (
    <Page>
      <Faceplate title={meta.title}>
        <div style={{ display: 'grid', gap: 16 }}>
          <KeyBank label="List" options={KINDS.map(({ value, label }) => ({ value, label }))} value={kind} onChange={setKind} />
          {values ? (
            <CataloguePicker
              key={kind}
              kind={kind}
              label={meta.title}
              value={values[kind]}
              onChange={(next) => setValues((v) => ({ ...(v ?? EMPTY), [kind]: next }))}
              regions={regions}
              onRegionsChange={setRegions}
              optional={kind === 'pantry'}
            />
          ) : null}
        </div>
      </Faceplate>
    </Page>
  );
}

export default PickerDemoPage;
