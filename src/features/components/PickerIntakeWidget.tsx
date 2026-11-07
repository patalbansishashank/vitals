/**
 * The catalogue picker as an intake turn (widget ids `cataloguePicker:<kind>`, registered by
 * `features/intake/chapters/food-kitchen.ts` as `INTAKE_WIDGETS`). The first view starts from the region's pre-ticked
 * items (region: the cuisines answered just before, else the locale). The turn has no key of its own: it registers its
 * commit with the card (`CommitKey`), so the step's one forward key — Next, or Save when changing — saves the current
 * list to the kitchen or pantry document and commits the same list as the turn's answer. Any list may be empty: an
 * empty pantry (nothing ticked, or "Clear defaults" first) is answered "skipped, by choice", never asked again; the
 * card's own Skip still means "ask later".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Key, toast } from '@/components';
import { dispatch } from '@/commands';
import { chooseRegions, type KitchenKind } from '@/catalogues/kitchen';
import { loadKitchen, type LoadedKitchen } from '@/content/catalogues/kitchenCatalogue';
import { CommitKey } from '@/features/intake/components/CommitKey';
import { pickerToKitchenInput, pickerToPantryInput } from './pickerValue';
import { CataloguePicker } from './Picker';
import { PICKER_COPY as C } from './PickerCopy';
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

const isEntryList = (v: unknown): v is PickerEntry[] =>
  Array.isArray(v) &&
  v.every((e) => !!e && typeof e === 'object' && typeof (e as PickerEntry).id === 'string');

/** Writes the whole list (`kitchen.set` replaces the kind's list, `pantry.add` the pantry); false when it did not save. */
async function save(kind: KitchenKind, value: PickerValue): Promise<boolean> {
  try {
    const res =
      kind === 'pantry'
        ? await dispatch('pantry.add', pickerToPantryInput(value))
        : await dispatch('kitchen.set', pickerToKitchenInput(kind, value));
    return res.ok;
  } catch {
    return false;
  }
}

export function PickerIntakeWidget({ q, value, values, ctx, onCommit }: PickerWidgetProps) {
  const kind = q.widget.split(':')[1] as KitchenKind;
  const [loaded, setLoaded] = useState<LoadedKitchen | null>(null);
  const [draft, setDraft] = useState<PickerValue | null>(null);
  const [regions, setRegions] = useState<string[] | null>(null);
  const cuisineIds = useMemo(
    () => (isEntryList(values['food.cuisines']) ? values['food.cuisines'].map((e) => e.id) : []),
    [values],
  );
  // one save at a time: a second Next (or Enter) while the list is being written does not commit twice
  const saving = useRef(false);
  // the catalogue did not load (an offline chunk): the turn says so and Try again loads it again
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadKitchen().then(
      (k) => {
        if (!live) return;
        const r = chooseRegions(k.cat, { cuisines: cuisineIds, india: ctx.india });
        setLoaded(k);
        setRegions(r);
        setDraft(isEntryList(value) ? value : withRegionDefaults(k.cat, kind, r, []));
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [kind, ctx.india, cuisineIds, value, attempt]);

  const commit = async (v: PickerValue) => {
    if (saving.current) return;
    saving.current = true;
    try {
      const clean = v.map(({ assumed: _a, name: _n, ...e }) => e);
      // a failed write keeps the turn open with the list as it is; Next tries again
      if (!(await save(kind, clean))) {
        toast(C.saveError);
        return;
      }
      // the answer carries each catalogue item's name for the answered list (Q3-J1-08); the documents never see it
      onCommit(
        clean.map((e) => {
          const name = e.label ? undefined : loaded?.cat.get(e.id)?.label;
          return name ? { ...e, name } : e;
        }),
      );
    } finally {
      saving.current = false;
    }
  };

  const ready = loaded !== null && draft !== null && regions !== null;
  return (
    <>
      {ready ? (
        <CataloguePicker
          kind={kind}
          value={draft}
          onChange={setDraft}
          regions={regions}
          onRegionsChange={(r) => {
            setRegions(r);
            setDraft(withRegionDefaults(loaded.cat, kind, r, draft));
          }}
          label={q.prompt}
        />
      ) : failed ? (
        <section className="lm-pk" aria-label={q.prompt}>
          <div className="lm-pk__error" role="alert">
            <p>{C.loadError}</p>
            <Key
              size="sm"
              onClick={() => {
                setFailed(false);
                setAttempt((a) => a + 1);
              }}
            >
              {C.retry}
            </Key>
          </div>
        </section>
      ) : (
        <CataloguePicker kind={kind} value={[]} onChange={() => undefined} label={q.prompt} />
      )}
      {/* inside a QuestionCard this renders nothing: the card's Next runs it (until the list is in, Next names the wait) */}
      <CommitKey
        onClick={() => (draft ? void commit(draft) : undefined)}
        disabledReason={ready ? undefined : failed ? C.loadError : C.loading}
      >
        {C.done}
      </CommitKey>
    </>
  );
}
