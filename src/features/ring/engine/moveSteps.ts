/**
 * (r070) "Finish moving from Gauge": which step the person is on, from the engine's state alone (no UI here).
 *
 *   1  Gauge still installed: wait until it has sent what it holds (pending uploads 0), then uninstall it.
 *   2  Gauge gone, the engine still passive or `needsTakeover`: take over the ring.
 *   3  The engine is active: give it what it needs from the phone (six one-tap rows).
 *
 * The card shows while the engine is `passive` or `needsTakeover`, and after the take-over for as long as something it
 * needs is missing; it is gone when everything is done. The short-video accessibility row is optional (it does not keep
 * the card up) until the short-video limit is on.
 */
import {
  permissionOk,
  permissionsMissing,
  PERMISSION_KEYS,
  type EngineState,
  type PermissionKey,
} from '@/platform/gaugeEngine';

export type MoveStepId = 'uninstall' | 'takeOver' | 'permissions';

export interface MovePlan {
  show: boolean;
  /** The step to act on now; null when the card is not shown. */
  step: MoveStepId | null;
  steps: ReadonlyArray<{ id: MoveStepId; state: 'done' | 'current' | 'todo' }>;
  /** Step 1: how many readings Gauge still holds (null: it has not said), and whether uninstalling is safe now. */
  uninstall: { waiting: number | null; ready: boolean };
  /** Step 3: every row, with whether it is done and whether the card waits for it. */
  items: ReadonlyArray<{ key: PermissionKey; ok: boolean; optional: boolean }>;
  /** The card's title: moving until the take-over, setting up after it. */
  moving: boolean;
}

const HIDDEN: MovePlan = {
  show: false,
  step: null,
  steps: [],
  uninstall: { waiting: null, ready: false },
  items: [],
  moving: false,
};

export function movePlan(state: EngineState | null | undefined, available = true): MovePlan {
  if (!available || !state) return HIDDEN;
  const missing = permissionsMissing(state);
  const moving = state.mode !== 'active';
  if (!moving && missing.length === 0) return HIDDEN;
  const waiting = state.gauge.pendingUploads;
  const step: MoveStepId = moving ? (state.gauge.installed ? 'uninstall' : 'takeOver') : 'permissions';
  const order: MoveStepId[] = ['uninstall', 'takeOver', 'permissions'];
  const at = order.indexOf(step);
  return {
    show: true,
    step,
    steps: order.map((id, i) => ({ id, state: i < at ? 'done' : i === at ? 'current' : 'todo' })),
    uninstall: { waiting, ready: waiting === 0 },
    items: PERMISSION_KEYS.map((key) => ({
      key,
      ok: permissionOk(state, key),
      optional: key === 'shortVideoAccessibility' && !state.shortVideo.enabled,
    })),
    moving,
  };
}
