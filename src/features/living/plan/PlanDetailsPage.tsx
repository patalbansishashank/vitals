import '../boot';
import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowRight, ChevronRight, GitBranch, Route } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  Dialog,
  DottedTrack,
  EmptyStage,
  GradientCard,
  HeroNumber,
  Icon,
  InfoPanel,
  Key,
  KeyLink,
  MonoMeta,
  Page,
  Rail,
  RailNode,
  RailRow,
  RangeBar,
  Switch,
  VisuallyHidden,
  toast,
  energyInText,
} from '@/components';
import { TopBar, type MenuEntry } from '@/app/shell';
import { addDays, daysBetween, weekdayOf } from '@/living/dates';
import { useActivePlanStore, type ActivePlan } from '../activePlan';
import { useLivingClock, useToday } from '../clock';
import { ChangeCard, withoutEnergy } from '../components/ChangeCard';
import { useEnergyUnit } from '@/state/settingsStore';
import { useLivingActions, type ActionOutcome } from '../data/actions';
import { useLiving } from '../data/source';
import type { PlanVersionRow } from '../data/types';
import { fmtClock, fmtDateRange, fmtDay, fmtWeekday } from '../format';
import type { ChangeAction } from '../model/changeCard';
import { planDayOf, useAppMode } from '../mode';
import { livingPaths } from '../paths';
import { PausePanel } from './components/PausePanel';
import { PLAN_COPY as C, INFO } from './copy';
import { infoSpec } from '../components/info';
import { DayDots } from '../components/DayDots';
import { planTrack, planTrackWords, versionDay } from '../model/planTrack';
import { planTitle } from './planTitle';
import { EXPERIMENTAL_TRACKING_NOTE } from '@/lib/experimentalTracking';
import { plainReason } from '../start/plainReason';
import './plan.css';

/**
 * The active plan and its history share one weekly dotted track. The plan's facts and training-day marks sit under
 * its position; version links live on the same rail used by the day's plan. Lifecycle actions stay in the header menu.
 * Version details reuse the proposal grammar, with the original table available from the information panel.
 */

/** "v1 · Fri 2 Oct" (the plan as chosen), "v3 · Thu 9 Oct · Thursday lift moved to Friday" for a later version. */
export function versionLine(
  v: Pick<PlanVersionRow, 'version' | 'reason' | 'reasonText' | 'date' | 'summary'>,
): string {
  const what = v.reason === 'start' ? null : v.summary || v.reasonText;
  return [`v${v.version}`, fmtDay(v.date), what].filter(Boolean).join(' · ');
}

const upperFirst = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export { planTitle };

/** Plan facts stay compact; the training week is its own labelled picture. */
function FactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="lv-plan-fact">
      <dt>
        <MonoMeta>{label}</MonoMeta>
      </dt>
      <dd>{typeof value === 'string' ? <MonoMeta tone="ink">{value}</MonoMeta> : value}</dd>
    </div>
  );
}

function PlanTrack({
  day,
  of,
  marks = [],
}: {
  day: number;
  of: number;
  marks?: Array<{ at: number; tone?: 'ink' | 'hue' | 'caution' }>;
}) {
  const track = planTrack(day, of);
  return (
    <div className="lv-plan-track">
      <DottedTrack
        label={C.day}
        value={track.value}
        goal={track.to}
        from={track.from}
        to={track.to}
        dots={track.dots}
        valueText={planTrackWords(track)}
        goalText={`${track.to} days`}
        marks={marks}
        hue="plan"
      />
      <MonoMeta tone="hue">{C.weekOf(track.week, track.weeks)}</MonoMeta>
    </div>
  );
}

export default function PlanDetailsPage() {
  const { n } = useParams();
  const { plan } = useAppMode();
  if (!plan) return null; // the Living guard sends the person to the planner
  return n !== undefined ? <VersionView n={Number(n)} plan={plan} /> : <PlanDetails plan={plan} />;
}

function PlanDetails({ plan }: { plan: ActivePlan }) {
  const today = useToday();
  const clock = useLivingClock();
  const navigate = useNavigate();
  const actions = useLivingActions();
  const view = useLiving((s) => s.today(today), [today]);
  const live = view?.plan;
  const quiet = !!view?.quietMode;
  const versions = useLiving((s) => s.versions(), []);
  const changes = useLiving((s) => s.changes('all'), []);
  const [autoEase, setAutoEase] = useState<boolean | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const easeId = useId();
  const experimental = plan.doc?.request.constraints?.experimentalTracking === true;
  const experimentalWarnings = (plan.version?.experimentalWarnings ?? []).filter((w) => w !== EXPERIMENTAL_TRACKING_NOTE);

  const status = live?.status ?? plan.status;
  const ease = autoEase ?? plan.policy.autoApplyLoadLowering;
  const day = planDayOf(plan, today);
  const pending = changes.filter(
    (c) =>
      (c.class === 'edit' || c.class === 'destructive') && (c.state === 'pending' || c.state === 'stale'),
  );
  const now = clock.now();
  const daysLeft = Math.max(0, daysBetween(today, plan.plannedEndDate));
  const checkInDate = addDays(today, (plan.policy.checkInWeekday - weekdayOf(today) + 7) % 7);

  const report = (r: ActionOutcome, ok: string) => {
    toast(r.ok ? ok : (r.message ?? C.failed));
    return r.ok;
  };

  const facts: Array<{ key: string; value: ReactNode }> = [];
  if (experimental) facts.push({ key: 'Plan mode', value: 'Experimental tracking' });
  if (status !== 'active' && status !== 'paused') facts.push({ key: C.status, value: C.statuses[status] });
  if (status === 'scheduled') facts.push({ key: C.starts, value: fmtDay(plan.startDate) });
  facts.push({ key: C.checkIn, value: C.everyWeekday(fmtWeekday(checkInDate)) });
  if (plan.intentions.weighInClockH !== undefined)
    facts.push({ key: C.weighIn, value: fmtClock(plan.intentions.weighInClockH) });
  if (plan.intentions.trainingWeekdays?.length)
    facts.push({ key: C.trainingDays, value: <DayDots days={plan.intentions.trainingWeekdays} /> });
  if (plan.intentions.missedSessionPlan)
    facts.push({ key: C.missedSession, value: C.missed[plan.intentions.missedSessionPlan] });
  const drift = view?.drift?.[0];

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

  // a plain confirm (the plan can be restored for 7 days); the command still checks the confirmation word, so pass it
  const end = async () => {
    if (busy) return;
    setBusy('end');
    const r = await actions.end('end');
    setBusy(null);
    if (!r.ok) {
      toast(r.message ?? C.failed);
      return;
    }
    setEndOpen(false);
    toast(C.endedToast(plan.name));
    navigate('/plan');
  };

  // the header ⋯: the plan's own lifecycle first (the header adds a divider and the global items after it). A running
  // plan can be paused; a paused one resumes from its Paused row; a scheduled one has not started, so nothing to pause.
  const menu: MenuEntry[] = [
    ...(status === 'active'
      ? [{ id: 'plan-pause', label: C.pause, onSelect: () => setPauseOpen(true) }]
      : []),
    {
      id: 'plan-replan-rest',
      label: C.replanRest,
      onSelect: () => void replanRest(),
      disabled: busy === 'replan',
    },
    { id: 'plan-replan-scratch', label: C.replanScratch, onSelect: replanFromScratch },
    { id: 'plan-end', label: C.end, tone: 'danger', onSelect: () => setEndOpen(true) },
  ];

  return (
    <>
      <TopBar title={C.title} back menu={menu} />
      <Page>
        <div className="lv-plan">
          <div className="lv-plan__col">
            <GradientCard
              domain="plan"
              glow="tl"
              as="section"
              head={<CardHead icon={Route} title={planTitle(plan)} as="h2" info={infoSpec(INFO.plan)} />}
              foot={
                <CardFoot state={status === 'paused' ? { word: C.statuses.paused } : undefined}>
                  {status === 'paused' ? (
                    <Key
                      size="sm"
                      variant="primary"
                      loading={busy === 'resume'}
                      onClick={() => void resume()}
                    >
                      {C.resume}
                    </Key>
                  ) : null}
                  <Switch
                    checked={ease}
                    onChange={(on) => void toggleEase(on)}
                    label={C.autoEase}
                    labelStyle="sentence"
                    describedBy={easeId}
                    className="lv-plan-ease"
                  />
                  <VisuallyHidden id={easeId}>{C.autoEaseBody}</VisuallyHidden>
                </CardFoot>
              }
            >
              <div className="lv-plan-hero">
                <HeroNumber
                  value={Math.max(0, day.day)}
                  unit={`/ ${day.of}`}
                  size="num-l"
                  label={`Day ${Math.max(0, day.day)} of ${day.of}`}
                />
                <MonoMeta tone="hue">
                  {C.day} · {C.ends} {fmtDay(addDays(plan.plannedEndDate, -1))}
                </MonoMeta>
              </div>
              <PlanTrack day={day.day} of={day.of} />
              {drift ? (
                <MonoMeta className="lv-plan-drift" tone="hue">
                  {!quiet && drift.goalDate?.range
                    ? `${C.goalDates} ${fmtDateRange(drift.goalDate.range[0], drift.goalDate.range[1])} · `
                    : ''}
                  {drift.text}
                </MonoMeta>
              ) : null}
              <dl className="lv-plan-facts">
                {facts.map((f) => (
                  <FactRow key={f.key} label={f.key} value={f.value} />
                ))}
              </dl>
              {experimental ? (
                <details className="lv-plan-experimental">
                  <summary>Experimental model notes</summary>
                  <p>{EXPERIMENTAL_TRACKING_NOTE}</p>
                  {experimentalWarnings.length ? <ul>{experimentalWarnings.map((warning) => <li key={warning}>{plainReason(warning)}</li>)}</ul> : null}
                </details>
              ) : null}
            </GradientCard>
          </div>

          <div className="lv-plan__col">
            {pending.length ? (
              <section className="lv-plan-proposals" aria-labelledby="lv-plan-proposals">
                <h2 id="lv-plan-proposals" className="lm-meta lv-plan-h">
                  {C.proposals} · {pending.length}
                </h2>
                {pending.map((card) => (
                  <ChangeCard
                    key={card.id}
                    card={card}
                    now={now}
                    quiet={quiet}
                    context="standalone"
                    headingLevel="h3"
                    onAction={(a) => void onCard(card.id, a)}
                  />
                ))}
              </section>
            ) : null}
            <GradientCard
              domain="plan"
              glow="bottom"
              as="section"
              head={<CardHead icon={GitBranch} title={C.versions} as="h2" info={infoSpec(INFO.versions)} />}
            >
              <PlanTrack
                day={day.day}
                of={day.of}
                marks={versions.map((v) => ({
                  at: versionDay(plan.startDate, v.date, day.of),
                  tone: v.version === plan.headVersion ? 'ink' : 'hue',
                }))}
              />
              <Rail label={C.versions} className="lv-plan-versions">
                {versions.map((v) => {
                  const current = v.version === plan.headVersion;
                  const state = current ? C.current : v.status === 'proposed' ? C.proposed : null;
                  return (
                    <RailRow
                      key={v.version}
                      node={
                        <RailNode
                          status={v.status === 'proposed' ? 'assumed' : current ? 'empty' : 'done'}
                          label={state ?? C.versionShort(v.version)}
                          hue="plan"
                        />
                      }
                      title={
                        <Link to={livingPaths.planVersion(v.version)} aria-label={versionLine(v)}>
                          {v.reason === 'start' ? C.asChosen : v.summary || v.reasonText}
                        </Link>
                      }
                      meta={[
                        `V${v.version}`,
                        fmtDay(v.date),
                        C.versionDay(versionDay(plan.startDate, v.date, day.of)),
                      ]}
                      trailing={
                        <>
                          {state ? <MonoMeta tone="ink">{state}</MonoMeta> : null}
                          <Icon icon={ChevronRight} size={18} />
                        </>
                      }
                    />
                  );
                })}
              </Rail>
            </GradientCard>
          </div>
        </div>
      </Page>

      <PausePanel open={pauseOpen} onClose={() => setPauseOpen(false)} today={today} />
      <Dialog
        open={endOpen}
        onClose={() => setEndOpen(false)}
        title={C.endTitle}
        role="alertdialog"
        footer={
          <>
            <Key variant="text" onClick={() => setEndOpen(false)}>
              {C.cancel}
            </Key>
            <Key variant="danger" loading={busy === 'end'} onClick={() => void end()}>
              {C.endKey}
            </Key>
          </>
        }
      >
        <p className="lv-confirm__body">{C.endBody}</p>
      </Dialog>
    </>
  );
}

function VersionTable({ version }: { version: PlanVersionRow }) {
  const energyUnit = useEnergyUnit();
  return (
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
        {version.diff.map((d, i) => (
          <tr key={i}>
            <td>{fmtDay(d.date)}</td>
            <th scope="row">{d.field}</th>
            <td>
              {energyInText(d.before, energyUnit)} → {energyInText(d.after, energyUnit)}
            </td>
            <td>{d.why}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The version's actual goal band and the preceding version, on a shared date scale. */
function VersionGoals({ version, previous }: { version: PlanVersionRow; previous?: PlanVersionRow }) {
  const ranges = [...version.goalDates, ...(previous?.goalDates ?? [])].flatMap((g) =>
    g.range ? [g.range] : [],
  );
  if (!ranges.length) return null;
  const first = ranges.map((r) => r[0]).sort()[0]!;
  const last = ranges
    .map((r) => r[1])
    .sort()
    .at(-1)!;
  const width = Math.max(1, daysBetween(first, last));
  const band = (r: [string, string] | null) =>
    r ? (
      <RangeBar
        low={daysBetween(first, r[0])}
        high={daysBetween(first, r[1])}
        value={(daysBetween(first, r[0]) + daysBetween(first, r[1])) / 2}
        min={-2}
        max={width + 2}
        width={72}
      >
        <MonoMeta>{fmtDateRange(r[0], r[1])}</MonoMeta>
      </RangeBar>
    ) : (
      <MonoMeta>{C.notReached}</MonoMeta>
    );
  return (
    <section className="lv-plan-goals">
      <h3 className="lm-meta">{C.goalDates}</h3>
      <ul className="lv-plan-diffs">
        {version.goalDates.map((g) => {
          const before = previous?.goalDates.find((p) => p.label === g.label);
          return (
            <li key={g.label}>
              <MonoMeta>{upperFirst(g.label)}</MonoMeta>
              <div className="lv-plan-diff__values">
                {before ? (
                  <>
                    {band(before.range)}
                    <Icon icon={ArrowRight} size={16} />
                  </>
                ) : null}
                {band(g.range)}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function VersionView({ n, plan }: { n: number; plan: ActivePlan }) {
  const energyUnit = useEnergyUnit();
  const versions = useLiving((s) => s.versions(), []);
  const today = useToday();
  const quiet = useLiving((s) => s.today(today)?.quietMode ?? false, [today]);
  const [tableOpen, setTableOpen] = useState(false);
  const v = versions.find((x) => x.version === n);
  const previous = versions.find((x) => x.version === n - 1);
  const valid = Number.isInteger(n) && n > 0;
  const of = Math.max(1, daysBetween(plan.startDate, plan.plannedEndDate));
  const adoptedDay = v ? versionDay(plan.startDate, v.date, of) : 1;
  const panel = infoSpec(INFO.versions, { twin: v && !quiet ? <VersionTable version={v} /> : undefined });
  return (
    <>
      <TopBar
        title={v ? C.versionTitle(n, fmtDay(v.date)) : valid ? C.versionShort(n) : C.versionUnknownTitle}
        documentTitle={valid ? C.versionShort(n) : C.versionUnknownTitle}
        back={{ to: livingPaths.planActive, label: C.backDetails }}
      />
      <Page>
        {!v ? (
          <EmptyStage
            title={C.versionMissing}
            action={<KeyLink to={livingPaths.planActive}>{C.allVersions}</KeyLink>}
          />
        ) : (
          <div className="lv-plan lv-plan--version">
            <GradientCard
              domain="plan"
              as="section"
              head={<CardHead icon={GitBranch} title={C.versionShort(v.version)} as="h2" info={panel} />}
              foot={
                !quiet && v.diff.length ? (
                  <CardFoot link={{ label: C.table, onClick: () => setTableOpen(true) }} />
                ) : undefined
              }
            >
              <div className="lv-plan-hero">
                <HeroNumber value={adoptedDay} size="num-l" label={C.versionDay(adoptedDay)} />
                <MonoMeta tone="hue">
                  {C.adopted(v.status === 'proposed', fmtDay(v.date), adoptedDay)}
                </MonoMeta>
              </div>
              <PlanTrack day={adoptedDay} of={of} />
              {v.reason === 'start' ? (
                <>
                  <p className="lv-plan-prose">{C.asChosen}</p>
                  <dl className="lv-plan-facts">
                    <FactRow label={C.starts} value={fmtDay(plan.startDate)} />
                    <FactRow label={C.ends} value={fmtDay(addDays(plan.plannedEndDate, -1))} />
                    <FactRow label={C.length} value={C.weeks(Math.max(1, Math.round(of / 7)))} />
                    <FactRow
                      label={C.checkIn}
                      value={C.everyWeekday(
                        fmtWeekday(
                          addDays(
                            plan.startDate,
                            (plan.policy.checkInWeekday - weekdayOf(plan.startDate) + 7) % 7,
                          ),
                        ),
                      )}
                    />
                  </dl>
                </>
              ) : null}
              {v.diff.length ? (
                <section className="lv-plan-section">
                  <h3 className="lm-meta">{C.diffTitle}</h3>
                  <ul className="lv-plan-diffs">
                    {v.diff.map((d, i) => (
                      <li key={i}>
                        <MonoMeta>
                          {fmtDay(d.date)} · {d.field}
                        </MonoMeta>
                        <div className="lv-plan-diff__values">
                          <span>{quiet ? withoutEnergy(d.before) : energyInText(d.before, energyUnit)}</span>
                          <Icon icon={ArrowRight} size={16} />
                          <span>{quiet ? withoutEnergy(d.after) : energyInText(d.after, energyUnit)}</span>
                        </div>
                        <p className="lv-plan-prose">{d.why}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : v.reason !== 'start' ? (
                <p className="lv-plan-prose">{C.noDiff}</p>
              ) : null}
              {!quiet ? <VersionGoals version={v} previous={previous} /> : null}
            </GradientCard>
          </div>
        )}
      </Page>
      <InfoPanel {...panel} open={tableOpen} onClose={() => setTableOpen(false)} section="twin" />
    </>
  );
}
