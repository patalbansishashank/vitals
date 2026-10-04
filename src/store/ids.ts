/** Identifiers: ULIDs (SUITE_SPEC §0.1 `Id`), device ids and hybrid-logical-clock revisions (tier H). */
import type { DeviceId, Id, Rev } from './types';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(out);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

function base32(bytes: Uint8Array, chars: number): string {
  let s = '';
  for (let i = 0; i < chars; i++) s += CROCKFORD[bytes[i % bytes.length]! & 31];
  return s;
}

let lastMs = -1;
let lastRandom: number[] = [];

/** ULID: 10 chars of milliseconds + 16 random chars, monotonic within one millisecond. */
export function ulid(nowMs: number = Date.now()): Id {
  let time = '';
  let t = Math.max(0, Math.floor(nowMs));
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  if (nowMs === lastMs && lastRandom.length === 16) {
    // increment the random part (monotonic ULIDs)
    for (let i = 15; i >= 0; i--) {
      if (lastRandom[i]! < 31) {
        lastRandom[i] = lastRandom[i]! + 1;
        break;
      }
      lastRandom[i] = 0;
    }
  } else {
    lastMs = nowMs;
    lastRandom = Array.from(randomBytes(16), (b) => b & 31);
  }
  return time + lastRandom.map((v) => CROCKFORD[v]).join('');
}

/** 16 chars of Crockford base32. */
export function newDeviceId(): DeviceId {
  return base32(randomBytes(16), 16);
}

/**
 * HLC revision `${ms 13}-${counter hex 4}-${device}`: string order = causal order on one device, and ties between
 * devices break by device id (the same format the Evolu adapter uses).
 */
export function createHlc(device: DeviceId): (nowMs?: number) => Rev {
  let last = 0;
  let counter = 0;
  return (nowMs = Date.now()) => {
    if (nowMs > last) {
      last = nowMs;
      counter = 0;
    } else counter += 1;
    return `${String(last).padStart(13, '0')}-${counter.toString(16).padStart(4, '0')}-${device}`;
  };
}
