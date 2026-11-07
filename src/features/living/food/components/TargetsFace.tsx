/**
 * Food’s targets use the same intake model and pictures as Today: energy on one ring, four nutrient tracks, and
 * unknown amounts left unknown. Only your day report confirms a complete day or zero intake. Explanations and the
 * table live in the (i); quiet mode keeps the energy ratio and hides nutrient numbers.
 */
import { useId, type ReactNode } from 'react';
import { CardFoot, CardHead, ChartTwin, DottedTrack, GradientCard, HeroNumber, KeyBank, MonoMeta, formatNumber, formatRange, toast } from '@/components';
import { Utensils } from 'lucide-react';
import { IntakeRing, IntakeTrack, intakeGoalText, spokenIntake } from '../../components/IntakeViz';
import { infoSpec } from '../../components/info';
import { INTAKE_WHY_TEXT, intakeModel, type IntakeChannel, type IntakeView } from '../../model/intake';
import { useEnergyUnit } from '@/state/settingsStore';
import type { Est, LocalDate, PrescribedDaySnapshot, TodayView } from '@/living';
import { compareDates } from '@/living/dates';
import type { ChannelCoverage, ChannelCoverageMap, DayIntakeAttestation, ExposureChannel } from '@/lib/bodyContracts';
import { useToday } from '../../clock';
import { useLivingActions, useOptionalLivingActions } from '../../data/actions';
import { fmtLikely, quietEaten } from '../../format';
import { FOOD_COPY, INFO } from '../copy';

const T = FOOD_COPY.targets;

export interface Channel {
  what: string;
  target: number;
  eaten: Est;
  unit: string;
  /** Data colour of the fill (macro identity). */
  color: string;
}

/**
 * The bar's accessible name (C6, D6-02): an exact entry reads exactly ("eaten 600 of 1 850 kcal"); an estimated one says
 * "about" with its estimate range ("eaten about 640 of 1 850 kcal (range 510–780)"), never "likely" (not a probability).
 */
export function barLabel(c: Pick<Channel, 'what' | 'target' | 'eaten' | 'unit'>): string {
  const est = c.eaten.sd > 0;
  return `${c.what}: eaten ${est ? 'about ' : ''}${formatNumber(c.eaten.value, 0)} of ${formatNumber(c.target, 0)} ${c.unit}${est ? ` (range ${fmtLikely(c.eaten.value, c.eaten.sd)})` : ''}`;
}

const COVERAGE_RANK: Readonly<Record<ChannelCoverage, number>> = { unknown: 0, partial: 1, asPlannedEstimate: 2, complete: 3, confirmedZero: 3 };

/**
 * Whether a macro's coverage lags the day's energy coverage (D6-02/D6-03): some logged food has energy but no figure for
 * this macro, so its total is a lower amount. Without a coverage map nothing is claimed either way.
 */
export function macroLags(coverage: ChannelCoverageMap | null | undefined, channel: ExposureChannel): boolean {
  if (!coverage || !coverage.energy) return false;
  return COVERAGE_RANK[coverage[channel] ?? 'unknown'] < COVERAGE_RANK[coverage.energy];
}

/** The day's food status word (C1/D5-01). */
export function dayFoodStatus(logged: boolean, intake?: DayIntakeAttestation | null): 'Not logged' | 'Partial' | 'Complete' | 'No intake' {
  if (intake === 'none') return logged ? 'Partial' : 'No intake';
  if (intake === 'complete' && logged) return 'Complete';
  return logged ? 'Partial' : 'Not logged';
}

export interface TargetsFaceProps {
  rx: PrescribedDaySnapshot;
  totals: TodayView['logged']['totals'];
  /** At least one meal is logged for the day. */
  logged: boolean;
  quiet: boolean;
  /** The per-view "show numbers" key (quiet mode only). */
  quietKey?: ReactNode;
  /** The person's day report about food (`TodayView.intake`); absent = no statement. */
  intake?: DayIntakeAttestation | null;
  /**
   * The day shown: with it, today and past days offer the one optional day report (All logged · Partial · No intake;
   * "No intake" is a confirmed zero, never "skipped"), when the actions support it.
   */
  date?: LocalDate;
  /** The day's per-channel coverage (`TodayView.coverage`): a macro lagging energy reads "partial" on its tile. */
  coverage?: ChannelCoverageMap | null;
}

const ATTEST: ReadonlyArray<{ value: DayIntakeAttestation; label: string }> = [
  { value: 'complete', label: 'All logged' },
  { value: 'partial', label: 'Partial' },
  { value: 'none', label: 'No intake' },
];

/** Whether the day report can be given for this day: today or a past day, when the actions support it. */
function useDayReport(date: LocalDate | undefined): boolean {
  const actions = useOptionalLivingActions();
  const today = useToday();
  return !!date && !!actions?.confirmDayIntake && compareDates(date, today) <= 0;
}

/**
 * The one optional day report (C1/D5-01, r068 F1): a labelled full-width row at the card's foot. It is the card's status
 * too (the head drops its caption while it shows): the person's own report is selected, else "Partial" once anything
 * is logged (what the status would say); nothing is selected on an empty day.
 */
function DayReport({ date, intake, logged }: { date: LocalDate; intake?: DayIntakeAttestation | null; logged: boolean }) {
  const actions = useLivingActions();
  const labelId = useId();
  if (!actions.confirmDayIntake) return null;
  const attest = actions.confirmDayIntake.bind(actions);
  const report = (a: DayIntakeAttestation) => {
    if (a === intake) return;
    void attest(date, a).then((o) => toast(o.ok ? `Food today: ${ATTEST.find((x) => x.value === a)!.label.toLowerCase()}` : (o.message ?? 'That couldn’t be saved.'), o.ok && o.undo ? { action: { label: 'Undo', onClick: () => void o.undo?.() } } : {}));
  };
  const shown = intake ?? (logged ? 'partial' : undefined);
  return (
    <div className="lv-tgt__report">
      <span className="lv-tgt__name" id={labelId}>
        {T.report}
      </span>
      <KeyBank<DayIntakeAttestation> size="sm" labelledBy={labelId} value={shown} onChange={report} options={ATTEST} />
    </div>
  );
}

/** Empty channels still show the planned amount; an unknown is never drawn as zero. */
function TargetTrack({ channel: c }: { channel: IntakeChannel }) {
  if (c.value !== null) return <IntakeTrack channel={c} />;
  const why = INTAKE_WHY_TEXT[c.why ?? 'nothingLogged'];
  return <div className="lv-intake" data-intake={c.id} data-state="unknown" data-kind={c.kind}>
    <div className="lv-intake__head"><span className="lv-intake__name">{c.label}{c.kind === 'floor' ? <MonoMeta size="sm">At least</MonoMeta> : null}</span><MonoMeta tone="hue">{c.kind === 'floor' ? '' : 'Target '}{intakeGoalText(c)}</MonoMeta></div>
    <DottedTrack label={c.label} value={null} goal={c.target} goalKind={c.kind} unit={c.unit} valueText={why} goalText={intakeGoalText(c)} state="unknown" />
  </div>;
}

export function TargetsFace({ rx, totals, logged, quiet, quietKey, intake, date, coverage }: TargetsFaceProps) {
  const energyUnit = useEnergyUnit();
  // The compatible props supply a meal-presence flag; the shared model only reads entry kinds here.
  const model = intakeModel({ logged: { totals, entries: logged ? [{ kind: 'meal' }] : [] } as IntakeView['logged'], coverage: coverage ?? undefined, intake: intake ?? undefined }, rx, { energyUnit });
  const today = useToday();
  const future = !!date && compareDates(date, today) > 0;
  const reporting = useDayReport(date);
  const energy = model.energy;
  const n = (value: number) => formatNumber(Math.round(value), 0);
  const twin = quiet ? undefined : <ChartTwin data={{ title: 'Today’s targets, table', caption: 'What you logged against your plan.', head: ['Nutrient', 'Eaten', 'Plan', 'Range'], rows: model.channels.map((c) => [c.label, c.value === null ? 'Not known' : `${c.state === 'atLeast' ? 'At least ' : ''}${n(c.value)} ${c.unit}${c.state === 'partial' ? ' · partial' : ''}`, `${c.kind === 'floor' ? 'At least ' : ''}${n(c.target)} ${c.unit}`, c.lo !== undefined && c.hi !== undefined ? formatRange(Math.round(c.lo), Math.round(c.hi), 0) : '—']), fileName: 'vitals-food-targets.csv', rowNoun: ['nutrient', 'nutrients'] }} />;
  return (
    <GradientCard id="targets" className="lv-food-targets" domain="food" glow="br" head={<CardHead icon={Utensils} title={T.title} info={infoSpec(INFO.targets, { twin })} />} foot={<CardFoot state={!reporting ? { word: future ? T.planned : model.status } : undefined}>{date && reporting ? <DayReport date={date} intake={intake} logged={logged} /> : null}{quietKey}</CardFoot>}>
      <div className="lv-food-targets__body">
        <div className="lv-food-targets__ring">
          <IntakeRing channel={energy} quiet={quiet} quietWord={energy.value === null ? T.nothingYet : quietEaten(energy.ratio)} size={160} centre={!quiet && energy.value !== null && energy.lo !== undefined ? <HeroNumber value={Math.round(energy.value)} format={(v) => `≈ ${n(v)}`} size="time" countUp numerals="proportional" unit={energy.unit} unitPlacement="below" label={spokenIntake(energy)} /> : 'number'} />
          {!quiet ? <MonoMeta tone="hue">Of {n(energy.target)} {energy.unit}{model.left ? ` · ${n(model.left.amount)} ${energy.unit} ${model.left.over ? 'over' : 'left'}` : ''}</MonoMeta> : null}
          {!quiet && energy.lo !== undefined && energy.hi !== undefined ? <MonoMeta tone="hue">Likely {formatRange(Math.round(energy.lo), Math.round(energy.hi), 0)}</MonoMeta> : null}
          <span className="lm-sr">{spokenIntake(energy, quiet)}</span>
        </div>
        {!quiet ? <div className="lv-food-targets__tracks">{model.channels.filter((c) => c.id !== 'energy').map((c) => <TargetTrack key={c.id} channel={c} />)}</div> : null}
      </div>
    </GradientCard>
  );
}
