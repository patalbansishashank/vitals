/**
 * R20-WRITERS-02: a correction made later on one device survives an earlier clear made offline on another device.
 * The bodies come from the real `biometrics.correct` / `biometrics.clearCorrection` commands; the two offline edits are
 * then merged per field the way the Evolu adapter merges them (`src/sync/evolu/fieldMerge.ts`).
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getDocumentStore } from '@/state/runtime';
import { mintWriteToken } from '@/store';
import { flatten, formatHlc, materialize, merge, stamp } from '@/sync/evolu/fieldMerge';
import { resolveDays } from '@/biometrics/core/resolve';
import { prov, sleep } from '@/biometrics/core/__tests__/factory';
import { sourceKeyOf } from '@/biometrics/core/source';
import type { BioCorrection } from '@/biometrics/core/types';
import { dispatch } from '../..';
import { resetBioRuntime } from '../../bio/runtime';
import { freshState } from '../../__tests__/harness';

const DAY = '2026-03-10';
const KEY = `sleep:${DAY}`;

/** The document body as the command wrote it (no store metadata). */
async function body(): Promise<Record<string, unknown>> {
  const d = (await getDocumentStore().get('bioCorrections' as never, KEY)) as Record<string, unknown> | undefined;
  if (!d) throw new Error('no correction stored');
  return Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('_')));
}
/** Seeds this replica with a correction as it arrived from another device. */
async function seed(b: Record<string, unknown>) {
  await getDocumentStore().transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('bioCorrections', { ...b, _id: KEY });
  });
}
async function at(iso: string, cmd: string, input: unknown) {
  vi.setSystemTime(new Date(iso));
  const r = await dispatch(cmd as never, input);
  if (!r.ok) throw new Error(JSON.stringify(r));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  freshState({ cleared: true });
  resetBioRuntime();
});
afterEach(() => vi.useRealTimers());

type Body = Record<string, unknown>;
const toDoc = (m: ReturnType<typeof merge>) => materialize(Object.fromEntries(Object.entries(m.texts).map(([k, v]) => [k, JSON.parse(v)])), m.clocks) as BioCorrection;

// `legacy`: the first correction was written before `correct` wrote `clearedAt` (no key); else it holds `clearedAt: null`
it.each([false, true])('a later correction on the phone survives an earlier offline clear on the desktop (legacy %s)', async (legacy) => {
  // both devices hold the first correction (6 h)
  await at('2026-03-12T08:00:00.000Z', 'biometrics.correct', { target: { kind: 'sleep', localDate: DAY }, value: { asleepS: 6 * 3600 } });
  const c1: Body = await body();
  if (legacy) delete c1.clearedAt;
  else expect(c1).toHaveProperty('clearedAt', null);
  await seed(c1);
  // the desktop, offline, clears it
  await at('2026-03-12T09:00:00.000Z', 'biometrics.clearCorrection', { key: KEY });
  const desk = await body();
  expect(desk.clearedAt).toBeTruthy();
  // the phone (a replica that still holds the first correction), later, corrects again (7 h)
  freshState({ cleared: true });
  await seed(c1);
  await at('2026-03-12T10:00:00.000Z', 'biometrics.correct', { target: { kind: 'sleep', localDate: DAY }, value: { asleepS: 7 * 3600 } });
  const phone = await body();

  // each device stamps its own write against the shared base; the replicas then merge (either order)
  const base = stamp(null, flatten(c1), false, formatHlc(1000, 0, 'PHONE'));
  const d = stamp(base, flatten(desk), false, formatHlc(2000, 0, 'DESK'));
  const p = stamp(base, flatten(phone), false, formatHlc(3000, 0, 'PHONE'));
  for (const doc of [toDoc(merge(d, p)), toDoc(merge(p, d))]) {
    expect(doc.value).toEqual({ asleepS: 7 * 3600 });
    expect(doc.clearedAt ?? null).toBeNull();
    // the readers treat a missing or null `clearedAt` as active: the correction wins over the device night
    const pr = prov();
    const [day] = resolveDays([{ sourceKey: sourceKeyOf(pr), record: sleep('n1', DAY, 5 * 3600, true, pr) }], [], {}, [doc]);
    expect(day?.basisByMetric['sleep']).toBe('correction');
    expect(day?.sleeps[0]?.asleep_s).toBe(7 * 3600);
  }
});

it('a clear made after the correction (seen) still clears it', async () => {
  await at('2026-03-12T08:00:00.000Z', 'biometrics.correct', { target: { kind: 'sleep', localDate: DAY }, value: { asleepS: 6 * 3600 } });
  await at('2026-03-12T09:00:00.000Z', 'biometrics.clearCorrection', { key: KEY });
  expect((await body()).clearedAt).toBe('2026-03-12T09:00:00.000Z');
  // and a correction after a seen clear is active again
  await at('2026-03-12T10:00:00.000Z', 'biometrics.correct', { target: { kind: 'sleep', localDate: DAY }, value: { asleepS: 7 * 3600 } });
  expect((await body()).clearedAt ?? null).toBeNull();
});
