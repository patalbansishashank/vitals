/**
 * `RecordedLink`: a scripted `BleLink` for tests. Each step expects one written frame and replies with notification
 * frames (delivered asynchronously, in order). Tier H, no timers unless a step sets `delayMs`.
 */
import type { BleLink, BluetoothServiceUUID } from '@/biometrics/core/ble/types';

export interface RecordedStep {
  /** Expected write: exact bytes, a hex string ('55 00 … 55'), a prefix (`{ prefix }`) or a predicate. */
  expect: Uint8Array | string | { prefix: Uint8Array | string } | ((bytes: Uint8Array) => boolean);
  reply?: Array<Uint8Array | string>;
  /** Simulate the ring dropping the link after replying. */
  disconnectAfter?: boolean;
  delayMs?: number;
}

export const hex = (s: string): Uint8Array => Uint8Array.from((s.replace(/[^0-9a-f]/gi, '').match(/../g) ?? []).map((b) => parseInt(b, 16)));
export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const asBytes = (v: Uint8Array | string): Uint8Array => (typeof v === 'string' ? hex(v) : v);

export class RecordedLink implements BleLink {
  readonly writes: Uint8Array[] = [];
  readonly errors: string[] = [];
  private listeners = new Set<(b: Uint8Array) => void>();
  private dropListeners = new Set<() => void>();
  private steps: RecordedStep[];
  connected = true;
  mtu?: number;
  /** A platform id, as every real link has one (the ring's identity never comes from its advertised name). */
  deviceId?: string = 'recorded-link';

  constructor(
    steps: RecordedStep[],
    readonly deviceName = 'Recorded Ring',
    private readonly reads: Record<string, Uint8Array> = {},
  ) {
    this.steps = [...steps];
  }

  get remaining(): number {
    return this.steps.length;
  }

  async write(_s: BluetoothServiceUUID, _c: BluetoothServiceUUID, bytes: Uint8Array): Promise<void> {
    if (!this.connected) throw new Error('not connected');
    const b = bytes.slice();
    this.writes.push(b);
    const step = this.steps[0];
    if (!step || !matches(step.expect, b)) {
      // a J-Style 0x3C write carries the passcode: only its opcode is ever shown
      this.errors.push(`unexpected write ${b[0] === 0x3c ? '3c …' : toHex(b)}`);
      return;
    }
    this.steps.shift();
    const deliver = (): void => {
      for (const r of step.reply ?? []) this.emit(asBytes(r));
      if (step.disconnectAfter) this.drop();
    };
    if (step.delayMs) setTimeout(deliver, step.delayMs);
    else queueMicrotask(deliver);
  }

  async subscribe(_s: BluetoothServiceUUID, _c: BluetoothServiceUUID, cb: (b: Uint8Array) => void): Promise<() => void> {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async read(_s: BluetoothServiceUUID, c: BluetoothServiceUUID): Promise<Uint8Array> {
    const v = this.reads[String(c)];
    if (!v) throw new Error('not readable');
    return v;
  }

  onDisconnect(cb: () => void): () => void {
    this.dropListeners.add(cb);
    return () => this.dropListeners.delete(cb);
  }

  /** Push an unsolicited notification. */
  emit(b: Uint8Array): void {
    for (const l of this.listeners) l(b.slice());
  }

  drop(): void {
    this.connected = false;
    for (const l of this.dropListeners) l();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}

function matches(e: RecordedStep['expect'], b: Uint8Array): boolean {
  if (typeof e === 'function') return e(b);
  if (typeof e === 'object' && !(e instanceof Uint8Array)) {
    const p = asBytes(e.prefix);
    return p.every((v, i) => b[i] === v);
  }
  const x = asBytes(e);
  return x.length === b.length && x.every((v, i) => b[i] === v);
}
