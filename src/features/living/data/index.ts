/**
 * Living data wiring. Screens read through `useLiving` / `useLivingActions`; tests mount their own
 * `LivingDataProvider` / `LivingActionsProvider` with `createStubLiving({ clock, plan })`.
 *
 * The app installs the document-backed source (`./documents`) with the command-backed actions (`./commands`) — see
 * `../boot.ts`; routes mounted on the in-memory plan (tests, demos) get the in-memory stand-in for both sides. Those two
 * modules are not re-exported here: they load the command bus, which plain screen tests do not need.
 */
import { systemClock } from '../clock';
import { setDefaultLivingActions, type LivingActions } from './actions';
import { setDefaultLivingSource, type LivingDataSource } from './source';
import { createStubLiving, type StubLiving } from './stub';

let instance: StubLiving | null = null;

/** Install (once) and return the app-wide stand-in (source + actions). */
export function installDefaultLiving(): StubLiving {
  if (!instance) {
    instance = createStubLiving({ clock: systemClock });
    setDefaultLivingSource(instance.source);
    setDefaultLivingActions(instance.actions);
  }
  return instance;
}

/** Install a source and its actions (the document-backed pair, `../boot.ts`). */
export function installLiving(source: LivingDataSource, actions: LivingActions): void {
  setDefaultLivingSource(source);
  setDefaultLivingActions(actions);
}

export * from './source';
export * from './actions';
export * from './types';
export { createStubLiving, fixedPlanControl, storePlanControl, type StubLiving, type PlanControl } from './stub';
export * from './fixtures';
