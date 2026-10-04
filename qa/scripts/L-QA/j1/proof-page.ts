/*
 * J1 proof page (bundled against L-DESKTOP's sources, evaluated inside the packaged app's window on app://vitals):
 * L-DESKTOP's Electron transport + chooser factory + the J-Style 2301 family from @vitals/rings, like
 * apps/desktop/src/ble/proof/page.ts, plus per-night stage minutes and heart-rate stats for the Lumen comparison.
 * Returns counts, times and aggregates only; never frames, names or addresses (the passcode stays inside the family).
 */
import { jstyle2301, openRingSession, type RingEvent, type Transport } from '@vitals/rings';
import { electronTransport } from '@/biometrics/ble/transports/electron';
import { chooserFactory } from '@/biometrics/ble/transports/rings';

const HOUR = 3_600_000;
const iso = (t: number): string | null => (Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null);

interface Block { start: number; epochMs: number; stages: string[]; complete: boolean }

function hrStats(v: Array<{ t: number; value: number }>) {
  if (!v.length) return { n: 0 };
  const xs = v.map((s) => s.value);
  return { n: v.length, min: Math.min(...xs), max: Math.max(...xs), avg: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10, first: iso(v[0]!.t), last: iso(v.at(-1)!.t) };
}

function summarise(blocks: Block[], hr: Array<{ t: number; value: number }>, other: Record<string, number>, from: number, to: number) {
  blocks.sort((a, b) => a.start - b.start);
  const nights: Array<{ start: number; end: number; minutes: Record<string, number>; blocks: number; complete: boolean; epochMs: number }> = [];
  for (const b of blocks) {
    const end = b.start + b.stages.length * b.epochMs;
    const n = nights.at(-1);
    const cur = n && b.start - n.end <= 2 * HOUR ? n : undefined;
    const tgt = cur ?? { start: b.start, end, minutes: {}, blocks: 0, complete: true, epochMs: b.epochMs };
    if (!cur) nights.push(tgt);
    tgt.end = Math.max(tgt.end, end);
    tgt.blocks++;
    tgt.complete &&= b.complete;
    for (const s of b.stages) tgt.minutes[s] = (tgt.minutes[s] ?? 0) + b.epochMs / 60_000;
  }
  hr.sort((a, b) => a.t - b.t);
  const show = (n: (typeof nights)[number]) => {
    const asleep = Object.entries(n.minutes).filter(([k]) => k !== 'awake' && k !== 'unknown').reduce((s, [, m]) => s + m, 0);
    return { start: iso(n.start), end: iso(n.end), spanMin: Math.round((n.end - n.start) / 60_000), asleepMin: asleep, minutes: n.minutes, blocks: n.blocks, complete: n.complete, hrInside: hrStats(hr.filter((s) => s.t >= n.start && s.t < n.end)) };
  };
  return {
    sleep: { blocks: blocks.length, nights: nights.length, recentNights: nights.slice(-3).map(show) },
    lastNight: nights.at(-1) ? show(nights.at(-1)!) : null,
    hr: { all: hrStats(hr), window: { from: iso(from), to: iso(to), ...hrStats(hr.filter((s) => s.t >= from && s.t < to)) } },
    samplesByStream: other,
  };
}

export async function runJ1Proof(opts: { ringId: string; fromMs: number; toMs: number; reconnect: boolean }): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const t0 = performance.now();
  try {
    const signal = AbortSignal.timeout(300_000);
    const factory = chooserFactory(electronTransport, 'electron');
    out.available = await factory.available();
    const tc = performance.now();
    let raw: Transport;
    if (opts.ringId) raw = await factory.connect({ platformId: opts.ringId }, jstyle2301, signal);
    else {
      let found!: (id: string) => void;
      const first = new Promise<string>((r) => (found = r));
      const scanning = factory.scan([jstyle2301], (ad) => found(ad.platformId), signal);
      const id = await Promise.race([first, scanning.then(() => Promise.reject(new Error('scan ended without a ring')))]);
      raw = await factory.connect({ platformId: id }, jstyle2301, signal);
      await scanning;
    }
    out.connectMs = Math.round(performance.now() - tc);
    const th = performance.now();
    const session = await openRingSession(jstyle2301, raw, { signal });
    out.handshakeMs = Math.round(performance.now() - th);
    const info = session.info();
    out.firmware = info.firmware;
    out.historyBlocked = info.historyBlocked ?? null;
    out.battery = (await session.battery()) ?? null;
    const blocks: Block[] = [];
    const hr: Array<{ t: number; value: number }> = [];
    const other: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const errors: string[] = [];
    let progress = 0;
    const ts = performance.now();
    for await (const e of session.sync({}, () => void progress++, signal) as AsyncIterable<RingEvent>) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      if (e.type === 'sample') {
        other[e.stream] = (other[e.stream] ?? 0) + 1;
        if (e.stream === 'hr') hr.push({ t: e.t, value: e.value });
      } else if (e.type === 'sleepEpochs') blocks.push({ start: e.start, epochMs: (e.epochS ?? 60) * 1000, stages: [...e.stages], complete: e.complete });
      else if (e.type === 'status' && e.key === 'error') errors.push(String(e.value));
    }
    out.syncMs = Math.round(performance.now() - ts);
    out.progressSteps = progress;
    out.byType = byType;
    out.errors = errors;
    Object.assign(out, summarise(blocks, hr, other, opts.fromMs, opts.toMs));
    await session.close();
    if (opts.reconnect) {
      await new Promise((r) => setTimeout(r, 5_000));
      const tr = performance.now();
      const again = await factory.connect({ platformId: opts.ringId || (raw.peripheral.address ?? raw.peripheral.id ?? '') }, jstyle2301, signal);
      const s2 = await openRingSession(jstyle2301, again, { signal });
      out.reconnectMs = Math.round(performance.now() - tr);
      out.reconnectBattery = (await s2.battery()) ?? null;
      await s2.close();
    }
  } catch (e) {
    const x = e as { name?: string; code?: string; reason?: string; message?: string; cause?: { name?: string; message?: string } };
    out.error = `${x.name ?? 'Error'} ${x.code ?? x.reason ?? ''} ${x.message ?? ''}`.trim();
    if (x.cause) out.errorCause = `${x.cause.name ?? 'Error'} ${x.cause.message ?? ''}`.trim();
  }
  out.totalMs = Math.round(performance.now() - t0);
  return out;
}
(globalThis as { runJ1Proof?: typeof runJ1Proof }).runJ1Proof = runJ1Proof;
