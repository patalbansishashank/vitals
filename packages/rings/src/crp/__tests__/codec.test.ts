// @vitest-environment node
/**
 * CRP golden vectors: `encode.json` byte-exact through `protocol.frame`, `decode.json` through the decoder layers the
 * fixture names (decoder, assembler, driver, header), then the mapping onto `RingEvent`s through `protocol.ingest`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromHex, toHex, type RingCommand, type RingEvent } from '../../types';
import { CMD, CRP_CMD_NOTIFY, CRP_STEPS_NOTIFY, GROUP, crpFrame, frameLength, isFrameStart } from '../commands';
import { EMPTY_ASSEMBLY, assemble, decodeCrp, type CrpAssembly } from '../decoder';
import { crp } from '../family';
import type { CrpState } from '../protocol';

const FIX = join(__dirname, '../../../../..', 'qa/fixtures/rings/crp');
const load = <T>(f: string): T => JSON.parse(readFileSync(join(FIX, f), 'utf8')) as T;

interface EncodeVector { name: string; command: RingCommand; frame: string }
interface DecodeVector {
  name: string;
  context: { layer: 'decoder' | 'assembler' | 'driver' | 'header'; channel?: string; now?: string; zone?: string };
  bytes?: string;
  bytesSequence?: string[];
  match: string;
  events: Array<Record<string, unknown>>;
  eventsPerChunk?: Array<Array<Record<string, unknown>>>;
}

describe('CRP encode vectors (encode.json)', () => {
  const { vectors } = load<{ vectors: EncodeVector[] }>('encode.json');
  it('has the 59 vectors', () => expect(vectors).toHaveLength(59));
  for (const v of vectors) {
    it(v.name, () => {
      const frames = crp.protocol.frame(v.command, crp.protocol.initialState());
      expect(frames.map((f) => toHex(f.bytes))).toEqual([v.frame]);
    });
  }
});

// ---------------------------------------------------------------- decode

type Ev = Record<string, unknown>;
const FALLBACK_NOW = Date.parse('2026-07-24T12:00:00Z');

/** Runs one vector through the layer it names; returns the events per chunk. */
function run(v: DecodeVector): Ev[][] {
  const ctx = { nowMs: v.context.now ? Date.parse(v.context.now) : FALLBACK_NOW, tzOffsetS: 0 };
  const channel = v.context.channel ?? CRP_CMD_NOTIFY;
  const chunks = (v.bytesSequence ?? [v.bytes!]).map(fromHex);
  if (v.context.layer === 'header') {
    const kind = v.events[0]?.kotlin;
    return [[kind === 'CRPProtocol.frameLength' ? { kotlin: kind, value: frameLength(chunks[0]!) } : { kotlin: 'CRPProtocol.isFrameStart', value: isFrameStart(chunks[0]!) }]];
  }
  if (v.context.layer === 'decoder') return [decodeCrp(chunks[0]!, channel, ctx) as unknown as Ev[]];
  let asm: CrpAssembly = EMPTY_ASSEMBLY;
  return chunks.map((c) => {
    if (v.context.layer === 'driver' && !channel.includes('fdd3')) return decodeCrp(c, channel, ctx) as unknown as Ev[];
    const r = assemble(asm, c);
    asm = r.asm;
    if (v.context.layer === 'assembler') return r.frame ? [{ kotlin: 'CRPFrameAssembler.frame', bytes: toHex(r.frame) }] : [];
    return r.frame ? (decodeCrp(r.frame, channel, ctx) as unknown as Ev[]) : [{ kotlin: 'FramePending', startsFrame: isFrameStart(c) }];
  });
}

function rle(stages: string[]): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const s of stages) {
    const last = out[out.length - 1];
    if (last && last[0] === s) last[1]++;
    else out.push([s, 1]);
  }
  return out;
}

/** Only the fields the fixture lists are checked; ISO times become epoch ms; sleep has summary fields. */
function same(got: Ev | undefined, want: Ev): void {
  expect(got?.kotlin).toBe(want.kotlin);
  for (const [k, w] of Object.entries(want)) {
    if (k === 'kotlin') continue;
    if (k === 'commandId') expect(got!.commandId).toBe(w);
    else if (k === 't') expect(got!.t).toBe(Date.parse(w as string));
    else if (k === 'stagesCount') expect((got!.stages as string[]).length).toBe(w);
    else if (k === 'firstStage') expect((got!.stages as string[])[0]).toBe(w);
    else if (k === 'stageCounts') {
      const counts: Record<string, number> = {};
      for (const s of got!.stages as string[]) counts[s] = (counts[s] ?? 0) + 1;
      expect(counts).toEqual(w);
    } else if (k === 'stagesRle') expect(rle(got!.stages as string[])).toEqual(w);
    else expect(got![k]).toEqual(w);
  }
}

function check(decoded: Ev[], want: Ev[], match: string): void {
  for (const part of match.split('+')) {
    if (part === 'exact' || part === 'counts') {
      expect(decoded).toHaveLength(want.length);
      decoded.forEach((d, i) => (part === 'exact' ? same(d, want[i]!) : expect(d.kotlin).toBe(want[i]!.kotlin)));
    } else if (part === 'first') same(decoded[0], want[0]!);
    else if (part.startsWith('only:')) {
      const cls = part.slice(5);
      const kept = decoded.filter((d) => d.kotlin === cls);
      const w = want.filter((e) => e.kotlin === cls);
      expect(kept).toHaveLength(w.length);
      kept.forEach((d, i) => same(d, w[i]!));
    } else if (part.startsWith('none:')) expect(decoded.filter((d) => d.kotlin === part.slice(5))).toEqual([]);
    else throw new Error(`unknown match ${part}`);
  }
}

describe('CRP decode vectors (decode.json)', () => {
  const { vectors } = load<{ vectors: DecodeVector[] }>('decode.json');
  it('has the 72 vectors', () => expect(vectors).toHaveLength(72));
  for (const v of vectors) {
    it(v.name, () => {
      const per = run(v);
      check(per.flat(), v.events, v.match);
      if (v.eventsPerChunk) {
        expect(per).toHaveLength(v.eventsPerChunk.length);
        per.forEach((p, i) => check(p, v.eventsPerChunk![i]!, 'exact'));
      }
    });
  }
});

// ---------------------------------------------------------------- mapping onto RingEvent (through protocol.ingest)

const NOW = Date.parse('2026-07-24T12:00:00Z');
const idle = (tzOffsetS = 0): CrpState => ({ ...(crp.protocol.initialState() as CrpState), nowMs: NOW, tzOffsetS, firmware: 'MOY-R1K3-2.1.6' });
const ingest = (hex: string, channel?: string, st: CrpState = idle()): RingEvent[] => crp.protocol.ingest(fromHex(hex), st, channel).events;
const slots = (n: number, fill: Record<number, number>): string => toHex(Uint8Array.from({ length: n }, (_, i) => fill[i] ?? 0));

describe('CRP RingEvent mapping', () => {
  it('spot and live results become samples with the Kotlin units, timed by the phone clock', () => {
    expect(ingest('fd da 10 07 01 09 4a')).toEqual([{ type: 'sample', stream: 'hr', t: NOW, value: 74, unit: 'bpm', origin: 'live' }]);
    expect(ingest('fd da 10 07 01 0a 2d')).toEqual([{ type: 'sample', stream: 'hrv', t: NOW, value: 45, unit: 'ms', origin: 'live' }]);
    expect(ingest('fd da 10 07 01 0b 62')).toEqual([{ type: 'sample', stream: 'spo2', t: NOW, value: 98, unit: 'pct', origin: 'live' }]);
    expect(ingest('fd da 10 07 01 0e 25')).toEqual([{ type: 'vendor', key: 'stress', t: NOW, value: 37, unit: 'score', origin: 'live' }]);
    expect(ingest('fd da 10 08 01 20 6d 01')).toEqual([{ type: 'sample', stream: 'skin_temp', t: NOW, value: 36.5, unit: 'degC', origin: 'live' }]);
  });

  it('the fdd1 push is today\'s running total at the local midnight (UTC+2)', () => {
    expect(ingest('e8 03 00 f4 01 00 2a 00 00', CRP_STEPS_NOTIFY, idle(7200))).toEqual([
      { type: 'dailyTotal', localDay: Date.parse('2026-07-23T22:00:00Z'), steps: 1000, distanceM: 500, kcal: 42 },
    ]);
  });

  it('history slots are samples at local midnight + slot × 5 min; stress is a vendor value', () => {
    const hr = ingest(`fd da 10 98 02 0f 01 00 ${slots(144, { 6: 55 })}`);
    expect(hr).toEqual([{ type: 'sample', stream: 'hr', t: Date.parse('2026-07-23T00:30:00Z'), value: 55, unit: 'bpm', origin: 'history' }]);
    const temp = ingest('fd da 10 0c 02 16 00 03 6d 01 18 01');
    expect(temp.map((e) => (e.type === 'sample' ? [e.stream, e.value, e.unit, e.t] : null))).toEqual([
      ['skin_temp', 36.5, 'degC', Date.parse('2026-07-24T18:00:00Z')],
      ['skin_temp', 28, 'degC', Date.parse('2026-07-24T18:05:00Z')],
    ]);
    expect(ingest(`fd da 10 98 02 2f 00 01 ${slots(144, { 0: 25 })}`)).toEqual([
      { type: 'vendor', key: 'stress', t: Date.parse('2026-07-24T12:00:00Z'), value: 25, unit: 'score', origin: 'history' },
    ]);
  });

  it('sleep becomes minute epochs with the vendor codes; a past wake day is complete', () => {
    const today = ingest('fd da 10 13 02 0e 00 01 00 1e 05 01 00 02 01 14 00 02 00');
    expect(today).toHaveLength(1);
    const e = today[0]!;
    expect(e.type === 'sleepEpochs' && { start: e.start, n: e.stages.length, first: e.stages[0], codes: [...new Set(e.rawCodes)], complete: e.complete, fw: e.firmware }).toEqual({
      start: Date.parse('2026-07-24T00:30:00Z'), n: 90, first: 'light', codes: [1, 5, 2], complete: false, fw: 'MOY-R1K3-2.1.6',
    });
    expect(e.type === 'sleepEpochs' && e.stages[30]).toBe('unknown');
    const past = ingest('fd da 10 0d 02 0e 01 01 01 00 00 08 00');
    expect(past[0]?.type === 'sleepEpochs' && past[0].complete).toBe(true);
  });

  it('housekeeping: firmware, capabilities, not worn, acks with the full group and command', () => {
    expect(ingest('fd da 10 14 03 03 4d 4f 59 2d 52 31 4b 33 2d 32 2e 31 2e 36')).toEqual([{ type: 'status', key: 'firmware', value: 'MOY-R1K3-2.1.6' }]);
    expect(ingest('fd da 10 07 02 25 02')).toEqual([{ type: 'status', key: 'capabilities', value: 'spo2' }]);
    expect(ingest('fd da 10 07 02 25 00')).toEqual([{ type: 'status', key: 'capabilities', value: '' }]);
    expect(ingest('fd da 10 07 03 07 00')).toEqual([{ type: 'status', key: 'error', value: 'not_worn' }]);
    expect(ingest('fd da 10 07 03 07 01')).toEqual([]);
    expect(ingest('fd da 10 07 07 01 00')).toEqual([{ type: 'status', key: 'ack', value: 'crp:7/1' }]);
    expect(ingest('fd da 10 07 02 06 05')).toEqual([{ type: 'status', key: 'ack', value: 'crp:2/6' }]);
  });

  it('a split frame waits in state (serialisable) and decodes once whole', () => {
    const a = crp.protocol.ingest(fromHex('fd da 10 07'), idle());
    expect(a.events).toEqual([]);
    expect(JSON.parse(JSON.stringify(a.state))).toEqual(a.state);
    expect(crp.protocol.ingest(fromHex('01 09 50'), a.state).events).toEqual([{ type: 'sample', stream: 'hr', t: NOW, value: 80, unit: 'bpm', origin: 'live' }]);
  });

  it('frames are logged as they are (no credential)', () => {
    const f = fromHex('fd da 10 07 01 09 01');
    expect(crp.protocol.redactOutbound(f)).toEqual(f);
  });
});

describe('CRP days across a daylight-saving change (Europe/Berlin, clocks back on 2026-10-25)', () => {
  // Read on 10-24 at noon (+02:00) and on 10-26 at noon (+01:00): the same 10-24 data is day 0, then day 2.
  const on24 = { nowMs: Date.parse('2026-10-24T10:00:00Z'), tzOffsetS: 7200, tz: 'Europe/Berlin' };
  const on26 = { nowMs: Date.parse('2026-10-26T11:00:00Z'), tzOffsetS: 3600, tz: 'Europe/Berlin' };
  const times = (out: ReturnType<typeof decodeCrp>): number[] => out.flatMap((d) => ('t' in d ? [d.t] : []));

  it('a timing-history slot of 10-24 lands on the same instant whether read on 10-24 or on 10-26', () => {
    const hr = (day: number) => crpFrame(GROUP.HISTORY, CMD.HISTORY_HR, [day, 0, 0, 0, 72]); // slot 2 = 00:10 local
    expect(times(decodeCrp(hr(0), CRP_CMD_NOTIFY, on24))).toEqual([Date.parse('2026-10-23T22:10:00Z')]);
    expect(times(decodeCrp(hr(2), CRP_CMD_NOTIFY, on26))).toEqual([Date.parse('2026-10-23T22:10:00Z')]);
  });

  it('a night that woke on 10-24 starts at the same instant either way', () => {
    // 23:00 light, 06:00 awake: began the evening before the wake day.
    const sleep = (day: number) => crpFrame(GROUP.HISTORY, CMD.HISTORY_SLEEP, [day, 1, 23, 0, 0, 6, 0]);
    expect(times(decodeCrp(sleep(0), CRP_CMD_NOTIFY, on24))).toEqual([Date.parse('2026-10-23T21:00:00Z')]);
    expect(times(decodeCrp(sleep(2), CRP_CMD_NOTIFY, on26))).toEqual([Date.parse('2026-10-23T21:00:00Z')]);
  });
});
