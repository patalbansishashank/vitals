/**
 * Maintenance displays shared by the intake and Your body: the driver bar with its table twin (COMPONENTS §13.2), the
 * maintenance result (design v3 §4.2; no sheet — every "change" opens a question), the readout rail and the desktop
 * faceplate.
 */
import { useId, useState } from 'react';
import { ChevronDown, Flame } from 'lucide-react';
import {
  CardHead,
  GradientCard,
  HeroNumber,
  IconKey,
  InfoKey,
  InfoPanel,
  InlineWarning,
  Key,
  MonoMeta,
  StackBar,
  formatNumber,
  type InfoSpec,
} from '@/components';
import type { MaintenanceEstimate } from '@/features/body/maintenance';
import type { EnergyUnit } from '@/state/settingsStore';
import { monthText } from '../chapters/activity';
import { A, MAINT, TURN, sentence } from '../copy';
import {
  DRIVER_QUESTION,
  energyOut,
  fmt,
  unitWord,
  type DriverRow,
  type MaintenanceView,
} from '../maintenanceView';
import type { MeasuredEnergy } from '../types';

export const maintenanceInfo: InfoSpec = {
  title: MAINT.title,
  body: 'Maintenance is the energy you use in a normal day. It is an estimate from your answers and your body, shown with its likely range. A marked part uses a default because you skipped its question. The line under the bar names the answer that would narrow the range most.',
  source: { kind: 'estimate', words: 'Your body and activity answers, resolved by the Vitals engine.' },
  evidence: { to: '/evidence/02-integrated-daily-expenditure', label: 'Daily energy expenditure' },
};

function MaintenanceInfo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <InfoKey label={`About ${MAINT.title}`} onClick={() => setOpen(true)} expanded={open} />
      <InfoPanel {...maintenanceInfo} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function MaintenanceNumber({
  view,
  size = 'num-l',
}: {
  view: MaintenanceView;
  size?: 'num-l' | 'num' | 'stat';
}) {
  return (
    <HeroNumber
      value={Number(view.kcal.replace(/\s/g, ''))}
      unit={`${view.unit}/day`} unitPlacement={size === 'num' ? 'below' : 'inline'}
      size={size}
      range={`Likely ${view.lo}–${view.hi}`}
      hue="energy"
      label={view.headline}
    />
  );
}

/* ------------------------------------------------------------------------------------------- driver bar */

export interface DriverBarProps {
  rows: readonly DriverRow[];
  unit: EnergyUnit;
  /** Quiet mode: parts without kcal. */
  quiet?: boolean;
  /** Always render the table twin (mobile); false = bar only (compact faceplate). */
  table?: boolean;
  /** "change" per row: jump to the question that set it. */
  onChange?: (row: DriverRow) => void;
  /** Compact (Your body's card): no legend under the bar; the table is parts and amounts with units, no header row. */
  compact?: boolean;
}

/**
 * The maintenance split in the shared ember intensity ramp; segment n and its legend or table row share one colour. Under the bar, the legend names every
 * part with its amount — unless the table twin follows right under it (its rows carry the same swatches) or the card is
 * compact (Your body: the compact table is the legend).
 */
export function DriverBar({ rows, unit, quiet, table = true, onChange, compact = false }: DriverBarProps) {
  const anyAssumed = rows.some((r) => r.assumed);
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.kcal), 0);
  return (
    <div className="lm-ik-driverbar">
      <StackBar
        label={MAINT.tableCaption}
        rows={rows.map((r, index) => ({
          id: r.id,
          label: r.label,
          valueText: `${fmt(r.kcal, unit)} ${unitWord(unit)}`,
          share: total ? Math.max(0, r.kcal) / total : 0,
          hue: `var(--lm-ik-part-${index + 1})`,
          unknown: r.assumed,
        }))}
        legend={!compact && !table ? 'below' : 'none'}
        quiet={quiet}
        hue="energy"
      />
      {anyAssumed ? <p className="lm-ik-note">{MAINT.dashedNote}</p> : null}
      {table ? (
        <DriverTable rows={rows} unit={unit} quiet={quiet} onChange={onChange} compact={compact} />
      ) : null}
    </div>
  );
}

/**
 * The driver bar's table twin: part, amount and what set it, with "Change" when a question set it. Compact: part and
 * amount with its unit ("1 810 kcal") and no header row; only the steps part keeps a line under it ("6 000 steps").
 */
export function DriverTable({ rows, unit, quiet, onChange, compact = false }: Omit<DriverBarProps, 'table'>) {
  if (compact) {
    return (
      <table className="lm-ik-table" data-compact="true">
        <caption className="lm-sr">{MAINT.tableCaption}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="lm-ik-table__label">
                {r.label}
                {!quiet && r.steps !== undefined ? (
                  <span className="lm-ik-table__sub">{MAINT.stepsCount(formatNumber(r.steps, 0))}</span>
                ) : null}
                {r.assumed ? <span className="lm-ik-assumed">{MAINT.assumed}</span> : null}
              </th>
              {quiet ? null : (
                <td className="lm-ik-num">
                  {fmt(r.kcal, unit)} <span className="lm-unit">{unitWord(unit)}</span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <table className="lm-ik-table">
      <caption className="lm-sr">{MAINT.tableCaption}</caption>
      <thead>
        <tr>
          <th scope="col" className="lm-ik-table__part">
            {MAINT.colPart}
          </th>
          {quiet ? null : (
            <th scope="col" className="lm-ik-num">
              {unit === 'kJ' ? 'kJ a day' : MAINT.colKcal}
            </th>
          )}
          <th scope="col" className="lm-ik-table__source">
            {MAINT.colFrom}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <th scope="row" className="lm-ik-table__label">
              {onChange && (r.question || r.path) ? (
                <button
                  className="lm-ik-table__link"
                  type="button"
                  onClick={() => onChange(r)}
                  aria-label={`${TURN.change}: ${r.label}`}
                >
                  {r.label}
                </button>
              ) : (
                r.label
              )}
            </th>
            {quiet ? null : <td className="lm-ik-num">{fmt(r.kcal, unit)}</td>}
            <td className="lm-ik-table__source">
              {quiet ? null : r.from}
              {r.assumed ? <span className="lm-ik-assumed">{MAINT.assumed}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------------------------------- the result card */

/** The measured-energy line: the figure as answered and what the plan does with it (the engine's route decides "used"). */
export function measuredLine(measured: MeasuredEnergy | undefined, m: MaintenanceEstimate): string | null {
  if (!measured) return null;
  const used = m.activity?.base.rmrRoute === 'measured' || m.rmrMethod === 'measured';
  let use: string;
  if (measured.kind === 'rmr' && measured.method === 'metabolic_cart') use = used ? A.measured.use.usedRmr : A.measured.use.shownEstimate;
  else if (measured.method === 'dxa_based' || measured.method === 'smart_scale' || measured.method === 'calculator') use = A.measured.use.shownEstimate;
  else if (measured.method === 'tracking') use = A.measured.use.observation;
  else use = A.measured.use.tdeeMeasured;
  return A.measured.line(
    formatNumber(measured.value, 0),
    measured.unit,
    A.measured.kind[measured.kind],
    A.measured.methodsShort[measured.method],
    monthText(measured.date),
    use,
  );
}

export interface MaintenanceResultProps {
  m: MaintenanceEstimate;
  view: MaintenanceView;
  unit: EnergyUnit;
  /** Gentle mode: no kcal by default ("show numbers" reveals them). */
  quiet?: boolean;
  /** Basics are typical values, not the person's own. */
  typicalBody?: boolean;
  /** The measured figure as answered (shown with what the plan does with it). */
  measured?: MeasuredEnergy;
  /** "change" on a driver or the biggest unknown: open that question (a card in the same list, or a deep link). */
  onChangeAnswer: (question: string) => void;
  /** Heading level and text (the chapter list uses an h3 inside the answers; Your body its panel title). */
  title?: string;
  headingLevel?: 'h2' | 'h3';
  id?: string;
  /** A card of its own (the chapter screen) or a standalone faceplate body (Your body draws the faceplate). */
  inset?: boolean;
  /** The question open on screen now: the biggest unknown does not offer a key that would open it again. */
  openQuestion?: string | null;
  /** The driver table folds under "What drives it" (the chapter step, where the question below is the hero). */
  foldDrivers?: boolean;
  /**
   * Your body's card: the parts as a plain list with units (no header row, no labels under the bar, no per-part
   * Change: the card's one Edit opens the questions).
   */
  compact?: boolean;
}

/**
 * The maintenance result (design v3 §4.2): the engine's number and 80 % range, the driver bar with its table twin,
 * the biggest unknown when fixing it narrows the range by ≥ 20 kcal (the one line of text under the numbers), and the
 * measured figure once answered. Every "change" opens a question; nothing opens a sheet.
 */
export function MaintenanceResult({
  m,
  view,
  unit,
  quiet = false,
  typicalBody,
  measured,
  onChangeAnswer,
  title = MAINT.title,
  headingLevel = 'h3',
  id,
  inset = true,
  openQuestion = null,
  foldDrivers = false,
  compact = false,
}: MaintenanceResultProps) {
  const [show, setShow] = useState(!quiet);
  const hidden = quiet && !show;
  const b = view.explanation.biggestUnknown;
  const H = headingLevel;
  const fixRow = (row: DriverRow) => {
    if (row.question) onChangeAnswer(row.question);
    else if (row.path === 'measured') onChangeAnswer('measuredEver');
  };
  const line = measuredLine(measured, m);
  const fixTarget = b
    ? b.driver === 'rmr'
      ? 'measuredEver'
      : b.driver === 'steps'
        ? 'stepsKnown'
        : b.driver === 'work'
          ? 'job'
          : (DRIVER_QUESTION[b.driver] ?? b.driver)
    : null;
  const body = (
    <>
      {hidden ? (
        <p className="lm-ik-note">{MAINT.quietHeadline}</p>
      ) : (
        // the card's title names the number: no second label over it
        <div className="lm-ik-readout-wrap">
          <HeroNumber
            value={energyOut(m.kcal, unit)}
            unit={`${unitWord(unit)}/day`}
            range={`Likely ${view.lo}–${view.hi}`}
            size="num-l"
            label={view.headline}
            hue="energy"
          />
        </div>
      )}
      {hidden ? null : <p className="lm-sr">{view.headline}</p>}
      <DriverBar rows={view.rows} unit={unit} quiet={hidden} onChange={compact ? undefined : fixRow} table={!foldDrivers} compact={compact} />
      {foldDrivers ? (
        <details className="lm-ik-fold">
          <summary>{MAINT.openDrivers}</summary>
          <DriverTable rows={view.rows} unit={unit} quiet={hidden} onChange={fixRow} />
        </details>
      ) : null}
      {quiet ? (
        <div className="lm-ik-actions">
          <Key variant="text" size="sm" aria-pressed={show} onClick={() => setShow((s) => !s)}>
            {show ? MAINT.hideNumbers : MAINT.showNumbers}
          </Key>
        </div>
      ) : null}
      <div className="lm-ik-maint__lines">
        {view.palNote ? <InlineWarning severity="caution">{view.palNote}</InlineWarning> : null}
        {typicalBody ? <p>{MAINT.needsBody}</p> : null}
        {!hidden && line ? <p className="lm-ik-result__measured">{line}</p> : null}
        {!hidden && view.unknownText && b && fixTarget ? (
          <div className="lm-ik-maint__unknown">
            <p>{view.unknownText}</p>
            {fixTarget !== openQuestion ? (
              <Key size="sm" variant="outlined" onClick={() => onChangeAnswer(fixTarget)}>
                {MAINT.fix[b.driver as keyof typeof MAINT.fix] ?? TURN.change}
              </Key>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
  return inset ? (
    <GradientCard id={id} className="lm-ik-result" as="section" domain="energy" aria-live="polite" aria-label={title} head={<CardHead icon={Flame} title={title} as={H} info={maintenanceInfo} />}>
      {body}
    </GradientCard>
  ) : (
    <section id={id} className="lm-ik-result lm-ik-result--plain" aria-live="polite" aria-label={title}>{body}</section>
  );
}

/* ------------------------------------------------------------------------------------------- rail + faceplate */

/** Readout rail below 1024 px; ▾ unfolds the driver bar in place (no sheet). */
export function MaintenanceRail({
  view,
  unit,
  quiet,
}: {
  view: MaintenanceView;
  unit: EnergyUnit;
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="lm-ik-rail" data-open={open || undefined}>
      <div className="lm-ik-rail__head">
        <span className="lm-ik-rail__text" aria-live="polite">
          {quiet ? MAINT.railQuiet : <MaintenanceNumber view={view} size="num" />}
        </span>
        <MaintenanceInfo />
        <IconKey
          icon={ChevronDown}
          className="lm-ik-rail__toggle"
          label={MAINT.openDrivers}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        />
      </div>
      <div id={panelId} className="lm-ik-rail__panel" hidden={!open}>
        {open ? <DriverBar rows={view.rows} unit={unit} quiet={quiet} table={false} /> : null}
      </div>
    </div>
  );
}

/**
 * From 768 px: "Your picture so far" — maintenance and its bar, then the other chapters in one line each. The biggest
 * unknown is said once, on the maintenance result; and once that result card is on the step (`maintenance={false}`),
 * the panel drops its own copy of the number and bar and keeps only the other chapters.
 */
export function PictureFace({
  view,
  unit,
  quiet,
  lines,
  title,
  maintenance = true,
}: {
  m: MaintenanceEstimate;
  view: MaintenanceView;
  unit: EnergyUnit;
  quiet?: boolean;
  lines: ReadonlyArray<{ key: string; value: string; state?: 'answered' | 'later' | 'empty' }>;
  title: string;
  maintenance?: boolean;
}) {
  return (
    <GradientCard
      className="lm-ik-picture"
      as="section"
      head={<CardHead icon={Flame} title={title} as="h2" info={maintenance ? maintenanceInfo : undefined} />}
    >
      {maintenance ? (
        <>
          {quiet ? (
            <p className="lm-ik-note">{MAINT.quietHeadline}</p>
          ) : (
            <div className="lm-ik-readout-wrap">
              <MaintenanceNumber view={view} size="num" />
            </div>
          )}
          <DriverBar rows={view.rows} unit={unit} quiet={quiet} table={false} />
        </>
      ) : null}
      <dl className="lm-ik-summary__rows" data-lead={maintenance ? undefined : 'true'}>
        {lines.map((l) => (
          <div key={l.key} className="lm-ik-summary__row" data-state={l.state}>
            <dt>{sentence(l.key)}</dt>
            <dd>
              <MonoMeta>{l.value}</MonoMeta>
            </dd>
          </div>
        ))}
      </dl>
    </GradientCard>
  );
}
