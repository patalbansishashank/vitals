import { useId, type ReactNode } from 'react';
import { Faceplate, formatNumber, formatSigned } from '@/components';
import type { BenchStat, BenchSuite, PlannerBenchmarks } from '@/content/evidence/validation/plannerBenchmarks';
import { activityIntakeGroups, ACTIVITY_INTAKE_SNAPSHOT, type RowVerdict } from '@/content/evidence/validation/activityIntake';
import { VALIDATION_ROLE_LABEL } from '@/content/evidence/schema';

/* ------------------------------------------------------------------ number formats */

const pct = (x: number, digits = 0): string => `${formatNumber(x * 100, digits)} %`;
const num = (x: number): string => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-GB') : Number(x.toPrecision(3)).toString());
const secs = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
/** Suite units in words where the raw unit would read oddly. */
const UNIT: Readonly<Record<string, string>> = { frac: '', flag: '(1 = yes)', PAL: '× resting' };
const unit = (u: string): string => UNIT[u] ?? u;
/** A change in percentage points to one decimal with a true minus ("−1.7 pts"); never raw floating-point noise (V-EV-3). */
const pts = (x: number): string => `${formatSigned(x, 1)} pts`;
/** "most runs 50–80 %" under a median, only when the middle 80 % of runs actually spread. */
const spread = (s: BenchStat, fmt: (x: number) => string): string | null => {
  const lo = fmt(s.p10);
  const hi = fmt(s.p90);
  return lo === hi ? null : `most runs ${lo.replace(/ %$/, '')}–${hi}`;
};
/** An algorithm's name without its parenthetical engineering note; the full name stays in Technical details. */
const shortName = (label: string): string => label.replace(/\s*\([^)]*\)\s*$/, '') || label;

/**
 * One table cell's content as a single element, so a phone's label/value grid gets exactly the label and this (V-EV-1/2),
 * with an optional quiet second line under the value.
 */
function Cell({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <span className="ev-cell">
      {children}
      {note ? <span className="ev-table__note">{note}</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ roles (D8-03) */

/**
 * The role of a set of checks, as one status line (C7/D8-03): software verification, development checks against the
 * sources a model was built from, and independent tests on held-out data are kept apart; none of them is presented as
 * another. "Independently tested" appears only beside results from frozen-model evaluations on held-out studies.
 */
export const VALIDATION_ROLE = {
  verification: `${VALIDATION_ROLE_LABEL.verification} · software check under the model, not a test of predictions for people`,
  development: `${VALIDATION_ROLE_LABEL.estimation} · checked against the sources the model was built from, not an independent test`,
  independent: (studies: number) => `${VALIDATION_ROLE_LABEL.externalEvaluation} · ${studies} held-out ${studies === 1 ? 'study' : 'studies'}`,
} as const;

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
  const label = (id: string) => shortName(report.algorithms.find((a) => a.id === id)?.label ?? id);
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
              {/* (r068 final M15) distinct markers: a filled dot for the first series, a hollow square for the second, so
                  two series on the same points still read as two */}
              {r.timeToQuality.map((p) =>
                i % 2 === 0 ? (
                  <circle key={p.evaluations} cx={sx(p.evaluations)} cy={sy(p.solved)} r={4} fill={st.color} stroke="var(--lm-chart-surface)" strokeWidth={2}>
                    <title>{`${label(r.algorithmId)}: ${pct(p.solved)} of targets after ${p.evaluations.toLocaleString('en-GB')} plans`}</title>
                  </circle>
                ) : (
                  <rect key={p.evaluations} x={sx(p.evaluations) - 5} y={sy(p.solved) - 5} width={10} height={10} fill="none" stroke={st.color} strokeWidth={1.5}>
                    <title>{`${label(r.algorithmId)}: ${pct(p.solved)} of targets after ${p.evaluations.toLocaleString('en-GB')} plans`}</title>
                  </rect>
                ),
              )}
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
      {/* D8-03: the role of these checks as one status (software verification under the model, not prediction accuracy) */}
      <p className="ev-valsec__meta">{VALIDATION_ROLE.verification}</p>
      <p>
        How close the Planner's plans come to the best possible plan. Each suite is a set of problems where the best answer is
        known, either by construction, by simulating every possible plan, or as the best plan any method has ever found. Every
        method runs on the same seeds, and a change to the Planner ships only if it is no worse than the current one on every
        suite and better on at least one.
      </p>
      {report === null || report === 'invalid' ? (
        <>
          <p className="ev-valsec__state">The planner benchmarks are not published yet.</p>
          <p className="ev-valsec__note">
            {report === 'invalid'
              ? 'The latest results could not be read; they will appear here once they are regenerated.'
              : 'They will appear here after the first full benchmark run.'}
          </p>
        </>
      ) : (
        <PlannerBenchmarksBody report={report} />
      )}
    </Faceplate>
  );
}

const verdictOf = (s: { superior: boolean; nonInferior: boolean }): 'better' | 'no worse' | 'worse' =>
  s.superior ? 'better' : s.nonInferior ? 'no worse' : 'worse';

/**
 * The benchmark results (r068 V-EV-3/6): a plain verdict first, then one table per question in plain column names with
 * values to one decimal; the run's metadata, the statistical rule and the definitions sit behind Technical details.
 */
function PlannerBenchmarksBody({ report }: { report: PlannerBenchmarks }) {
  const fullName = (id: string) => report.algorithms.find((a) => a.id === id)?.label ?? id;
  const name = (id: string) => shortName(fullName(id));
  const suiteName = (id: string) => report.suites.find((x) => x.id === id)?.label ?? id;
  const g = report.gate;
  const count = (v: ReturnType<typeof verdictOf>) => g.suites.filter((s) => verdictOf(s) === v).length;
  const worse = g.suites.filter((s) => verdictOf(s) === 'worse').map((s) => suiteName(s.suiteId));
  const n = (k: number) => `${k} ${k === 1 ? 'suite' : 'suites'}`;
  const tally = [
    count('better') ? `better on ${n(count('better'))}` : null,
    count('no worse') ? `as good on ${n(count('no worse'))}` : null,
    worse.length ? `worse on ${n(worse.length)} (${worse.join(', ')})` : null,
  ].filter(Boolean);
  const seeds = report.seeds.values;
  return (
    <>
      <h3>Does the new method hold up?</h3>
      <p>
        <strong>{g.passed ? 'Passed.' : 'Not passed.'}</strong> The {name(g.candidateId)} against the {name(g.baselineId)}:{' '}
        {tally.join(', ')}.{' '}
        {g.safetyTestsPassed ? 'Safety and reference-request tests passed.' : 'Safety or reference-request tests failed.'}{' '}
        {g.deterministic ? 'Plans are identical whatever the number of workers.' : 'Plans differ with the number of workers.'}
      </p>
      <div className="ev-scroll" role="region" aria-label="Non-inferiority check by suite" tabIndex={0}>
        <table className="ev-table">
          <thead>
            <tr>
              <th scope="col">Suite</th>
              <th scope="col">Success</th>
              <th scope="col">Shortfall on goal 1</th>
              <th scope="col">New run better</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {g.suites.map((s) => (
              <tr key={s.suiteId}>
                <th scope="row">{suiteName(s.suiteId)}</th>
                <td data-label="Success">
                  <Cell note={`at worst ${pts(s.lexSuccessDiff.lower)}`}>{pts(s.lexSuccessDiff.estimate)}</Cell>
                </td>
                <td data-label="Shortfall on goal 1">
                  <Cell note={`at worst ${pts(s.regretDiff.upper)}`}>{pts(s.regretDiff.estimate)}</Cell>
                </td>
                <td data-label="New run better">
                  <Cell>{pct(s.effectSize)}</Cell>
                </td>
                <td data-label="Verdict">
                  <Cell>{verdictOf(s)}</Cell>
                </td>
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
                  <th scope="col">Success</th>
                  <th scope="col">Shortfall on goal 1</th>
                  <th scope="col">Spread covered</th>
                  <th scope="col">Speed to quality</th>
                  <th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                {suite.results.map((r) => {
                  const shortfall = (x: number) => `${formatNumber(x, 1)} %`;
                  return (
                    <tr key={r.algorithmId}>
                      <th scope="row">{name(r.algorithmId)}</th>
                      <td data-label="Success">
                        <Cell note={spread(r.lexSuccess, pct)}>{pct(r.lexSuccess.median)}</Cell>
                      </td>
                      <td data-label="Shortfall on goal 1">
                        <Cell note={spread(r.regretPct, shortfall)}>{shortfall(r.regretPct.median)}</Cell>
                      </td>
                      <td data-label="Spread covered">
                        <Cell>{r.hypervolume ? pct(r.hypervolume.median) : '—'}</Cell>
                      </td>
                      <td data-label="Speed to quality">
                        <Cell>{formatNumber(r.anytimeScore, 2)}</Cell>
                      </td>
                      <td data-label="Time">
                        <Cell>{secs(r.wallMs.median)}</Cell>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <QualityCurve suite={suite} report={report} />
        </section>
      ))}
      <details className="ev-md__sec ev-valsec__tech">
        <summary className="ev-md__sum">
          <h3>Technical details</h3>
        </summary>
        <div className="ev-md__body">
          <p className="ev-valsec__meta">
            Run {report.generatedAt.slice(0, 10)} · Planner {report.plannerVersion} · model {report.engineVersion} · {report.machine} ·{' '}
            {seeds.length} held-out seeds ({seeds[0]}–{seeds[seeds.length - 1]})
          </p>
          <ul>
            {report.algorithms.map((a) => (
              <li key={a.id}>
                <strong>{shortName(a.label)}</strong> ({a.role === 'candidate' ? 'new' : 'current'}): {a.label}
              </li>
            ))}
          </ul>
          <p>
            The rule: success may not fall by more than {g.margins.lexSuccessPoints} points and the shortfall may not rise by more
            than {g.margins.regretPoints} point, at {g.alpha * 100} % one-sided significance; &ldquo;at worst&rdquo; is that
            one-sided confidence bound.
          </p>
          <p className="ev-valsec__note">
            Success: share of runs where every ranked goal is within half its tolerance of the best answer (&ldquo;most
            runs&rdquo; is the middle 80 %, P10–P90). Shortfall on goal 1 (regret): how far the first goal falls short of the
            best answer. Spread covered (hypervolume): how much of the best possible spread of plans the returned plans cover.
            Speed to quality (anytime score): how quickly quality arrives, from 0 to 1. New run better (effect size): the chance
            that a run of the new method beats a run of the current one (50 % means no difference).
          </p>
        </div>
      </details>
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
      <p className="ev-valsec__meta">{VALIDATION_ROLE.development}</p>
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
                    <td data-label="Target">
                      <Cell>
                        {r.expected} {unit(r.unit)}
                      </Cell>
                    </td>
                    <td data-label="Model">
                      <Cell>
                        {num(r.measured)} {unit(r.unit)}
                      </Cell>
                    </td>
                    <td data-label="Result">
                      <Cell>{VERDICT_TEXT[r.verdict]}</Cell>
                    </td>
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
