/*
 * The proof page: the app's Electron transport and a ring driver, as the app runs them. Returns counts and times only;
 * written frames are never logged (opcodes only, never the bytes after them).
 *
 *   a5a     (default) `@vitals/rings`: the chooser factory over the Electron transport, `openRingSession` with the
 *           J-Style 2301 family (built-in passcode inside the family)
 *   legacy  the app's current driver (`src/biometrics/ble/drivers.ts`)
 */
import { jstyle2301, openRingSession, type RingEvent, type Transport } from '@vitals/rings';
import { electronTransport } from '@/biometrics/ble/transports/electron';
import { chooserFactory } from '@/biometrics/ble/transports/rings';
import { jstyle2301Driver } from '@/biometrics/ble/drivers';
import type { RingDecodedEvent } from '@/biometrics/core/ble/types';
import type { RingLink } from '@/biometrics/ble/transports/types';

const iso = (t: number): string | null => (Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null);
const local = (t: number): string | null =>
  Number.isFinite(t) && t > 0 ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : null;
const HOUR = 3_600_000;

interface Tally {
  byType: Record<string, number>;
  byStream: Record<string, number>;
  errors: string[];
  blocks: Array<{ start: number; end: number; epochs: number; complete: boolean }>;
  hr: number[];
}

function tally(t: Tally, e: RingEvent | RingDecodedEvent): void {
  t.byType[e.type] = (t.byType[e.type] ?? 0) + 1;
  if (e.type === 'sample') {
    t.byStream[e.stream] = (t.byStream[e.stream] ?? 0) + 1;
    if (e.stream === 'hr') t.hr.push(e.t);
  } else if (e.type === 'sleepEpochs') {
    const epochMs = ('epochS' in e ? e.epochS : 60) * 1000;
    t.blocks.push({ start: e.start, end: e.start + e.stages.length * epochMs, epochs: e.stages.length, complete: e.complete });
  } else if (e.type === 'status' && e.key === 'error') t.errors.push(String(e.value));
}

/** Heart-rate samples from 20:00 to 10:00 local before the latest 10:00: was the ring worn last night at all. */
function overnight(inside: (a: number, b: number) => number): { from: string | null; to: string | null; samples: number } {
  const end = new Date();
  end.setHours(10, 0, 0, 0);
  if (end.getTime() > Date.now()) end.setDate(end.getDate() - 1);
  const to = end.getTime();
  const from = to - 14 * HOUR;
  return { from: local(from), to: local(to), samples: inside(from, to) };
}

/** Sleep blocks closer than two hours make one night; the latest night is "last night". Counts and times only. */
function summarise(t: Tally): Record<string, unknown> {
  const blocks = [...t.blocks].sort((a, b) => a.start - b.start);
  const nights: Array<{ start: number; end: number; epochs: number; blocks: number; complete: boolean }> = [];
  for (const b of blocks) {
    const n = nights.at(-1);
    if (n && b.start - n.end <= 2 * HOUR) {
      n.end = Math.max(n.end, b.end);
      n.epochs += b.epochs;
      n.blocks++;
      n.complete = n.complete && b.complete;
    } else nights.push({ ...b, blocks: 1 });
  }
  const hr = [...t.hr].sort((a, b) => a - b);
  const last = nights.at(-1);
  const inside = (a: number, b: number): number => hr.filter((x) => x >= a && x < b).length;
  const show = (n: (typeof nights)[number]) => ({
    start: iso(n.start), end: iso(n.end), startLocal: local(n.start), endLocal: local(n.end),
    hours: Math.round(((n.end - n.start) / HOUR) * 10) / 10, epochs: n.epochs, blocks: n.blocks, complete: n.complete, hrSamplesInside: inside(n.start, n.end),
  });
  return {
    byType: t.byType,
    byStream: t.byStream,
    errors: t.errors,
    sleep: { blocks: blocks.length, epochs: blocks.reduce((s, b) => s + b.epochs, 0), nights: nights.length, recentNights: nights.slice(-3).map(show) },
    lastNight: last ? show(last) : null,
    hr: { n: hr.length, first: iso(hr[0] ?? NaN), last: iso(hr.at(-1) ?? NaN), last24h: inside(Date.now() - 24 * HOUR, Infinity), overnight: overnight(inside) },
  };
}

/** Wraps a transport's writes and notifications to count them: per write opcode, the replies and the longest gap. */
function counted(t: Transport): { transport: Transport; stats: { writes: number; ops: string[]; notif: number; maxLen: number; perOp: Array<{ op: string; replies: number; maxGapMs: number }> } } {
  const perOp: Array<{ op: string; replies: number; maxGapMs: number; lastAt: number }> = [];
  const stats = { writes: 0, ops: [] as string[], notif: 0, maxLen: 0, perOp: [] as Array<{ op: string; replies: number; maxGapMs: number }> };
  t.on((ev) => {
    if (ev.type !== 'notification') return;
    stats.notif++;
    stats.maxLen = Math.max(stats.maxLen, ev.bytes.length);
    const cur = perOp.at(-1);
    if (!cur) return;
    const now = performance.now();
    cur.maxGapMs = Math.max(cur.maxGapMs, Math.round(now - cur.lastAt));
    cur.lastAt = now;
    cur.replies++;
  });
  const write: Transport['write'] = (s, c, bytes, mode) => {
    stats.writes++;
    const op = (bytes[0] ?? 0).toString(16).padStart(2, '0');
    if (stats.ops.at(-1) !== op) stats.ops.push(op);
    perOp.push({ op, replies: 0, maxGapMs: 0, lastAt: performance.now() });
    stats.perOp = perOp.map(({ op: o, replies, maxGapMs }) => ({ op: o, replies, maxGapMs }));
    return t.write(s, c, bytes, mode);
  };
  return { transport: Object.assign(Object.create(t) as Transport, { write, on: t.on.bind(t), subscribe: t.subscribe.bind(t), read: t.read.bind(t), disconnect: t.disconnect.bind(t) }), stats: new Proxy(stats, { get: (o, k) => (k === 'perOp' ? perOp.map(({ op, replies, maxGapMs }) => ({ op, replies, maxGapMs })) : o[k as keyof typeof o]) }) };
}

async function runA5a(ringId: string, out: Record<string, unknown>, quietMs?: number): Promise<void> {
  const signal = AbortSignal.timeout(280_000);
  const factory = chooserFactory(electronTransport, 'electron');
  out.available = await factory.available();
  const tc = performance.now();
  let raw: Transport;
  if (ringId) raw = await factory.connect({ platformId: ringId }, jstyle2301, signal);
  else {
    // no address given: the first ring the platform lists, picked the way the scan list would
    let found!: (id: string) => void;
    const first = new Promise<string>((r) => (found = r));
    const scanning = factory.scan([jstyle2301], (ad) => found(ad.platformId), signal);
    const id = await Promise.race([first, scanning.then(() => Promise.reject(new Error('scan ended without a ring')))]);
    raw = await factory.connect({ platformId: id }, jstyle2301, signal);
    await scanning;
  }
  out.connectMs = Math.round(performance.now() - tc);
  out.addressKnown = Boolean(raw.peripheral.address);
  const { transport, stats } = counted(raw);
  const th = performance.now();
  const session = await openRingSession(jstyle2301, transport, { signal, ...(quietMs ? { timers: { quietMs } } : {}) });
  if (quietMs) out.quietMs = quietMs;
  out.handshakeMs = Math.round(performance.now() - th);
  const info = session.info();
  out.firmware = info.firmware;
  out.authAccepted = info.firmware === 'V0789' ? 'yes (the V0789 handshake throws auth_rejected otherwise)' : 'not needed';
  out.historyBlocked = info.historyBlocked ?? null;
  out.identityBasis = session.identity.basis;
  out.handshakeBattery = info.battery ?? null;
  const tb = performance.now();
  out.battery = (await session.battery()) ?? null;
  out.batteryMs = Math.round(performance.now() - tb);
  const t: Tally = { byType: {}, byStream: {}, errors: [], blocks: [], hr: [] };
  const progress: string[] = [];
  const ts = performance.now();
  for await (const e of session.sync({}, (p) => progress.push(`${p.fraction.toFixed(2)}@${Math.round(performance.now() - ts)}`), signal)) tally(t, e);
  out.syncMs = Math.round(performance.now() - ts);
  out.progressSteps = progress.length;
  Object.assign(out, summarise(t));
  out.link = { writes: stats.writes, ops: stats.ops, notif: stats.notif, maxLen: stats.maxLen, perOp: stats.perOp };
  await session.close();

  // a second connection without any list or click: what reconnecting at start does
  await new Promise((r) => setTimeout(r, 5_000));
  const tr = performance.now();
  const again = await factory.connect({ platformId: ringId || (raw.peripheral.address ?? raw.peripheral.id ?? '') }, jstyle2301, signal);
  const s2 = await openRingSession(jstyle2301, again, { signal });
  out.reconnectMs = Math.round(performance.now() - tr);
  out.reconnectFirmware = s2.info().firmware;
  out.reconnectBattery = (await s2.battery()) ?? null;
  await s2.close();
}

async function runLegacy(ringId: string, out: Record<string, unknown>): Promise<void> {
  out.available = await electronTransport.isAvailable();
  const tr = performance.now();
  const link: RingLink = ringId ? await electronTransport.reconnect!(ringId, jstyle2301Driver) : await electronTransport.requestDevice(jstyle2301Driver, { scanMs: 45_000 });
  out.connectMs = Math.round(performance.now() - tr);
  const t0 = performance.now();
  const session = await jstyle2301Driver.open(link, {});
  out.handshakeMs = Math.round(performance.now() - t0);
  const info = await session.info();
  out.firmware = info.firmware;
  out.battery = info.battery ?? null;
  const t: Tally = { byType: {}, byStream: {}, errors: [], blocks: [], hr: [] };
  const ts = performance.now();
  for await (const e of session.sync({}, () => {}, AbortSignal.timeout(180_000)) as AsyncIterable<RingDecodedEvent>) tally(t, e);
  out.syncMs = Math.round(performance.now() - ts);
  Object.assign(out, summarise(t));
  await session.close();
}

export async function runProof(opts: { kind: string; ringId: string; quietMs?: number }): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { kind: opts.kind };
  const t0 = performance.now();
  try {
    await (opts.kind === 'legacy' ? runLegacy(opts.ringId, out) : runA5a(opts.ringId, out, opts.quietMs));
  } catch (e) {
    const x = e as { name?: string; code?: string; reason?: string; message?: string; cause?: { name?: string; message?: string } };
    out.error = `${x.name ?? 'Error'} ${x.code ?? x.reason ?? ''} ${x.message ?? ''}`.trim();
    if (x.cause) out.errorCause = `${x.cause.name ?? 'Error'} ${x.cause.message ?? ''}`.trim();
  }
  out.totalMs = Math.round(performance.now() - t0);
  return out;
}
(globalThis as { runProof?: typeof runProof }).runProof = runProof;
