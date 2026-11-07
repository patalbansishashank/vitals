/**
 * (r070) Nothing is reviewed: a weak detection is one quiet "Possible …" line under the day's activities (Add, Not this),
 * absent when there is none, words only in quiet mode; an activity counted automatically says where it came from in its
 * sheet, and editing or removing it still works.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { detectActivities } from '@/living/sensors/activityDetect';
import {
  planCandidateUpsert,
  reviewSheetModel,
  type ReviewRow,
  type ReviewSheetModel,
} from '@/living/activityCandidates';
import { expectWordsOnly } from '@/features/living/__tests__/wordsOnly';
import { renderLiving } from '../../testing';
import { FIXTURE_TODAY } from '../../data/fixtures';
import { ActivityDataProvider, type ActivityData } from '../data';
import { ActivityFace } from '../../today/components/ActivityFace';
import { ActivitySheet } from '../ActivitySheet';
import { autoNoteText, AUTO_NOTE_STICKS } from '../model';
import { possibleLineText } from '../PossibleLine';
import { commandsFixture, dayFixture, fixtureActivityData } from '../../today/__screens__/fixtures';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

const at = (h: number) => new Date(`${FIXTURE_TODAY}T00:00:00`).getTime() + h * 3_600_000;
const NOW = at(16);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(NOW));
});
afterAll(() => {
  vi.useRealTimers();
});

/** Weak detections through the real detector and upsert, stored as `possible` (what `planAutoAccept` does to them). */
function possibleModel(
  eps: Array<{ id: string; label: string; start: number; end: number }>,
  quiet = false,
): ReviewSheetModel {
  const r = detectActivities({
    episodes: eps.map((e) => ({
      ...e,
      revision: 1,
      detector: 'detect/2',
      existence: 0.7,
      typeScore: 0.45,
      level: 'medium' as const,
      reasons: ['ringFewSteps'],
    })),
    localDetectors: false,
    mintKey: () => '',
  });
  const plan = planCandidateUpsert({
    drafts: r.drafts,
    existing: new Map(),
    refIndex: new Map(),
    tz: 'Asia/Kolkata',
    now: new Date(NOW).toISOString(),
  });
  return reviewSheetModel(
    plan.puts.map((p) => ({ ...p, status: 'possible' as const })),
    { quiet },
  );
}
const WALK = { id: 'W1', label: 'walk', start: at(14 + 1 / 3), end: at(14.75) };
const WORKOUT = { id: 'P1', label: 'possible_workout', start: at(11), end: at(11.35) };

function harness(model: ReviewSheetModel, quiet = false) {
  const f = dayFixture(FIXTURE_TODAY, NOW, 'pending');
  const base = fixtureActivityData(f, { quiet, commands: commandsFixture(f) });
  const data: ActivityData = {
    ...base,
    useReview: () => model,
    useLiveDetections: () => [],
    approve: vi.fn(async () => ({ ok: true as const })),
    edit: vi.fn(async () => ({ ok: true as const })),
    reject: vi.fn(async () => ({ ok: true as const })),
  };
  return data;
}

function face(model: ReviewSheetModel, quiet = false, onOpenRow: (r: ReviewRow) => void = () => undefined) {
  const data = harness(model, quiet);
  renderLiving(
    <ActivityDataProvider value={data}>
      <ActivityFace date={FIXTURE_TODAY} isToday quiet={quiet} review={model} onOpenRow={onOpenRow} nowMs={NOW} />
    </ActivityDataProvider>,
    { path: '/today', route: 'today' },
  );
  return data;
}

describe('the possible line', () => {
  it('reads "Possible walk, 14:20, 25 min" with Add and Not this; no badge, no count', () => {
    const m = possibleModel([WALK]);
    expect(m.possible).toHaveLength(1);
    expect(m.rows).toHaveLength(0);
    expect(possibleLineText(m.possible[0]!, false)).toBe('Possible walk, 14:20, 25 min');
    expect(possibleLineText(m.possible[0]!, true)).toBe('Possible walk, in the afternoon');
  });

  it('Add counts it with one tap; Not this removes it', async () => {
    const m = possibleModel([WALK]);
    const data = face(m);
    const list = await screen.findByRole('region', { name: 'Today’s activities' });
    expect(within(list).getByText('Possible walk, 14:20, 25 min')).toBeInTheDocument();
    // not in the counted list, and nothing says "review"
    expect(within(list).queryByRole('list')).toBeNull();
    expect(document.body.textContent).not.toMatch(/to review|Approve all/i);
    await act(async () => fireEvent.click(within(list).getByRole('button', { name: /^Add/ })));
    expect(data.approve).toHaveBeenCalledWith(m.possible[0]!.id, m.possible[0]!.revision);
    await act(async () => fireEvent.click(within(list).getByRole('button', { name: /^Not this/ })));
    expect(data.reject).toHaveBeenCalledWith(m.possible[0]!.id);
  });

  it('a possible workout without a type opens the sheet to choose one instead of adding', async () => {
    const m = possibleModel([WORKOUT]);
    const open = vi.fn();
    const data = face(m, false, open);
    const list = await screen.findByRole('region', { name: 'Today’s activities' });
    expect(within(list).getByText(/^Possible workout, 11:00, 21 min$/)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: /^Add/ }));
    expect(open).toHaveBeenCalledWith(m.possible[0]);
    expect(data.approve).not.toHaveBeenCalled();
  });

  it('is absent when there is nothing possible', async () => {
    const m = { ...possibleModel([WALK]), possible: [] };
    face(m);
    const list = await screen.findByRole('region', { name: 'Today’s activities' });
    expect(within(list).queryByRole('button', { name: /^Add/ })).toBeNull();
    expect(list.textContent).not.toMatch(/Possible/);
  });

  it('quiet mode: words only, aria too', async () => {
    const m = possibleModel([WALK], true);
    face(m, true);
    const list = await screen.findByRole('region', { name: 'Today’s activities' });
    await waitFor(() => expect(within(list).getByText('Possible walk, in the afternoon')).toBeInTheDocument());
    expectWordsOnly(list, 'Today’s activities');
  });
});

describe('the "added automatically" note', () => {
  it('names the source in friendly words', () => {
    expect(autoNoteText({ kind: 'healthConnect', app: 'com.google.android.apps.fitness' })).toBe('Added from Google Fit');
    expect(autoNoteText({ kind: 'healthConnect', app: 'com.fitbit.FitbitMobile' })).toBe('Added from Fitbit');
    expect(autoNoteText({ kind: 'healthConnect', app: 'com.unknown.app' })).toBe('Added from Health Connect');
    expect(autoNoteText({ kind: 'healthConnect' })).toBe('Added from Health Connect');
    expect(autoNoteText({ kind: 'gauge' })).toBe('Added from your phone recording');
    expect(autoNoteText({ kind: 'ring' })).toBe('Added from your ring');
    expect(autoNoteText({ kind: 'detected' })).toBe('Detected and added automatically');
  });

  function sheetOf(auto: ReviewRow['auto'] | undefined) {
    const f = dayFixture(FIXTURE_TODAY, NOW, 'pending');
    const data = fixtureActivityData(f, { quiet: false, commands: commandsFixture(f) });
    const removed = vi.spyOn(data, 'reject');
    let model: ReviewSheetModel | null = null;
    function Probe() {
      model = data.useReview(FIXTURE_TODAY, FIXTURE_TODAY);
      return null;
    }
    renderLiving(
      <ActivityDataProvider value={data}>
        <Probe />
      </ActivityDataProvider>,
    );
    const base = model!.rows[0]!;
    const row: ReviewRow = { ...base, status: 'approved', ...(auto ? { auto } : {}) };
    renderLiving(
      <ActivityDataProvider value={data}>
        <ActivitySheet row={row} onClose={() => undefined} quiet={false} />
      </ActivityDataProvider>,
    );
    return { removed, row };
  }

  it('shows one muted line with the source, and Remove still works', async () => {
    const { removed, row } = sheetOf({ from: { kind: 'healthConnect', app: 'com.google.android.apps.fitness' } });
    const d = await screen.findByRole('dialog');
    expect(within(d).getByText(`Added from Google Fit ${AUTO_NOTE_STICKS}`)).toBeInTheDocument();
    fireEvent.click(within(d).getByRole('button', { name: 'Remove this activity' }));
    await act(async () => fireEvent.click(within(d).getByRole('button', { name: 'Remove' })));
    expect(removed).toHaveBeenCalledWith(row.id);
  });

  it('has no note on an activity the person decided', async () => {
    sheetOf(undefined);
    const d = await screen.findByRole('dialog');
    expect(d.textContent).not.toMatch(/Added from|added automatically/);
  });
});
