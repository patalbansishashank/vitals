/**
 * §V4.4 manual log: the ElsePanel's new types, minutes and intensity, the live `projectActivity` preview, quiet mode, and
 * the `activity.logManual` input it sends (through the V3 adapter, stood in for here).
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components';
import { act } from '@testing-library/react';
import { useSettingsStore } from '@/state/settingsStore';
import { withSystemWrite } from '@/state/scope';
import { projectActivity } from '@/living/sensors';
import { renderLiving } from '../../testing';
import { STUB_STIMULUS_CONTEXT, STUB_TRAINING_PROFILE } from '../../data/fixtures';
import { TrainingSetupProvider, fixedTrainingSetup, type TrainingSetupSource } from '../setup';
import TrainPage from '../TrainPage';
import { clearStoredSwaps } from '../swapStore';
import { expectWordsOnly } from '@/features/living/__tests__/wordsOnly';
import { COMMON_ACTIVITY_IDS, intensityOf, logManualInput, manualLogPreview, manualPreview, previewKcalText, previewPointsText, roundEnergy, roundKcal, spokenPreview, startHOf, startHOfClock } from '../manualLog';
import { ManualCheckProvider, ManualLogProvider, fixedManualCheck, type ActivityLogManualInput, type CheckManualActivity, type LogManualActivity } from '../v3Adapter';
import { SEED_CATALOGUE } from '@/content/catalogues';
import { exerciseRecordOf } from '@/living/sensors';
import { candidate } from '@/features/ring/__tests__/activityFixtures';

const CTX = { ...STUB_STIMULUS_CONTEXT, rmrKcalPerDay: 1780 };
/** The dated person facts the log's check reads (0.6.3 S12: the same request the booking makes). */
const PERSON = { massKg: CTX.bodyMassKg, ageY: 40, sex: null, rmrKcalPerDay: 1780 };

describe('manual log model', () => {
  it('previews energy above rest from projectActivity, with the envelope moved by own rest', () => {
    const p = manualPreview('walk_brisk', { minutes: 40, effort: 'moderate' }, CTX)!;
    const ref = projectActivity({ exerciseId: 'walk_brisk', durationMin: 40, massKg: CTX.bodyMassKg, rmrKcalPerDay: 1780, intensityClass: 'moderate' });
    expect(p.kcal).toBeCloseTo(ref.A, 6);
    expect(p.lo).toBeCloseTo(Math.max(0, ref.envelope.lo - ref.R), 6);
    expect(p.hi).toBeCloseTo(ref.envelope.hi - ref.R, 6);
    // a stated moderate class is 1 point a minute (fit-points/1)
    expect(p.points).toEqual({ lo: 40, hi: 40 });
  });

  it('speed and incline reach the estimator for gait only; a treadmill speed is a belt speed', () => {
    const plain = manualPreview('treadmill_incline_walk', { minutes: 30 }, CTX)!;
    const fast = manualPreview('treadmill_incline_walk', { minutes: 30, speedKmh: 6, gradePct: 5 }, CTX)!;
    expect(fast.method).not.toBe(plain.method);
    // the air bike has no speed field: a speed given is ignored
    expect(manualPreview('air_bike', { minutes: 20, speedKmh: 30 }, CTX)).toEqual(manualPreview('air_bike', { minutes: 20 }, CTX));
    expect(intensityOf(exerciseRecordOf('treadmill_incline_walk')!, { minutes: 30, effort: 'vigorous', speedKmh: 6, gradePct: 5 })).toEqual({ class: 'vigorous', speedKmh: 6, gradePct: 5 });
    expect(intensityOf(exerciseRecordOf('walk')!, { minutes: 30, speedKmh: 5, gradePct: 5 })).toEqual({ speedKmh: 5 });
  });

  it('has no estimate for an unknown type, no minutes or no body mass (never a made-up number)', () => {
    expect(manualPreview('user-wooden-wheel', { minutes: 20 }, CTX)).toBeNull();
    expect(manualPreview('walk', { minutes: 0 }, CTX)).toBeNull();
    expect(manualPreview('walk', { minutes: 20 }, { ...CTX, bodyMassKg: Number.NaN })).toBeNull();
  });

  it('words the preview as the spec does, rounded so the figure never claims more than its range', () => {
    expect(roundKcal(312)).toBe(310);
    expect(roundKcal(47)).toBe(50); // to the nearest 10, also under 100 (V4d)
    expect(previewKcalText({ kcal: 312, lo: 221, hi: 398 })).toMatch(/^About 310 kcal, 220.400$/);
    expect(previewPointsText({ lo: 40, hi: 40 })).toBe('40 Heart Points');
    expect(previewPointsText({ lo: 20, hi: 40 })).toBe('20–40 Heart Points');
    expect(previewPointsText({ lo: 0, hi: 0 })).toBe('No Heart Points');
    const p = { kcal: 312, lo: 221, hi: 398, points: { lo: 40, hi: 40 }, method: 'met', version: 'project-activity/1' } as never;
    expect(spokenPreview(p, false)).toMatch(/^About 310 kcal, 220.400 estimated, scenario range; 40 Heart Points, Fit-compatible estimate$/);
    // quiet mode: no kcal, Heart Points stay
    expect(spokenPreview(p, true)).toBe('Earns Heart Points, Fit-compatible estimate');
  });

  it('builds the activity.logManual input; on today it ends now, a past day leaves the start out', () => {
    expect(startHOf('2026-10-01', '2026-10-01', 13, 40)).toBeCloseTo(12.33, 2);
    expect(startHOf('2026-09-30', '2026-10-01', 13, 40)).toBeUndefined();
    // after midnight the app day is still D: the clock hour reads 24.5, the bout started at 23.75 on D (no clamp)
    expect(startHOf('2026-10-01', '2026-10-01', 24.5, 45)).toBeCloseTo(23.75, 2);
    expect(startHOf('2026-10-01', '2026-10-01', 3.5, 45)).toBeCloseTo(2.75, 2);
    const input: ActivityLogManualInput = logManualInput('walk_brisk', '2026-10-01', { minutes: 39.6, effort: 'moderate' }, 12.33);
    expect(input).toEqual({ exerciseId: 'walk_brisk', date: '2026-10-01', startH: 12.33, durationMin: 40, intensity: { class: 'moderate' } });
  });

  it('offers common activities that exist in the catalogue, the new types among them', () => {
    for (const id of COMMON_ACTIVITY_IDS) expect(SEED_CATALOGUE.exercise(id), id).toBeTruthy();
    expect(COMMON_ACTIVITY_IDS).toContain('air_bike');
  });
});

describe('Log an activity (Train)', () => {
  beforeEach(() => clearStoredSwaps());

  function renderLog(logManual: LogManualActivity, path = '/train/2026-10-01', quiet = false, now?: string, check: CheckManualActivity = fixedManualCheck(PERSON), plan?: null) {
    const h = renderLiving(
      <ManualLogProvider value={logManual}>
        <ManualCheckProvider value={check}>
          <TrainingSetupProvider value={fixedTrainingSetup(STUB_TRAINING_PROFILE, CTX)}>
            <TrainPage />
          </TrainingSetupProvider>
        </ManualCheckProvider>
        <Toaster />
      </ManualLogProvider>,
      { route: 'train/:date', path, ...(now ? { now } : {}), ...(plan === null ? { plan: null } : {}) },
    );
    if (quiet) void h.stub.actions.setQuietMode(true);
    return h;
  }

  it('picks a common activity, states how hard, previews and logs through activity.logManual with Undo', async () => {
    const user = userEvent.setup();
    const undo = vi.fn(async () => ({ ok: true }));
    const log = vi.fn<LogManualActivity>(async () => ({ ok: true, undo }));
    renderLog(log);
    await user.click(await screen.findByRole('button', { name: 'Log an activity' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
    const common = within(sheet).getByRole('list', { name: 'Common activities' });
    await user.click(within(common).getByRole('button', { name: 'Brisk walk (exercise walking)' }));
    await user.click(within(sheet).getByRole('radio', { name: 'Moderate' }));
    const est = within(sheet).getByRole('status');
    expect(est.textContent).toMatch(/^About \d.* kcal, .* estimated, scenario range; 30 Heart Points, Fit-compatible estimate$/);
    expect(within(sheet).getByText('Energy above rest')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    const input = log.mock.calls[0]![0];
    expect(input).toMatchObject({ exerciseId: 'walk_brisk', date: '2026-10-01', durationMin: 30, intensity: { class: 'moderate' } });
    // today at 13:00: it ended now
    expect(input.startH).toBeCloseTo(12.5, 2);
    expect(await screen.findByText(/^Logged Brisk walk \(exercise walking\) · 30 min$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalled();
  });

  it('says why it was not saved and keeps the sheet open (V3 not on the bus yet)', async () => {
    const user = userEvent.setup();
    renderLog(async () => ({ ok: false, message: 'Not available yet.' }));
    await user.click(await screen.findByRole('button', { name: 'Log an activity' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
    await user.click(within(sheet).getByRole('button', { name: /^Air bike/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    expect(await within(sheet).findByText('Not available yet.')).toBeInTheDocument();
  });

  it('logged at 00:30 (app day still 10-01), the start is clock hour 24 of that day, not 0 (no clamp)', async () => {
    const user = userEvent.setup();
    const log = vi.fn<LogManualActivity>(async () => ({ ok: true }));
    renderLog(log, '/train/2026-10-01', false, '2026-10-02T00:30:00');
    await user.click(await screen.findByRole('button', { name: 'Log an activity' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
    await user.click(within(sheet).getByRole('button', { name: 'Brisk walk (exercise walking)' }));
    await user.click(within(sheet).getByRole('radio', { name: 'Moderate' }));
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    // 30 minutes ending at clock hour 24.5
    expect(log.mock.calls[0]![0]).toMatchObject({ date: '2026-10-01' });
    expect(log.mock.calls[0]![0].startH).toBeCloseTo(24, 2);
  });

  it('a typed name with no catalogue match is logged as the catalogue’s generic activity (the log has no new-record path)', async () => {
    const user = userEvent.setup();
    const log = vi.fn<LogManualActivity>(async () => ({ ok: true }));
    renderLog(log);
    await user.click(await screen.findByRole('button', { name: 'Log an activity' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
    await user.type(within(sheet).getByRole('textbox'), 'wooden wheel rolling');
    expect(within(sheet).queryByRole('button', { name: /as you typed it/ })).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: /^Log it as/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(log.mock.calls[0]![0].exerciseId).toBe('other_moderate');
  });

  it('kJ preference: the preview figure, range and spoken sentence use kJ, never kcal (rounded to 10 in that unit)', async () => {
    expect(roundEnergy(312, 'kcal')).toBe(310);
    expect(roundEnergy(312, 'kJ')).toBe(1310); // 1305.4 kJ to the nearest 10 kJ
    expect(previewKcalText({ kcal: 312, lo: 221, hi: 398 }, 'kJ')).toMatch(/^About 1.310 kJ, 920.1.670$/);
    expect(spokenPreview(manualPreview('walk_brisk', { minutes: 40, effort: 'moderate' }, CTX)!, false, 'kJ')).toMatch(/ kJ, .* estimated, scenario range; 40 Heart Points/);
    const user = userEvent.setup();
    act(() => useSettingsStore.getState().set({ energyUnit: 'kJ' }));
    try {
      renderLog(async () => ({ ok: true }));
      await user.click(await screen.findByRole('button', { name: 'Log an activity' }));
      const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
      await user.click(within(sheet).getByRole('button', { name: /^Air bike/ }));
      await user.click(within(sheet).getByRole('radio', { name: 'Hard' }));
      expect(within(sheet).getByRole('status').textContent).toMatch(/^About \d.* kJ, .* estimated/);
      expect(within(sheet).queryByText(/kcal/)).toBeNull();
      expect(within(sheet).getByText('Energy above rest')).toBeInTheDocument();
      expect(sheet.textContent).toMatch(/kJ/);
    } finally {
      act(() => useSettingsStore.getState().set({ energyUnit: 'kcal' }));
    }
  });

  // (0.6.3 INT) quiet mode is words only, aria too: Heart Points as a word, no clock time
  it('quiet mode drops the kcal and every figure: Heart Points in words', async () => {
    const user = userEvent.setup();
    renderLog(async () => ({ ok: true }), '/train/2026-10-01', true);
    await user.click(await screen.findByRole('button', { name: 'Log an activity' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
    await user.click(within(sheet).getByRole('button', { name: /^Air bike/ }));
    await user.click(within(sheet).getByRole('radio', { name: 'Hard' }));
    expect(within(sheet).queryByText('Energy above rest')).toBeNull();
    expect(within(sheet).queryByText(/kcal/)).toBeNull();
    expect(within(sheet).getByRole('status')).toHaveTextContent('Earns Heart Points, Fit-compatible estimate');
    expect(within(sheet).getByText(/^Earns Heart Points · /)).toBeInTheDocument();
    // the typed figures stay in their fields (the person's own entries); everything the sheet says is words
    expectWordsOnly(sheet, 'Log an activity');
  });

  it('is in the header ⋯ on a session day and not on a future day', async () => {
    const user = userEvent.setup();
    renderLog(async () => ({ ok: true }), '/train/2026-09-30');
    await user.click(await screen.findByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Log an activity' })).toBeInTheDocument();
  });

  it('replacing a planned session previews the estimate beside the meter and records how hard on the performed item', async () => {
    const user = userEvent.setup();
    const h = renderLog(async () => ({ ok: true }), '/train/2026-09-30');
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'I did something else' }));
    const sheet = await screen.findByRole('dialog', { name: 'Something else' });
    await user.type(within(sheet).getByRole('textbox'), 'air bike 25 min');
    await user.click(within(sheet).getByRole('button', { name: /^Air bike/ }));
    await user.click(within(sheet).getByRole('radio', { name: 'Hard' }));
    expect(within(sheet).getByRole('meter', { name: 'same stimulus' })).toBeInTheDocument();
    expect(within(sheet).getByRole('status').textContent).toMatch(/50 Heart Points/);
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const it = h.stub.source.today('2026-09-30')?.logged.items.find((i) => i.itemId.startsWith('rtSession:'));
      expect(it?.status).toBeDefined();
    });
  });
});

describe('0.6.3 manual log: placement, overlap, weight, no plan, setup state', () => {
  beforeEach(() => clearStoredSwaps());

  async function openLog(path = '/train/2026-09-29', o: { check?: CheckManualActivity; plan?: null; setup?: TrainingSetupSource } = {}) {
    const user = userEvent.setup();
    const log = vi.fn<LogManualActivity>(async () => ({ ok: true }));
    const h = renderLiving(
      <ManualLogProvider value={log}>
        <ManualCheckProvider value={o.check ?? fixedManualCheck(PERSON)}>
          <TrainingSetupProvider value={o.setup ?? fixedTrainingSetup(STUB_TRAINING_PROFILE, CTX)}>
            <TrainPage />
          </TrainingSetupProvider>
        </ManualCheckProvider>
        <Toaster />
      </ManualLogProvider>,
      { route: 'train/:date', path, ...(o.plan === null ? { plan: null } : {}) },
    );
    return { user, log, h };
  }

  it('A27: a past day needs a start or an explicit "time not known"; the start is placed on the app day', async () => {
    const { user, log } = await openLog();
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Log an activity' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
    await user.click(within(sheet).getByRole('button', { name: /^Air bike/ }));
    expect(within(sheet).getByText('Set the start, or say you don’t know the time.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    expect(log).not.toHaveBeenCalled();
    const start = within(sheet).getByLabelText('Started at');
    await user.clear(start);
    await user.type(start, '07:30');
    expect(within(sheet).getByText(/^Ends 07:50$/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(log.mock.calls[0]![0]).toMatchObject({ date: '2026-09-29', startH: 7.5 });
  });

  it('A27: "I don’t know the time" sends no start (the log stays date-only)', async () => {
    const { user, log } = await openLog();
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Log an activity' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
    await user.click(within(sheet).getByRole('button', { name: /^Air bike/ }));
    await user.click(within(sheet).getByRole('checkbox', { name: /I don’t know the time/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(log.mock.calls[0]![0].startH).toBeUndefined();
    // a typed start after midnight (before the rollover) is clock hour 24+ of the app day
    expect(startHOfClock('01:15', 4)).toBe(25.25);
    expect(startHOfClock('07:05', 4)).toBe(7.08);
    expect(startHOfClock('7:5', 4)).toBeUndefined();
  });

  it('A5: an overlap with a recording shows the choice before anything is saved and sends it', async () => {
    const base = fixedManualCheck(PERSON);
    const check: CheckManualActivity = (input) => ({
      ...base(input),
      conflicts: input.startH === undefined ? [] : [{ key: 'K'.repeat(26), entryId: 'E1', overlapPct: 100, status: 'approved', auto: false, exerciseId: 'jog_outdoor', startAt: '2026-10-01T12:00:00.000Z', endAt: '2026-10-01T12:30:00.000Z' }],
    });
    const { user, log } = await openLog('/train/2026-10-01', { check });
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Log an activity' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
    await user.click(within(sheet).getByRole('button', { name: /^Air bike/ }));
    const group = within(sheet).getByRole('group', { name: /Your ring or phone recorded jog/ });
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    expect(log).not.toHaveBeenCalled();
    await user.click(within(group).getByRole('radio', { name: 'The same activity: add these details to it' }));
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(log.mock.calls[0]![0]).toMatchObject({ exerciseId: 'air_bike', resolution: 'link' });
  });

  it('r070: an overlap with activities only the automatic rules counted asks nothing: the log is sent as it is and replaces them', async () => {
    const base = fixedManualCheck(PERSON);
    const check: CheckManualActivity = (input) => ({
      ...base(input),
      conflicts: input.startH === undefined ? [] : [{ key: 'K'.repeat(26), entryId: 'E1', overlapPct: 100, status: 'approved', auto: true, exerciseId: 'jog_outdoor', startAt: '2026-10-01T12:00:00.000Z', endAt: '2026-10-01T12:30:00.000Z' }],
    });
    const { user, log } = await openLog('/train/2026-10-01', { check });
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Log an activity' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
    await user.click(within(sheet).getByRole('button', { name: /^Air bike/ }));
    expect(within(sheet).queryByRole('group', { name: /recorded jog/ })).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(log.mock.calls[0]![0]).toMatchObject({ exerciseId: 'air_bike' });
    expect(log.mock.calls[0]![0]).not.toHaveProperty('resolution');
  });

  // r063 FX3 (aR16): "the same activity" keeps the recording's window and evidence: the preview says so and estimates that
  // window (what the booking saves), and the success toast uses the saved facts, not the typed minutes
  it('aR16: the link preview is the linked recording’s window and estimate; the toast uses the saved minutes', async () => {
    const start = Date.parse('2026-10-01T12:00:00');
    const run = candidate({ key: 'K'.repeat(26), status: 'approved', refs: ['gauge:w-1'], date: '2026-10-01', start, end: start + 60 * 60_000, entryId: 'E1', exerciseId: 'jog_outdoor' });
    const user = userEvent.setup();
    const log = vi.fn<LogManualActivity>(async () => ({ ok: true, saved: { exerciseId: 'air_bike', durationMin: 60, startAt: new Date(start).toISOString(), endAt: new Date(start + 3_600_000).toISOString() } }));
    const check = vi.fn(fixedManualCheck(PERSON, [run]));
    renderLiving(
      <ManualLogProvider value={log}>
        <ManualCheckProvider value={check}>
          <TrainingSetupProvider value={fixedTrainingSetup(STUB_TRAINING_PROFILE, CTX)}>
            <TrainPage />
          </TrainingSetupProvider>
        </ManualCheckProvider>
        <Toaster />
      </ManualLogProvider>,
      { route: 'train/:date', path: '/train/2026-10-01' },
    );
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Log an activity' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
    await user.click(within(sheet).getByRole('button', { name: /^Air bike/ }));
    const group = within(sheet).getByRole('group', { name: /Your ring or phone recorded jog/ });
    const before = within(sheet).getByRole('status').textContent;
    expect(within(sheet).queryByText(/^Saved as the recording/)).toBeNull();
    await user.click(within(group).getByRole('radio', { name: 'The same activity: add these details to it' }));
    // the check ran with the resolution, and the preview is the recording's 60 minutes from the ring
    expect(check).toHaveBeenLastCalledWith(expect.objectContaining({ exerciseId: 'air_bike', resolution: 'link' }));
    expect(within(group).getByText(/^Saved as the recording: .*, 60 min, from your ring recording\. The estimate below is for that time\.$/)).toBeInTheDocument();
    expect(within(sheet).getByRole('status').textContent).not.toBe(before);
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(log.mock.calls[0]![0]).toMatchObject({ exerciseId: 'air_bike', resolution: 'link' });
    expect(await screen.findByText(/^Logged Air bike.* · 60 min$/)).toBeInTheDocument();
  });

  it('S2: without a known weight the sheet says so and does not log', async () => {
    const { user, log } = await openLog('/train/2026-10-01', { check: fixedManualCheck(null) });
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Log an activity' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
    await user.click(within(sheet).getByRole('button', { name: /^Air bike/ }));
    expect(within(sheet).getByText(/needs your body weight/)).toBeInTheDocument();
    expect(within(sheet).queryByRole('status')).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    expect(log).not.toHaveBeenCalled();
  });

  it('S12: the log preview shows the points the booking computes (MET-based), not the stated class', async () => {
    const { user } = await openLog('/train/2026-10-01');
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Log an activity' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
    await user.type(within(sheet).getByRole('textbox'), 'table tennis');
    await user.click(within(sheet).getByRole('button', { name: /^Table tennis/ }));
    await user.click(within(sheet).getByRole('radio', { name: 'Hard' }));
    const field = sheet.querySelector('input[inputmode="numeric"]') as HTMLInputElement | null;
    const minutes = Number(field?.value);
    expect(minutes).toBeGreaterThan(0);
    const want = manualLogPreview(fixedManualCheck(PERSON)(logManualInput('table_tennis', '2026-10-01', { minutes, effort: 'vigorous' }, 13 - minutes / 60)).estimate)!;
    expect(want.points.hi).toBeLessThan(2 * minutes);
    expect(within(sheet).getByRole('status').textContent).toContain(`; ${previewPointsText(want.points)}`);
  });

  it('S24/A7: without a plan Train is the activity hub and logs an activity', async () => {
    const { user, log } = await openLog('/train/2026-10-01', { plan: null });
    const hub = await screen.findByRole('region', { name: 'Activities' }).catch(() => screen.findByText('Activities'));
    expect(hub).toBeTruthy();
    expect(screen.getByText('No plan running')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Log an activity' }));
    const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
    await user.click(within(sheet).getByRole('button', { name: /^Air bike/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
  });

  // (0.6.3 INT) planless Today's "Log an activity" lands here with the sheet open
  it('INT: /train?log=1 opens Log an activity once, with or without a plan', async () => {
    const { h } = await openLog('/train/2026-10-01?log=1', { plan: null });
    expect(await screen.findByRole('dialog', { name: 'Log an activity' })).toBeInTheDocument();
    await waitFor(() => expect(h.router.state.location.search).not.toContain('log=1'));
  });

  // (0.6.3 INT) quiet mode holds on the planless hub too (no day model carries it there): words only, aria too
  it('INT: quiet mode on the activity hub without a plan is words only', async () => {
    act(() => withSystemWrite(() => useSettingsStore.setState({ quietMode: true, quietModeSet: true })));
    try {
      const { user } = await openLog('/train/2026-10-01', { plan: null });
      const hub = await screen.findByRole('region', { name: 'Activities' });
      expectWordsOnly(hub, 'Activities hub');
      await user.click(within(hub).getByRole('button', { name: 'Log an activity' }));
      const sheet = await screen.findByRole('dialog', { name: 'Log an activity' });
      await user.click(within(sheet).getByRole('button', { name: /^Air bike/ }));
      await user.click(within(sheet).getByRole('radio', { name: 'Hard' }));
      expect(within(sheet).getByRole('status')).toHaveTextContent('Earns Heart Points');
      expectWordsOnly(sheet, 'Log an activity (no plan)');
    } finally {
      act(() => withSystemWrite(() => useSettingsStore.setState({ quietMode: false, quietModeSet: false })));
    }
  });

  // (0.6.3 INT, S2) a typical placeholder body may compose a session, never price it as the person's
  it('INT/S2: on a typical body (no weight entered) the session shows no energy and says why; a replaced session refuses its estimate', async () => {
    const typical: TrainingSetupSource = { ...fixedTrainingSetup(STUB_TRAINING_PROFILE, CTX), typicalBody: () => true };
    const { user } = await openLog('/train/2026-09-30', { setup: typical });
    expect(await screen.findByRole('link', { name: 'Add your weight for energy' })).toHaveAttribute('href', '/body');
    expect(screen.queryByText(/kcal/)).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'I did something else' }));
    const sheet = await screen.findByRole('dialog', { name: 'Something else' });
    await user.type(within(sheet).getByRole('textbox'), 'air bike 25 min');
    await user.click(within(sheet).getByRole('button', { name: /^Air bike/ }));
    expect(within(sheet).getByText(/needs your body weight/)).toBeInTheDocument();
    expect(within(sheet).queryByText('Energy above rest')).toBeNull();
    expect(within(sheet).queryByRole('status')).toBeNull();
  });

  it('A33: a live setup that is still loading shows no session and no fixture body', async () => {
    const loading = { profile: () => null, context: () => null, status: () => 'loading' as const };
    renderLiving(
      <TrainingSetupProvider value={loading}>
        <TrainPage />
      </TrainingSetupProvider>,
      { route: 'train/:date', path: '/train/2026-09-30' },
    );
    expect(await screen.findByText('Reading your training setup…')).toBeInTheDocument();
    // nothing composed or estimated: no session face, no date strip
    expect(document.getElementById('session')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
