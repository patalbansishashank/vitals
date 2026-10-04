import { useId } from 'react';
import { Faceplate, Notice } from '@/components';
import type { BenchSuite, PlannerBenchmarks } from '@/content/evidence/validation/plannerBenchmarks';
import { activityIntakeGroups, ACTIVITY_INTAKE_SNAPSHOT, type RowVerdict } from '@/content/evidence/validation/activityIntake';

/* ------------------------------------------------------------------ number formats */

const pct = (x: number, digits = 0): string => `${(x * 100).toFixed(digits)} %`;
const num = (x: number): string => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-GB') : Number(x.toPrecision(3)).toString());
const secs = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
/** Suite units in words where the raw unit would read oddly. */
const UNIT: Readonly<Record<string, string>> = { frac: '', flag: '(1 = yes)', PAL: '× resting' };
const unit = (u: string): string => UNIT[u] ?? u;
const signed = (x: number, unit: string): string => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)} ${unit}`;

/* ------------------------------------------------------------------ planner benchmarks */

const SERIES_STYLE = [
  { color: 'var(--lm-series-1)', dash: undefined },
  { color: 'var(--lm-series-2)', dash: '6 4' },
] as const;

const REFERENCE_TEXT: Record<BenchSuite['reference'], string> = {
  analytic: 'known by construction',
  exhaustive: 'every plan simulated',
  'best-known': 'best plan ever found',
};

/** Time-to-quality curves of one suite: share of targets reached against plan evaluations (log scale). */
function QualityCurve({ suite, report }: { suite: BenchSuite; report: PlannerBenchmarks }) {
  const titleId = useId();
  const W = 320;
  const H = 150;
  const pad = { l: 36, r: 10, t: 8, b: 28 };
  const pts = suite.results.flatMap((r) => r.timeToQuality);
  if (pts.length === 0) return null;
  const xs = pts.map((p) => Math.log10(Math.max(1, p.evaluations)));
  const x0 = Math.floor(Math.min(...xs));
  const x1 = Math.ceil(Math.max(...xs));
  const sx = (e: number) => pad.l + ((Math.log10(Math.max(1, e)) - x0) / Math.max(1, x1 - x0)) * (W - pad.l - pad.r);
  const sy = (s: number) => pad.t + (1 - s) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: x1 - x0 + 1 }, (_, i) => 10 ** (x0 + i));
  const label = (id: string) => report.algorithms.find((a) => a.id === id)?.label ?? id;
  return (
    <figure className="ev-bench__chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} className="ev-bench__svg">
        <title id={titleId}>{`${suite.label}: share of quality targets reached against the number of plans evaluated`}</title>
        {[0, 0.5, 1].map((s) => (
          <g key={s}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(s)} y2={sy(s)} stroke="var(--lm-chart-grid)" strokeWidth={1} />
            <text x={pad.l - 6} y={sy(s) + 4} textAnchor="end" className="ev-bench__tick">{`${s * 100} %`}</text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={sx(t)} y={H - 10} textAnchor="middle" className="ev-bench__tick">
            {t >= 1000 ? `${t / 1000}k` : t}
          </text>
        ))}
        {suite.results.map((r, i) => {
          const st = SERIES_STYLE[i % SERIES_STYLE.length]!;
          const d = r.timeToQuality.map((p, j) => `${j ? 'L' : 'M'}${sx(p.evaluations).toFixed(1)},${sy(p.solved).toFixed(1)}`).join(' ');
          return (
            <g key={r.algorithmId}>
              <path d={d} fill="none" stroke={st.color} strokeWidth={2} strokeDasharray={st.dash} strokeLinejoin="round" />
              {r.timeToQuality.map((p) => (
                <circle key={p.evaluations} cx={sx(p.evaluations)} cy={sy(p.solved)} r={4} fill={st.color} stroke="var(--lm-chart-surface)" strokeWidth={2}>
                  <title>{`${label(r.algorithmId)}: ${pct(p.solved)} of targets after ${p.evaluations.toLocaleString('en-GB')} plans`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption className="ev-bench__legend">
        {suite.results.map((r, i) => {
          const st = SERIES_STYLE[i % SERIES_STYLE.length]!;
          return (
            <span key={r.algorithmId} className="ev-bench__key">
              <svg width="22" height="8" aria-hidden="true">
                <line x1="1" x2="21" y1="4" y2="4" stroke={st.color} strokeWidth={2} strokeDasharray={st.dash} />
              </svg>
              {label(r.algorithmId)}
            </span>
          );
        })}
        <span className="ev-bench__axis">plans evaluated (log scale) → share of targets reached</span>
      </figcaption>
    </figure>
  );
}

export function PlannerBenchmarksSection({ report }: { report: PlannerBenchmarks | null | 'invalid' }) {
  return (
    <Faceplate as="section" className="ev-md ev-valsec" aria-labelledby="planner-benchmarks">
      <h2 id="planner-benchmarks">Planner benchmarks</h2>
      <p>
        How close the Planner's plans come to the best possible plan. Each suite is a set of problems where the best answer is
        known, either by construction, by simulating every possible plan, or as the best plan any method has ever found. Every
        method runs on the same seeds, and a change to the Planner ships only if it is no worse than the current one on every
        suite and better on at least one.
      </p>
      {report === null || report === 'invalid' ? (
        <Notice severity="info" layout="ruled" title="The planner benchmarks are not published yet.">
          <p>
            {report === 'invalid'
              ? 'The latest results could not be read; they will appear here once they are regenerated.'
              : 'They will appear here after the first full benchmark run.'}
          </p>
        </Notice>
      ) : (
        <PlannerBenchmarksBody report={report} />
      )}
    </Faceplate>
  );
}

function PlannerBenchmarksBody({ report }: { report: PlannerBenchmarks }) {
  const label = (id: string) => report.algorithms.find((a) => a.id === id)?.label ?? id;
  const g = report.gate;
  return (
    <>
      <p className="ev-valsec__meta">
        Run {report.generatedAt.slice(0, 10)} · Planner {report.plannerVersion} · model {report.engineVersion} · {report.machine} ·{' '}
        {report.seeds.values.length} held-out seeds ({report.seeds.values[0]}–{report.seeds.values[report.seeds.values.length - 1]})
      </p>
      <h3>Does the new method hold up?</h3>
      <p>
        <strong>{g.passed ? 'Passed.' : 'Not passed.'}</strong> {label(g.candidateId)} against {label(g.baselineId)}: success
        may not fall by more than {g.margins.lexSuccessPoints} points and regret may not rise by more than{' '}
        {g.margins.regretPoints} point, at {g.alpha * 100} % one-sided significance.{' '}
        {g.safetyTestsPassed ? 'Safety and reference-request tests passed.' : 'Safety or reference-request tests failed.'}{' '}
        {g.deterministic ? 'Plans are identical whatever the number of workers.' : 'Plans differ with the number of workers.'}
      </p>
      <div className="ev-scroll" role="region" aria-label="Non-inferiority check by suite" tabIndex={0}>
        <table className="ev-table">
          <thead>
            <tr>
              <th scope="col">Suite</th>
              <th scope="col">Success change (lower bound)</th>
              <th scope="col">Regret change (upper bound)</th>
              <th scope="col">Effect size</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {g.suites.map((s) => (
              <tr key={s.suiteId}>
                <th scope="row">{report.suites.find((x) => x.id === s.suiteId)?.label ?? s.suiteId}</th>
                <td>
                  {signed(s.lexSuccessDiff.estimate, 'pts')} ({signed(s.lexSuccessDiff.lower, 'pts')})
                </td>
                <td>
                  {signed(s.regretDiff.estimate, 'pts')} ({signed(s.regretDiff.upper, 'pts')})
                </td>
                <td>{s.effectSize.toFixed(2)}</td>
                <td>{s.superior ? 'better' : s.nonInferior ? 'no worse' : 'worse'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.suites.map((suite) => (
        <section key={suite.id} aria-labelledby={`bench-${suite.id}`}>
          <h3 id={`bench-${suite.id}`}>{suite.label}</h3>
          <p>
            {suite.description} {suite.problems} problems; reference: {REFERENCE_TEXT[suite.reference]}.
          </p>
          <div className="ev-scroll" role="region" aria-label={`${suite.label}: results by method`} tabIndex={0}>
            <table className="ev-table">
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Success (P10–P90)</th>
                  <th scope="col">Regret on goal 1</th>
                  <th scope="col">Ladder coverage</th>
                  <th scope="col">Anytime score</th>
                  <th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                {suite.results.map((r) => (
                  <tr key={r.algorithmId}>
                    <th scope="row">{label(r.algorithmId)}</th>
                    <td>
                      {pct(r.lexSuccess.median)} ({pct(r.lexSuccess.p10)}–{pct(r.lexSuccess.p90)})
                    </td>
                    <td>
                      {num(r.regretPct.median)} % ({num(r.regretPct.p10)}–{num(r.regretPct.p90)})
                    </td>
                    <td>{r.hypervolume ? pct(r.hypervolume.median) : '—'}</td>
                    <td>{r.anytimeScore.toFixed(2)}</td>
                    <td>{secs(r.wallMs.median)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <QualityCurve suite={suite} report={report} />
        </section>
      ))}
      <p className="ev-valsec__note">
        Success: share of runs where every ranked goal is within half its tolerance of the best answer. Regret: how far the
        first goal falls short of the best answer. Ladder coverage: how much of the best possible spread of plans the
        returned plans cover. Anytime score: how quickly quality arrives, from 0 to 1. Effect size: the chance that a run of
        the new method beats a run of the current one (0.5 means no difference).
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ activity intake */

const VERDICT_TEXT: Record<RowVerdict, string> = {
  pass: 'pass',
  'accepted-miss': 'known miss',
  'open-miss': 'open question',
  miss: 'miss',
};

export function ActivityIntakeValidationSection() {
  const groups = activityIntakeGroups();
  const rows = groups.flatMap((g) => g.rows);
  const passed = rows.filter((r) => r.verdict === 'pass').length;
  return (
    <Faceplate as="section" className="ev-md ev-valsec" aria-labelledby="activity-intake-validation">
      <h2 id="activity-intake-validation">Activity intake validation</h2>
      <p>
        The questions about a normal day (work, steps, time on your feet, sport) set the maintenance estimate every plan starts
        from. Here the mapping from answers to energy is checked against published activity tables, equations fitted to
        doubly labelled water measurements, and single studies. {passed} of {rows.length} checks pass; the rest are explained
        below each table. Last run {ACTIVITY_INTAKE_SNAPSHOT.generated}.
      </p>
      {groups.map((g) => (
        <section key={g.scenarioId} aria-labelledby={`ai-${g.scenarioId}`}>
          <h3 id={`ai-${g.scenarioId}`}>{g.title}</h3>
          <p>
            {g.description} <span className="ev-valsec__src">Source: {g.source}.</span>
          </p>
          <div className="ev-scroll" role="region" aria-label={g.title} tabIndex={0}>
            <table className="ev-table">
              <thead>
                <tr>
                  <th scope="col">Check</th>
                  <th scope="col">Target</th>
                  <th scope="col">Model</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.key} data-verdict={r.verdict}>
                    <th scope="row">{r.label}</th>
                    <td>
                      {r.expected} {unit(r.unit)}
                    </td>
                    <td>
                      {num(r.measured)} {unit(r.unit)}
                    </td>
                    <td>{VERDICT_TEXT[r.verdict]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {g.rows.some((r) => r.reason) && (
            <ul className="ev-valsec__reasons">
              {g.rows
                .filter((r) => r.reason)
                .map((r) => (
                  <li key={r.key}>
                    <strong>{r.label}:</strong> {r.reason}
                  </li>
                ))}
            </ul>
          )}
        </section>
      ))}
    </Faceplate>
  );
}
