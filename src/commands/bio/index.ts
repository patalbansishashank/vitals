/**
 * `bio.*` executors (I1-B): replace the 13 stubs declared in `../defs/bio.ts` through `implement()` (`../implement.ts`).
 *
 * This module stays in the main chunk and is light: the executors live in `./exec.ts` (importers, score catalogue,
 * Bluetooth drivers) and load on first use. Policy filtering for callers that are not the person (agents: AI, WebMCP,
 * MCP) happens inside the read executors (`coachSees`): a stream the person has not shared with the Coach is left out
 * and named in `hidden`.
 *
 * Small changes (an entry by hand, a policy or priority change, a deleted source) schedule a debounced rescore
 * (`./runtime.ts` `scheduleRescore`); the runner installed here dispatches `bio.rescore` as the SYSTEM actor, so the
 * job shows on the bus like any other and the "updating scores…" chip follows `bioActivity`.
 */
import { implement } from '../implement';
import { dispatch } from '../bus';
import { SYSTEM_ACTOR, type CommandContext } from '../types';
import { installBioPorts, rescoreOnRemoteBio, scheduleRescore, setRescoreRunner } from './runtime';
import { getDocumentStore, onDocumentStoreSwitch } from '@/state/runtime';
import type { LocalDate } from '@/store';
import type * as ExecModule from './exec';
import type * as SharingModule from './sharing';
import type * as FoldModule from './fold';

const BY = 'I1 (biometrics)';

type Exec = typeof ExecModule;
let execP: Promise<Exec> | null = null;
/** The heavy executors, loaded once. */
const exec = (): Promise<Exec> => (execP ??= import('./exec'));

installBioPorts();

setRescoreRunner(async (from: LocalDate | null) => {
  const r = await dispatch('bio.rescore', from ? { from } : {}, { actor: SYSTEM_ACTOR });
  if (!r.ok) console.warn('Vitals: background rescoring did not start', r.error);
});

// records and corrections that arrive by sync are scored on this device too (scores are never synced)
let remoteOff = rescoreOnRemoteBio(getDocumentStore());
onDocumentStoreSwitch((s) => {
  remoteOff();
  remoteOff = rescoreOnRemoteBio(s);
  scheduleRescore(null, 5000);
});
// Catch up at start: data that arrived while this page was closed (or whose sample bytes could not be fetched last time)
// has records but no scores; a null `from` fills only what is missing, so an up-to-date device does no work (Q9-5).
scheduleRescore(null, 5000);

type In<T> = (ctx: CommandContext, input: T) => unknown;
const lazy =
  <T>(pick: (m: Exec) => In<T>): In<T> =>
  async (ctx, input) =>
    pick(await exec())(ctx, input);

implement('bio.daily', lazy((m) => m.daily), BY);
implement('bio.series', lazy((m) => m.series), BY);
implement('bio.baselines', lazy((m) => (ctx) => m.baselines(ctx)), BY);
implement('bio.sources', lazy((m) => () => m.sources()), BY);
implement('bio.scores', lazy((m) => m.scores), BY);
implement('bio.manual', lazy((m) => m.manual), BY);

implement('bio.setPolicy', lazy((m) => m.setPolicy), BY);
implement('bio.deleteSource', lazy((m) => m.deleteSource), BY);
implement('bio.rescore', lazy((m) => m.rescore), BY);
implement('bio.import', lazy((m) => m.importFile), BY);
implement('bio.deviceConnect', lazy((m) => m.deviceConnect), BY);
implement('bio.deviceSync', lazy((m) => m.deviceSync), BY);

// ring data on by default (plan 04 item 11): the master switch, its notice and the one-time migration (./sharing.ts)
let sharingP: Promise<typeof SharingModule> | null = null;
const sharing = () => (sharingP ??= import('./sharing'));
implement('bio.setRingSharing', async (ctx: CommandContext, input: { on: boolean }) => (await sharing()).setRingSharing(ctx, input), BY);
implement('bio.dismissRingDefaultsNotice', async (ctx: CommandContext) => (await sharing()).dismissRingDefaultsNotice(ctx), BY);
implement('biometrics.ringDefaults', async (ctx: CommandContext) => (await sharing()).ringDefaultsMigration(ctx), BY);

// one ring = one source (SUITE_SPEC §15.2): sources keyed from an advertised name or an old Lumen key fold into the
// ring's one source, and Lumen data into the person's one J-Style 2301 ring (./fold.ts)
let foldP: Promise<typeof FoldModule> | null = null;
const fold = () => (foldP ??= import('./fold'));
implement('biometrics.ringFold', async (ctx: CommandContext) => (await fold()).ringFoldMigration(ctx), BY);

let ringDefaultsStarted = false;
/** Run `biometrics.ringDefaults` once per page load as the SYSTEM actor; it records itself, so later loads do nothing.
 * `biometrics.ringFold` follows it (idempotent: it acts only on a source that is not where it belongs). */
export async function runRingDefaultsMigration(): Promise<void> {
  if (ringDefaultsStarted) return;
  ringDefaultsStarted = true;
  const r = await dispatch('biometrics.ringDefaults', {}, { actor: SYSTEM_ACTOR });
  if (!r.ok) console.warn('Vitals: moving ring data to the ring defaults did not finish', r.error);
  await runRingFold();
}

/** Run `biometrics.ringFold` as the SYSTEM actor: at boot, and again once a ring source is first created. */
export async function runRingFold(): Promise<void> {
  const r = await dispatch('biometrics.ringFold', {}, { actor: SYSTEM_ACTOR });
  if (!r.ok) console.warn('Vitals: folding ring sources did not finish', r.error);
}
if ((import.meta as { env?: { MODE?: string } }).env?.MODE !== 'test' && typeof globalThis.addEventListener === 'function') {
  // after the app has booted its store (this module loads with the command registry, before the store exists)
  setTimeout(() => {
    try {
      void getDocumentStore()
        .ready.then(() => runRingDefaultsMigration())
        .catch(() => undefined);
      // the ring service: auto-connect to known rings (SUITE_SPEC §15.2); lazy so the main chunk stays light
      void import('@/biometrics/service/app')
        .then((m) => m.startAppRingService())
        .catch((e: unknown) => console.warn('Vitals: the ring service did not start', e));
    } catch {
      /* no store in this context */
    }
  }, 4000);
}
