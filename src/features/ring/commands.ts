/**
 * The Ring screens' line to Gauge (SPEC A.4 through package C's hooks): "Measure now" (`hr.measure`), "Refresh ring
 * data" (`ring.sync`, r068 B2: the phone's Gauge syncs the ring and uploads before it answers), the short-video limit
 * (`reels.set`) and "Check for updates" (`update.check`). The screens call these hooks, never a transport; the
 * words for each command's state live here so a card and its test read the same sentence.
 *
 * Tests install a controller with `setRingCommands`; a development tab with `__VITALS_GAUGE_DEMO__` gets an in-memory
 * Gauge that answers like a paired, online phone (production builds drop that branch).
 */
import { useSyncExternalStore } from 'react';
import { createGaugeCommandsController, gaugeCommands, useGaugeCommand, useGaugeLink, type GaugeCommandView, type GaugeCommandsController } from '@/state/gaugeCommands';
import type { GaugeCommand, GaugeCommandsApi, GaugeCommandType, GaugeLinkState } from '@/net/gaugeCommands';
import { ringDemo } from './api';

let override: GaugeCommandsController | null = null;
let demo: GaugeCommandsController | null = null;
const listeners = new Set<() => void>();

/** The controller the Ring screens use. */
export function ringCommands(): GaugeCommandsController {
  if (override) return override;
  if (ringDemo()) return (demo ??= createGaugeCommandsController({ api: makeCommandsFixture(), local: { probe: async () => false, run: async () => ({ kind: 'fallback' }) } }));
  return gaugeCommands;
}

/** Tests: use this controller (null restores the app's). */
export function setRingCommands(ctl: GaugeCommandsController | null): void {
  override = ctl;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

function useController(): GaugeCommandsController {
  return useSyncExternalStore(subscribe, ringCommands, ringCommands);
}

/** `useGaugeLink` over the Ring's controller. */
export function useRingLink() {
  return useGaugeLink(useController());
}

/** `useGaugeCommand` over the Ring's controller. */
export function useRingCommand<T extends GaugeCommandType>(type: T) {
  return useGaugeCommand(type, useController());
}

// ---------------------------------------------------------------------------------------------------------------
// Words

/** "14:05" on this device's clock. */
const clock = (iso: string | undefined): string | null => {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Why a command did not run, in words (SPEC A.4 item 9 codes and the client's problems). */
const CODE_WORDS: Record<string, string> = {
  server_unreachable: 'Your server can’t be reached',
  not_paired: 'Connect this device to your server first',
  unauthorized: 'This device can’t send to the phone',
  no_gauge: 'No phone is paired with your server',
  too_many_pending: 'Too many requests are waiting for the phone',
  rate_limited: 'Too many requests: try again in a minute',
  ring_disconnected: 'The ring isn’t connected to the phone',
  ring_refused: 'The ring refused the measurement',
  no_reading: 'No steady reading: keep the ring still and try again',
  workout_active: 'A workout is recording',
  busy: 'A measurement is already running',
  check_failed: 'The update check failed',
  timeout: 'The phone didn’t finish in time',
  // (r068 B2) a Gauge older than the command (2.8.3 and earlier for `ring.sync`)
  unknown_type: 'Update the phone app to do this',
  // workout commands (A.4 item 9; Claude UI P2-3)
  needs_activity_recognition: 'The phone app needs the Physical activity permission on the phone',
  foreground_start_blocked: 'The phone blocked the app from starting the workout: open the ring app once, then try again',
  bad_type: 'The phone app can’t record that kind of workout',
  no_active_workout: 'No workout is recording',
  wrong_workout: 'That workout isn’t the one recording',
  // (r068 B2) the phone never took the request: Gauge was not running, or the phone was asleep without network
  expired: 'Your phone didn’t answer: open the ring app on the phone, then try again',
};

/**
 * The words of any command's outcome for a screen that has no wording of its own (the recording banner): the failure
 * code's words, the `expired` state's, a lost watch's; null while it is not a failure.
 */
export function failureWords(v: GaugeCommandView | null): string | null {
  if (!v) return null;
  if (v.lost) return lostWords(v);
  if (v.state === 'expired') return codeWords('expired');
  if (v.state === 'failed' || v.state === 'rejected') return codeWords(v.code);
  return null;
}

/** The words of a command's code, or a plain fallback. */
export const codeWords = (code: string | undefined | null): string => (code && CODE_WORDS[code]) || 'The phone couldn’t do it';

/**
 * A command whose watch broke before an outcome (Codex UI #17): why, and that the person can ask again. Never "Measuring"
 * or "Checking" once the line to the server is gone.
 */
export function lostWords(v: GaugeCommandView): string {
  return `${codeWords(v.code)}: no answer from the phone yet. Try again`;
}

/**
 * While a command waits or runs: the `queued` word ("Waiting for Gauge"), "Your phone hasn't checked in · expires 14:05"
 * when Gauge has not polled lately, "Gauge has it…" once delivered, or the running word.
 */
export function pendingWords(v: GaugeCommandView, running: string, now: number = Date.now(), quiet = false, queued = 'Waiting for the phone'): string {
  // (Claude UI P1-8) a non-terminal view with a problem code, or past its deadline, is not waiting any more
  if (v.code) return codeWords(v.code);
  const exp = v.expiresAt ? Date.parse(v.expiresAt) : Number.NaN;
  if (v.state !== 'running' && Number.isFinite(exp) && exp < now) return codeWords('expired');
  if (v.state === 'running') return running;
  if (v.online === false) {
    const at = clock(v.expiresAt);
    // (r063 FX3) quiet: no clock time
    return at && !quiet ? `Your phone hasn’t checked in · expires ${at}` : 'Your phone hasn’t checked in';
  }
  return v.state === 'delivered' ? 'The phone has it…' : queued;
}

/** (r068 B2) What a request to the phone says while it travels: sent, received, then the running word. */
const SENT = 'Sent to your phone…';

/** "Sent to your phone…" · "Measuring on the ring…" · "Measured 58 bpm" · the failure words (`hr.measure`). */
export function measureWords(v: GaugeCommandView | null, quiet = false): string | null {
  if (!v) return null;
  if (v.lost) return lostWords(v);
  if (v.state === 'done') {
    // (r063 FX3 sR10/aR10) quiet: the reading lands on the heart-rate page as its word; the answer says only that it ran
    const bpm = typeof v.result?.bpm === 'number' ? v.result.bpm : null;
    return bpm !== null && !quiet ? `Measured ${Math.round(bpm)} bpm` : 'Measured';
  }
  if (v.state === 'queued' || v.state === 'delivered' || v.state === 'running') return pendingWords(v, 'Measuring on the ring…', Date.now(), quiet, SENT);
  if (v.state === 'expired') return codeWords('expired');
  if (v.state === 'cancelled' || v.state === 'superseded' || v.state === 'noop') return null;
  return codeWords(v.code);
}

/**
 * (r068 B2) "Refresh ring data" (`ring.sync`): "Sent to your phone…" · "Syncing the ring…" · "Synced from the ring" ·
 * the failure words. A sync whose upload is still waiting on the phone says so (the screens cannot show it yet).
 */
export function syncWords(v: GaugeCommandView | null): string | null {
  if (!v) return null;
  if (v.lost) return lostWords(v);
  if (v.state === 'done') {
    if (v.result?.uploaded === false) return 'Synced on the phone; the upload is still on its way';
    return v.result?.complete === false ? 'Synced what the ring sent' : 'Synced from the ring';
  }
  if (v.state === 'queued' || v.state === 'delivered' || v.state === 'running') return pendingWords(v, 'Syncing the ring…', Date.now(), false, SENT);
  if (v.state === 'expired') return codeWords('expired');
  if (v.state === 'cancelled' || v.state === 'superseded' || v.state === 'noop') return null;
  return codeWords(v.code);
}

/** `update.check` outcomes (Gauge's `OtaUpdates`). Installing needs one tap on the phone (A.1.6). */
export function updateWords(v: GaugeCommandView | null): string | null {
  if (!v) return null;
  if (v.lost) return lostWords(v);
  if (v.state === 'done') {
    const outcome = String(v.result?.outcome ?? '');
    const name = typeof v.result?.versionName === 'string' ? ` ${v.result.versionName}` : '';
    if (outcome === 'UP_TO_DATE') return `The ring app is up to date${name ? ` (${name.trim()})` : ''}`;
    if (outcome === 'READY' || outcome === 'WAITING_FOR_TAP') return `The ring app${name} is ready on the phone: tap Install there`;
    return 'Checked';
  }
  if (v.state === 'queued' || v.state === 'delivered' || v.state === 'running') return pendingWords(v, 'Checking');
  if (v.state === 'expired') return codeWords('expired');
  if (v.state === 'rejected' && (v.code === 'NOT_PAIRED' || v.code === 'not_paired')) return 'The ring app isn’t paired with your server';
  if (v.state === 'rejected' && (v.code === 'NEEDS_REPAIR' || v.code === 'needs_repair')) return 'The ring app needs pairing again';
  if (v.state === 'cancelled' || v.state === 'superseded' || v.state === 'noop') return null;
  return codeWords(v.code);
}

/** `reels.set`: "Saved on the phone" · "Waiting for Gauge" · the failure words. */
export function reelsWords(v: GaugeCommandView | null): string | null {
  if (!v) return null;
  if (v.lost) return lostWords(v);
  if (v.state === 'done') return 'Saved on the phone';
  if (v.state === 'queued' || v.state === 'delivered' || v.state === 'running') return pendingWords(v, 'Saving');
  if (v.state === 'expired') return codeWords('expired');
  if (v.state === 'superseded' || v.state === 'cancelled' || v.state === 'noop') return null;
  return codeWords(v.code);
}

// ---------------------------------------------------------------------------------------------------------------
// An in-memory Gauge (tests and the development demo)

export interface CommandsFixtureOptions {
  online?: boolean;
  /** How long Gauge takes to finish a command (ms; default 1200, `hr.measure` 2400). */
  delayMs?: number;
  /** The ack each type ends with. */
  answer?: Partial<Record<GaugeCommandType, Pick<GaugeCommand, 'state' | 'code' | 'result'>>>;
  reels?: GaugeLinkState['reels'];
}

/** A server-side command channel with a paired, polling Gauge. */
export function makeCommandsFixture(o: CommandsFixtureOptions = {}): GaugeCommandsApi {
  const online = o.online ?? true;
  let reels: GaugeLinkState['reels'] = o.reels ?? { enabled: true, dailyLimit: 30, countdownSeconds: 10, apps: ['instagram', 'youtube'] };
  const store = new Map<string, GaugeCommand>();
  const answer = (type: GaugeCommandType): Pick<GaugeCommand, 'state' | 'code' | 'result'> =>
    o.answer?.[type] ??
    (type === 'hr.measure'
      ? { state: 'done', code: null, result: { bpm: 58, observedAt: new Date().toISOString() } }
      : type === 'update.check'
        ? { state: 'done', code: null, result: { outcome: 'UP_TO_DATE', versionName: '2.8.0', versionCode: 280 } }
        : type === 'ring.sync'
          ? { state: 'done', code: null, result: { syncedAt: new Date().toISOString(), complete: true, uploaded: true } }
          : { state: 'done', code: null, result: { applied: true } });
  const make = (id: string, type: GaugeCommandType, payload: Record<string, unknown>): GaugeCommand => {
    const now = new Date();
    return {
      id,
      type,
      payload,
      state: 'queued',
      code: null,
      detail: null,
      result: null,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (type === 'reels.set' ? 86_400_000 : type === 'update.check' ? 3_600_000 : type === 'ring.sync' ? 120_000 : 60_000)).toISOString(),
      occurredAt: null,
      deliveredAt: null,
      attempt: 0,
      installationId: 'gauge-1',
      updatedAt: now.toISOString(),
    };
  };
  const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), res()));
  });
  const linkState = (): GaugeLinkState => ({
    paired: true,
    installationId: 'gauge-1',
    online,
    lastPollAt: new Date(Date.now() - 8_000).toISOString(),
    appVersion: '2.8.0',
    capabilities: ['reels.set', 'workout.start', 'workout.pause', 'workout.resume', 'workout.stop', 'hr.measure', 'update.check', 'ring.sync'],
    reels,
    recording: null,
    serverNow: new Date().toISOString(),
  });
  return {
    async send(c) {
      const cmd = make(c.id, c.type, c.payload as Record<string, unknown>);
      store.set(c.id, cmd);
      return { ok: true, command: cmd, online };
    },
    async get(id) {
      const c = store.get(id);
      return c ? { ok: true, command: c, online } : { ok: false, problem: 'not_found' };
    },
    async watch(id, w = {}) {
      const c = store.get(id);
      if (!c) return { ok: false, problem: 'not_found' };
      if (!online) {
        await wait(Math.max(0, (w.deadlineMs ?? Date.now()) - Date.now()), w.signal);
        const expired = { ...c, state: 'expired' as const };
        store.set(id, expired);
        return { ok: true, command: expired, online };
      }
      const delay = o.delayMs ?? (c.type === 'hr.measure' || c.type === 'ring.sync' ? 2400 : 1200);
      const delivered = { ...c, state: c.type === 'hr.measure' || c.type === 'ring.sync' ? ('running' as const) : ('delivered' as const) };
      store.set(id, delivered);
      w.onUpdate?.(delivered, online);
      await wait(delay, w.signal);
      const a = answer(c.type);
      if (c.type === 'reels.set' && a.state === 'done' && reels) reels = { ...reels, ...(c.payload as Partial<NonNullable<GaugeLinkState['reels']>>) };
      const done = { ...c, ...a, updatedAt: new Date().toISOString() };
      store.set(id, done);
      return { ok: true, command: done, online };
    },
    async list() {
      return { ok: true, commands: [...store.values()].reverse() };
    },
    async cancel(id) {
      const c = store.get(id);
      return c ? { ok: true, command: { ...c, state: 'cancelled' } } : { ok: false, problem: 'not_found' };
    },
    async state() {
      return { ok: true, state: linkState() };
    },
  };
}
