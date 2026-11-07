/**
 * Vitals' hooks for commanding Gauge (energy SPEC §A.4 item 10). Memory only: a reload re-reads `commands/state` and
 * the recent commands from the server. The screens are V4b (Reels editor, Measure, Check for updates) and V4c
 * (Record); they call these hooks and never the transports.
 *
 * - `useGaugeLink()` → `{ online, lastPollAt, appVersion, reels, recording, transportFor }`.
 * - `useGaugeCommand(type)` → `{ send(payload), pending, last, retry }`; a command view is
 *   `{ id, type, state, code?, result?, expiresAt?, via }`.
 *
 * Transport per command (`transportFor(type)`): workout commands go `local` (Gauge's broadcast API on this phone) when
 * the plugin, an installed Gauge, the granted permission and a 1.5 s `WORKOUT_STATUS` answer all hold; everything else
 * goes `server`. A command takes one transport; after a local timeout it asks the status once, adopts the asked state if
 * reached, otherwise falls back to the server with the same id. There is no offline queue: a command that cannot reach
 * the server fails at once with `server_unreachable`. A watch that breaks before an outcome ends the pending state with
 * `lost: true` and its problem code; `retry` asks again with the same id.
 *
 * (0.6.3 S4/A23) Local control needs Gauge's `CONTROL_WORKOUT` permission. `link.localControl` says whether it can be
 * asked for (`askable`: the plugin and a Gauge package are there, the grant is not); `requestLocalControl()` asks on the
 * person's own action and re-probes. The local path is re-checked when the app comes back to the foreground while
 * anything shows the link (a grant in Android settings, Gauge installed or removed). Declined or unsupported: the server.
 * (0.6.3 S26) `workout.start` may carry the catalogue `activityTypeId`; the server path drops it unless Gauge reports
 * `workout.start.activity_type_id` (an older Gauge rejects a key it does not know).
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  GAUGE_ACTIVITY_TYPE_CAPABILITY, gaugeCommandsApi, isTerminal, isWorkoutCommand, newCommandId,
  type GaugeCapability, type GaugeCommand, type GaugeCommandPayloads, type GaugeCommandsApi, type GaugeCommandState, type GaugeCommandType,
  type GaugeReelsState, type GaugeRecordingState,
} from '@/net/gaugeCommands';
import { notifyGaugeDataChanged } from '@/net/gaugeIdentity';
import { gaugeLocalInfo, probeGaugeLocal, requestGaugeControl, runLocalWorkout, type LocalRun, type VitalsGaugeInfo } from '@/platform/gaugeLocal';

export type Transport = 'local' | 'server';

/** What a screen shows of one command. */
export interface GaugeCommandView {
  id: string;
  type: GaugeCommandType;
  state: GaugeCommandState;
  code?: string;
  result?: Record<string, unknown>;
  expiresAt?: string;
  via: Transport;
  /** Server path: whether Gauge has polled in the last 55 s ("Waiting for Gauge" when false). */
  online?: boolean;
  /**
   * (Codex UI #17) The watch broke before an outcome (the server could not be reached, or the watch gave up): the
   * command is no longer shown as running; `state` keeps the last state the server reported and `code` says why the
   * watch ended. Gauge may still finish it, so `retry` sends it again with the same id (idempotent on the server).
   */
  lost?: true;
}

export interface GaugeLinkView {
  online: boolean;
  lastPollAt: string | null;
  appVersion: string | null;
  reels: GaugeReelsState | null;
  recording: GaugeRecordingState | null;
  /** Command types (and feature tokens) this Gauge build runs ([] until it reports). */
  capabilities: GaugeCapability[];
  paired: boolean;
  /** Whether the local workout path is usable (null until probed). */
  local: boolean | null;
  /**
   * (0.6.3 S4/A23) Gauge's control permission on this phone: `granted`; `askable` (the plugin and a Gauge package are
   * there, the grant is not: the Record sheet offers to ask); `declined` (asked this session and refused); `unavailable`
   * (no plugin or no Gauge). null until probed.
   */
  localControl: LocalControl | null;
}

export type LocalControl = 'granted' | 'askable' | 'declined' | 'unavailable';

export interface GaugeCommandSlot {
  pending: boolean;
  last: GaugeCommandView | null;
}

export interface LocalTransport {
  probe(): Promise<boolean>;
  run(type: GaugeCommandType, payload: Record<string, unknown>): Promise<LocalRun>;
  /** What the plugin says about Gauge on this phone (null: no plugin). Absent: the permission is never offered. */
  info?(): Promise<VitalsGaugeInfo | null>;
  /** Ask for Gauge's control permission (a system prompt); the info after the answer. */
  requestControl?(): Promise<VitalsGaugeInfo | null>;
}

export interface GaugeCommandsController {
  link(): GaugeLinkView;
  slot(type: GaugeCommandType): GaugeCommandSlot;
  transportFor(type: GaugeCommandType): Transport;
  subscribe(listener: () => void): () => void;
  /** Re-read `commands/state` (and the recent commands, the first time). */
  refresh(): Promise<void>;
  /** Re-check the local path (and the control permission); joins a check already running. */
  probeLocal(): Promise<boolean>;
  /**
   * (0.6.3 S4/A23) Ask for Gauge's control permission, on the person's own action only, then re-probe: true when the
   * local path is usable afterwards. Declined or unsupported: false, and workouts keep going through the server.
   */
  requestLocalControl(): Promise<boolean>;
  send<T extends GaugeCommandType>(type: T, payload: GaugeCommandPayloads[T], o?: { id?: string }): Promise<GaugeCommandView>;
  /** Send the last command of this type again with the same id (a retry of the same user action). */
  retry(type: GaugeCommandType): Promise<GaugeCommandView | null>;
  /** While someone shows the link: refresh now and every 30 s. Returns the release. */
  retain(): () => void;
  reset(): void;
}

const REFRESH_MS = 30_000;
/** How long past `expiresAt` a watch may go on (a running measurement has 90 s, a ring sync 3 min). */
const WATCH_SLACK_MS = 240_000;

const EMPTY_LINK: GaugeLinkView = { online: false, lastPollAt: null, appVersion: null, reels: null, recording: null, capabilities: [], paired: false, local: null, localControl: null };
const EMPTY_SLOT: GaugeCommandSlot = { pending: false, last: null };

const viewOf = (c: GaugeCommand, via: Transport, online?: boolean): GaugeCommandView => ({
  id: c.id, type: c.type, state: c.state, via, expiresAt: c.expiresAt,
  ...(c.code ? { code: c.code } : {}), ...(c.result ? { result: c.result } : {}), ...(online !== undefined ? { online } : {}),
});

export const defaultLocalTransport: LocalTransport = {
  probe: () => probeGaugeLocal(),
  run: (type, payload) => runLocalWorkout(type as Parameters<typeof runLocalWorkout>[0], payload as Parameters<typeof runLocalWorkout>[1]),
  info: () => gaugeLocalInfo(),
  requestControl: () => requestGaugeControl(),
};

/** The permission state from the plugin's info (`declined` once the person refused this session). */
const controlOf = (info: VitalsGaugeInfo | null, declined: boolean): LocalControl =>
  !info || !info.package ? 'unavailable' : info.granted ? 'granted' : declined ? 'declined' : 'askable';

export function createGaugeCommandsController(deps: { api?: GaugeCommandsApi; local?: LocalTransport } = {}): GaugeCommandsController {
  const api = deps.api ?? gaugeCommandsApi;
  const local = deps.local ?? defaultLocalTransport;
  const listeners = new Set<() => void>();
  let link = EMPTY_LINK;
  const slots = new Map<GaugeCommandType, GaugeCommandSlot>();
  const sent = new Map<GaugeCommandType, { id: string; payload: Record<string, unknown> }>();
  let loadedRecent = false;
  let retained = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let probing: Promise<boolean> | null = null;
  let requesting: Promise<boolean> | null = null;
  /** The person refused the permission this session: the sheet stops offering it (a grant in settings still counts). */
  let declined = false;
  // back in the foreground while someone shows the link: re-check the local path (permission, Gauge) and the link
  const onVisible = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    if (!requesting) void ctl.probeLocal();
    void ctl.refresh().catch(() => undefined);
  };

  const emit = () => listeners.forEach((l) => l());
  const setLink = (patch: Partial<GaugeLinkView>) => {
    link = { ...link, ...patch };
    emit();
  };
  const setSlot = (type: GaugeCommandType, patch: Partial<GaugeCommandSlot>) => {
    slots.set(type, { ...(slots.get(type) ?? EMPTY_SLOT), ...patch });
    emit();
  };

  const ctl: GaugeCommandsController = {
    link: () => link,
    slot: (type) => slots.get(type) ?? EMPTY_SLOT,
    transportFor: (type) => (isWorkoutCommand(type) && link.local === true ? 'local' : 'server'),
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    async refresh() {
      const s = await api.state();
      if (s.ok) {
        setLink({
          online: s.state.online, lastPollAt: s.state.lastPollAt, appVersion: s.state.appVersion, reels: s.state.reels, recording: s.state.recording,
          capabilities: s.state.capabilities ?? [], paired: s.state.paired,
        });
      } else if (s.problem === 'not_paired' || s.problem === 'unauthorized') {
        setLink({ ...EMPTY_LINK, local: link.local, localControl: link.localControl });
      }
      if (!loadedRecent && s.ok) {
        loadedRecent = true;
        const recent = await api.list({ limit: 20 });
        if (recent.ok) {
          // newest first: the first of each type is its `last`
          for (const c of recent.commands) if (!slots.get(c.type)?.last) setSlot(c.type, { last: viewOf(c, 'server'), pending: false });
        }
      }
    },
    probeLocal() {
      probing ??= Promise.all([local.probe().catch(() => false), local.info ? local.info().catch(() => null) : Promise.resolve(undefined)]).then(([ok, info]) => {
        setLink({ local: ok, localControl: info === undefined ? (ok ? 'granted' : 'unavailable') : controlOf(info, declined) });
        probing = null;
        return ok;
      });
      return probing;
    },
    requestLocalControl() {
      requesting ??= (async () => {
        try {
          const info = local.requestControl ? await local.requestControl().catch(() => null) : null;
          if (info?.package && !info.granted) declined = true;
          if (info?.granted) declined = false;
          // a check started before the answer would report the old state: wait it out, then check afresh
          if (probing) await probing;
          return await ctl.probeLocal();
        } finally {
          requesting = null;
        }
      })();
      return requesting;
    },
    async send(type, payload, o = {}) {
      const id = o.id ?? newCommandId();
      const body = payload as Record<string, unknown>;
      sent.set(type, { id, payload: body });
      if (isWorkoutCommand(type) && link.local === null) await ctl.probeLocal();
      const via = ctl.transportFor(type);
      setSlot(type, { pending: true, last: { id, type, state: 'queued', via } });
      // (0.6.3 S26) an older Gauge rejects `activityTypeId`: through the server only when Gauge says it takes it
      const toServer = (): GaugeCommandPayloads[typeof type] => {
        if (type !== 'workout.start' || body.activityTypeId === undefined || link.capabilities.includes(GAUGE_ACTIVITY_TYPE_CAPABILITY)) return payload;
        const { activityTypeId: _drop, ...rest } = body;
        void _drop;
        return rest as GaugeCommandPayloads[typeof type];
      };
      const finish = (v: GaugeCommandView) => {
        setSlot(type, { pending: false, last: v });
        if (isTerminal(v.state)) void ctl.refresh().catch(() => undefined);
        // (0.6.3 S28) a finished measurement (or a stopped recording, or (r068 B2) a ring sync) means new readings: the
        // screens ask again. Gauge uploads before it answers, so the new readings are on the server by now.
        if (v.state === 'done' && (type === 'hr.measure' || type === 'workout.stop' || type === 'ring.sync')) notifyGaugeDataChanged();
        return v;
      };

      if (via === 'local') {
        const r = await local.run(type, body).catch((): LocalRun => ({ kind: 'fallback' }));
        if (r.kind === 'ack') {
          return finish({ id, type, state: r.status, via: 'local', ...(r.code ? { code: r.code } : {}), ...(r.result ? { result: r.result } : {}) });
        }
        // no answer on this phone: the server channel, same id
      }

      const s = await api.send({ id, type, payload: toServer() });
      if (!s.ok) return finish({ id, type, state: 'failed', code: s.problem, via: 'server' });
      // (audit F9) a coalesced send answers the command already in force (another id): watch and retry THAT one
      const serverId = s.command.id || id;
      if (serverId !== id) sent.set(type, { id: serverId, payload: body });
      let view = viewOf(s.command, 'server', s.online);
      if (isTerminal(view.state)) return finish(view);
      setSlot(type, { pending: true, last: view });
      const w = await api.watch(serverId, {
        since: s.command.state,
        deadlineMs: Date.parse(s.command.expiresAt) + WATCH_SLACK_MS,
        onUpdate: (c, online) => {
          view = viewOf(c, 'server', online);
          setSlot(type, { pending: !isTerminal(c.state), last: view });
        },
      });
      // the outcome is unknown: end "running" and say why, never keep showing the last state as if it were live
      if (!w.ok) return finish({ ...view, code: w.problem, lost: true });
      return finish(viewOf(w.command, 'server', w.online));
    },
    async retry(type) {
      const last = sent.get(type);
      if (!last) return null;
      return ctl.send(type, last.payload as GaugeCommandPayloads[typeof type], { id: last.id });
    },
    retain() {
      retained++;
      if (retained === 1) {
        void ctl.refresh().catch(() => undefined);
        if (link.local === null) void ctl.probeLocal();
        timer = setInterval(() => void ctl.refresh().catch(() => undefined), REFRESH_MS);
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        retained--;
        if (retained === 0) {
          if (timer) clearInterval(timer);
          timer = null;
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
        }
      };
    },
    reset() {
      link = EMPTY_LINK;
      slots.clear();
      sent.clear();
      loadedRecent = false;
      probing = null;
      requesting = null;
      declined = false;
      emit();
    },
  };
  return ctl;
}

/** The app's controller (memory only). */
export const gaugeCommands: GaugeCommandsController = createGaugeCommandsController();

/** The link to Gauge for V4b / V4c: online, the last poll, the version, the Reels settings, the live recording. */
export function useGaugeLink(ctl: GaugeCommandsController = gaugeCommands) {
  const link = useSyncExternalStore(ctl.subscribe, ctl.link, ctl.link);
  useEffect(() => ctl.retain(), [ctl]);
  return { ...link, transportFor: ctl.transportFor };
}

/** One command type for V4b / V4c: `send(payload)` resolves with the final view; `pending` while it runs. */
export function useGaugeCommand<T extends GaugeCommandType>(type: T, ctl: GaugeCommandsController = gaugeCommands) {
  const getSlot = useCallback(() => ctl.slot(type), [ctl, type]);
  const slot = useSyncExternalStore(ctl.subscribe, getSlot, getSlot);
  const send = useCallback((payload: GaugeCommandPayloads[T], o?: { id?: string }) => ctl.send(type, payload, o), [ctl, type]);
  const retry = useCallback(() => ctl.retry(type), [ctl, type]);
  return { send, retry, pending: slot.pending, last: slot.last };
}
