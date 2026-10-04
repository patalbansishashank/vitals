import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { IconKey, KeyValueList, Notice, Section, StatusMark, energyInText, formatNumber } from '@/components';
import { DisclaimerLine, lockLines, type PlannerLock } from '@/features/onboarding';
import type { GoalFeasibility, PlannerRequest, PlannerResultV2 } from '@/engine/planner/domain/types';
import { useEnergyUnit, type UnitSystem } from '@/state/settingsStore';
import { goalMetric } from '../catalogue';
import { fmtKcal, fmtMetric, fmtPct } from '../format';
import { RUNG_TITLE, isRung, outcomeView, type LadderPlan, type PlanKind } from '../ladder';
import { phaseBalance, type PhaseFact } from '../planFacts';
import type { Prescription } from '../prescription';
import { BurdenScale } from './BurdenScale';
import { RivalTable } from './FastingLine';
import { LimitCosts, limitCostSentence } from './LimitCosts';
import { EXCLUDABLE } from './LimitsPanel';
import { PhaseTimeline, safetyItemsOf } from './PlanParts';

/* -------------------------------------------------------------------------------------------- overview */

export interface OverviewTabProps {
  kind: PlanKind;
  plan: LadderPlan;
  v2: PlannerResultV2;
  request: PlannerRequest;
  phases: readonly PhaseFact[];
  rx: Prescription | null;
  feasibility: readonly GoalFeasibility[];
  units: UnitSystem;
  onWhy: (metricId: string) => void;
  /** Run-level relations already shown above (not repeated here). */
  relations?: readonly string[];
  gentle?: boolean;
  /** The figure and visceral view, start → end (rungs only; the Ideal is shown in numbers only). */
  figure?: ReactNode;
}

const r0 = (x: number) => formatNumber(x, 0);

function sameThroughout(rx: Prescription): string[] {
  const eating = rx.days.filter((d) => !d.zero);
  if (!eating.length) return [];
  const out: string[] = [];
  // fast days (the day a fast starts or ends) eat less by design; "the same" describes the ordinary eating days
  const ordinary = eating.filter((d) => !d.fast);
  const prot = (ordinary.length ? ordinary : eating).map((d) => d.proteinG);
  const pLo = Math.min(...prot);
  const pHi = Math.max(...prot);
  if (pHi - pLo < 8) out.push(`protein about ${r0((pLo + pHi) / 2)} g a day${ordinary.length < eating.length ? ' outside fasts' : ''}`);
  else if (pHi <= pLo * 1.15) out.push(`protein ${r0(pLo)}–${r0(pHi)} g a day${ordinary.length < eating.length ? ' outside fasts' : ''}`);
  const sleep = rx.days.map((d) => d.sleepHours);
  if (Math.max(...sleep) - Math.min(...sleep) < 0.25) out.push(`sleep ${formatNumber(sleep[0]!, 1)} h`);
  const meals = eating.map((d) => d.meals.length);
  if (Math.max(...meals) === Math.min(...meals)) out.push(`${meals[0]} meals on eating days`);
  return out;
}

/**
 * Overview tab (plan-ladder.md §6.6): phases in detail, the seven burdens in full, time to target, the fasting
 * explanation, what stays the same, decision stability, chance of reaching each target, levers and the figure.
 */
export function OverviewTab({ kind, plan, v2, request, phases, rx, feasibility, units, onWhy, relations = [], gentle = false, figure }: OverviewTabProps) {
  const energy = useEnergyUnit();
  const s = plan.summary;
  const title = RUNG_TITLE[kind];
  const notes = plan.notes.filter((t) => !relations.includes(t));
  const goal1 = request.goals[0]?.metric;
  const met = (i: number) => {
    const o = s.outcomes.find((x) => x.goal === i);
    return o?.verdict === 'reached' || o?.verdict === 'kept';
  };
  // the feasibility texts speak of the Hard plan; shown with Hard (and wherever this plan does not meet the target)
  const needs = feasibility.filter((f) => f.status === 'unattainable' && (f.requiredWeeks !== null || !!f.text) && !met(f.goal));
  const explanation = plan.explanation.filter((t) => !/^The largest single lever/i.test(t) && t !== plan.fasting?.text);
  const levers = plan.contributions.filter((c) => Math.abs(c.deltaGoal1) >= 0.5);
  const quick = v2.provenance.tier === 'S';
  const ttt = s.outcomes
    .filter((o) => o.tttText && request.goals[o.goal]?.target !== undefined)
    .map((o) => {
      const v = outcomeView(o, request.goals[o.goal], kind, units, { energy, roundChance: quick });
      return { key: o.goal, text: `${o.goal + 1} · ${v.name}: ${o.tttText}`, chance: o.pTargetMet };
    });
  const chances = s.outcomes.filter((o) => o.pTargetMet !== null && Number.isFinite(o.pTargetMet) && request.goals[o.goal]?.target !== undefined && o.verdict !== 'kept');
  return (
    <div className="lp-overview">
      {phases.length ? <PhaseTimeline phases={phases} days={request.horizonDays} size="detail" scale /> : null}
      {phases.length ? (
        <div className="lp-table-wrap">
          <table className="lp-phase-table">
            <caption className="lm-sr">Phases of the {title} plan</caption>
            <thead>
              <tr>
                <th scope="col">phase</th>
                <th scope="col">weeks</th>
                <th scope="col" className="num">
                  energy
                </th>
                <th scope="col" className="num">
                  protein · carbs · fat
                </th>
                <th scope="col">what and why</th>
              </tr>
            </thead>
            <tbody>
              {phases.map((p, i) => (
                <tr key={`${p.startDay}-${i}`}>
                  <th scope="row">
                    <span className="lp-phase-dot" data-tone={p.tone} aria-hidden="true" />
                    {energyInText(p.name, energy)}
                  </th>
                  <td className="lm-num">
                    {Math.floor(p.startDay / 7) + 1}–{Math.ceil(p.endDay / 7)}
                  </td>
                  <td className="num lm-num">
                    {/* the engine's phase % (the number in its name and summary), never one recomputed from the days */}
                    {p.enginePct !== null ? fmtPct(p.enginePct) : '—'}
                    {p.enginePct !== null && p.enginePctOtherDays ? <span className="lp-phase-table__bal">other days</span> : null}
                    {phaseBalance(p) ? <span className="lp-phase-table__bal">{phaseBalance(p)}</span> : null}
                  </td>
                  <td className="num lm-num">
                    {r0(p.proteinG)} · {r0(p.carbG)} · {r0(p.fatG)} g
                  </td>
                  <td className="lp-phase-table__why">
                    {p.summary ? <span className="lp-phase-table__sum">{energyInText(p.summary, energy)}</span> : null}
                    {p.why ? (
                      <span className="lp-why">
                        {p.why}
                        {goal1 ? <IconKey icon={Info} size="sm" variant="quiet" label={`Why: evidence for ${goalMetric(goal1)?.label.toLowerCase() ?? 'this goal'}`} onClick={() => onWhy(goal1)} /> : null}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="lp-overview__facts">
        <Section label="Effort">
          <BurdenScale difficulty={s.difficulty} ideal={kind === 'ideal'} gentle={gentle} footnote />
        </Section>
        {ttt.length ? (
          <Section label="Time to target">
            <ul className="lp-plain-list">
              {ttt.map((t) => (
                <li key={t.key}>{t.text}</li>
              ))}
            </ul>
          </Section>
        ) : null}
        {chances.length ? (
          <Section label="Chance of reaching each target">
            <ul className="lp-plain-list">
              {chances.map((o) => {
                const p = o.pTargetMet! <= 1 ? o.pTargetMet! * 100 : o.pTargetMet!;
                return <li key={o.goal}>{`${o.goal + 1} · ${(goalMetric(o.metric)?.label ?? o.label).toLowerCase()}: ${quick ? `about ${fmtPct(Math.round(p / 10) * 10)}` : fmtPct(p)} of the check runs`}</li>;
              })}
            </ul>
          </Section>
        ) : null}
        {plan.fasting?.text && !gentle ? (
          <Section label={plan.fasting.used ? 'Why it uses a fast' : 'Why there is no fast'}>
            <p className="lp-plain">{plan.fasting.text}</p>
            <RivalTable verdict={plan.fasting} goals={request.goals} units={units} energy={energy} />
          </Section>
        ) : null}
        {rx ? (
          <Section label="What stays the same">
            <p className="lp-plain">{sameThroughout(rx).join(' · ') || 'Every phase changes the day.'}</p>
          </Section>
        ) : null}
        {explanation.length ? (
          <Section label="How this plan works">
            {explanation.map((t, i) => (
              <p key={i} className="lp-plain">
                {t}
              </p>
            ))}
          </Section>
        ) : null}
        {needs.length ? (
          <Section label={needs.some((f) => f.requiredWeeks !== null) ? 'Time the targets need' : 'Targets out of reach'}>
            <ul className="lp-plain-list">
              {needs.map((f) => (
                <li key={f.goal}>
                  {f.text || `${f.label}: about ${Math.ceil(f.requiredWeeks!)} weeks.`}
                  {f.nearestAttainableTarget !== null ? ` Nearest reachable in ${Math.round(request.horizonDays / 7)} weeks: ${fmtMetric(f.metric, f.nearestAttainableTarget, units, { energy })}.` : ''}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        {levers.length ? (
          <Section label="Levers behind goal 1">
            <p className="lp-plain lp-overview__caption">Change in goal 1 if the plan were changed this way, in points of what is possible.</p>
            <KeyValueList
              items={levers.map((c) => {
                // deltaGoal1 = D(plan) − D(plan with the lever removed): the row reads "without the lever", so the sign flips
                const change = -c.deltaGoal1;
                return { key: c.label, value: <span className="lm-num">{`${change >= 0 ? '+' : '−'}${formatNumber(Math.abs(change), 1)} pts`}</span> };
              })}
            />
          </Section>
        ) : null}
        {isRung(kind) && kind !== 'hard' && plan.hardBeatsThisShare !== null ? (
          <Section label="Stability">
            <p className="lp-plain">
              Hard stays ahead of this plan in {fmtPct(plan.hardBeatsThisShare * (plan.hardBeatsThisShare <= 1 ? 100 : 1))} of model variations.
            </p>
          </Section>
        ) : null}
        {notes.length ? (
          <Section label="Conflicts and synergies">
            <ul className="lp-plain-list">
              {notes.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Section>
        ) : null}
        {figure ? <Section label="Start → end">{figure}</Section> : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- limits */

export interface LimitsTabProps {
  kind: PlanKind;
  plan: LadderPlan;
  v2: PlannerResultV2;
  request: PlannerRequest;
  units: UnitSystem;
}

/**
 * Limits tab (plan-ladder.md §6.6): for a rung, each limit it presses with its share of days and what relaxing it would
 * buy (from the Ideal's limit costs); for the Ideal, the full limit-cost list, what it changes and the advised list.
 */
export function LimitsTab({ kind, plan, v2, request, units }: LimitsTabProps) {
  const energy = useEnergyUnit();
  if (kind === 'ideal' && v2.ideal) {
    return (
      <div className="lp-limitstab">
        <Section label="What your limits cost">
          <LimitCosts ideal={v2.ideal} goals={request.goals} units={units} energy={energy} all />
        </Section>
        <DisclaimerLine />
      </div>
    );
  }
  const b = plan.summary.bindingLimits;
  return (
    <div className="lp-limitstab">
      <Section label={`Limits the ${RUNG_TITLE[kind]} plan presses`}>
        {b.length ? (
          <ul className="lp-limits-list">
            {b.map((l) => {
              const cost = v2.ideal?.limitCosts.find((c) => c.group === l.group);
              return (
                <li key={l.group}>
                  <span className="lp-limits-list__name">{l.text || l.label}</span>
                  <span className="lp-limits-list__share lm-num">{l.share >= 1 ? 'at its bound' : `on ${fmtPct(l.share * 100)} of days`}</span>
                  {cost ? <span className="lp-limits-list__cost">{limitCostSentence(cost, request.goals, units, energy)}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="lp-plain">None of your limits shapes this plan: it sits inside all of them.</p>
        )}
      </Section>
      {!v2.ideal ? <p className="lp-plain lp-limitstab__note">The Ideal was not computed for this search, so what each limit costs is not known.</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- safety */

export interface SafetyTabProps {
  kind: PlanKind;
  plan: LadderPlan;
  request: PlannerRequest;
  locks: readonly PlannerLock[];
}

export function SafetyTab({ kind, plan, request, locks }: SafetyTabProps) {
  const energy = useEnergyUnit();
  const title = RUNG_TITLE[kind];
  const excludedIds = new Set(request.constraints?.excludedLevers ?? []);
  const userExcluded = EXCLUDABLE.filter((x) => excludedIds.has(x.id)).map((x) => x.label);
  const fastingNone = request.constraints?.fasting === 'none';
  const maxFastUser = request.constraints?.maxFastHours;
  const safetyLines = lockLines(locks, energy);
  const items = safetyItemsOf({ safetyItems: plan.safetyItems ?? plan.summary.safetyItems, safetyNotes: plan.safetyNotes });
  const flagged = items.filter((i) => i.severity !== 'info');
  const notes = items.filter((i) => i.severity === 'info');
  return (
    <div className="lp-safetytab">
      {flagged.length ? (
        <Section label={`${flagged.some((i) => i.severity === 'danger') ? 'Dangers and cautions' : 'Cautions'} for the ${title} plan`}>
          <div className="lp-safetytab__notes">
            {flagged.map((it, i) => (
              <Notice key={i} severity={it.severity} layout="ruled" title={it.text} />
            ))}
          </div>
        </Section>
      ) : (
        <p className="lp-safety-line">
          <StatusMark severity="ok" size={16} />
          <span>No safety flags for the {title} plan.</span>
        </p>
      )}
      {notes.length ? (
        <Section label="Worth knowing">
          <ul className="lp-notes">
            {notes.map((it, i) => (
              <li key={i}>
                <StatusMark severity="info" size={16} />
                <span>{it.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {kind === 'ideal' ? (
        <Section label="Without your practical limits">
          <p className="lp-plain">The Ideal drops your practical limits only. Your safety answers, the safety limits below and your opt-ins still apply to it.</p>
        </Section>
      ) : (
        <Section label="Excluded because of your limits">
          <ul className="lp-plain-list">
            {fastingNone ? <li>fasting days and fasts of 24 h or more (your longest fast is {maxFastUser ?? 'under 24'} h)</li> : maxFastUser !== undefined ? <li>fasts over {maxFastUser} h (you set {maxFastUser} h as your longest)</li> : null}
            {userExcluded.map((l) => (
              <li key={l}>{l}</li>
            ))}
            {request.constraints?.sleepFixed ? <li>changes to your sleep</li> : null}
            {!fastingNone && maxFastUser === undefined && userExcluded.length === 0 && !request.constraints?.sleepFixed ? <li>nothing — every building block was allowed</li> : null}
          </ul>
        </Section>
      )}
      <Section label="Safety limits every plan stays inside">
        <ul className="lp-plain-list">
          {safetyLines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Section>
      <Section label="Excluded for safety">
        <ul className="lp-plain-list">
          <li>
            A weekly average under {fmtKcal(1200, energy)} (women) or {fmtKcal(1500, energy)} (men).
          </li>
          <li>Fasts longer than the fasting level you are cleared for.</li>
          <li>Multi-day fasts over 72 hours and very-low-energy diets: these are for the Simulator only.</li>
        </ul>
      </Section>
      <p className="lp-plain lp-safetytab__always">These plans stay within Vitals’ safety limits. They are projections, not medical advice.</p>
      <DisclaimerLine />
    </div>
  );
}
