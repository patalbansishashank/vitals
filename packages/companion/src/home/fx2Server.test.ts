// @vitest-environment node
/**
 * r063 FX2 (final review): fused intervals break at the person's rollover so the app-day adapter places every count, the
 * producer-to-adapter chain included (sR08/aR03); every synchronous derivation read counts in the row budget and the sync
 * coverage read is windowed (sR13/aR17); a Health Connect page reads the installations once (aR17).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFusionContextStore } from './fusionContext.ts';
import { chargeReadBudget, Inputs, ReadBudgetError, ringDetailCompleteDates, withReadBudget } from './gaugeDerive.ts';
import { hcRecord, INSTALL, lumenEvent, ringSteps } from './lumenFixtures.ts';
import { openLumenStore, type LumenStore } from './lumenStore.ts';
import { lumenToolSet } from './lumenTools.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const NOW = Date.parse('2026-10-22T04:00:00Z');
const TZ = 'Asia/Kolkata';
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers are read field by field
type Json = Record<string, any>;

function setup(wrap: (s: LumenStore) => LumenStore = (s) => s) {
  const dir = mkdtempSync(join(TMP, 'fx2-srv-'));
  const store = openLumenStore(join(dir, 'lumen.db'));
  const fc = createFusionContextStore(() => join(dir, 'fusion-context.json'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close());
  const wrapped = wrap(store);
  const tools = lumenToolSet(() => wrapped, TZ, () => NOW, () => fc.get('p'));
  const run = async (name: string, args: Record<string, unknown>) => {
    const env = await tools.call(name, args);
    expect(env.ok, JSON.stringify(env.error ?? null)).toBe(true);
    return env.data as Json;
  };
  const ingest = (events: unknown[]) => {
    const r = store.ingest(INSTALL, events, NOW);
    expect(r.rejected).toEqual([]);
  };
  return { store, fc, run, ingest, tools };
}

/** `n` ring minutes of `steps` from a local Kolkata wall time. */
const ringMinutes = (localIso: string, n: number, steps: number) => {
  const t0 = Date.parse(`${localIso}+05:30`);
  return Array.from({ length: n }, (_, k) => ringSteps(new Date(t0 + k * 60_000).toISOString(), steps));
};

describe('sR08/aR03: fusion breaks merged intervals at the person\'s rollover', () => {
  it('the probe: sixty 100-step minutes 03:30-04:30 become 3,000 on each app day (producer to adapter)', async () => {
    const t = setup();
    t.ingest(ringMinutes('2026-10-21T03:30:00', 60, 100));
    const plain = await t.run('gauge_steps', { from: '2026-10-20', to: '2026-10-21' });
    // without the rollover the minutes merge into one interval and the adapter cannot split it
    expect(plain.intervals.filter((u: Json) => u.steps > 0)).toHaveLength(1);
    t.fc.put('p', { windowStartMs: Date.parse('2026-10-01T00:00:00Z'), windowEndMs: Date.parse('2026-11-01T00:00:00Z'), activities: [], corrections: [], rolloverH: 4 }, NOW);
    const split = await t.run('gauge_steps', { from: '2026-10-20', to: '2026-10-21' });
    expect(split.intervals.filter((u: Json) => u.steps > 0).map((u: Json) => u.steps)).toEqual([3000, 3000]);
    // the calendar-day totals are unchanged; the rollover is part of the context's key (so of the hash and the ETag)
    expect(split.days.map((d: Json) => d.located)).toEqual(plain.days.map((d: Json) => d.located));
    expect(split.inputsHash).not.toBe(plain.inputsHash);
    // the split is at 04:00 local (the importer's app-day rows: src/state/__tests__/fx2StepsRollover.test.ts)
    expect(split.intervals.filter((u: Json) => u.steps > 0).map((u: Json) => Date.parse(u.end))).toEqual([Date.parse('2026-10-21T04:00:00+05:30'), Date.parse('2026-10-21T04:30:00+05:30')]);
  });

  it('an explicit context carries its own rollover (POST /steps/fuse); a bad one is refused', async () => {
    const t = setup();
    t.ingest(ringMinutes('2026-10-21T03:30:00', 60, 100));
    const own = await t.run('gauge_steps', { from: '2026-10-20', to: '2026-10-21', activities: [], rolloverH: 4 });
    expect(own.intervals.filter((u: Json) => u.steps > 0).map((u: Json) => u.steps)).toEqual([3000, 3000]);
    const bad = await t.tools.call('gauge_steps', { from: '2026-10-20', to: '2026-10-21', activities: [], rolloverH: 25 });
    expect(bad.ok).toBe(false);
  });

  it('a coarse span across midnight stays indivisible: counted on the day of its last instant, coverage clipped per day', async () => {
    const t = setup();
    t.ingest([hcRecord('Steps', 'h1', '2026-10-20T23:50:00+05:30', '2026-10-21T00:10:00+05:30', { count: 200 }, { origin: 'com.example' })]);
    const out = await t.run('gauge_steps', { from: '2026-10-20', to: '2026-10-21', activities: [], rolloverH: 4 });
    expect(out.days.map((d: Json) => d.located ?? 0)).toEqual([0, 200]);
    expect(out.days.map((d: Json) => d.coverage.eitherMin)).toEqual([10, 10]);
  });

  it('the fusion-context post stores the rollover', async () => {
    const { fusionContextUpdateOf } = await import('./lumenTools.ts');
    const u = fusionContextUpdateOf({ window: { start: '2026-10-01T00:00', end: '2026-10-02T00:00' }, activities: [], rolloverH: 4.5 }, TZ);
    expect(u).toMatchObject({ rolloverH: 4.5 });
  });
});

describe('sR13/aR17: every derivation read is budgeted and windowed', () => {
  const coverage = (observedIso: string, fromDay: string, toDay: string) =>
    lumenEvent('state/sync', 'coverage.activity_detail', 'health.sync.coverage', observedIso, { stream: 'activity_detail', from: observedIso, to: observedIso, fromDay, toDay, complete: true, reason: 'drained' });

  it('the probe: a one-row budget refuses a many-row coverage read (it was read outside the budget)', () => {
    const t = setup();
    t.ingest(Array.from({ length: 30 }, (_, k) => coverage(new Date(Date.parse('2026-10-20T00:30:00Z') + k * 60_000).toISOString(), '2026-10-19', '2026-10-19')));
    expect(() => withReadBudget(() => ringDetailCompleteDates(t.store, new Inputs(), { fromDate: '2026-10-19', fromMs: Date.parse('2026-10-18T18:30:00Z') }), 1)).toThrow(ReadBudgetError);
    expect(() => withReadBudget(() => chargeReadBudget(2), 1)).toThrow(ReadBudgetError);
  });

  it('coverage reports from long before the asked days are not read at all', () => {
    const t = setup();
    // 40 old reports (each about its own old day) and one about the asked day
    t.ingest([...Array.from({ length: 40 }, (_, k) => coverage(`2026-08-${String(1 + (k % 28)).padStart(2, '0')}T00:${String(10 + k).padStart(2, '0')}:00Z`, '2026-07-31', '2026-07-31')), coverage('2026-10-20T00:30:00Z', '2026-10-12', '2026-10-19')]);
    const got = withReadBudget(() => ringDetailCompleteDates(t.store, new Inputs(), { fromDate: '2026-10-19', fromMs: Date.parse('2026-10-18T18:30:00Z') }), 5);
    // only the asked days on: the report's earlier days are not listed
    expect([...got]).toEqual(['2026-10-19']);
  });

  it('the cadence lookup reads current readings only and counts in the budget', async () => {
    const t = setup();
    // a reading and its newer version (same observed time): one current row
    const at = '2026-10-21T04:00:00Z';
    t.ingest([lumenEvent('metrics/hr', 'hr', 'health.metric.observed', at, { metric: 'hr', value: 80, unit: 'bpm', provenance: 'device_live', cadence_s: 10 }, { receivedAt: '2026-10-21T04:00:01Z' }), lumenEvent('metrics/hr', 'hr', 'health.metric.observed', at, { metric: 'hr', value: 81, unit: 'bpm', provenance: 'device_live', cadence_s: 10 }, { receivedAt: '2026-10-21T04:00:02Z' })]);
    const { metricSamples } = await import('./gaugeDerive.ts');
    const s = withReadBudget(() => metricSamples(t.store, 'hr', Date.parse(at) - 60_000, Date.parse(at) + 60_000, new Inputs()), 2);
    expect(s).toHaveLength(1);
    expect(s[0]!.cadenceS).toBe(10);
  });
});

describe('aR17: a Health Connect page reads the installations once', () => {
  it('not once per record', async () => {
    let calls = 0;
    const t = setup((s) => new Proxy(s, { get: (o, k) => (k === 'installations' ? () => (calls++, o.installations()) : Reflect.get(o, k)) }));
    t.ingest(Array.from({ length: 20 }, (_, k) => hcRecord('Steps', `h${k}`, `2026-10-21T0${k % 9}:00:00+05:30`, `2026-10-21T0${k % 9}:05:00+05:30`, { count: 100 + k }, { origin: 'com.example' })));
    calls = 0;
    const out = await t.run('gauge_hc', { type: 'Steps', from: '2026-10-21', to: '2026-10-21' });
    expect(out.records.length).toBe(20);
    expect(calls).toBeLessThanOrEqual(2);
  });
});
