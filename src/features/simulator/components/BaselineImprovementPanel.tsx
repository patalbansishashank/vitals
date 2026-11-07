import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Key } from '@/components';
import { jobs } from '@/commands/bus';
import type { ImprovementRunView, ImprovementReport } from '@/commands/defs/improvement';
import '@/commands/defs/improvement';
import { paths } from '@/app/paths';
import { failureMessage, sendCommand } from '@/features/lib/sendCommand';
import type { Scenario } from '@/state/scheduleStore';
import { mergeDay } from '@/engine/planner/domain/dayMath';
import { ruleText } from '@/engine/planner/domain/explain';
import { pairedClassification, pairedExtraFatLossLabel } from './baselineImprovementPresentation';
import './baselineImprovement.css';

type Candidate = ImprovementReport['candidates'][number];

const familyName: Record<Candidate['family'], string> = {
  baseline: 'Original routine',
  mealTiming: 'Meal timing',
  carbCycle: 'Carbohydrate distribution',
  energyCycle: 'Lifting day energy',
  flatMacroControl: 'Steady macro control',
  lowCarbRest: 'Rest day carbohydrate',
  higherProtein: 'Higher protein',
  trainingChange: 'Proposed resistance training',
  trainingPlusProtein: 'Proposed training + protein',
};

function kg(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable';
  return `${signed && value > 0 ? '+' : ''}${value.toFixed(2)} kg`;
}

function weekly(value: number[]): string {
  if (!value.length) return 'Unavailable';
  const rounded = value.map((v) => Math.round(v));
  return rounded.every((v) => v === rounded[0])
    ? `${rounded[0]! > 0 ? '+' : ''}${rounded[0]}`
    : `${Math.min(...rounded)} to ${Math.max(...rounded)}`;
}

function finalBodyFat(value: number | null): string | null {
  return value !== null && Number.isFinite(value) ? `Final body fat ~${value.toFixed(1)}%` : null;
}

function policyReason(candidate: Candidate): string | null {
  const policy = candidate.policy;
  const codes = [...policy.failedMargins, ...policy.inputPolicyFailures];
  if (policy.muscleRetention === 'overBudget') codes.unshift('userMuscleRetention');
  const reasons = [...new Set(codes.map((code) => {
    const known = ruleText(code);
    if (known !== code) return known;
    if (code.startsWith('HC-E')) return 'an energy safety limit';
    if (code.startsWith('HC-M')) return 'a macro safety limit';
    if (code.startsWith('HC-X')) return 'an exercise safety limit';
    if (code.startsWith('HC-P')) return 'a body or safety-mode limit';
    return 'another app policy limit';
  }))];
  if (reasons.length) return `${reasons[0]}${reasons.length > 1 ? ` · ${reasons.length - 1} more` : ''}`;
  if (policy.missingMargins.length) return 'model safety checks unavailable';
  if (policy.muscleRetention === 'unavailable') return 'modeled muscle-loss check unavailable';
  return policy.status === 'blocked' ? 'an app policy check did not pass' : null;
}

function trainingDose(candidate: Candidate): string | null {
  const detail = candidate.trainingDetails;
  if (!detail) return null;
  const minutes = Array.isArray(detail.trainingMinutesByDay)
    ? detail.trainingMinutesByDay.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
    : [];
  const longest = minutes.length ? Math.round(Math.max(...minutes)) : null;
  const name = detail.sourceVariantId === 'progressed-rt' ? 'Progressed whole-body dose' : 'Balanced whole-body dose';
  return `${name}${longest === null ? '' : ` · up to ${longest} min/session`}`;
}

function controls(scenario: Scenario): { energy: number; protein: number } | null {
  const first = scenario.schedule.days[0];
  if (!first) return null;
  const day = mergeDay(scenario.schedule.programs[first.program]!, first.override);
  if (day.energy?.kind !== 'kcal' || day.macros?.protein.unit !== 'g') return null;
  return { energy: day.energy.kcal * 7, protein: day.macros.protein.value * 7 };
}

export function BaselineImprovementPanel({ scenario }: { scenario: Scenario }) {
  const navigate = useNavigate();
  const [view, setView] = useState<ImprovementRunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [includeTraining, setIncludeTraining] = useState(true);
  const [showAll, setShowAll] = useState(false);

  async function compare() {
    setBusy(true);
    setError(null);
    setView(null);
    setProgress(0);
    setShowAll(false);
    const res = await sendCommand('planner.improveCurrent', { scenarioId: scenario.id, draws: 32, includeTrainingChanges: includeTraining }, { silent: true });
    if (!res.ok) {
      setError(failureMessage(res.error) ?? 'Comparison stopped.');
      setBusy(false);
      return;
    }
    if (!('job' in res)) {
      setError('The comparison did not start. Try again.');
      setBusy(false);
      return;
    }
    const id = res.job.jobId;
    const timer = window.setInterval(() => setProgress(jobs.status(id)?.progress ?? 0), 250);
    try {
      const status = await jobs.wait(id);
      if (status.state === 'done') setView(jobs.result(id) as ImprovementRunView);
      else setError(status.state === 'cancelled' ? 'Comparison stopped.' : status.error?.message ?? 'Comparison failed. Try again.');
    } finally {
      window.clearInterval(timer);
      setBusy(false);
    }
  }

  async function open(candidate: Candidate) {
    if (!view) return;
    setOpening(candidate.id);
    setError(null);
    try {
      const res = await sendCommand('planner.openImprovement', { runId: view.runId, candidateId: candidate.id }, { silent: true });
      if (!res.ok) {
        setError(failureMessage(res.error) ?? 'Could not open this diagnostic.');
        return;
      }
      if ('output' in res && res.output) navigate(paths.schedule(res.output.scenarioId));
    } finally {
      setOpening(null);
    }
  }

  const baseline = view?.report.candidates.find((c) => c.id === 'baseline');
  const others = view?.report.candidates.filter((c) => c.id !== 'baseline') ?? [];
  const featuredIds = [view?.report.bestFatLossDiagnosticId, view?.report.bestMuscleWithoutLessFatDiagnosticId];
  if (!featuredIds.some(Boolean)) featuredIds.push(view?.report.bestDiagnosticCandidateId);
  const featured = [...new Set(featuredIds.filter((id): id is string => Boolean(id)))].map((id) => others.find((c) => c.id === id)).filter((c): c is Candidate => Boolean(c));
  const visible = showAll ? others : featured;
  const reference = controls(scenario);

  return (
    <section className="sim-improve" aria-labelledby="sim-improve-title">
      <div className="sim-improve__head">
        <h2 id="sim-improve-title">Compare changes to this routine</h2>
        <Key variant="outlined" size="sm" onClick={() => void compare()} loading={busy} disabledReason={busy ? 'Comparison running' : undefined}>
          {view ? 'Compare again' : 'Compare changes'}
        </Key>
      </div>
      <label className="sim-improve__option"><input type="checkbox" checked={includeTraining} onChange={(event) => setIncludeTraining(event.target.checked)} disabled={busy} /> Include proposed resistance training changes</label>
      {busy ? <p role="status" className="sim-improve__note">Comparing the same model samples across routines · {Math.round(progress * 100)}%</p> : null}
      {error ? <p role="alert" className="sim-improve__error">{error}</p> : null}
      {view?.report.status === 'unsupportedBaseline' ? (
        <p className="sim-improve__note">This comparison needs a fixed daily kcal, protein and fat routine, with net carbohydrate as the remainder, plus lifting and rest days. {view.report.reason}</p>
      ) : null}
      {view?.report.status === 'complete' && baseline ? (
        <>
          <p className="sim-improve__note">Same source routine, model profile and paired samples. Weekly energy stays fixed. Higher-protein rows change weekly protein; training rows change the proposed resistance dose on the original lifting days. Model estimates are not personal guarantees.</p>
          {view.report.trainingUnavailableReason ? <p className="sim-improve__note">Training comparisons unavailable: {view.report.trainingUnavailableReason}</p> : null}
          <p className="sim-improve__note">{view.report.baselineDominatorIds.length ? `Showing ${featured.length} diagnostic representative${featured.length === 1 ? '' : 's'} from ${others.length} evaluated changes.` : `No candidate consistently improved both modeled outcomes in this bounded comparison of ${others.length} changes. ${featured.length ? 'The highest ranked diagnostic appears below.' : ''}`}</p>
          {reference ? <p className="sim-improve__note">Original weekly intake: {Math.round(reference.energy)} kcal · {Math.round(reference.protein)} g protein. Δ columns below compare each routine with this reference.</p> : null}
          <div className="sim-improve__table-wrap" role="region" aria-label="Routine comparisons; scroll horizontally for all columns" tabIndex={0}>
            <table className="sim-improve__table">
              <caption>Changes compared with {view.sourceName}</caption>
              <thead><tr><th scope="col">Routine</th><th scope="col">Weekly energy Δ</th><th scope="col">Weekly protein Δ</th><th scope="col">Modeled fat loss</th><th scope="col">Modeled skeletal muscle Δ</th><th scope="col">Paired vs original</th><th scope="col">Policy</th><th scope="col">Diagnostic</th></tr></thead>
              <tbody>
                <tr className="sim-improve__baseline"><th scope="row">Original · {view.sourceName}</th><td>0 kcal</td><td>0 g</td><td>{kg(baseline.nominal.fatLossKg)}{finalBodyFat(baseline.nominal.bodyFatPct) ? <small>{finalBodyFat(baseline.nominal.bodyFatPct)}</small> : null}</td><td>{kg(baseline.nominal.skeletalMuscleChangeKg, true)}</td><td>Reference</td><td>{baseline.policy.status === 'blocked' ? 'Blocked' : 'Not established'}{policyReason(baseline) ? <small>App policy: {policyReason(baseline)}</small> : null}</td><td>Current routine</td></tr>
                {visible.map((c) => <tr key={c.id}>
                  <th scope="row"><span>{c.trainingVariantId && c.nutritionFamily !== 'baseline' ? `${familyName[c.nutritionFamily]} + proposed training` : familyName[c.family]}</span><small>{[c.id === view.report.bestFatLossDiagnosticId ? 'Most modeled fat loss · diagnostic' : null, c.id === view.report.bestMuscleWithoutLessFatDiagnosticId ? 'Most modeled muscle without less fat · diagnostic' : null, !view.report.baselineDominatorIds.length && c.id === view.report.bestDiagnosticCandidateId ? 'Highest ranked diagnostic · no consistent gain' : null, trainingDose(c) ?? c.id].filter(Boolean).join(' · ')}</small></th>
                  <td>{weekly(c.conservation.weeklyEnergyKcalDelta)} kcal</td>
                  <td>{weekly(c.conservation.weeklyProteinGDelta)} g</td>
                  <td>{kg(c.nominal.fatLossKg)}{finalBodyFat(c.nominal.bodyFatPct) ? <small>{finalBodyFat(c.nominal.bodyFatPct)}</small> : null}<small>paired extra loss {pairedExtraFatLossLabel(c.vsBaseline?.meanFatDeltaKg ?? null)}</small></td>
                  <td>{kg(c.nominal.skeletalMuscleChangeKg, true)}<small>paired {kg(c.vsBaseline?.meanMuscleDeltaKg ?? null, true)}</small></td>
                  <td>{pairedClassification(c.vsBaseline)}{c.vsSameTrainingNutritionControl ? <small>nutrition effect, same training: {c.vsSameTrainingNutritionControl.dominatesComparator ? 'model gain' : 'no consistent gain'}</small> : null}{c.vsExerciseMatchedControl ? <small>training effect, same nutrition: {c.vsExerciseMatchedControl.dominatesComparator ? 'model gain' : 'no consistent gain'}</small> : null}</td>
                  <td>{c.policy.status === 'blocked' ? 'Blocked' : 'Not established'}{policyReason(c) ? <small>App policy: {policyReason(c)}</small> : null}</td>
                  <td><Key size="sm" variant="quiet" loading={opening === c.id} disabledReason={opening ? 'Opening diagnostic' : undefined} onClick={() => void open(c)}>Open diagnostic</Key></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {others.length > featured.length ? <Key size="sm" variant="quiet" className="sim-improve__show-all" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Show representatives' : `Show all ${others.length} changes`}</Key> : null}
          <p className="sim-improve__note">Paired values are changes against the original routine: positive extra fat loss means less remaining fat; positive muscle change means more modeled skeletal muscle. Policy status is separate from model comparison. Every opened routine is diagnostic and needs separate safety review before adoption.</p>
        </>
      ) : null}
    </section>
  );
}
