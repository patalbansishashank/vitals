/**
 * `openRingSession(family, transport)`: runs a family's pure `Protocol` over a `Transport` (plan 04 item 1, A5a layer 3).
 * No DOM, no platform API: everything a platform differs in sits behind the transport.
 *
 * Per command: stamp `nowMs`/`tzOffsetS` → `protocol.begin` → `protocol.frame` → serialised writes → every notification to
 * `protocol.ingest` → write its `send` follow-ups → finish on `done`, or on the quiet/stall timers via `protocol.timeout`.
 * One command at a time (a second `exchange` while one runs is a `busy` error). Between commands, notifications the ring
 * pushes on its own (live samples, battery changes) are decoded at once and handed to `on()` listeners. A packet the
 * protocol marks `unrelated` neither starts the quiet timer nor restarts the wait, and no command waits longer than
 * its ceiling (`CommandPlan.maxMs`, default 60 s) in all. A family's `keepalive` is written every interval while the
 * session is open, between frames of whatever command is in flight.
 *
 * Write size: frames longer than the write budget (`transport.mtu − 3`, else 20) are split, which only helps families that
 * reassemble writes; every family here writes 16- or 20-byte frames.
 */
import type { BioStream } from '../../../src/biometrics/core/types';
import {
  RingError, ringIdentity,
  type HandshakeInfo, type HandshakeOptions, type IngestResult, type OutboundFrame, type RingCommand, type RingEvent, type RingFamily,
  type RingIdentity, type RingSession, type SessionRuntime, type SpotKind, type SyncCursor, type SyncProgress, type Transport, type TransportEvent, type Uuid,
} from './types';

export interface SessionClock {
  now(): number;
  /** Device UTC offset (s, east positive) at `now`. */
  tzOffsetS(): number;
  /** IANA zone name, stamped as `params.tz` for families whose records need the zone's daylight-saving rule (YCBT). */
  tz?: string;
}

export const systemClock: SessionClock = {
  now: () => Date.now(),
  tzOffsetS: () => -new Date().getTimezoneOffset() * 60,
  tz: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
};

export interface SessionOptions extends HandshakeOptions {
  clock?: SessionClock;
  /** Override the protocol's timers (tests). */
  timers?: { quietMs?: number; stallMs?: number; maxMs?: number };
  /** Default reply wait when the protocol gives no `stallMs`. */
  replyMs?: number;
  /** Ceiling on a spot measurement when the protocol never says it is done (Lumen: 30 s HR, 60 s SpO2). */
  spotCeilingMs?: Partial<Record<SpotKind, number>>;
}

/** Ceiling on one command when the protocol gives no `maxMs`: steady pushes cannot hold a read open for ever. */
export const DEFAULT_COMMAND_MS = 60_000;

const DEFAULT_SPOT_MS = { hr: 30_000, spo2: 60_000, hrv: 60_000, temperature: 60_000, stress: 60_000 } as const;

type Listener = (ev: RingEvent | { type: 'disconnected'; reason?: string }) => void;

const abortError = (): RingError => new RingError('aborted', 'aborted');

export async function openRingSession(family: RingFamily, transport: Transport, opts: SessionOptions = {}): Promise<RingSession & { runtime: SessionRuntime }> {
  const { protocol, gatt } = family;
  const clock = opts.clock ?? systemClock;
  let state = protocol.initialState();
  let closed = false;
  let dropped = false;
  let dropReason: string | undefined;
  let busy = false;
  const inbox: Array<{ bytes: Uint8Array; channel: Uuid }> = [];
  const listeners = new Set<Listener>();
  let wake: (() => void) | null = null;
  const poke = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };
  const emit = (ev: RingEvent | { type: 'disconnected'; reason?: string }): void => {
    for (const l of listeners) l(ev);
  };

  const onTransport = (ev: TransportEvent): void => {
    if (ev.type === 'notification') {
      if (busy) {
        inbox.push({ bytes: ev.bytes, channel: ev.characteristic });
        poke();
      } else if (!closed) {
        // Nothing in flight: the ring spoke on its own (live sample, battery). Decode now; never buffer unbounded.
        const r = protocol.ingest(ev.bytes, state, ev.characteristic);
        state = r.state;
        for (const e of r.events) emit(e);
        if (r.send?.length) void writeCommands(r.send).catch(() => {});
      }
    } else if (ev.type === 'disconnected') {
      dropped = true;
      clearInterval(keepaliveTimer);
      dropReason = ev.reason;
      poke();
      emit({ type: 'disconnected', reason: ev.reason });
    }
  };
  let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  const offTransport = transport.on(onTransport);

  const unsubscribes: Array<() => Promise<void>> = [];
  try {
    for (const n of gatt.notify) unsubscribes.push(await transport.subscribe(n.service ?? gatt.service, n.characteristic, n.mode));
  } catch (e) {
    offTransport();
    await transport.disconnect().catch(() => {});
    throw new RingError('could not subscribe to the ring', 'transport', e);
  }

  const writeBudget = transport.mtu ? Math.max(20, transport.mtu - 3) : 20;
  const writeMode = gatt.writeMode ?? 'withResponse';
  let writeChain: Promise<void> = Promise.resolve();
  const writeFrames = (frames: OutboundFrame[]): Promise<void> => {
    const job = writeChain.then(async () => {
      for (const f of frames) {
        const toCommand = f.channel === 'command' && gatt.command !== undefined;
        const ch = toCommand ? gatt.command! : gatt.write;
        const svc = toCommand && gatt.commandService ? gatt.commandService : gatt.service;
        for (let o = 0; o < f.bytes.length; o += writeBudget) {
          if (dropped) throw new RingError(dropReason ? `link dropped: ${dropReason}` : 'link dropped', 'disconnected');
          if (closed) throw new RingError('session closed', 'closed');
          try {
            await transport.write(svc, ch, f.bytes.subarray(o, o + writeBudget), writeMode);
          } catch (e) {
            if (e instanceof RingError) throw e;
            throw new RingError(dropped ? 'link dropped' : 'write failed', dropped ? 'disconnected' : 'transport', e);
          }
        }
      }
    });
    writeChain = job.catch(() => {});
    return job;
  };
  const stamp = (cmd: RingCommand): RingCommand => ({ ...cmd, params: { nowMs: clock.now(), tzOffsetS: clock.tzOffsetS(), ...(clock.tz ? { tz: clock.tz } : {}), ...cmd.params } });
  const writeCommands = (cmds: RingCommand[]): Promise<void> => writeFrames(cmds.flatMap((c) => protocol.frame(stamp(c), state)));

  /** Waits for a packet, the timer, abort or disconnect. */
  const nextPacket = (ms: number | undefined, signal?: AbortSignal): Promise<{ bytes: Uint8Array; channel: Uuid } | 'timeout'> =>
    new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', check);
        wake = null;
      };
      function check(): void {
        if (signal?.aborted) return cleanup(), reject(abortError());
        if (closed) return cleanup(), reject(new RingError('session closed', 'closed'));
        const b = inbox.shift();
        if (b) return cleanup(), resolve(b);
        if (dropped) return cleanup(), reject(new RingError(dropReason ? `link dropped: ${dropReason}` : 'link dropped', 'disconnected'));
        wake = check;
      }
      if (ms !== undefined) timer = setTimeout(() => (cleanup(), resolve('timeout')), ms);
      signal?.addEventListener('abort', check, { once: true });
      check();
    });

  async function* exchange(cmd: RingCommand, signal?: AbortSignal): AsyncGenerator<RingEvent> {
    if (closed) throw new RingError('session closed', 'closed');
    if (busy) throw new RingError('another command is running on this ring', 'busy');
    const sig = signal ?? opts.signal;
    if (sig?.aborted) throw abortError();
    busy = true;
    try {
      const c = stamp(cmd);
      const plan = protocol.begin ? protocol.begin(c, state) : { state, expectReply: true };
      state = plan.state;
      await writeFrames(protocol.frame(c, state));
      if (!plan.expectReply) return;
      const quietMs = opts.timers?.quietMs ?? plan.quietMs;
      const stallMs = opts.timers?.stallMs ?? plan.stallMs ?? opts.replyMs ?? 4_000;
      const endAt = Date.now() + (opts.timers?.maxMs ?? plan.maxMs ?? DEFAULT_COMMAND_MS);
      let sawPacket = false;
      let waitEnd = 0;
      let rearm = true;
      for (;;) {
        if (rearm) waitEnd = Date.now() + (sawPacket && quietMs !== undefined ? quietMs : stallMs);
        const ceiling = endAt < waitEnd;
        const got = await nextPacket(Math.max(0, Math.min(waitEnd, endAt) - Date.now()), sig);
        const kind = ceiling || !sawPacket || quietMs === undefined ? 'stall' : 'quiet';
        let r: IngestResult =
          got === 'timeout'
            ? protocol.timeout
              ? protocol.timeout(state, kind)
              : { events: [{ type: 'status', key: 'error', value: `timeout:${cmd.op}` }], state, done: true }
            : protocol.ingest(got.bytes, state, got.channel);
        // The ceiling ends the command whatever the protocol says; one still mid-reply gets the plain timeout error.
        if (got === 'timeout' && ceiling && !r.done) r = { ...r, events: [...r.events, { type: 'status', key: 'error', value: `timeout:${cmd.op}` }], send: undefined, done: true };
        // A timer the protocol answered with `done: false` means "still mid-reply, keep the quiet timer": the real ring
        // pauses inside a history page for longer than the settle time.
        const stillWaiting = got === 'timeout' && protocol.timeout !== undefined && r.done === false;
        // A packet the protocol marks `unrelated` (a push that is not part of this reply) changes neither timer.
        rearm = got === 'timeout' || !r.unrelated;
        sawPacket = got !== 'timeout' ? sawPacket || !r.unrelated : stillWaiting ? sawPacket : false;
        state = r.state;
        if (inHandshake) handshakeEvents.push(...r.events);
        for (const e of r.events) yield e;
        if (r.send?.length) {
          await writeCommands(r.send);
          // An acknowledgement (`op: 'ack'`) answers a packet we have; the ring keeps streaming, so the quiet timer stays.
          // Any other follow-up (a continuation page) starts a fresh reply wait.
          if (!r.send.every((c) => c.op === 'ack')) {
            sawPacket = false;
            rearm = true;
          }
        }
        if (r.done) return;
        if (got === 'timeout' && !r.send?.length && !stillWaiting) return;
      }
    } finally {
      busy = false;
      // Packets that arrived in the last moments of the command belong to the idle stream now.
      for (const p of inbox.splice(0)) onTransport({ type: 'notification', service: gatt.service, characteristic: p.channel, bytes: p.bytes });
    }
  }

  const runtime: SessionRuntime = {
    transport,
    get state() {
      return state;
    },
    async run(cmd, signal) {
      const out: RingEvent[] = [];
      for await (const e of exchange(cmd, signal)) out.push(e);
      return out;
    },
    exchange,
    async read(service, characteristic) {
      try {
        return await transport.read(service, characteristic);
      } catch {
        return undefined;
      }
    },
  };

  const teardown = async (): Promise<void> => {
    closed = true;
    clearInterval(keepaliveTimer);
    poke();
    offTransport();
    for (const u of unsubscribes) await u().catch(() => {});
    await transport.disconnect().catch(() => {});
  };

  // Whether the protocol knows a 'battery' command (probe the framer with the initial state; no I/O).
  let hasBatteryCommand = true;
  try {
    protocol.frame({ op: 'battery', params: { nowMs: clock.now(), tzOffsetS: clock.tzOffsetS() } }, protocol.initialState());
  } catch {
    hasBatteryCommand = false;
  }

  /** Events the ring produced during the handshake (bond request, capabilities, settings): `on()` cannot see them yet. */
  const handshakeEvents: RingEvent[] = [];
  let inHandshake = true;
  let info: HandshakeInfo;
  try {
    info = await family.handshake(runtime, { signal: opts.signal, credential: opts.credential, profile: opts.profile });
  } catch (e) {
    await teardown();
    throw e instanceof RingError ? e : new RingError('handshake failed', 'transport', e);
  }

  inHandshake = false;
  // Opt-in keepalive (Jring 0x3A every 15 s): written outside the `busy` lock through the serialised write path, so it
  // reaches the ring between frames of a sync too. The protocol's `begin` is never called: the read in flight keeps its state.
  const keepalive = family.keepalive;
  if (keepalive) keepaliveTimer = setInterval(() => {
    if (!closed && !dropped) void writeCommands([keepalive.command]).catch(() => {});
  }, keepalive.intervalMs);
  const identity: RingIdentity = ringIdentity({
    family: family.id,
    model: info.model,
    serial: info.serial,
    address: transport.peripheral.address,
    advertisedId: transport.peripheral.id ?? transport.peripheral.name,
  });

  async function* sync(cursor: SyncCursor, onProgress: (p: SyncProgress) => void, signal: AbortSignal, only?: BioStream): AsyncGenerator<RingEvent> {
    if (info.historyBlocked) {
      yield { type: 'status', key: 'error', value: info.historyBlocked };
      onProgress({ fraction: 1 });
      return;
    }
    const feeds = (c: RingCommand, s: BioStream): boolean => c.params?.stream === s || (typeof c.params?.streams === 'string' && c.params.streams.split(',').includes(s));
    const plan = protocol.planSync(cursor, state).filter((c) => only === undefined || feeds(c, only));
    onProgress({ fraction: 0 });
    for (let i = 0; i < plan.length; i++) {
      const cmd = plan[i]!;
      const stage = typeof cmd.params?.stream === 'string' ? cmd.params.stream : cmd.op;
      yield* exchange(cmd, signal);
      yield { type: 'progress', stage, done: i === plan.length - 1 };
      onProgress({ fraction: (i + 1) / plan.length, stage });
    }
  }

  const list = (c: RingCommand | RingCommand[] | undefined): RingCommand[] => (c === undefined ? [] : Array.isArray(c) ? c : [c]);
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  /** Writes `start` (in order, `gapMs` apart), yields what the ring pushes until `signal` aborts, then writes `stop`. */
  async function* stream(start: RingCommand[], stop: RingCommand[], signal: AbortSignal, ceilingMs?: number, gapMs = 0, origin?: 'spot'): AsyncGenerator<RingEvent> {
    if (closed) throw new RingError('session closed', 'closed');
    if (busy) throw new RingError('another command is running on this ring', 'busy');
    busy = true;
    const startedAt = clock.now();
    try {
      for (let i = 0; i < start.length; i++) {
        if (i > 0 && gapMs > 0) await sleep(gapMs);
        const c = stamp(start[i]!);
        if (protocol.begin) state = protocol.begin(c, state).state; // the protocol learns a live run started
        await writeFrames(protocol.frame(c, state));
      }
      for (;;) {
        const left = ceilingMs === undefined ? undefined : Math.max(0, ceilingMs - (clock.now() - startedAt));
        if (left === 0) return;
        let got: { bytes: Uint8Array; channel: Uuid } | 'timeout';
        try {
          got = await nextPacket(left, signal);
        } catch (e) {
          if (e instanceof RingError && e.code === 'aborted') return;
          throw e;
        }
        if (got === 'timeout') return;
        const r = protocol.ingest(got.bytes, state, got.channel);
        state = r.state;
        // Readings during an on-demand measurement are spot readings whatever opcode carries them (J-Style sends them on 0x09).
        for (const e of r.events) yield origin && e.type === 'sample' && e.origin !== 'history' ? { ...e, origin } : e;
        if (r.send?.length) await writeCommands(r.send);
        if (r.done) return;
      }
    } finally {
      busy = false;
      if (stop.length && !closed && !dropped) await writeCommands(stop).catch(() => {});
    }
  }

  return {
    runtime,
    family,
    identity,
    info: () => info,
    async battery() {
      // Families with a battery command answer it; the others expose the standard Battery Service (Jring, 0x2a19).
      let value: number | undefined;
      if (hasBatteryCommand) {
        const evs = await runtime.run({ op: 'battery' });
        const b = evs.find((e) => e.type === 'status' && e.key === 'battery');
        if (b && b.type === 'status' && typeof b.value === 'number') value = b.value;
      }
      if (value === undefined && gatt.battery) {
        const bytes = await runtime.read(gatt.battery.service, gatt.battery.characteristic);
        if (bytes && bytes.length > 0) value = bytes[0];
      }
      if (value !== undefined) info = { ...info, battery: value };
      return value;
    },
    handshakeEvents,
    sync: (cursor, onProgress, signal) => sync(cursor, onProgress, signal),
    readHistory: (s, cursor, signal) => sync(cursor, () => {}, signal, s),
    liveHeartRate(signal) {
      const live = family.liveHeartRate;
      if (!live) throw new RingError(`${family.label} has no live heart rate`, 'unsupported');
      return stream([live.start], [live.stop], signal);
    },
    spot(kind, signal) {
      const cmd = family.spot?.[kind];
      if (!cmd) throw new RingError(`${family.label} cannot measure ${kind} on demand`, 'unsupported');
      const ceiling = opts.spotCeilingMs?.[kind] ?? DEFAULT_SPOT_MS[kind];
      return stream(list(cmd), list(family.spotStop?.[kind]), signal, ceiling, family.spotGapMs, 'spot');
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      if (closed) return;
      await teardown();
    },
  };
}
