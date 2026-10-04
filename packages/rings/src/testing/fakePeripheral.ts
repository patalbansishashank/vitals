/**
 * `FakePeripheral`: a scripted `Transport` for tests and for the shells' development builds (plan 04 item 1 step 5).
 * It replays a family's fixtures: each step expects one written frame and answers with notification frames (delivered
 * asynchronously, in order). Steps come from `qa/fixtures/rings/<family>/sessions.json` (`loadSessions`) or are built in
 * code. No timers unless a step sets `delayMs`. It never prints the frames it receives: a J-Style 0x3C write stays in
 * `writes` as bytes only, and `redactedWrites(protocol)` is the form a test may log.
 */
import { fromHex, type Protocol, type SubscriptionMode, type Transport, type TransportEvent, type Uuid } from '../types';

export interface FakeStep {
  /** Expected write: exact bytes, a hex string ('55 00 … 55'), a prefix (`{ prefix }`) or a predicate. */
  expect: Uint8Array | string | { prefix: Uint8Array | string } | ((bytes: Uint8Array) => boolean);
  /** Notification frames to deliver after the write (hex or bytes). */
  reply?: Array<Uint8Array | string>;
  /** The channel the replies arrive on; default the first subscribed characteristic. */
  channel?: Uuid;
  /** Simulate the ring dropping the link after replying. */
  disconnectAfter?: boolean;
  delayMs?: number;
}

export interface FakePeripheralOptions {
  name?: string;
  address?: string;
  id?: string;
  mtu?: number;
  /** Services `services()` reports (RWfit and CRP decide their framing from these). */
  services?: Uuid[];
  /** Readable characteristics: key `${service}/${characteristic}` (lower-case UUIDs) → bytes. */
  reads?: Record<string, Uint8Array | string>;
}

const asBytes = (v: Uint8Array | string): Uint8Array => (typeof v === 'string' ? fromHex(v) : v);

function matches(e: FakeStep['expect'], b: Uint8Array): boolean {
  if (typeof e === 'function') return e(b);
  if (typeof e === 'object' && !(e instanceof Uint8Array)) {
    const p = asBytes(e.prefix);
    return p.every((v, i) => b[i] === v);
  }
  const x = asBytes(e);
  return x.length === b.length && x.every((v, i) => b[i] === v);
}

export class FakePeripheral implements Transport {
  readonly peripheral: { id?: string; name?: string; address?: string };
  readonly mtu?: number;
  /** Every frame written, in order (bytes only; see `redactedWrites`). */
  readonly writes: Uint8Array[] = [];
  /** Unexpected writes show two header bytes, or only the opcode for an authentication frame. */
  readonly errors: string[] = [];
  connected = true;
  private steps: FakeStep[];
  private listeners = new Set<(ev: TransportEvent) => void>();
  private subscribed: Array<{ service: Uuid; characteristic: Uuid }> = [];
  private readonly reads: Record<string, Uint8Array>;
  private readonly serviceList: Uuid[];

  constructor(steps: FakeStep[] = [], opts: FakePeripheralOptions = {}) {
    this.steps = [...steps];
    this.peripheral = { id: opts.id ?? 'fake-ring', name: opts.name ?? 'Fake ring', address: opts.address };
    this.mtu = opts.mtu;
    this.serviceList = opts.services ?? [];
    this.reads = Object.fromEntries(Object.entries(opts.reads ?? {}).map(([k, v]) => [k.toLowerCase(), asBytes(v)]));
  }

  /** Steps not yet consumed. */
  get remaining(): number {
    return this.steps.length;
  }

  /** Queue more steps while running (a test that drives several commands). */
  script(...steps: FakeStep[]): void {
    this.steps.push(...steps);
  }

  /** Writes as a protocol would log them (the family's `redactOutbound` drops any credential). */
  redactedWrites(protocol: Pick<Protocol, 'redactOutbound'>): Uint8Array[] {
    return this.writes.map((w) => protocol.redactOutbound(w));
  }

  async write(_service: Uuid, _characteristic: Uuid, bytes: Uint8Array, _mode: 'withResponse' | 'withoutResponse'): Promise<void> {
    if (!this.connected) throw new Error('not connected');
    const b = bytes.slice();
    this.writes.push(b);
    const step = this.steps[0];
    if (!step || !matches(step.expect, b)) {
      const prefix = b.subarray(0, b[0] === 0x3c ? 1 : 2);
      this.errors.push(`unexpected write ${Array.from(prefix, (x) => x.toString(16).padStart(2, '0')).join(' ')} …`);
      return;
    }
    this.steps.shift();
    const deliver = (): void => {
      for (const r of step.reply ?? []) this.notify(asBytes(r), step.channel);
      if (step.disconnectAfter) this.drop('fixture');
    };
    if (step.delayMs) setTimeout(deliver, step.delayMs);
    else queueMicrotask(deliver);
  }

  async read(service: Uuid, characteristic: Uuid): Promise<Uint8Array> {
    const v = this.reads[`${service}/${characteristic}`.toLowerCase()];
    if (!v) throw new Error('not readable');
    return v.slice();
  }

  async subscribe(service: Uuid, characteristic: Uuid, _mode: SubscriptionMode): Promise<() => Promise<void>> {
    if (!this.connected) throw new Error('not connected');
    const entry = { service, characteristic };
    this.subscribed.push(entry);
    return async () => {
      this.subscribed = this.subscribed.filter((s) => s !== entry);
    };
  }

  async services(): Promise<Uuid[]> {
    return [...this.serviceList];
  }

  on(listener: (ev: TransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Push an unsolicited notification (a live sample the ring sends on its own). */
  notify(bytes: Uint8Array | string, channel?: Uuid): void {
    const target = channel ?? this.subscribed[0]?.characteristic;
    if (!target) return;
    const service = this.subscribed.find((s) => s.characteristic === target)?.service ?? this.subscribed[0]?.service ?? '';
    const copy = asBytes(bytes).slice();
    for (const l of this.listeners) l({ type: 'notification', service, characteristic: target, bytes: copy });
  }

  /** The ring drops the link. */
  drop(reason?: string): void {
    if (!this.connected) return;
    this.connected = false;
    for (const l of this.listeners) l({ type: 'disconnected', reason });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}

// ---------------------------------------------------------------- fixtures (qa/fixtures/rings/<family>/sessions.json)

export interface FixtureStep {
  /** Hex; `match: 'prefix'`, a trailing space or fewer bytes than a frame means "prefix". */
  expectWrite?: string;
  match?: 'exact' | 'prefix';
  notify?: string[];
  channel?: string;
  disconnectAfter?: boolean;
  /** Delay before the replies are delivered. */
  delayMs?: number;
  /** A negative step: nothing may be written for `waitMs`; the fake skips it, a test asserts on `writes` instead. */
  expectNoWrite?: boolean;
  waitMs?: number;
  note?: string;
}

export interface FixtureSession {
  name: string;
  firmware?: string;
  services?: string[];
  reads?: Record<string, string>;
  steps: FixtureStep[];
}

export interface SessionsFixture {
  family: string;
  sessions: FixtureSession[];
}

/** One fixture step → one fake step. Writes shorter than `frameLength` bytes (or ending in a space) match as a prefix. */
export function stepFromFixture(s: FixtureStep, frameLength = 16): FakeStep | undefined {
  if (s.expectNoWrite || s.expectWrite === undefined) return undefined;
  const bytes = fromHex(s.expectWrite);
  const prefix = s.match === 'prefix' || s.expectWrite.endsWith(' ') || bytes.length < frameLength;
  return { expect: prefix ? { prefix: bytes } : bytes, reply: s.notify, channel: s.channel, disconnectAfter: s.disconnectAfter, delayMs: s.delayMs };
}

/** A fake ring scripted from one session of a family's `sessions.json` (negative `expectNoWrite` steps are skipped). */
export function fakeFromSession(session: FixtureSession, opts: FakePeripheralOptions & { frameLength?: number } = {}): FakePeripheral {
  const { frameLength, ...rest } = opts;
  const steps = session.steps.map((s) => stepFromFixture(s, frameLength)).filter((s): s is FakeStep => s !== undefined);
  return new FakePeripheral(steps, { services: session.services, reads: session.reads, ...rest });
}

/** `sessions.json` of one family, read from `qa/fixtures/rings/<family>/` (tests only; Node). */
export async function loadSessions(repoRoot: string, family: string): Promise<SessionsFixture> {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(`${repoRoot}/qa/fixtures/rings/${family}/sessions.json`, 'utf8')) as SessionsFixture;
}
