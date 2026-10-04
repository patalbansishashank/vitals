/**
 * A scripted YCBT ring for the session replays. Unlike `FakePeripheral` it matches writes by content, not position:
 * Lumen's fixtures assume its FIFO write queue (a whole batch queued before any reply is handled), while this port waits
 * for the `02 00` / `02 01` replies, so some writes land in another order. Each fixture write answers with its own
 * notifications whenever it comes. A history query no fixture step expects is answered "no data" and kept apart
 * (`ambient`): the Kotlin tests often stop a walk early, the port walks on. Anything else unexpected is an error.
 */
import { fromHex, toHex, type SubscriptionMode, type Transport, type TransportEvent, type Uuid } from '../../types';
import { YCBT_STREAM, frameLogical } from '../commands';

export interface PoolEntry { hex: string; replies: string[]; used: boolean }

export class ScriptedRing implements Transport {
  readonly peripheral: { id: string; name: string; address: string };
  connected = true;
  /** Accept any write and answer from `canned` (the handshake of a session whose fixture does not script it). */
  prelude: 'all' | 'post-subscription' | 'none' = 'none';
  canned: Record<string, string[]> = {};
  readonly writes: string[] = [];
  readonly scripted: string[] = [];
  readonly ambient: string[] = [];
  readonly errors: string[] = [];
  private listeners = new Set<(ev: TransportEvent) => void>();

  constructor(readonly pool: PoolEntry[], name: string) {
    this.peripheral = { id: 'fake-ycbt', name, address: 'AA:BB:CC:DD:EE:07' };
  }

  get unused(): string[] {
    return this.pool.filter((p) => !p.used).map((p) => p.hex);
  }

  async write(_s: Uuid, _c: Uuid, bytes: Uint8Array): Promise<void> {
    if (!this.connected) throw new Error('not connected');
    const hex = toHex(bytes);
    this.writes.push(hex);
    if (this.prelude === 'all') return this.reply(this.canned[hex] ?? []);
    const entry = this.pool.find((p) => !p.used && p.hex === hex);
    if (entry) {
      entry.used = true;
      this.scripted.push(hex);
      return this.reply(entry.replies);
    }
    if (this.prelude === 'post-subscription' && (hex.startsWith('02 03') || hex.startsWith('01 00'))) return;
    if (bytes[0] === 0x05 && bytes.length === 6) {
      this.ambient.push(hex);
      return this.reply([toHex(frameLogical([0x05, bytes[1]!, 0x00]))]);
    }
    this.errors.push(hex);
  }

  private reply(frames: string[]): void {
    queueMicrotask(() => frames.forEach((f) => this.notify(f)));
  }

  notify(hex: string): void {
    for (const l of this.listeners) l({ type: 'notification', service: '', characteristic: YCBT_STREAM, bytes: fromHex(hex) });
  }

  async read(): Promise<Uint8Array> {
    throw new Error('not readable');
  }
  async subscribe(_s: Uuid, _c: Uuid, _m: SubscriptionMode): Promise<() => Promise<void>> {
    return async () => {};
  }
  on(listener: (ev: TransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
}
