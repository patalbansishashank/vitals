/**
 * The level matrix section of docs/PLANNER_COVERAGE.md and planner-coverage.json (PLANNER_V2_SPEC §12.6): for every
 * request × tier, each of Hard, Medium, Easy and Ideal is a card or absent with a verified reason (levels.ts). Pure.
 */
import { LEVELS, LEVEL_TIERS, judgeLevels, monotoneViolations, type Level, type LevelDigest, type LevelTier, type LevelVerdict } from './levels';

export interface LevelsSummary {
  requests: number;
  tiers: readonly LevelTier[];
  /** Per tier and level: cards, verified absences, failures. */
  counts: Record<LevelTier, Record<Level, { card: number; absent: number; fail: number }>>;
  cells: Array<{ key: string; tier: LevelTier; verdicts: Array<Pick<LevelVerdict, 'level' | 'state' | 'reason'>> }>;
  failures: string[];
  /** Cards per tier and level before batch 02 (levels.before.json), when given. */
  before: Record<string, Record<string, number>> | null;
}

const TIER_NAME: Readonly<Record<LevelTier, string>> = { S: 'Quick', M: 'Standard', X: 'Exhaustive' };
const LEVEL_NAME: Readonly<Record<Level, string>> = { hard: 'Hard', medium: 'Medium', easy: 'Easy', ideal: 'Ideal' };
const REASON_TEXT: Readonly<Record<string, string>> = {
  belowMinimal: 'goal change below the minimal one',
  tooClose: 'too close in effort to the next plan',
  notDistinct: 'repeats a neighbour',
  noEasy: 'no easier plan, so none in between',
  hardEasySame: 'Hard and Easy too alike, so none in between',
  bandEmpty: 'nothing distinct in between',
  easyProof: 'no easier plan keeps half of Hard',
  easyRejected: 'easier plans failed a safety check',
  sameAsHard: 'the same plan as Hard',
  carried: 'the earlier rung failed against the new Hard',
  noHard: 'no safe plan',
  noSafePlan: 'no safe plan',
  stopped: 'the search was stopped first',
};

export function levelsSummary(chains: ReadonlyArray<Partial<Record<LevelTier, LevelDigest>>>, before: LevelsSummary['before'] = null): LevelsSummary {
  const counts = Object.fromEntries(LEVEL_TIERS.map((t) => [t, Object.fromEntries(LEVELS.map((l) => [l, { card: 0, absent: 0, fail: 0 }]))])) as LevelsSummary['counts'];
  const cells: LevelsSummary['cells'] = [];
  const failures: string[] = [];
  for (const chain of chains) {
    for (const t of LEVEL_TIERS) {
      const d = chain[t];
      if (!d) continue;
      const vs = judgeLevels(d);
      for (const v of vs) {
        counts[t][v.level][v.state]++;
        if (v.state === 'fail') failures.push(`${d.key} ${t} ${v.level}: ${v.why}`);
      }
      cells.push({ key: d.key, tier: t, verdicts: vs.map((v) => ({ level: v.level, state: v.state, reason: v.reason })) });
    }
    const key = Object.values(chain)[0]?.key ?? '?';
    for (const m of monotoneViolations(chain)) failures.push(`${key}: ${m}`);
  }
  return { requests: chains.length, tiers: LEVEL_TIERS, counts, cells, failures, before };
}

/** Markdown section appended to docs/PLANNER_COVERAGE.md (no timings). */
export function levelsMarkdown(s: LevelsSummary, requestName: (key: string) => string): string {
  const out: string[] = [];
  const line = (x = '') => out.push(x);
  line('## 7. Every ladder level at every search length');
  line();
  line(`Each of the ${s.requests} test requests runs the quick, standard and exhaustive searches in that order, each longer search receiving the shorter one's ladder, as the app does. For every level (Hard, Medium, Easy, Ideal) the plan is either shown and valid (safe, distinct — Hard and Easy at least 0.15 apart in effort and 0.20 in plan distance, a Medium between them at least 0.08 in effort and max(0.10, a third of the Hard–Easy distance) in plan distance from each —, ordered by effort, Easy keeps at least half of Hard's goal-1 progress, the Ideal reaches at least Hard's goal 1) or absent with a reason whose numbers the audit checks. The exhaustive search runs with a fixed budget here so the audit finishes in reasonable time.`);
  line();
  line('| Search | Level | Shown | Absent, reason verified | Failed |' + (s.before ? ' Shown before batch 02 |' : ''));
  line('|---|---|---|---|---|' + (s.before ? '---|' : ''));
  for (const t of s.tiers)
    for (const l of LEVELS) {
      const c = s.counts[t][l];
      line(`| ${TIER_NAME[t]} | ${LEVEL_NAME[l]} | ${c.card} | ${c.absent} | ${c.fail} |` + (s.before ? ` ${s.before[t]?.[l] ?? '–'} |` : ''));
    }
  line();
  line('| Request | ' + s.tiers.map((t) => TIER_NAME[t]).join(' | ') + ' |');
  line('|---|' + s.tiers.map(() => '---').join('|') + '|');
  const keys = [...new Set(s.cells.map((c) => c.key))];
  for (const k of keys) {
    const row = s.tiers.map((t) => {
      const c = s.cells.find((q) => q.key === k && q.tier === t);
      if (!c) return '–';
      const shown = c.verdicts.filter((v) => v.state === 'card').map((v) => LEVEL_NAME[v.level]);
      const rest = c.verdicts.filter((v) => v.state !== 'card').map((v) => `${LEVEL_NAME[v.level]}: ${v.state === 'fail' ? `**failed** (${v.reason})` : (REASON_TEXT[v.reason] ?? v.reason)}`);
      return [shown.join(', '), ...rest].filter(Boolean).join('; ');
    });
    line(`| ${requestName(k)} | ${row.join(' | ')} |`);
  }
  line();
  if (s.failures.length) {
    line('Failures:');
    line();
    for (const f of s.failures) line(`- ${f}`);
  } else line('No level is missing without a verified reason, and no longer search shows fewer rungs than a shorter one unless an earlier rung failed a stated check.');
  line();
  return out.join('\n');
}
