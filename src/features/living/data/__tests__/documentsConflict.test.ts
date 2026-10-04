import { expect, it } from 'vitest';
import type { LivingDocs, LogEntry, MeasurementEntry } from '@/living';
import { projectEntries } from '@/living';
import type { DocumentStore } from '@/store';
import { createDocumentLivingSource, historyDates } from '../documents';

const date = '2026-10-05';
const source = { by: 'user' as const, method: 'typed' as const };
const est = (value: number) => ({ value, sd: 0 });
const nutrients = (kcal: number) => ({ energyKcal: est(kcal), proteinG: est(20), carbG: est(20), fatG: est(10), fibreG: est(2) });
const meal = (id: string, name: string, kcal: number, at: string, supersedes?: string): LogEntry => ({
  id, date, tz: 'UTC', at, source, kind: 'meal', clockH: 13.5, slot: 'meal2',
  components: [{ name, grams: est(100), nutrients: nutrients(kcal), nutrientSource: 'user' }],
  totals: nutrients(kcal),
  ...(supersedes ? { supersedes } : {}),
});
const measurement = (id: string, value: number, at: string, supersedes?: string): MeasurementEntry => ({
  id, date, at, source, metric: 'weightKg', value, ...(supersedes ? { supersedes } : {}),
});

it('history shows one meal and two independent conflicts with distinguishable versions', () => {
  const docs: LivingDocs = {
    plan: null, versions: [], dayStatus: [], records: [],
    entries: [
      meal('meal-root', 'Rice', 250, '2026-10-05T10:00:00Z'),
      meal('meal-a', 'Rice and lentils', 350, '2026-10-05T11:00:00Z', 'meal-root'),
      meal('meal-b', 'Soup and bread', 400, '2026-10-05T12:00:00Z', 'meal-root'),
    ],
    measurements: [
      measurement('weight-root', 70, '2026-10-05T08:00:00Z'),
      measurement('weight-a', 70.2, '2026-10-05T09:00:00Z', 'weight-root'),
      measurement('weight-b', 70.4, '2026-10-05T10:00:00Z', 'weight-root'),
    ],
  };
  const store = { subscribe: () => () => {}, ready: Promise.resolve() } as unknown as DocumentStore;
  const living = createDocumentLivingSource({
    clock: { now: () => new Date('2026-10-06T12:00:00Z'), tz: 'UTC', rolloverH: 4 },
    getStore: () => store,
    onSwitch: () => () => {},
    read: () => docs,
  });

  const history = living.history(date, date);
  expect(history).toHaveLength(1);
  expect(history[0]?.entries).toHaveLength(1);
  expect(history[0]?.entries[0]?.conflict?.versions.map((v) => v.id)).toEqual(['meal-b', 'meal-a']);
  expect(history[0]?.conflicts).toHaveLength(2);
  expect(history[0]?.conflicts?.map((c) => c.kind)).toEqual(['meal', 'measurement']);
  expect(history[0]?.conflicts?.[0]?.versions.map((v) => v.label)).toEqual([
    '2026-10-05 · Soup and bread · 13:30 · Meal 2',
    '2026-10-05 · Rice and lentils · 13:30 · Meal 2',
  ]);
  expect(history[0]?.conflicts?.[0]?.versions.map((v) => v.energyKcal)).toEqual([400, 350]);
  expect(history[0]?.conflicts?.[1]?.versions.map((v) => v.label)).toEqual([
    '2026-10-05 · weight 70.4 kg', '2026-10-05 · weight 70.2 kg',
  ]);
});

it('keeps a moved conflict visible outside the active plan dates', () => {
  const root = meal('meal-root', 'Rice', 250, '2026-10-05T10:00:00Z');
  const onPlan = meal('meal-a', 'Rice and lentils', 350, '2026-10-05T11:00:00Z', root.id);
  const moved = { ...meal('meal-b', 'Soup and bread', 400, '2026-10-06T12:00:00Z', root.id), date: '2026-10-06' };
  const visible = projectEntries([root, onPlan, moved]);
  expect(visible).toHaveLength(1);
  expect(visible[0]?.conflict?.versions.map((v) => v.id)).toEqual(['meal-b', 'meal-a']);
  expect(historyDates([date], visible, [], date, '2026-10-06')).toEqual(['2026-10-06', date]);
});
