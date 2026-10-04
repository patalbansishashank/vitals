/**
 * Persistent storage (`navigator.storage.persist()`): ask the browser to keep Vitals' data when the device runs low on
 * space, so the document database is not evicted under storage pressure.
 *
 * When to ask depends on the browser:
 * - **Chromium** (Chrome, Edge, Samsung Internet, …) and **Safari** never show a prompt: they grant or refuse silently by
 *   engagement (an installed app, a bookmark, regular use). A refusal today can be a grant next week, so the app asks
 *   after the first real save of a session and again when the app is installed or opened as an installed app — at most
 *   once per session for each — and stops once granted.
 * - **Firefox** shows a permission prompt. It is asked once, ever, at a moment that explains itself: when the person
 *   finishes setting up their body (`profile.setSetupStep` → done), starts a plan (`plan.start`) or installs the app,
 *   whichever comes first. The answer is recorded and the question never comes back (no prompt loops).
 *
 * The outcome is kept on this device only, in localStorage under `vitals-storage-persist` (outside the `vitals.*` data
 * keys, so it is never exported, imported or synced). Nothing is shown to the person either way.
 */
import { on } from '@/commands/bus';
import type { BusEvent } from '@/commands/types';
import { useProfileStore } from '@/state/profileStore';

export const PERSIST_KEY = 'vitals-storage-persist';

export type PersistOutcome = 'granted' | 'denied' | 'unsupported';
/** What prompted the request: a saved change, finished setup, a started plan, an install, a launch as installed app. */
export type PersistTrigger = 'save' | 'setupDone' | 'planStart' | 'install';

export interface PersistRecord {
  outcome: PersistOutcome;
  /** When the outcome was recorded (ISO instant). */
  at: string;
  /** How many times `persist()` was called on this device. */
  asked: number;
  trigger: PersistTrigger;
}

export interface PersistEnv {
  storage?: Pick<StorageManager, 'persist' | 'persisted'> | null;
  local?: Storage | null;
  userAgent?: string;
  now?: () => Date;
}

function defaults(env: PersistEnv): Required<PersistEnv> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  let local: Storage | null = null;
  try {
    local = typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // storage disabled (private mode, sandboxed frame): `local` stays null
  }
  return {
    storage: env.storage !== undefined ? env.storage : (nav?.storage ?? null),
    local: env.local !== undefined ? env.local : local,
    userAgent: env.userAgent ?? nav?.userAgent ?? '',
    now: env.now ?? (() => new Date()),
  };
}

/** Firefox asks the person; Chromium and Safari decide silently. */
export function promptsForPersistence(userAgent: string): boolean {
  return /\bFirefox\//.test(userAgent) && !/\bSeamonkey\//i.test(userAgent);
}

export function readPersistRecord(env: PersistEnv = {}): PersistRecord | null {
  const { local } = defaults(env);
  try {
    const raw = local?.getItem(PERSIST_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<PersistRecord>;
    return r && (r.outcome === 'granted' || r.outcome === 'denied' || r.outcome === 'unsupported') ? (r as PersistRecord) : null;
  } catch {
    return null;
  }
}

function writeRecord(local: Storage | null, r: PersistRecord): void {
  try {
    local?.setItem(PERSIST_KEY, JSON.stringify(r));
  } catch {
    /* storage blocked: asked again next session (silent browsers only; Firefox never re-asks in this session) */
  }
}

/** Triggers already used in this session (silent browsers ask at most once per trigger per session). */
const usedThisSession = new Set<PersistTrigger>();
let inflight: Promise<PersistOutcome | 'skipped'> | null = null;

/** Tests: a new session. */
export function resetPersistSession(): void {
  usedThisSession.clear();
  inflight = null;
}

/**
 * Ask for persistent storage if this trigger and this browser call for it now. Resolves with the outcome, or
 * 'skipped' when nothing was asked (already granted, already answered in Firefox, already asked this session, or a
 * trigger Firefox does not ask on).
 */
export function requestPersistentStorage(trigger: PersistTrigger, env: PersistEnv = {}): Promise<PersistOutcome | 'skipped'> {
  if (inflight) return inflight;
  const p = ask(trigger, defaults(env)).finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}

async function ask(trigger: PersistTrigger, env: Required<PersistEnv>): Promise<PersistOutcome | 'skipped'> {
  const prev = readPersistRecord(env);
  if (prev?.outcome === 'granted' || prev?.outcome === 'unsupported') return 'skipped';
  const prompts = promptsForPersistence(env.userAgent);
  if (prompts && (trigger === 'save' || (prev?.asked ?? 0) > 0)) return 'skipped';
  if (!prompts && usedThisSession.has(trigger)) return 'skipped';
  usedThisSession.add(trigger);
  const at = () => env.now().toISOString();
  const asked = prev?.asked ?? 0;
  const s = env.storage;
  if (!s || typeof s.persist !== 'function') {
    writeRecord(env.local, { outcome: 'unsupported', at: at(), asked, trigger });
    return 'unsupported';
  }
  try {
    if (typeof s.persisted === 'function' && (await s.persisted())) {
      writeRecord(env.local, { outcome: 'granted', at: at(), asked, trigger });
      return 'granted';
    }
    const granted = await s.persist();
    const outcome: PersistOutcome = granted ? 'granted' : 'denied';
    writeRecord(env.local, { outcome, at: at(), asked: asked + 1, trigger });
    return outcome;
  } catch {
    // a browser that throws (blocked by policy, opaque origin) counts as an answer: no retry loop
    writeRecord(env.local, { outcome: 'denied', at: at(), asked: asked + 1, trigger });
    return 'denied';
  }
}

export interface PersistWiring extends PersistEnv {
  /** Bus subscription (tests pass a fake). */
  subscribe?: (listener: (e: BusEvent) => void) => () => void;
  /** Has the person finished the body setup (read when `profile.setSetupStep` commits). */
  setupDone?: () => boolean;
  /** The window for `appinstalled` and the standalone display mode (null in tests without one). */
  win?: Pick<Window, 'addEventListener' | 'removeEventListener' | 'matchMedia'> | null;
}

/** Start listening for the moments above. Returns the stop function. Called once by the app. */
export function startStoragePersistence(w: PersistWiring = {}): () => void {
  const subscribe = w.subscribe ?? on;
  const setupDone = w.setupDone ?? (() => useProfileStore.getState().setup === 'done');
  const win = w.win !== undefined ? w.win : typeof window === 'undefined' ? null : window;
  const req = (t: PersistTrigger) => void requestPersistentStorage(t, w).catch(() => undefined);
  const off = subscribe((e) => {
    if (e.type !== 'committed' || !e.changeSet || e.actor.kind !== 'user') return;
    if (e.commandId === 'plan.start') req('planStart');
    else if (e.commandId === 'profile.setSetupStep' && setupDone()) req('setupDone');
    else req('save');
  });
  const onInstalled = () => req('install');
  win?.addEventListener('appinstalled', onInstalled);
  try {
    if (win?.matchMedia?.('(display-mode: standalone)').matches) req('install');
  } catch {
    /* no matchMedia */
  }
  return () => {
    off();
    win?.removeEventListener('appinstalled', onInstalled);
  };
}
