/**
 * Generic BLE session runner (SUITE_SPEC §4.6). Tier H: no DOM, no navigator; talks only through a `BleLink`.
 *
 * Per command: stamp `nowMs`/`tzOffsetS` → `protocol.begin` → `protocol.frame` → serialized writes → feed every notification
 * to `protocol.ingest` → write its `send` follow-ups → finish on `done`, or on the quiet/stall timers via `protocol.timeout`.
 *
 * Write size: every protocol here writes 16-byte frames, which fit the default 23-byte ATT MTU (20-byte payload), so no
 * chunking happens in practice. Frames longer than the write budget (`link.mtu − 3`, else 20) are split, which only helps
 * protocols that reassemble writes. Chrome exposes no MTU API; whether Chrome Android negotiates a large MTU automatically
 * (needed for the 2301's ~130-byte history notifications) is UNVERIFIED (R10 §4.4).
 * Foreground only: nothing here schedules background work; a session lives while its caller awaits it.
 */
import type { BioStream } from '@/biometrics/core/types';
import type { BleDriver, BleLink, BleSession, ProtocolState, RingCommand, RingDecodedEvent } from '@/biometrics/core/ble/types';

export interface SessionClock {
  now(): number;
  /** Phone UTC offset (s, east positive) at `now`. */
  tzOffsetS(): number;
}

export const systemClock: SessionClock = {
  now: () => Date.now(),
  tzOffsetS: () => -new Date().getTimezoneOffset() * 60,
};

export interface SessionOptions {
  signal?: AbortSignal;
  clock?: SessionClock;
  /** Override the protocol's timers (tests). */
  timers?: { quietMs?: number; stallMs?: number };
  /** Default reply wait when the protocol gives no `stallMs`. */
  replyMs?: number;
  /** Driver handshake run once after subscribing (battery, firmware, auth, clock). */
  handshake?: (rt: SessionRuntime) => Promise<HandshakeInfo>;
}

export interface HandshakeInfo {
  firmware: string;
  battery?: number;
  clockOffsetS: number;
  /** When set, history reads yield one `status:error` with this reason instead of running (e.g. unknown 2301 firmware). */
  historyBlocked?: string;
}

/** Low-level access for driver handshakes. */
export interface SessionRuntime {
  readonly link: BleLink;
  readonly state: ProtocolState;
  /** Runs one command to completion and returns every event it produced. */
  run(cmd: RingCommand, signal?: AbortSignal): Promise<RingDecodedEvent[]>;
  exchange(cmd: RingCommand, signal?: AbortSignal): AsyncGenerator<RingDecodedEvent>;
}

export class BleSessionError extends Error {
  constructor(
    message: string,
    readonly code: 'disconnected' | 'aborted' | 'credential_invalid' | 'auth_rejected' | 'closed',
  ) {
    super(message);
    this.name = 'BleSessionError';
  }
}

/** Optional link capability (Web Bluetooth link and RecordedLink implement it). */
interface DisconnectAware {
  onDisconnect(cb: () => void): () => void;
}
const isDisconnectAware = (l: BleLink): l is BleLink & DisconnectAware => typeof (l as Partial<DisconnectAware>).onDisconnect === 'function';

const abortError = (): BleSessionError => new BleSessionError('aborted', 'aborted');

export async function openSession(driver: BleDriver, link: BleLink, opts: SessionOptions = {}): Promise<BleSession & { runtime: SessionRuntime }> {
  const { protocol } = driver;
  const uuids = driver.gatt;
  if (!uuids) throw new Error(`driver ${driver.id} declares no GATT characteristics`);
  const svc = uuids.service;
  const clock = opts.clock ?? systemClock;
  let state = protocol.initialState();
  let closed = false;
  let dropped = false;
  const inbox: Uint8Array[] = [];
  let wake: (() => void) | null = null;
  const poke = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };

  const unsubscribe = await link.subscribe(svc, uuids.notify, (bytes) => {
    inbox.push(bytes);
    poke();
  });
  const offDisconnect = isDisconnectAware(link)
    ? link.onDisconnect(() => {
        dropped = true;
        poke();
      })
    : () => {};

  const writeBudget = link.mtu ? Math.max(20, link.mtu - 3) : 20;
  let writeChain: Promise<void> = Promise.resolve();
  const writeFrames = (frames: Uint8Array[]): Promise<void> => {
    const job = writeChain.then(async () => {
      for (const f of frames) {
        for (let o = 0; o < f.length; o += writeBudget) await link.write(svc, uuids.write, f.subarray(o, o + writeBudget));
      }
    });
    writeChain = job.catch(() => {});
    return job;
  };

  const stamp = (cmd: RingCommand): RingCommand => ({ ...cmd, params: { nowMs: clock.now(), tzOffsetS: clock.tzOffsetS(), ...cmd.params } });

  /** Waits for a packet, the timer, abort or disconnect. */
  const nextPacket = (ms: number | undefined, signal?: AbortSignal): Promise<Uint8Array | 'timeout'> =>
    new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', check);
        wake = null;
      };
      function check(): void {
        if (signal?.aborted) return cleanup(), reject(abortError());
        if (closed) return cleanup(), reject(new BleSessionError('session closed', 'closed'));
        const b = inbox.shift();
        if (b) return cleanup(), resolve(b);
        if (dropped) return cleanup(), reject(new BleSessionError('link dropped', 'disconnected'));
        wake = check;
      }
      if (ms !== undefined) timer = setTimeout(() => (cleanup(), resolve('timeout')), ms);
      signal?.addEventListener('abort', check, { once: true });
      check();
    });

  async function* exchange(cmd: RingCommand, signal?: AbortSignal): AsyncGenerator<RingDecodedEvent> {
    if (closed) throw new BleSessionError('session closed', 'closed');
    const sig = signal ?? opts.signal;
    if (sig?.aborted) throw abortError();
    const c = stamp(cmd);
    const plan = protocol.begin ? protocol.begin(c, state) : { state, expectReply: true };
    state = plan.state;
    await writeFrames(protocol.frame(c));
    if (!plan.expectReply) return;
    const quietMs = opts.timers?.quietMs ?? plan.quietMs;
    const stallMs = opts.timers?.stallMs ?? plan.stallMs ?? opts.replyMs ?? 4_000;
    let sawPacket = false;
    for (;;) {
      const got = await nextPacket(sawPacket && quietMs !== undefined ? quietMs : stallMs, sig);
      const r =
        got === 'timeout'
          ? protocol.timeout
            ? protocol.timeout(state, sawPacket && quietMs !== undefined ? 'quiet' : 'stall')
            : { events: [{ type: 'status', key: 'error', value: `timeout:${cmd.op}` } as RingDecodedEvent], state, done: true }
          : protocol.ingest(got, state);
      sawPacket = got !== 'timeout';
      state = r.state;
      for (const e of r.events) yield e;
      if (r.send?.length) {
        await writeFrames(r.send.flatMap((s) => protocol.frame(stamp(s))));
        sawPacket = false;
      }
      if (r.done) return;
      if (got === 'timeout' && !r.send?.length) return; // a protocol without `done` hints ends on its first timer
    }
  }

  const runtime: SessionRuntime = {
    link,
    get state() {
      return state;
    },
    async run(cmd, signal) {
      const out: RingDecodedEvent[] = [];
      for await (const e of exchange(cmd, signal)) out.push(e);
      return out;
    },
    exchange,
  };

  let info: HandshakeInfo;
  try {
    info = opts.handshake ? await opts.handshake(runtime) : { firmware: '', clockOffsetS: 0 };
  } catch (e) {
    closed = true;
    unsubscribe();
    offDisconnect();
    await link.disconnect().catch(() => {});
    throw e;
  }

  async function* sync(cursor: Partial<Record<BioStream, string>>, onProgress: (p: number) => void, signal: AbortSignal, only?: BioStream): AsyncGenerator<RingDecodedEvent> {
    if (info.historyBlocked) {
      yield { type: 'status', key: 'error', value: info.historyBlocked };
      onProgress(1);
      return;
    }
    const plan = protocol.planSync(cursor).filter((c) => only === undefined || c.params?.stream === only);
    onProgress(0);
    for (let i = 0; i < plan.length; i++) {
      yield* exchange(plan[i]!, signal);
      onProgress((i + 1) / plan.length);
    }
  }

  return {
    runtime,
    async info() {
      return { firmware: info.firmware, battery: info.battery, clockOffsetS: info.clockOffsetS };
    },
    async battery() {
      const evs = await runtime.run({ op: 'battery' });
      const b = evs.find((e) => e.type === 'status' && e.key === 'battery');
      return b && b.type === 'status' && typeof b.value === 'number' ? (info.battery = b.value) : undefined;
    },
    sync: (cursor, onProgress, signal) => sync(cursor, onProgress, signal),
    readHistory: (stream, since, signal) => sync(since === undefined ? {} : { [stream]: since }, () => {}, signal, stream),
    async close() {
      if (closed) return;
      closed = true;
      poke();
      unsubscribe();
      offDisconnect();
      await link.disconnect();
    },
  };
}
