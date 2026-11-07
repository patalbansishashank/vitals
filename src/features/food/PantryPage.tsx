/**
 * /food/pantry: what is in the kitchen now, with an inventory count, shelf picture and the picker.
 * The title is in the header beside Back; the card’s (i) explains how names feed recipes and groceries. Autosaved with an
 * Undo toast. Perishables not confirmed for two weeks get a "Still have these?" line with a key that confirms them;
 * nothing is ever removed automatically. Groups the person's diet rules out (meat and fish for a vegetarian) are hidden
 * unless something in them is picked.
 */
import { useMemo } from 'react';
import { Package } from 'lucide-react';
import { CardHead, GradientCard, HeroNumber, Key, MonoMeta, Page, VisuallyHidden } from '@/components';
import { INFO } from '@/features/living/food/copy';
import { infoSpec } from '@/features/living/components/info';
import './pantry.css';
import { TopBar } from '@/app/shell';
import { CataloguePicker } from '@/features/components/Picker';
import { pickerFromPantry } from '@/features/components/pickerValue';
import { useFoodProfile } from '@/features/living/food/profile';
import {
  pantryGroupsHiddenFor,
  quickAddPantry,
  savePantry,
  useAutosave,
  useKitchenCatalogue,
  useKitchenRegions,
  useKitchenView,
  usePantryView,
} from './pantryData';

export const PANTRY_TITLE = 'Pantry';

export default function PantryPage() {
  const pantry = usePantryView();
  const kitchen = useKitchenView();
  const { dietKind } = useFoodProfile();
  const { catalogue } = useKitchenCatalogue();
  const regions = useKitchenRegions(kitchen.view, catalogue);
  const hiddenGroups = useMemo(() => pantryGroupsHiddenFor(dietKind), [dietKind]);
  const fromView = useMemo(() => (pantry.view ? pickerFromPantry(pantry.view) : null), [pantry.view]);
  const { value, onChange } = useAutosave(fromView, savePantry);
  const shelves = useMemo(() => {
    const picked = new Set(value.map((p) => p.id));
    const hidden = new Set(hiddenGroups);
    return (catalogue?.cat.groups('pantry') ?? [])
      .map((g) => ({ id: g.id, label: g.label, count: g.items.filter((item) => picked.has(item.id)).length }))
      .filter((g) => !hidden.has(g.id) || g.count > 0);
  }, [value, hiddenGroups, catalogue]);
  const stocked = shelves.filter((g) => g.count > 0).length;
  const stale = useMemo(() => {
    const ask = new Set(pantry.view?.askStillHave ?? []);
    return (pantry.view?.items ?? []).filter((p) => ask.has(p.id));
  }, [pantry.view]);

  return (
    <>
      <TopBar title={PANTRY_TITLE} back={{ to: '/food', label: 'Food' }} />
      <Page>
        <div className="lv-pantry-page">
          {stale.length ? (
            <GradientCard
              domain="food"
              glow="bl"
              size="slim"
              className="lv-pantry-stale"
              aria-label="Still have these?"
            >
              <div className="lv-pantry-stale__names">
                <MonoMeta>Still have these?</MonoMeta>
                <p>{stale.map((p) => p.label).join(', ')}</p>
              </div>
              <Key
                size="sm"
                variant="action"
                onClick={() => void quickAddPantry(stale, 'Kept on your list.')}
              >
                Yes, still have them
              </Key>
            </GradientCard>
          ) : null}
          <GradientCard
            domain="food"
            glow="bl"
            head={<CardHead icon={Package} title="At home" info={infoSpec(INFO.pantryPage)} />}
          >
            {pantry.loading && !pantry.view ? (
              <p className="m-0 text-sm text-ink-2">Loading…</p>
            ) : pantry.error && !pantry.view ? (
              <p className="m-0 text-sm text-ink-2">{pantry.error}</p>
            ) : (
              <div className="lv-pantry-inventory">
                <div className="lv-pantry-inventory__hero">
                  <HeroNumber
                    value={value.length}
                    size="num-l"
                    label={`${value.length} ${value.length === 1 ? 'item' : 'items'} at home`}
                  />
                  <MonoMeta>Items at home</MonoMeta>
                  {shelves.length ? (
                    <>
                      <ul className="lv-pantry-shelves" aria-label="Shelves stocked">
                        {shelves.map((g) => (
                          <li key={g.id} data-stocked={g.count > 0} title={g.label}>
                            <VisuallyHidden>{`${g.label}: ${g.count > 0 ? `${g.count} at home` : 'nothing listed'}`}</VisuallyHidden>
                          </li>
                        ))}
                      </ul>
                      <MonoMeta>{`${stocked} of ${shelves.length} shelves stocked`}</MonoMeta>
                    </>
                  ) : null}
                </div>
                <CataloguePicker
                  kind="pantry"
                  label={PANTRY_TITLE}
                  value={value}
                  onChange={onChange}
                  regions={regions}
                  hiddenGroups={hiddenGroups}
                  openFirstTicked={false}
                />
              </div>
            )}
          </GradientCard>
        </div>
      </Page>
    </>
  );
}
