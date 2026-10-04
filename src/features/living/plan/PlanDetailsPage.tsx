import '../boot';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ChevronDown } from 'lucide-react';
import { EmptyStage, Faceplate, Key, KeyLink, KeyValueList, Menu, Page, Section, Switch, toast } from '@/components';
import { TopBar } from '@/app/shell';
import { addDays, daysBetween, weekdayOf } from '@/living/dates';
import { useActivePlanStore, type ActivePlan } from '../activePlan';
import { useLivingClock, useToday } from '../clock';
import { ChangeCard } from '../components/ChangeCard';
import { TypedConfirmDialog } from '../components/TypedConfirmDialog';
import { useLivingActions, type ActionOutcome } from '../data/actions';
import { useLiving } from '../data/source';
import { fmtClock, fmtDateRange, fmtDay, fmtWeekday } from '../format';
import type { ChangeAction } from '../model/changeCard';
import { planDayOf, useAppMode } from '../mode';
import { livingPaths } from '../paths';
import { PausePanel } from './components/PausePanel';
import { PLAN_COPY as C } from './copy';
import './plan.css';

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * Plan details (`/plan/active`, `/plan/active/versions/:n`; living-mode.md §9–§10): the plan's facts and intentions,
 * the "Let the plan ease itself" switch, proposals waiting for you, the version list, and the plan's lifecycle —
 * Pause · Resume · End plan… (typed confirmation) · Re-plan (the rest, or from scratch). A version route shows that
 * version's diff and forecast goal dates.
 */
export default function PlanDetailsPage() {
  const { n } = useParams();
  const { plan } = useAppMode();
  if (!plan) return null; // the Living guard sends the person to the planner
  return n !== undefined ? <VersionView n={Number(n)} /> : <PlanDetails plan={plan} />;
}

function PlanDetails({ plan }: { plan: ActivePlan }) {
  const today = useToday();
  const clock = useLivingClock();
  const navigate = useNavigate();
  const actions = useLivingActions();
  const live = useLiving((s) => s.today(today)?.plan ?? null, [today]);
  const versions = useLiving((s) => s.versions(), []);
  const changes = useLiving((s) => s.changes('all'), []);
  const [autoEase, setAutoEase] = useState<boolean | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const status = live?.status ?? plan.status;
  const ease = autoEase ?? plan.policy.autoApplyLoadLowering;
  const day = planDayOf(plan, today);
  const pending = changes.filter((c) => (c.class === 'edit' || c.class === 'destructive') && (c.state === 'pending' || c.state === 'stale'));
  const now = clock.now();
  const daysLeft = Math.max(0, daysBetween(today, plan.plannedEndDate));
  const checkInDate = addDays(today, (plan.policy.checkInWeekday - weekdayOf(today) + 7) % 7);

  const report = (r: ActionOutcome, ok: string) => {
    toast(r.ok ? ok : (r.message ?? C.failed));
    return r.ok;
  };

  const intentions: string[] = [];
  if (plan.intentions.weighInClockH !== undefined) intentions.push(C.weighIn(fmtClock(plan.intentions.weighInClockH)));
  if (plan.intentions.trainingWeekdays?.length) intentions.push(C.trainingDays(plan.intentions.trainingWeekdays.map((w) => WEEKDAYS[w]).join(' · ')));
  if (plan.intentions.missedSessionPlan) intentions.push(C.missed[plan.intentions.missedSessionPlan]);

  const toggleEase = async (on: boolean) => {
    setAutoEase(on);
    const r = await actions.setAutoEase(on);
    if (!report(r, on ? C.autoEaseOn : C.autoEaseOff)) setAutoEase(!on);
  };

  const resume = async () => {
    setBusy('resume');
    const r = await actions.resume(today);
    setBusy(null);
    report(r, C.resumedToast);
  };

  const replanRest = async () => {
    setBusy('replan');
    toast(C.replanning(daysLeft));
    const r = await actions.replanRest();
    setBusy(null);
    if (!r.ok) {
      toast(r.message ?? C.failed);
      return;
    }
    if (r.message) toast(r.message);
    // a proposal waits on Today (it also shows here, under the proposals)
    if (r.proposalId) navigate(livingPaths.today());
  };

  const replanFromScratch = () => {
    // order matters: leave the Living screen first — the Living route guard clears the override when one is entered
    void navigate(livingPaths.replanFromScratch);
    useActivePlanStore.getState().setPlanningOverride(true);
  };

  const onCard = async (id: string, action: ChangeAction) => {
    const run: Partial<Record<ChangeAction, () => Promise<ActionOutcome>>> = {
      apply: () => actions.applyChange(id),
      discard: () => actions.discardChange(id),
      undo: () => actions.undoChange(id),
      redo: () => actions.redoChange(id),
    };
    if (action === 'adjust') {
      navigate(livingPaths.coach());
      return;
    }
    const fn = run[action];
    if (!fn) return;
    const r = await fn();
    if (!r.ok) toast(r.message ?? C.failed);
  };

  const end = async (typed: string) => {
    const r = await actions.end(typed);
    if (!r.ok) {
      toast(r.message ?? C.failed);
      return;
    }
    setEndOpen(false);
    toast(C.endedToast(plan.name));
    navigate('/plan');
  };

  return (
    <>
      <TopBar title={C.title} back={{ to: livingPaths.today(), label: C.backToday }} />
      <Page>
        <div className="lv-plan">
          <div className="lv-plan__col">
            <Faceplate title={plan.name} caption={C.rungs[plan.rung] ?? plan.rung}>
              <KeyValueList
                items={[
                  { key: C.status, value: C.statuses[status] },
                  { key: C.span, value: C.spanValue(fmtDay(plan.startDate), fmtDay(addDays(plan.plannedEndDate, -1))) },
                  ...(status === 'active' || status === 'paused' ? [{ key: C.day, value: C.dayValue(Math.max(1, day.day), day.of) }] : []),
                  { key: C.checkIn, value: fmtWeekday(checkInDate) },
                ]}
              />
              <Section label={C.intentions} className="lv-plan-section">
                {intentions.length ? (
                  <ul className="lv-plan-list">
                    {intentions.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="lv-plan-prose">{C.noIntentions}</p>
                )}
                {/* TODO(E5): intentions editing (plan.setIntentions) */}
                <Key size="sm" disabledReason={C.editSoon}>
                  {C.editIntentions}
                </Key>
              </Section>
              <Section label={C.easing} className="lv-plan-section">
                <Switch checked={ease} onChange={(on) => void toggleEase(on)} label={C.autoEase} labelStyle="sentence" describedBy="lv-plan-ease-body" />
                <p id="lv-plan-ease-body" className="lv-plan-prose">
                  {C.autoEaseBody}
                </p>
                <p className="lv-plan-note">{C.autoEaseNote}</p>
              </Section>
            </Faceplate>

            <Faceplate title={C.actions}>
              <div className="lv-plan-actions">
                {status === 'paused' ? (
                  <Key loading={busy === 'resume'} onClick={() => void resume()}>
                    {C.resume}
                  </Key>
                ) : (
                  <Key onClick={() => setPauseOpen(true)} {...(status === 'scheduled' ? { disabledReason: C.scheduledNoPause } : {})}>
                    {C.pause}
                  </Key>
                )}
                <Menu
                  label={C.replanMenu}
                  trigger={(p) => (
                    <Key {...p} trailingIcon={ChevronDown} loading={busy === 'replan'}>
                      {C.replan}
                    </Key>
                  )}
                  items={[
                    { id: 'rest', label: C.replanRest, onSelect: () => void replanRest() },
                    { id: 'scratch', label: C.replanScratch, onSelect: replanFromScratch },
                  ]}
                />
                <Key variant="danger" onClick={() => setEndOpen(true)}>
                  {C.end}
                </Key>
              </div>
            </Faceplate>
          </div>

          <div className="lv-plan__col">
            <section className="lv-plan-proposals" aria-labelledby="lv-plan-proposals">
              <h2 id="lv-plan-proposals" className="lm-h3 lv-plan-h">
                {C.proposals}
              </h2>
              {pending.length === 0 ? <p className="lv-plan-prose">{C.noProposals}</p> : null}
              {pending.map((card) => (
                <ChangeCard key={card.id} card={card} now={now} context="standalone" headingLevel="h3" onAction={(a) => void onCard(card.id, a)} />
              ))}
            </section>

            <Faceplate title={C.versions}>
              <ol className="lv-plan-versions">
                {versions.map((v) => (
                  <li key={v.version}>
                    <KeyLink variant="quiet" block to={livingPaths.planVersion(v.version)} className="lv-plan-versions__link">
                      {C.versionRow(v.version, v.reasonText, fmtDay(v.date), v.summary)}
                      {v.version === plan.headVersion ? ` · ${C.current}` : v.status === 'proposed' ? ` · ${C.proposed}` : ''}
                    </KeyLink>
                  </li>
                ))}
              </ol>
            </Faceplate>
          </div>
        </div>
      </Page>

      <PausePanel open={pauseOpen} onClose={() => setPauseOpen(false)} today={today} />
      <TypedConfirmDialog
        open={endOpen}
        onClose={() => setEndOpen(false)}
        title={C.endTitle(plan.name)}
        body={C.endBody}
        word="end"
        instruction={C.endType}
        confirmLabel={C.endKey}
        cancelLabel={C.cancel}
        onConfirm={end}
      />
    </>
  );
}

function VersionView({ n }: { n: number }) {
  const versions = useLiving((s) => s.versions(), []);
  const v = versions.find((x) => x.version === n);
  return (
    <>
      <TopBar title={Number.isInteger(n) && n > 0 ? C.versionTitle(n) : C.versionUnknownTitle} back={{ to: livingPaths.planActive, label: C.backDetails }} />
      <Page>
        {!v ? (
          <EmptyStage title={C.versionMissing} action={<KeyLink to={livingPaths.planActive}>{C.allVersions}</KeyLink>}>
            {C.versionMissingBody}
          </EmptyStage>
        ) : (
          <div className="lv-plan lv-plan--version">
            <Faceplate title={C.versionRow(v.version, v.reasonText, fmtDay(v.date), v.summary)} className="lv-plan__wide">
              <Section label={C.diffTitle} className="lv-plan-section">
                {v.diff.length ? (
                  <table className="lv-plan-table">
                    <thead>
                      <tr>
                        <th scope="col">{C.diffCols.date}</th>
                        <th scope="col">{C.diffCols.what}</th>
                        <th scope="col">{C.diffCols.change}</th>
                        <th scope="col">{C.diffCols.why}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.diff.map((d, i) => (
                        <tr key={`${d.date}:${d.field}:${i}`}>
                          <td>{fmtDay(d.date)}</td>
                          <th scope="row">{d.field}</th>
                          <td>
                            {d.before} → {d.after}
                          </td>
                          <td>{d.why}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="lv-plan-prose">{C.noDiff}</p>
                )}
              </Section>
              <Section label={C.goalDates} className="lv-plan-section">
                {v.goalDates.some((g) => g.range) ? (
                  <ul className="lv-plan-list">
                    {v.goalDates.map((g) => (g.range ? <li key={g.label}>{C.goalDateValue(g.label, fmtDateRange(g.range[0], g.range[1]))}</li> : null))}
                  </ul>
                ) : (
                  <p className="lv-plan-prose">{C.noGoalDates}</p>
                )}
              </Section>
            </Faceplate>
            <div>
              <KeyLink to={livingPaths.planActive}>{C.allVersions}</KeyLink>
            </div>
          </div>
        )}
      </Page>
    </>
  );
}
