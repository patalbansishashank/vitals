/**
 * 0.6.7 AD-VITALS, the screens (contract §3; owner: "if it was auto counted as auto detection it should say so"):
 *  - Today's activities say "detected" for a detection episode, never "logged by hand" (r070: there is no review strip or
 *    sheet any more; a weak detection is one quiet "Possible …" line with Add and Not this, tested in r070Auto);
 *  - an episode still going on is a live line on Today ("Walking now · detected · 18 min") with no Approve;
 *  - quiet mode is words only (aria too).
 */
import { screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { detectActivities } from '@/living/sensors/activityDetect';
import { planCandidateUpsert, reviewSheetModel, type ReviewSheetModel } from '@/living/activityCandidates';
import { expectWordsOnly } from '@/features/living/__tests__/wordsOnly';
import { LIVE_DETECTION_STALE_MS, type LiveDetection } from '@/state/liveDetections';
import { renderLiving } from '../../testing';
import { FIXTURE_TODAY } from '../../data/fixtures';
import { ActivityDataProvider, type ActivityData } from '../data';
import { ActivityFace } from '../../today/components/ActivityFace';
import { activityRowWord, liveLineText, rowName, sourcesText } from '../model';
import { ACTIVITY_COPY as C } from '../../copy';
import { commandsFixture, dayFixture, fixtureActivityData } from '../../today/__screens__/fixtures';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

const at = (h: number) => new Date(`${FIXTURE_TODAY}T00:00:00`).getTime() + h * 3_600_000;
const NOW = at(13);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(NOW));
});
afterAll(() => {
  vi.useRealTimers();
});

/** Candidates of these episodes through the real detector and upsert (no estimate: none is wired here). */
function detectedModel(
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
  return reviewSheetModel(plan.puts, { quiet });
}
const TREADMILL = { id: 'T1', label: 'walk_possibly_treadmill', start: at(10), end: at(10.4) };

function harness(model: ReviewSheetModel, live: LiveDetection[] = [], quiet = false) {
  const f = dayFixture(FIXTURE_TODAY, NOW, 'pending');
  const base = fixtureActivityData(f, { quiet, commands: commandsFixture(f) });
  const data: ActivityData = {
    ...base,
    useReview: () => model,
    useLiveDetections: () => live,
    approve: vi.fn(async () => ({ ok: true as const })),
    edit: vi.fn(async () => ({ ok: true as const })),
    reject: vi.fn(async () => ({ ok: true as const })),
  };
  return data;
}

describe('the words (pure)', () => {
  it('a detected row reads by its detection and says "detected", never "logged by hand"', () => {
    const m = detectedModel([TREADMILL]);
    const row = m.rows[0]!;
    expect(rowName(row)).toBe('Possible treadmill walk');
    expect(sourcesText(row.sources)).toBe('Detected');
    const words = {
      pending: C.statusWord.pending,
      byHand: C.byHand,
      updated: 'counted, updated since',
      status: C.statusWord,
    };
    expect(activityRowWord(row, words)).toBe('detected, not counted yet');
    expect(activityRowWord({ ...row, status: 'approved' }, words)).toBe('detected, counted');
    expect(activityRowWord({ ...row, status: 'approved', detection: undefined, sources: [] }, words)).toBe(
      'logged by hand',
    );
    // (0.6.7) a removed hand log is not counted, never "logged by hand"
    expect(activityRowWord({ ...row, status: 'rejected', detection: undefined, sources: [] }, words)).toBe(
      C.statusWord.rejected,
    );
  });

  it('the live line: minutes so far; quiet words only; nothing once its evidence is stale', () => {
    const d = { id: 'O', label: 'walk', start: NOW - 20 * 60_000, end: NOW - 2 * 60_000 };
    expect(liveLineText(d, NOW, false, LIVE_DETECTION_STALE_MS)).toBe('Walking now · detected · 18 min');
    expect(liveLineText(d, NOW, true, LIVE_DETECTION_STALE_MS)).toBe('Walking now · detected');
    expect(liveLineText({ ...d, label: 'possible_workout' }, NOW, true, LIVE_DETECTION_STALE_MS)).toBe(
      'Active now · detected',
    );
    expect(liveLineText(d, NOW + LIVE_DETECTION_STALE_MS, false, LIVE_DETECTION_STALE_MS)).toBeNull();
  });
});

describe('Today: the live line and the list', () => {
  function face(model: ReviewSheetModel, live: LiveDetection[], quiet = false) {
    const data = harness(model, live, quiet);
    renderLiving(
      <ActivityDataProvider value={data}>
        <ActivityFace
          date={FIXTURE_TODAY}
          isToday
          quiet={quiet}
          review={model}
          onOpenRow={() => undefined}
          nowMs={NOW}
        />
      </ActivityDataProvider>,
      { path: '/today', route: 'today' },
    );
  }

  it('an episode going on now is a live line with no Approve; a final one is listed as detected', async () => {
    const m = detectedModel([TREADMILL]);
    face(m, [{ id: 'O1', label: 'walk', start: NOW - 18 * 60_000, end: NOW - 60_000 }]);
    const list = await screen.findByRole('region', { name: C.activities });
    expect(within(list).getByRole('status')).toHaveTextContent('Walking now · detected · 17 min');
    expect(within(list).queryByRole('button', { name: /Approve/ })).toBeNull();
    const row = within(list).getByRole('button', {
      name: /^Possible treadmill walk, 10:00–10:24, detected, not counted yet$/,
    });
    expect(row).toBeInTheDocument();
    expect(list.textContent).not.toMatch(/logged by hand/i);
  });

  it('quiet: the live line and the list in words only', async () => {
    const m = detectedModel([TREADMILL], true);
    face(m, [{ id: 'O1', label: 'walk', start: NOW - 18 * 60_000, end: NOW - 60_000 }], true);
    const list = await screen.findByRole('region', { name: C.activities });
    await waitFor(() => expect(within(list).getByRole('status')).toHaveTextContent('Walking now · detected'));
    expectWordsOnly(list, 'Today’s activities');
  });
});
