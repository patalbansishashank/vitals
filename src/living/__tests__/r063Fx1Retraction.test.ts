// @vitest-environment node
/**
 * 0.6.3 FX1 (final review sR03/aR05): deleting the last step or sleep evidence used to leave the imported actual in force
 * (a day without coverage was simply not written, so its old entry was never reconsidered). Now a day the server answered
 * in full without a reading retracts the imported entry; nothing is inferred without such an answer (offline, a failed
 * read); the import's own retraction never blocks the evidence coming back, the person's removal still does.
 */
import { describe, expect, it } from 'vitest';
import { gaugeKey, planGaugeImport, type GaugeImportInput } from '../gaugeImport';
import { effectiveEntries, projectEntries } from '../logs';
import type { LogEntry } from '../types';

const TZ = 'Asia/Kolkata';
const TODAY = '2026-10-20';
const NOW = '2026-10-20T12:00:00.000Z';
const Y = '2026-10-19';

function apply(entries: LogEntry[], input: Partial<GaugeImportInput>): { entries: LogEntry[]; plan: ReturnType<typeof planGaugeImport> } {
  const plan = planGaugeImport({ entries, steps: [], sleep: [], tz: TZ, today: TODAY, now: NOW, ...input });
  const next = [...entries];
  for (const c of plan.create) if (!next.some((e) => e.id === c.id)) next.push({ ...c.entry, id: c.id } as LogEntry);
  return { entries: next, plan };
}
const steps = (es: LogEntry[], date: string) => projectEntries(es).filter((e) => e.kind === 'steps' && e.date === date);
const sleeps = (es: LogEntry[]) => effectiveEntries(es).filter((e) => e.kind === 'sleep');
const fusedDay = (date: string, n: number) => ({ date, steps: n, fusion: { version: 'steps-fuse/1', located: n, headlinePolicy: 'atLeast' as const, coverage: { ringMin: 30, phoneMin: 0, eitherMin: 30, unknownMin: 0 } } });
const night = (start: string, end: string, asleepMinutes = 400) => ({ wakingDate: Y, start, end, asleepMinutes });

describe('sR03/aR05: steps', () => {
  it('the probe: the only evidence of a day is deleted; the next answer has no reading, and the imported total is retracted', () => {
    const a = apply([], { steps: [fusedDay(Y, 6000)] });
    expect(steps(a.entries, Y).map((e) => (e as { steps: number }).steps)).toEqual([6000]);
    // the server answered the day (and its small hours) in full, without steps or coverage
    const b = apply(a.entries, { steps: [], answered: { steps: [Y] } });
    expect(b.plan.create).toHaveLength(1);
    expect(b.plan.create[0]).toMatchObject({ key: gaugeKey('steps', Y), stream: 'steps', entry: { kind: 'retract', source: { app: 'gauge', actorId: 'gauge-import' } } });
    // the reproduction: 6000 steps stayed in force
    expect(steps(b.entries, Y)).toEqual([]);
    // the same answer again writes nothing more
    expect(apply(b.entries, { steps: [], answered: { steps: [Y] } }).plan.create).toEqual([]);
    // the evidence comes back: imported again (the import's own retraction never blocks it)
    const c = apply(b.entries, { steps: [fusedDay(Y, 5000)], answered: { steps: [Y] } });
    expect(steps(c.entries, Y).map((e) => (e as { steps: number }).steps)).toEqual([5000]);
  });

  it('without an authoritative answer nothing is retracted (offline, a failed read, a day not answered)', () => {
    const a = apply([], { steps: [fusedDay(Y, 6000)] });
    expect(apply(a.entries, { steps: [] }).plan.create).toEqual([]);
    expect(apply(a.entries, { steps: [], answered: { steps: [TODAY] } }).plan.create).toEqual([]);
    expect(apply(a.entries, { steps: [], answered: {} }).plan.create).toEqual([]);
  });

  it('an unsupported zero is no reading either (retracted), a supported zero replaces the count (unchanged rule)', () => {
    const a = apply([], { steps: [fusedDay(Y, 6000)] });
    const zero = { date: Y, steps: 0, fusion: { version: 'steps-fuse/1', located: 0, headlinePolicy: 'atLeast' as const, coverage: { ringMin: 0, phoneMin: 0, eitherMin: 0, unknownMin: 0 } } };
    expect(apply(a.entries, { steps: [zero], answered: { steps: [Y] } }).plan.create[0]!.entry.kind).toBe('retract');
    const supported = apply(a.entries, { steps: [fusedDay(Y, 0)], answered: { steps: [Y] } });
    expect(supported.plan.create[0]!.entry).toMatchObject({ kind: 'steps', steps: 0 });
  });

  it('the person removing a day keeps it removed; a correction older than the window is listed, not retracted', () => {
    const a = apply([], { steps: [fusedDay(Y, 6000)] });
    const head = steps(a.entries, Y)[0]!;
    const removed = [...a.entries, { id: 'R1', date: Y, tz: TZ, at: NOW, recordedAt: NOW, kind: 'retract', target: head.id, source: { by: 'user', method: 'typed' } } as LogEntry];
    expect(apply(removed, { steps: [fusedDay(Y, 5000)], answered: { steps: [Y] } }).plan.skipped).toEqual([expect.objectContaining({ reason: 'removed' })]);
    const old = '2026-09-01';
    const o = apply([], { steps: [fusedDay(old, 6000)], today: old });
    expect(apply(o.entries, { steps: [], answered: { steps: [old] } }).plan).toMatchObject({ create: [], skipped: [expect.objectContaining({ reason: 'changedUpstream' })] });
  });
});

describe('sR03/aR05: sleep', () => {
  const bed = '2026-10-18T23:10:00+05:30';
  const wake = '2026-10-19T06:52:00+05:30';
  it('a night no session overlaps any more, on a wake date the read covered, is retracted; an answer elsewhere keeps it', () => {
    const a = apply([], { sleep: [night(bed, wake)] });
    expect(sleeps(a.entries)).toHaveLength(1);
    expect(apply(a.entries, { sleep: [], answered: { sleep: { from: '2026-10-01', to: '2026-10-18' } } }).plan.create).toEqual([]);
    expect(apply(a.entries, { sleep: [] }).plan.create).toEqual([]);
    const b = apply(a.entries, { sleep: [], answered: { sleep: { from: '2026-10-01', to: TODAY } } });
    expect(b.plan.create).toEqual([expect.objectContaining({ key: gaugeKey('sleep', Y), stream: 'sleep', entry: expect.objectContaining({ kind: 'retract' }) })]);
    expect(sleeps(b.entries)).toEqual([]);
  });

  it('a night still overlapped by a session (going on, or revised) is never retracted', () => {
    const a = apply([], { sleep: [night(bed, wake)] });
    // the same night, revised to end later: superseded, not retracted
    const revised = apply(a.entries, { sleep: [night(bed, '2026-10-19T07:30:00+05:30')], answered: { sleep: { from: '2026-10-01', to: TODAY } } });
    expect(revised.plan.create.map((c) => c.entry.kind)).toEqual(['sleep']);
    // a session overlapping it that is not complete yet keeps it too
    const going = apply(a.entries, { sleep: [night(bed, '2026-10-20T17:20:00+05:30')], answered: { sleep: { from: '2026-10-01', to: TODAY } } });
    expect(going.plan.create).toEqual([]);
  });
});
