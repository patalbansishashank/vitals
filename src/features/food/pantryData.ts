/**
 * Kitchen and pantry data for the screens (Food tab › Pantry, /food/pantry, Settings › Kitchen): the views come from
 * `kitchen.get` / `pantry.get` and are fetched again whenever a kitchen or pantry change is committed or undone; every
 * write goes through `kitchen.set` / `pantry.add` with an Undo toast. Nothing here reads or writes the store directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dispatch, on, type CommandResult, type InputOf, type OutputOf } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import { dismissToast, toast } from '@/components';
import { chooseRegions, type KitchenKind } from '@/catalogues/kitchen';
import { detectIndia } from '@/features/intake/context';
import { loadKitchen, kitchenNow, type LoadedKitchen } from '@/content/catalogues/kitchenCatalogue';
import type { PickerValue } from '@/features/components/PickerTypes';
import { pickerToKitchenInput, pickerToPantryInput } from '@/features/components/pickerValue';

export type KitchenView = OutputOf<'kitchen.get'>;
export type PantryView = OutputOf<'pantry.get'>;

export interface ViewState<V> {
  view: V | null;
  loading: boolean;
  error: string | null;
}

/** Past the bus's 300 ms coalescing idle commit. */
const AFTER_COALESCE_MS = 400;

const COULD_NOT_LOAD = 'Couldn’t load your kitchen. Try again.';

/** A command-backed view, refreshed when a commit of one of `prefixes` lands or any change is undone. */
function useCommandView<V>(read: () => Promise<CommandResult<V>>, prefixes: readonly string[]): ViewState<V> {
  const [state, setState] = useState<ViewState<V>>({ view: null, loading: true, error: null });
  const key = prefixes.join(',');
  useEffect(() => {
    let alive = true;
    let seq = 0;
    let again: ReturnType<typeof setTimeout> | undefined;
    const fetch = () => {
      const mine = ++seq;
      read()
        .then((r) => {
          if (!alive || mine !== seq) return;
          if (r.ok && 'output' in r) setState({ view: r.output, loading: false, error: null });
          else setState((s) => ({ view: s.view, loading: false, error: r.ok ? COULD_NOT_LOAD : r.error.message || COULD_NOT_LOAD }));
        })
        .catch(() => {
          if (alive && mine === seq) setState((s) => ({ view: s.view, loading: false, error: COULD_NOT_LOAD }));
        });
    };
    fetch();
    const wanted = key.split(',');
    const off = on((e) => {
      // reads are announced too (with no ChangeSet): only writes refresh, or the read would refresh itself forever
      if (e.type === 'undone' || (e.type === 'committed' && e.changeSet && wanted.some((p) => String(e.commandId).startsWith(p)))) {
        fetch();
        // a user's edits coalesce and reach the documents after a short idle window: read again once written
        clearTimeout(again);
        again = setTimeout(fetch, AFTER_COALESCE_MS);
      }
    });
    return () => {
      alive = false;
      clearTimeout(again);
      off();
    };
  }, [key, read]);
  return state;
}

const KITCHEN_PREFIXES = ['kitchen.'] as const;
const PANTRY_PREFIXES = ['pantry.'] as const;
const readKitchen = () => dispatch('kitchen.get', {});
const readPantry = () => dispatch('pantry.get', {});

export function useKitchenView(): ViewState<KitchenView> {
  return useCommandView(readKitchen, KITCHEN_PREFIXES);
}

export function usePantryView(): ViewState<PantryView> {
  return useCommandView(readPantry, PANTRY_PREFIXES);
}

/** The kitchen catalogue (loaded lazily, once per app). */
export function useKitchenCatalogue(): { catalogue: LoadedKitchen | null; error: boolean } {
  const [catalogue, setCatalogue] = useState<LoadedKitchen | null>(() => kitchenNow());
  const [error, setError] = useState(false);
  useEffect(() => {
    if (catalogue) return;
    let alive = true;
    loadKitchen().then(
      (c) => alive && setCatalogue(c),
      () => alive && setError(true),
    );
    return () => {
      alive = false;
    };
  }, [catalogue]);
  return { catalogue, error };
}

/* ------------------------------------------------------------------------------------------------ writes */

const LIST_NAME: Readonly<Record<KitchenKind, string>> = {
  equipment: 'Equipment',
  cuisines: 'Cuisines',
  staples: 'Staples',
  pantry: 'Pantry',
};

let lastToast: string | null = null;

/** Toast the outcome; a change offers Undo (its ChangeSet goes back through `history.undo`). */
function announce<O>(r: CommandResult<O>, message: string): boolean {
  if (lastToast) dismissToast(lastToast);
  if (!r.ok) {
    lastToast = toast(r.error.message || 'Couldn’t save. Try again.');
    return false;
  }
  const cs = 'changeSet' in r ? r.changeSet?.id : undefined;
  lastToast = toast(message, cs ? { action: { label: 'Undo', onClick: () => void sendCommand('history.undo', { changeSetId: cs }) } } : {});
  return true;
}

/** Replace one kitchen list (equipment, cuisines or staples) with the picker's value. */
export async function saveKitchenList(kind: Exclude<KitchenKind, 'pantry'>, value: PickerValue): Promise<boolean> {
  const r = await dispatch('kitchen.set', pickerToKitchenInput(kind, value) as InputOf<'kitchen.set'>);
  return announce(r, `${LIST_NAME[kind]} saved.`);
}

/** Use another region's defaults (the picker's "Use another region"). */
export async function saveRegions(regions: string[]): Promise<boolean> {
  const r = await dispatch('kitchen.set', { regions });
  return announce(r, 'Region saved.');
}

/** Replace the whole pantry with the picker's value. */
export async function savePantry(value: PickerValue): Promise<boolean> {
  const r = await dispatch('pantry.add', pickerToPantryInput(value));
  return announce(r, 'Pantry saved.');
}

/** Add items to the pantry (quick-add from the staples; adding an item already there confirms it). */
export async function quickAddPantry(items: ReadonlyArray<{ id: string; label: string }>, message?: string): Promise<boolean> {
  if (!items.length) return true;
  const r = await dispatch('pantry.add', { items: items.map((i) => ({ id: i.id, label: i.label })), source: 'picker' });
  return announce(r, message ?? (items.length === 1 ? `${items[0]!.label} added to your pantry.` : `${items.length} items added to your pantry.`));
}

/* ------------------------------------------------------------------------------------------------ autosave */

export const AUTOSAVE_MS = 600;

const sameIds = (a: PickerValue, b: PickerValue): boolean => a.length === b.length && a.every((e, i) => e.id === b[i]!.id);

/**
 * A picker bound to a view with a debounced autosave: edits show at once (a local draft), are saved `AUTOSAVE_MS`
 * after the last change, and the draft gives way to the view once the saved view arrives (or after an Undo).
 */
export function useAutosave(fromView: PickerValue | null, save: (value: PickerValue) => Promise<boolean>, delay = AUTOSAVE_MS): { value: PickerValue; onChange: (next: PickerValue) => void; saving: boolean } {
  const [draft, setDraft] = useState<PickerValue | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<PickerValue | null>(null);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  const settled = useRef(false);
  const savedValue = useRef<PickerValue | null>(null);

  const flush = useCallback(() => {
    timer.current = undefined;
    const v = latest.current;
    if (!v) return;
    latest.current = null;
    savedValue.current = v;
    setSaving(true);
    void saveRef.current(v).then((ok) => {
      setSaving(false);
      if (timer.current) return; // edited again meanwhile: keep the draft
      if (ok) settled.current = true;
      else setDraft(null);
    });
  }, []);

  // the saved view arrived (same items in the same order): show it
  useEffect(() => {
    const saved = savedValue.current;
    if (settled.current && !timer.current && saved && fromView && sameIds(saved, fromView)) {
      settled.current = false;
      setDraft(null);
    }
  }, [fromView]);

  // an Undo brings back the stored list
  useEffect(
    () =>
      on((e) => {
        if (e.type !== 'undone' || timer.current) return;
        settled.current = false;
        setDraft(null);
      }),
    [],
  );

  // leaving the screen saves what is pending
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = undefined;
        const v = latest.current;
        latest.current = null;
        if (v) void saveRef.current(v);
      }
    },
    [],
  );

  const onChange = useCallback(
    (next: PickerValue) => {
      setDraft(next);
      latest.current = next;
      settled.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [flush, delay],
  );

  return { value: draft ?? fromView ?? [], onChange, saving };
}

/** Regions whose defaults the pickers pre-tick: the person's choice, else the first cuisine's region, else the locale's. */
export function useKitchenRegions(view: KitchenView | null, catalogue: LoadedKitchen | null): string[] {
  const [india] = useState(detectIndia);
  return useMemo(
    () => (view && catalogue ? chooseRegions(catalogue.cat, { chosen: view.regions, cuisines: view.cuisines.map((c) => c.id), india }) : (view?.regions ?? [])),
    [view, catalogue, india],
  );
}
