/**
 * Activity intake validation, as the Evidence › Validation page shows it: the validation suite's activity-intake rows
 * (questionnaire answers → maintenance energy, against published activity tables and energy-expenditure equations),
 * with the measured value of each row from the last run and, for rows that miss, the reason in plain words.
 *
 * The suite itself is test-only code (it runs the engine), so the page reads a snapshot of its results
 * (`activityIntake.snapshot.json`), written and checked by `__tests__/activityIntakeSnapshot.test.ts`: the test re-runs
 * the rows and fails when the snapshot is stale or a row has no copy here. Regenerate with
 * `VITALS_UPDATE_SNAPSHOTS=1 pnpm vitest run src/content/evidence/validation`.
 *
 * All text here is user-visible: plain words, published sources by author and year, no research-note or ruling ids.
 */
import snapshot from './activityIntake.snapshot.json';

/** One row of the suite as recorded in the snapshot. */
export interface ActivityIntakeSnapshotRow {
  /** `${scenarioId}/${expectationId}` in the suite. */
  key: string;
  measured: number;
  unit: string;
  /** The acceptance region, e.g. "[1.4, 1.5]" or "0 ± 342". */
  expected: string;
  /** Suite outcome: 'pass' | 'q-pass' (pass of a quality row) | 'miss' | 'known-miss' | 'q-miss'. */
  status: string;
  /** Set when the row is in the suite's register of known misses: 'accepted' or an 'open' calibration item. */
  knownMiss?: 'accepted' | 'open';
}

export interface ActivityIntakeSnapshot {
  /** Date of the run (YYYY-MM-DD). */
  generated: string;
  rows: ActivityIntakeSnapshotRow[];
}

export const ACTIVITY_INTAKE_SNAPSHOT = snapshot as ActivityIntakeSnapshot;

export interface ActivityIntakeGroupCopy {
  /** Scenario id in the suite. */
  scenarioId: string;
  title: string;
  /** What is compared, and with what. */
  description: string;
  /** Published source(s) of the targets, by author and year. */
  source: string;
  /** Row label by expectation id. */
  rows: Readonly<Record<string, string>>;
}

const ARCHETYPE_LABEL: Readonly<Record<string, string>> = {
  deskLittle: 'desk job, little moving (5,000 steps)',
  deskOrdinary: 'desk job, ordinary day (6,000–7,000 steps)',
  mixed: 'mixed sitting and moving job',
  onFeet: 'on feet all day (retail)',
  delivery: 'walking delivery round',
  trades: 'trades work',
  heavy: 'heavy manual work',
  notWorking: 'not working, busy at home',
};
const NASEM_LABEL: Readonly<Record<string, string>> = {
  adl: 'daily living only (desk, 5,000 steps) vs the "inactive" equation',
  walk: 'daily living plus an hour of brisk walking vs the "low active" equation',
  very: 'daily living plus cycling, jogging and tennis every day vs the "very active" equation',
  skip: 'every question skipped vs the "low active" equation',
};
const bySex = (labels: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(labels).flatMap(([id, l]) => [
      [`m-${id}`, `Man: ${l}`],
      [`f-${id}`, `Woman: ${l}`],
    ]),
  );

/** One group per suite scenario, in the suite's order. */
export const ACTIVITY_INTAKE_GROUPS: readonly ActivityIntakeGroupCopy[] = [
  {
    scenarioId: 'R1-V1-fao-lifestyle-pal',
    title: 'Typical days against the international lifestyle table',
    description:
      'Eight typical answer sets, for a reference man and woman: does the activity level the intake implies (daily energy divided by resting energy) land in the band the international lifestyle table gives for that way of life?',
    source: 'FAO/WHO/UNU 2004',
    rows: bySex(ARCHETYPE_LABEL),
  },
  {
    scenarioId: 'R1-V2-nasem-categories',
    title: 'Against the doubly labelled water equations',
    description:
      'Maintenance from the intake minus the prediction of the equations fitted to doubly labelled water measurements, for the matching activity category; the target is within one standard error of the equation.',
    source: 'NASEM 2023',
    rows: bySex(NASEM_LABEL),
  },
  {
    scenarioId: 'R1-V3-skip-all-population',
    title: 'Everything skipped, twenty different adults',
    description:
      'When every question is skipped, the activity level of twenty synthetic adults (both sexes, three ages, three body sizes, plus two) should sit in the "low active" band of the doubly labelled water equations.',
    source: 'NASEM 2023',
    rows: {
      min: 'Lowest activity level of the twenty (at least 1.50)',
      max: 'Highest activity level of the twenty (at most 1.65)',
      share153: 'Share of the twenty above the "inactive" band (1.53 or more)',
    },
  },
  {
    scenarioId: 'R1-V4-iaea-dlw-pi',
    title: 'Inside the range real people measure',
    description:
      'Every typical day, for each of the twenty synthetic adults, should fall inside the 95 % prediction interval of the large international database of doubly labelled water measurements.',
    source: 'Bajunaid 2025 (international doubly labelled water database)',
    rows: {
      insidePi: 'Smallest margin inside the 95 % prediction interval, over all 200 cases',
      skipBias: 'Typical shortfall of the everything-skipped estimate against the database prediction',
    },
  },
  {
    scenarioId: 'R1-V5-V10-intake-anchors',
    title: 'Single answers against single studies',
    description:
      'Each part of the mapping checked on its own: standing, the energy of steps, the spacing of job categories, the long-run fall in job energy, postal workers, and the ceiling on implausible answers.',
    source: 'Saeidifard 2018; Ohkawara 2011; InterAct 2012; Church 2011; Tigbe 2011; FAO/WHO/UNU 2004; NASEM 2023',
    rows: {
      v5stand: 'Standing instead of sitting for 6 hours a day at 65 kg (about +54 kcal a day)',
      v6steps: 'About 20,600 extra steps a day at 64.5 kg (about +588 kcal a day)',
      v7male: 'Men: smallest energy step between neighbouring job categories',
      v7female: 'Women: smallest energy step between neighbouring job categories',
      v8men: 'Men: fall in job energy as moderate jobs went from half to a fifth of all jobs',
      v8all: 'Men and women: average fall in job energy (at least 100 kcal a day)',
      v9postal: 'Walking against office postal workers: difference in daily energy',
      v10cap: 'Implausibly active answers: the activity level is capped at 2.5',
      v10flag: 'The same answers are flagged as capped',
      v10warn: 'A heavy labourer who also does a lot of hard sport is asked to confirm',
    },
  },
  {
    scenarioId: 'R1-V11-rmaint-invariance',
    title: 'Living as usual keeps weight steady',
    description:
      'With the answers given and the usual week replayed as the plan, the model should make no extra activity adjustment and the weight should not drift over 30 days.',
    source: 'Model consistency check',
    rows: {
      heavyAdj: 'Heavy manual work: largest extra activity adjustment',
      heavyFm: 'Heavy manual work: change in fat mass after 30 days',
      heavyScale: 'Heavy manual work: change on the scale after 30 days',
      skipAdj: 'Everything skipped: largest extra activity adjustment',
      skipFm: 'Everything skipped: change in fat mass after 30 days',
      skipScale: 'Everything skipped: change on the scale after 30 days',
    },
  },
  {
    scenarioId: 'R1-V12-V13-band-and-sleep',
    title: 'Honest uncertainty',
    description:
      'The maintenance estimate carries a band at least as wide as the error of the best published equations, wider when questions are skipped, narrower when a step count is added; bed and wake times alone do not move it.',
    source: 'NASEM 2023; Hong 2024',
    rows: {
      answered: 'Questions answered: relative uncertainty at least 10 %',
      skipped: 'Everything skipped: relative uncertainty at least 12 %',
      wristNarrows: 'Adding a wrist step count narrows the band',
      sleep: 'Moving bed and wake times does not change the estimate',
    },
  },
  {
    scenarioId: 'R1-steady-desk-vs-manual',
    title: 'Same body, different job, full simulation',
    description:
      'The same person simulated for four weeks with a desk job, a trade and heavy manual work: the gaps in daily energy should match the lifestyle table, and each should stay weight-stable at its own maintenance.',
    source: 'FAO/WHO/UNU 2004',
    rows: {
      heavyDesk: 'Heavy manual minus desk, in units of resting energy',
      tradesDesk: 'Trades minus desk, in units of resting energy',
      deskStable: 'Desk job: change on the scale after 28 days',
      tradesStable: 'Trades: change on the scale after 28 days',
      heavyStable: 'Heavy manual work: change on the scale after 28 days',
      deskTee: 'Desk job: simulated daily energy against the intake estimate',
      heavyTee: 'Heavy manual work: simulated daily energy against the intake estimate',
    },
  },
];

/** Why rows miss, in plain words (the suite keeps the full notes). Keyed by `${scenarioId}/${expectationId}`. */
export const ACTIVITY_INTAKE_MISS_REASONS: Readonly<Record<string, string>> = (() => {
  const tef =
    'Just below the band: the model works out the energy cost of digesting food from a typical diet (about 8.7 % of intake) rather than the round 10 % the mapping was designed with, which lowers every activity level by about 1.4 %.';
  const out: Record<string, string> = {};
  for (const s of ['m', 'f']) {
    out[`R1-V1-fao-lifestyle-pal/${s}-deskLittle`] = tef;
    out[`R1-V1-fao-lifestyle-pal/${s}-onFeet`] = tef;
  }
  out['R1-V3-skip-all-population/share153'] =
    'A quality row, not a pass-or-fail one: lean young adults sit just under 1.53 for the same digestion-cost reason.';
  return out;
})();

export type RowVerdict = 'pass' | 'accepted-miss' | 'open-miss' | 'miss';

export interface ActivityIntakeRowView {
  key: string;
  label: string;
  measured: number;
  unit: string;
  expected: string;
  verdict: RowVerdict;
  reason?: string;
}

export interface ActivityIntakeGroupView extends Omit<ActivityIntakeGroupCopy, 'rows'> {
  rows: ActivityIntakeRowView[];
}

export function rowVerdict(r: ActivityIntakeSnapshotRow): RowVerdict {
  if (r.status === 'pass' || r.status === 'q-pass') return 'pass';
  if (r.knownMiss === 'open') return 'open-miss';
  if (r.knownMiss === 'accepted' || r.status === 'q-miss' || r.status === 'known-miss') return 'accepted-miss';
  return 'miss';
}

/** The snapshot grouped and labelled for the page; rows without copy are left out (a test keeps that list empty). */
export function activityIntakeGroups(snap: ActivityIntakeSnapshot = ACTIVITY_INTAKE_SNAPSHOT): ActivityIntakeGroupView[] {
  const byKey = new Map(snap.rows.map((r) => [r.key, r]));
  return ACTIVITY_INTAKE_GROUPS.map(({ rows, ...g }) => ({
    ...g,
    rows: Object.entries(rows).flatMap(([id, label]) => {
      const key = `${g.scenarioId}/${id}`;
      const r = byKey.get(key);
      if (!r) return [];
      const reason = ACTIVITY_INTAKE_MISS_REASONS[key];
      return [{ key, label, measured: r.measured, unit: r.unit, expected: r.expected, verdict: rowVerdict(r), ...(reason ? { reason } : {}) }];
    }),
  }));
}
