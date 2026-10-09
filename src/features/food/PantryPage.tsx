/**
 * /food/pantry: what is in the kitchen now, as a full page with the picker (design/COMPONENTS.md §14.5; no sheet).
 * Optional, autosaved with an Undo toast. Perishables not confirmed for two weeks get a quiet "Still have these?"
 * line with a key that confirms them; nothing is ever removed automatically.
 */
import { useMemo } from 'react';
import { Faceplate, Key, Page } from '@/components';
import { TopBar } from '@/app/shell';
import { CataloguePicker } from '@/features/components/Picker';
import { pickerFromPantry } from '@/features/components/pickerValue';
import { quickAddPantry, savePantry, useAutosave, useKitchenCatalogue, useKitchenRegions, useKitchenView, usePantryView } from './pantryData';

export const PANTRY_TITLE = 'What’s in your kitchen now';

export default function PantryPage() {
  const pantry = usePantryView();
  const kitchen = useKitchenView();
  const { catalogue } = useKitchenCatalogue();
  const regions = useKitchenRegions(kitchen.view, catalogue);
  const fromView = useMemo(() => (pantry.view ? pickerFromPantry(pantry.view) : null), [pantry.view]);
  const { value, onChange } = useAutosave(fromView, savePantry);
  const stale = useMemo(() => {
    const ask = new Set(pantry.view?.askStillHave ?? []);
    return (pantry.view?.items ?? []).filter((p) => ask.has(p.id));
  }, [pantry.view]);

  return (
    <>
      <TopBar title={PANTRY_TITLE} back={{ to: '/food', label: 'Food' }} />
      <Page>
        <div className="grid gap-4">
          {stale.length ? (
            <Faceplate as="div" variant="inset" aria-label="Still have these?">
              <p className="m-0 text-sm text-ink-2">
                Still have these? {stale.map((p) => p.label).join(', ')}. The Coach may ask before planning a meal around them; nothing is taken off your list.
              </p>
              <div className="mt-2">
                <Key size="sm" onClick={() => void quickAddPantry(stale, 'Thanks. Kept on your list.')}>
                  Yes, still have them
                </Key>
              </div>
            </Faceplate>
          ) : null}
          <Faceplate>
            <p className="mb-3 mt-0 text-sm leading-[1.5] text-ink-2">Recipes can start from what you already have. Changes save as you go.</p>
            {pantry.loading && !pantry.view ? (
              <p className="m-0 text-sm text-ink-2">Loading…</p>
            ) : pantry.error && !pantry.view ? (
              <p className="m-0 text-sm text-ink-2">{pantry.error}</p>
            ) : (
              <CataloguePicker kind="pantry" label="What’s in your kitchen now" value={value} onChange={onChange} regions={regions} optional paste />
            )}
          </Faceplate>
        </div>
      </Page>
    </>
  );
}
