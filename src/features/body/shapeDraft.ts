/**
 * Shape sliders: what moves while a thumb is down, and what waits for the release.
 *
 * A slider used to write the profile on every input event: command bus, change log, document store, then the whole
 * Body page re-rendered and the 3D figure re-morphed (about half a second of main-thread work each time). Now a drag
 * touches only three small things:
 *
 *   1. `live`   - the value under the thumb, set on every input event (O(1)); only the slider that moves re-renders,
 *                 so the thumb and its readout stay instant.
 *   2. `shown`  - what the figure draws. The live values are copied out at most once per animation frame,
 *                 paced by the measured render cost, with at most a 15 Hz pacing interval. New input never
 *                 resets the deadline, so even the first continuous drag makes progress. No store, no engine call
 *                 except the one estimate behind the drawing, no React render outside the figure.
 *   3. the profile write - once, on release (`'drag'`), or 150 ms after the last key step (`'step'`), so a held arrow
 *                 key is one write. The figure and the live value are dropped when the write has landed.
 *
 * The final value is always the one written: `live` is the last input, and a write in flight keeps its draft until it
 * resolves, so nothing snaps back in between.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { AvatarParams } from '@/engine/body';
import type { BodyProfileValues, ShapeKey } from '@/state/profileStore';
import { patchProfileAsync } from './commands';
import { deriveFigure, withFrame, type FigureView } from './figure';
import { summarizeBody } from './model';

type Draft = Partial<Record<ShapeKey, number>>;

/** Wait after the last key step (or wheel notch, typed entry, assistive increment) before the profile is written. */
export const STEP_COMMIT_MS = 150;
const FRAME_MS = 1000 / 60;
/** Bound cost-based pacing so continuous input cannot starve the figure. */
export const PREVIEW_MAX_INTERVAL_MS = 1000 / 15;
/** After a cheap figure update the next waits this many times what it cost the main thread. */
const COST_SPACING = 2;

let live: Draft = {};
let shown: Draft = {};
const keyListeners = new Map<ShapeKey, Set<() => void>>();
const shownListeners = new Set<() => void>();
const timers = new Map<ShapeKey, ReturnType<typeof setTimeout>>();
let frame = 0;
let dirty = false;
let lastAt = -Infinity;
/** Main-thread ms the last figure update took (render, morph, upload); assumed dear until one has been measured. */
let cost = 100;

/** What the figure updates have cost, for tests and the performance check; `setCost` seeds the pacing in tests. */
export const stats = {
  publishes: 0,
  get costMs() {
    return cost;
  },
  setCost(ms: number) {
    cost = ms;
  },
};

const without = (d: Draft, key: ShapeKey): Draft => {
  const { [key]: _gone, ...rest } = d;
  return rest;
};

function notifyKey(key: ShapeKey): void {
  keyListeners.get(key)?.forEach((l) => l());
}
function notifyShown(): void {
  shownListeners.forEach((l) => l());
}

/* ---------------------------------------------------------------------------------------------- the figure */

function publish(): void {
  frame = 0;
  if (!dirty) return;
  dirty = false;
  shown = { ...live };
  stats.publishes++;
  // Run the update (it ends in a figure re-render) and learn what it cost: two frames later the main thread shows it.
  const t0 = performance.now();
  lastAt = t0;
  notifyShown();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      cost = Math.max(0, performance.now() - t0 - 2 * FRAME_MS);
    }),
  );
}

function tick(): void {
  frame = 0;
  if (!dirty) return;
  if (performance.now() - lastAt < Math.min(PREVIEW_MAX_INTERVAL_MS, COST_SPACING * cost)) {
    frame = requestAnimationFrame(tick);
    return;
  }
  publish();
}

/** New input updates the pending value without postponing the next preview. */
function schedule(): void {
  if (!frame) frame = requestAnimationFrame(tick);
}

/* ---------------------------------------------------------------------------------------------- input */

/** Every input event of a slider: instant for that slider, coalesced for the figure. No write. */
export function dragShape(key: ShapeKey, x: number): void {
  if (live[key] === x) return;
  live = { ...live, [key]: x };
  notifyKey(key);
  dirty = true;
  schedule();
}

function release(key: ShapeKey, x: number): void {
  if (live[key] !== x) return; // a newer drag owns it now
  live = without(live, key);
  shown = without(shown, key);
  if (Object.keys(live).length === 0) {
    // a draft update still waiting would only draw the same thing twice
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    dirty = false;
  }
  notifyKey(key);
  notifyShown();
}

function write(key: ShapeKey, done?: () => void): void {
  const pending = timers.get(key);
  if (pending !== undefined) clearTimeout(pending);
  timers.delete(key);
  const x = live[key];
  if (x === undefined) {
    done?.();
    return;
  }
  void patchProfileAsync({ shape: { [key]: x } }).finally(() => {
    release(key, x);
    done?.();
  });
}

/**
 * The gesture ended. A pointer release writes now; a key step waits `STEP_COMMIT_MS` for the next one. `done` runs
 * after the write (the caller releases its screen-reader snapshot there).
 */
export function commitShape(
  key: ShapeKey,
  x: number,
  via: 'drag' | 'step' = 'step',
  done?: () => void,
): void {
  dragShape(key, x);
  const pending = timers.get(key);
  if (pending !== undefined) clearTimeout(pending);
  if (via === 'drag') write(key, done);
  else
    timers.set(
      key,
      setTimeout(() => write(key, done), STEP_COMMIT_MS),
    );
}

/** Write every waiting key step now (the card is going away, or the person pressed Next). */
export function flushShapeCommits(): void {
  for (const key of [...timers.keys()]) write(key);
}

/** Drop everything not yet written (Reset to estimate). */
export function resetShapeDraft(): void {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  dirty = false;
  lastAt = -Infinity; // the pacing clock restarts too (a clock from before is not comparable to the next one)
  const keys = Object.keys(live) as ShapeKey[];
  live = {};
  shown = {};
  keys.forEach(notifyKey);
  notifyShown();
}

/* ---------------------------------------------------------------------------------------------- hooks */

/** The value under the thumb of one slider while it is being moved or waiting to be written; else undefined. */
export function useLiveShape(key: ShapeKey): number | undefined {
  const subscribe = useCallback(
    (cb: () => void) => {
      let set = keyListeners.get(key);
      if (!set) keyListeners.set(key, (set = new Set()));
      set.add(cb);
      return () => void set.delete(cb);
    },
    [key],
  );
  return useSyncExternalStore(
    subscribe,
    () => live[key],
    () => undefined,
  );
}

function subscribeShown(cb: () => void): () => void {
  shownListeners.add(cb);
  return () => void shownListeners.delete(cb);
}

/** The drawing's params with the same content keep the same object, so an unchanged figure is not morphed twice. */
const canon: { json: string; params: AvatarParams }[] = [];
function canonical(params: AvatarParams): AvatarParams {
  const json = JSON.stringify(params);
  const hit = canon.find((c) => c.json === json);
  if (hit) return hit.params;
  canon.unshift({ json, params });
  canon.length = Math.min(canon.length, 4);
  return params;
}

/** True while the figure is drawing a slider's draft (a drag is on); false once the committed figure has taken over. */
export function useShapeDragging(): boolean {
  return useSyncExternalStore(
    subscribeShown,
    () => Object.keys(shown).length > 0,
    () => false,
  );
}

let cache: { v: BodyProfileValues; view: FigureView; draft: Draft; out: FigureView } | null = null;

/** The figure for these inputs and drafts; one `summarizeBody` + `deriveFigure`, shared by every caller of a frame. */
function drawnView(v: BodyProfileValues, view: FigureView, draft: Draft): FigureView {
  if (cache && cache.v === v && cache.view === view && cache.draft === draft) return cache.out;
  let out: FigureView = view;
  if (Object.keys(draft).length > 0) {
    const vd: BodyProfileValues = { ...v, shape: { ...v.shape, ...draft } };
    const d = deriveFigure(vd, summarizeBody(vd));
    out = { ...d, frame: view.frame, params: withFrame(d.params, view.frame) };
  }
  const params = canonical(out.params);
  if (params !== out.params) out = { ...out, params };
  cache = { v, view, draft, out };
  return out;
}

/**
 * The figure as it is drawn: the committed `view`, or while a slider is being moved the same figure with the drafted
 * slider values.
 */
export function useDraftView(v: BodyProfileValues, view: FigureView): FigureView {
  const draft = useSyncExternalStore(
    subscribeShown,
    () => shown,
    () => shown,
  );
  return useMemo(() => drawnView(v, view, draft), [v, view, draft]);
}
