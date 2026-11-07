import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { dispatch, readLivingDocs, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import {
  addDays,
  weeklyCheckIn,
  realisedSchedule,
  weighInsFor,
  type LivingDocs,
  type LogEntry,
  type MeasurementEntry,
} from '@/living';
import { bpEpisodes } from '@/living/monitoring';
import { getDocumentStore } from '@/state/runtime';
import { bodyOf, mintWriteToken, type DocumentStore } from '@/store';
import { useSettingsStore } from '@/state/settingsStore';
import { withSystemWrite } from '@/state/scope';
import { SEED_PLAN_ID, seedPlanDocs } from '../../__tests__/seedPlanDocs';
import type { ActivePlan } from '../../activePlan';
import { currentDay, fixedClock, systemClock } from '../../clock';
import { GoalsSection } from '../../progress/sections/GoalsSection';
import { BodySection } from '../../progress/sections/BodySection';
import { CheckInSheet } from '../../today/components/CheckInSheet';
import { LivingActionsProvider } from '../actions';
import { createCommandLivingActions } from '../commands';
import { createDocumentLivingSource } from '../documents';
import { LivingDataProvider, type LivingDataSource } from '../source';

const observed = { by: 'user' as const, method: 'typed' as const };
const idle = { subscribe: () => () => {}, ready: Promise.resolve() } as unknown as DocumentStore;

async function setup(goals: Array<{ metric: string; direction: string; target?: number }> = []) {
  freshState({ cleared: true });
  const today = currentDay(systemClock);
  await seedPlanDocs({ startDate: addDays(today, -28) });
  const docs = readLivingDocs();
  docs.plan!.request.goals = goals as NonNullable<typeof docs.plan>['request']['goals'];
  const source = createDocumentLivingSource({ read: () => docs });
  return { today, docs, source, plan: { ...docs.plan!, doc: docs.plan! } as ActivePlan };
}

function goalsView(source: LivingDataSource, plan: ActivePlan, today: string) {
  return render(
    <MemoryRouter>
      <LivingDataProvider value={source}>
        <LivingActionsProvider value={createCommandLivingActions(source)}>
          <GoalsSection plan={plan} today={today} />
        </LivingActionsProvider>
      </LivingDataProvider>
    </MemoryRouter>,
  );
}
function measurement(
  id: string,
  date: string,
  metric: MeasurementEntry['metric'],
  value: number,
  episodeId?: string,
): MeasurementEntry {
  return { id, date, metric, value, source: observed, ...(episodeId ? { episodeId } : {}) };
}

function lowExposure(docs: LivingDocs, count: number, gap?: number) {
  const est = (value: number) => ({ value, sd: 0 });
  docs.dayStatus = Array.from({ length: count }, (_, d) => ({
    date: addDays(docs.plan!.startDate, d),
    intake: d === gap ? ('partial' as const) : ('complete' as const),
  }));
  docs.entries = Array.from({ length: count }, (_, d): LogEntry[] => {
    const date = addDays(docs.plan!.startDate, d);
    return [
      {
        id: `food-${d}`,
        date,
        tz: 'UTC',
        source: observed,
        kind: 'meal',
        clockH: 12,
        components: [
          {
            name: 'Food',
            grams: est(500),
            nutrients: { energyKcal: est(1050), proteinG: est(70), carbG: est(100), fatG: est(40) },
            nutrientSource: 'user',
          },
        ],
        totals: { energyKcal: est(1050), proteinG: est(70), carbG: est(100), fatG: est(40) },
      },
      {
        id: `exercise-${d}`,
        date,
        tz: 'UTC',
        source: observed,
        kind: 'session',
        status: 'skipped',
        performed: [],
        stimulus: {
          effectiveSetsByRegion: {},
          pattern: 'complex',
          loadClass: 'moderate',
          netKcal: 0,
          mem: 0,
          hiMinutes: 0,
          mobilityMinutes: {},
        },
        catalogueVersion: 'test',
      },
    ];
  }).flat();
}

describe('W2/W3 production consumers', () => {
  it.each(['fullRawList', 'primaryPlusAdditional'] as const)('transports raw repeated BP readings with %s encoding', async (encoding) => {
    await setup();
    const today = currentDay(systemClock);
    const source = createDocumentLivingSource();
    const actions = createCommandLivingActions(source);
    const repeats = encoding === 'fullRawList' ? [138, 132, 138] : [132, 138];
    const result = await actions.logMeasurement(today, { metric: 'sbpMmHg', value: 138, repeats, ...(encoding === 'primaryPlusAdditional' ? { repeatsEncoding: encoding } : {}), episodeId: 'bp-repeat', method: 'meter' });
    expect(result.ok).toBe(true);
    await settleCommits();
    const readings = readLivingDocs().measurements;
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ repeats, repeatsEncoding: encoding, value: encoding === 'fullRawList' ? 136 : 138 });
    expect(bpEpisodes(readings)[0]).toMatchObject({ sbp: 136, readings: { sbp: [138, 132, 138] } });
  });

  it('reports repeated complete low exposure in the real document and check-in sheet without weigh-ins', async () => {
    const { today, docs } = await setup();
    lowExposure(docs, 28);
    const source = createDocumentLivingSource({
      read: () => docs,
      getStore: () => idle,
      onSwitch: () => () => {},
    });
    const report = source.checkIn(today)!;
    expect(report.weighIns7).toBe(0);
    expect(report.energyAvailability).toMatchObject({ reasonCode: 'coveredExerciseScenario', exerciseCoveredDays: 7, intakeCoveredDays: 7, exerciseScopes: ['coveredSessions'] });
    expect(report.review).toBe(true);
    expect(report.reviewReasons).toContain('repeatedCalendarEaBelowReference');
    expect(
      source
        .today(today)
        ?.notices.some((n) => n.id.includes('repeatedCalendarEaBelowReference') || n.text === 'Review'),
    ).toBe(true);
    render(
      <LivingDataProvider value={source}>
        <LivingActionsProvider value={createCommandLivingActions(source)}>
          <CheckInSheet open today={today} quiet={false} onClose={() => {}} />
        </LivingActionsProvider>
      </LivingDataProvider>,
    );
    expect(screen.getByText('Review')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(
      screen.getByText('Repeated calendar energy availability below the provisional reference'),
    ).toBeInTheDocument();
    expect(screen.getByText(/30 kcal\/kg FFM\/day · provisional policy/)).toBeInTheDocument();
    expect(getDocumentStore().peekAll('anchors')).toHaveLength(0);
  });

  it.each([1, 20, 21])('requires fifteen complete eligible windows: %i elapsed days', async (days) => {
    const { docs } = await setup();
    lowExposure(docs, days);
    const today = addDays(docs.plan!.startDate, days);
    const source = createDocumentLivingSource({
      read: () => docs,
      getStore: () => idle,
      onSwitch: () => () => {},
      clock: fixedClock(`${today}T12:00:00`),
    });
    expect(source.checkIn(today)?.reviewReasons?.includes('repeatedCalendarEaBelowReference')).toBe(
      days === 21,
    );
  });

  it('does not turn a low known-days mean or a gap into complete persistence', async () => {
    const { docs, today } = await setup();
    lowExposure(docs, 28, 15);
    const source = createDocumentLivingSource({
      read: () => docs,
      getStore: () => idle,
      onSwitch: () => () => {},
    });
    expect(source.checkIn(today)?.reviewReasons).not.toContain('repeatedCalendarEaBelowReference');
  });

  it.each(['illness', 'travel', 'dietBreak', 'creatineStart'] as const)(
    'shows pending %s Review before confirmation',
    async (event) => {
      const { docs, today } = await setup();
      docs.entries = [{ id: 'event', date: today, tz: 'UTC', source: observed, kind: 'event', event }];
      const source = createDocumentLivingSource({
        read: () => docs,
        getStore: () => idle,
        onSwitch: () => () => {},
      });
      expect(source.checkIn(today)).toMatchObject({ review: true, reviewReasons: [event] });
      expect(getDocumentStore().peekAll('anchors')).toHaveLength(0);
    },
  );

  it('shows paired BP observations without weight, with protocol and raw readings in Details', async () => {
    const { docs, today, plan } = await setup([{ metric: 'sbp', direction: 'target', target: 120 }]);
    docs.measurements = [
      measurement('s1', addDays(today, -7), 'sbpMmHg', 138, 'bp1'),
      measurement('d1', addDays(today, -7), 'dbpMmHg', 88, 'bp1'),
      measurement('s2', today, 'sbpMmHg', 131, 'bp2'),
      measurement('d2', today, 'dbpMmHg', 83, 'bp2'),
    ];
    const source = createDocumentLivingSource({
      read: () => docs,
      getStore: () => idle,
      onSwitch: () => () => {},
    });
    expect(source.driftCards()).toEqual([]);
    expect(source.monitoredGoals()[0]).toMatchObject({
      status: 'observed',
      days: 2,
      readings: 2,
      change: -7,
    });
    const view = goalsView(source, plan, today);
    expect(screen.getByText('131/83 mmHg')).toBeInTheDocument();
    expect(view.container).not.toHaveTextContent(/weigh|on track|goal date/i);
    await userEvent.click(screen.getByRole('button', { name: 'Blood pressure details' }));
    const details = screen.getByRole('dialog', { name: 'Blood pressure' });
    expect(within(details).getByText('2 episodes · 2 days')).toBeInTheDocument();
    expect(within(details).getByText('−7/−5 mmHg')).toBeInTheDocument();
    expect(screen.getByText('2 paired · 0 incomplete · 0 unknown')).toBeInTheDocument();
    expect(screen.getByText(/systolic 138 · diastolic 88 mmHg/)).toBeInTheDocument();
  });

  it('shows waist and LDL rows, preserving Unknown and quiet mode', async () => {
    const { today, docs, plan } = await setup([
      { metric: 'waist', direction: 'target', target: 85 },
      { metric: 'ldl', direction: 'target', target: 2 },
    ]);
    docs.measurements = [
      measurement('waist1', addDays(today, -4), 'waistCm', 96),
      measurement('waist2', today, 'waistCm', 94),
    ];
    const source = createDocumentLivingSource({
      read: () => docs,
      getStore: () => idle,
      onSwitch: () => () => {},
    });
    const view = goalsView(source, plan, today);
    expect(screen.getByText('94.0 cm')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'LDL' })).getByText('Unknown')).toBeInTheDocument();
    docs.settings = { ...docs.settings, quietMode: true };
    await act(async () =>
      withSystemWrite(() => useSettingsStore.setState({ quietMode: true, quietModeSet: true })),
    );
    expect(view.container).not.toHaveTextContent('94.0');
    expect(within(screen.getByRole('article', { name: 'Waist' })).getByText('Observed')).toBeInTheDocument();
  });

  it('updates a real document selector and rendered row after edits and retraction', async () => {
    const { today, docs, plan } = await setup([{ metric: 'waist', direction: 'target', target: 85 }]);
    const store = getDocumentStore();
    await store.transact(mintWriteToken('migration', { label: 'monitor fixture' }), async (tx) => {
      await tx.put('plans', { ...docs.plan!, _id: SEED_PLAN_ID });
      await tx.append('measurements', {
        ...measurement('01JABCDEFGHJKMNPQRSTVWXYZ1', today, 'waistCm', 96),
        _id: '01JABCDEFGHJKMNPQRSTVWXYZ1',
      });
    });
    const source = createDocumentLivingSource();
    goalsView(source, plan, today);
    expect(screen.getByText('96.0 cm')).toBeInTheDocument();
    await act(async () =>
      store.transact(mintWriteToken('migration', { label: 'monitor edit' }), async (tx) => {
        await tx.append('measurements', {
          ...measurement('01JABCDEFGHJKMNPQRSTVWXYZ2', today, 'waistCm', 94),
          supersedes: '01JABCDEFGHJKMNPQRSTVWXYZ1',
          _id: '01JABCDEFGHJKMNPQRSTVWXYZ2',
        });
      }),
    );
    expect(screen.getByText('94.0 cm')).toBeInTheDocument();
    expect(source.monitoredGoals()[0]?.readings).toBe(1);
    await act(async () => {
      expect((await dispatch('log.retract', { entryId: '01JABCDEFGHJKMNPQRSTVWXYZ2' })).ok).toBe(true);
      await settleCommits();
    });
    expect(source.monitoredGoals()[0]?.readings).toBe(1);
    expect(screen.getByText('96.0 cm')).toBeInTheDocument();
  });

  it('renders document-backed unsupported composition intervals as useful points; retains supported ranges', async () => {
    const { today, docs } = await setup();
    docs.measurements = Array.from({ length: 29 }, (_, d) =>
      measurement(`w${d}`, addDays(docs.plan!.startDate, d), 'weightKg', 90 - d * 0.05),
    );
    const checkIn = weeklyCheckIn({
      plan: docs.plan!,
      schedule: realisedSchedule(docs.plan!, docs.versions[0]!, [], today),
      records: [],
      weighIns: weighInsFor(docs.plan!, docs.measurements, []),
      today,
      intakeDays: Array.from({ length: 28 }, (_, i) => i),
    });
    expect(checkIn.record).not.toBeNull();
    docs.records = [checkIn.record!];
    const source = createDocumentLivingSource({
      read: () => docs,
      getStore: () => idle,
      onSwitch: () => () => {},
      clock: fixedClock(`${today}T12:00:00`),
    });
    expect(source.composition()?.rows.length).toBeGreaterThan(0);
    const view = render(
      <LivingDataProvider value={source}>
        <LivingActionsProvider value={createCommandLivingActions(source)}>
          <BodySection today={today} quiet={false} />
        </LivingActionsProvider>
      </LivingDataProvider>,
    );
    expect(view.container).not.toHaveTextContent(/Range/);
    expect(view.container.querySelector('.lm-hero')?.getAttribute('aria-label')).not.toMatch(/range/i);
    const comp = source.composition()!;
    const row = comp.rows[0]!;
    expect(view.container).toHaveTextContent(row.label);
    const supported: LivingDataSource = {
      ...source,
      composition: () => ({ ...comp, rows: [{ ...row, lo: row.value - 1, hi: row.value + 1 }] }),
    };
    view.rerender(
      <LivingDataProvider value={supported}>
        <LivingActionsProvider value={createCommandLivingActions(supported)}>
          <BodySection today={today} quiet={false} />
        </LivingActionsProvider>
      </LivingDataProvider>,
    );
    expect(view.container).toHaveTextContent(/Range/);
    expect(view.container.querySelector('.lm-hero')?.getAttribute('aria-label')).toMatch(/range/i);
  });

  it('passes the reviewed sheet identity through production actions; rejects evidence queued ahead, then confirms once', async () => {
    await setup();
    const today = currentDay(systemClock);
    const source = createDocumentLivingSource();
    const actions = createCommandLivingActions(source);
    const reviewed = source.checkIn(today)!;
    const close = vi.fn();
    let changeAhead = true;
    const payloads: string[] = [];
    const wrapped = {
      ...actions,
      checkIn: (previewId: string) => {
        payloads.push(previewId);
        if (changeAhead) {
          changeAhead = false;
          void dispatch('log.measurement', { date: today, metric: 'waistCm', value: 95 });
        }
        return actions.checkIn(previewId);
      },
    };
    render(
      <LivingDataProvider value={source}>
        <LivingActionsProvider value={wrapped}>
          <CheckInSheet open today={today} quiet={false} onClose={close} />
        </LivingActionsProvider>
      </LivingDataProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(payloads).toEqual([reviewed.previewId]);
    expect(close).not.toHaveBeenCalled();
    expect(getDocumentStore().peekAll('anchors')).toHaveLength(0);
    expect(
      getDocumentStore()
        .peekAll('planVersions')
        .filter((d) => bodyOf<{ status: string }>(d).status === 'proposed'),
    ).toHaveLength(0);
    const refreshed = source.checkIn(today)!;
    expect(refreshed.previewId).not.toBe(reviewed.previewId);
    await userEvent.click(screen.getByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(payloads).toEqual([reviewed.previewId, refreshed.previewId]);
    expect((await actions.checkIn(refreshed.previewId)).ok).toBe(true);
    expect(getDocumentStore().peekAll('anchors')).toHaveLength(1);
  });

  it('Cancel, Escape and outside close leave the real sheet without confirmation', async () => {
    const { source, today } = await setup();
    const actions = createCommandLivingActions(source);
    const checkIn = vi.spyOn(actions, 'checkIn');
    const close = vi.fn();
    const view = render(
      <LivingDataProvider value={source}>
        <LivingActionsProvider value={actions}>
          <CheckInSheet open today={today} quiet={false} onClose={close} />
        </LivingActionsProvider>
      </LivingDataProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('dialog'));
    expect(close).toHaveBeenCalledTimes(3);
    expect(checkIn).not.toHaveBeenCalled();
    expect(getDocumentStore().peekAll('anchors')).toHaveLength(0);
    view.unmount();
  });
});
