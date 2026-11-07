/**
 * r063 FX2 (final review sR08/aR03): steps across the person's rollover, producer to importer. The import posts the
 * rollover with the fusion context (and an explicit `steps/fuse`), the server breaks merged intervals there, and the
 * importer's app-day rows (`fusedStepsDays` → `appDayStepsOf`) place counts and coverage by one contract.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adaptGaugeData, type GaugeApi, type GaugeSteps, type GaugeV2Api } from '@/net/gauge';
import { fusedStepsDays, runGaugeImport, type GaugeImportDeps } from '../gaugeImport';
import { openLumenStore } from '../../../packages/companion/src/home/lumenStore.ts';
import { lumenToolSet } from '../../../packages/companion/src/home/lumenTools.ts';
import { hcRecord, INSTALL, ringSteps } from '../../../packages/companion/src/home/lumenFixtures.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const TZ = 'Asia/Kolkata';
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

/** The companion's `gauge_steps` answer (the POST /steps/fuse body as args), as the client receives it. */
async function serverSteps(events: unknown[], args: Record<string, unknown>): Promise<GaugeSteps> {
  const dir = mkdtempSync(join(TMP, 'fx2-steps-'));
  const store = openLumenStore(join(dir, 'lumen.db'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close());
  expect(store.ingest(INSTALL, events, Date.parse('2026-10-22T00:00:00Z')).rejected).toEqual([]);
  const env = await lumenToolSet(() => store, TZ, () => Date.parse('2026-10-22T00:00:00Z')).call('gauge_steps', { from: '2026-10-20', to: '2026-10-21', tz: TZ, activities: [], ...args });
  expect(env.ok).toBe(true);
  return adaptGaugeData('/v1/gauge/steps', JSON.parse(JSON.stringify(env.data)) as Record<string, unknown>) as unknown as GaugeSteps;
}
const ringMinutes = (localIso: string, n: number, steps: number) => Array.from({ length: n }, (_, k) => ringSteps(new Date(Date.parse(`${localIso}+05:30`) + k * 60_000).toISOString(), steps));

describe('sR08/aR03: producer to importer across the rollover', () => {
  it('the probe: sixty 100-step minutes 03:30-04:30 give 3,000 steps to each app day (it was 6,000 and 0)', async () => {
    // without the rollover the server merges the hour into one indivisible interval: one day gets it all
    const before = fusedStepsDays(await serverSteps(ringMinutes('2026-10-21T03:30:00', 60, 100), {}), TZ, 'located', { rolloverH: 4 });
    expect(before.map((d) => d.steps).sort()).toEqual([0, 6000]);
    const rows = fusedStepsDays(await serverSteps(ringMinutes('2026-10-21T03:30:00', 60, 100), { rolloverH: 4 }), TZ, 'located', { rolloverH: 4 });
    expect(rows.map((d) => [d.date, d.steps])).toEqual([['2026-10-20', 3000], ['2026-10-21', 3000]]);
    expect(rows.map((d) => d.fusion?.coverage?.ringMin)).toEqual([30, 30]);
  });

  it('the probe: a 200-step phone span 23:50-00:10 belongs to the 20th app day, count and coverage alike', async () => {
    const rows = fusedStepsDays(await serverSteps([hcRecord('Steps', 'h1', '2026-10-20T23:50:00+05:30', '2026-10-21T00:10:00+05:30', { count: 200 }, { origin: 'com.example' })], { rolloverH: 4 }), TZ, 'located', { rolloverH: 4 });
    expect(rows.map((d) => [d.date, d.steps, d.fusion?.coverage?.eitherMin])).toEqual([['2026-10-20', 200, 20]]);
  });

  it('the import sends the person\'s rollover with the fusion context and with an explicit POST /steps/fuse', async () => {
    const posted: Array<Record<string, unknown>> = [];
    const fused: Array<Record<string, unknown>> = [];
    const empty = { fusionVersion: 'steps-fuse/1', intervals: [], days: [] };
    const api = {
      activity: async () => ({ days: [] }),
      sleep: async () => ({ sessions: [] }),
      steps: async () => empty,
      stepsFuse: async (body: Record<string, unknown>) => (fused.push(body), empty),
      fusionContext: async (body: Record<string, unknown>) => (posted.push(body), { revision: 'fc:1', changed: true }),
      changes: async () => ({ cursor: 'c1.1.0', resync: false, changes: [], truncated: false }),
      hc: async (type: string) => ({ type, from: '', to: '', records: [], deleted: [], truncated: false }),
      workouts: async () => ({ sessions: [] }),
      status: () => ({ lastOkAt: null, problem: null }),
    } as unknown as GaugeApi & Partial<GaugeV2Api>;
    const m = new Map<string, string>();
    const deps: Partial<GaugeImportDeps> = {
      api, enabled: () => true, today: () => '2026-10-20', tz: () => TZ, now: () => Date.parse('2026-10-20T06:34:00Z'), rolloverH: () => 5,
      importer: async () => ({ created: [], skipped: [] }), storage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) },
      stepsContext: () => ({ activities: [], preference: { stepsPreference: ['ring', 'phone', 'hc-other'], soleSustainedGait: true }, headline: 'atLeast' }),
    };
    await runGaugeImport(deps);
    expect(posted[0]).toMatchObject({ rolloverH: 5 });
    (api as { fusionContext?: unknown }).fusionContext = async () => null;
    await runGaugeImport(deps);
    expect(fused.at(-1)).toMatchObject({ rolloverH: 5 });
  });
});
