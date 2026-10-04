/**
 * Maintenance displays shared by the intake and Your body: the driver bar with its table twin (COMPONENTS §13.2), the
 * maintenance result (design v3 §4.2; no sheet — every "change" opens a question), the readout rail and the desktop
 * faceplate.
 */
import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Faceplate, IconKey, InlineWarning, Key, Readout, formatNumber } from '@/components';
import type { MaintenanceEstimate } from '@/features/body/maintenance';
import type { EnergyUnit } from '@/state/settingsStore';
import { monthText } from '../chapters/activity';
import { A, MAINT, TURN } from '../copy';
import { DRIVER_QUESTION, energyOut, fmt, unitWord, type DriverRow, type MaintenanceView } from '../maintenanceView';
import type { MeasuredEnergy } from '../types';

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
}

export function DriverBar({ rows, unit, quiet, table = true, onChange }: DriverBarProps) {
  const total = rows.reduce((a, r) => a + Math.max(0, r.kcal), 0);
  const parts = rows.map((r) => (quiet ? r.label : `${r.label} ${fmt(r.kcal, unit)}`)).join(', ');
  const anyAssumed = rows.some((r) => r.assumed);
  return (
    <div className="lm-ik-driverbar">
      <div className="lm-ik-driverbar__bar" role="img" aria-label={MAINT.barLabel(parts)}>
        {rows.map((r, i) => (
          <span key={r.id} className="lm-ik-driverbar__seg" data-alt={i % 2 === 1 || undefined} data-assumed={r.assumed || undefined} style={{ flexGrow: Math.max(0, r.kcal), flexBasis: 0 }} />
        ))}
      </div>
      <div className="lm-ik-driverbar__labels" aria-hidden="true">
        {rows.map((r) => (
          <span key={r.id} style={{ flexGrow: Math.max(0, r.kcal), flexBasis: 0 }}>
            {total > 0 && r.kcal / total >= 0.12 ? `${r.label}${quiet ? '' : ` ${fmt(r.kcal, unit)}`}` : ''}
          </span>
        ))}
      </div>
      {anyAssumed ? <p className="lm-ik-note">{MAINT.dashedNote}</p> : null}
      {table ? (
        <table className="lm-ik-table">
          <caption>{MAINT.tableCaption}</caption>
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
              <th scope="col">{MAINT.colFrom}</th>
              {onChange ? <td className="lm-ik-table__act" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.label}</th>
                {quiet ? null : <td className="lm-ik-num">{fmt(r.kcal, unit)}</td>}
                <td>
                  {r.from}
                  {r.assumed ? <span className="lm-ik-assumed">{MAINT.assumed}</span> : null}
                </td>
                {onChange ? (
                  <td className="lm-ik-table__act">
                    {r.question || r.path ? (
                      <Key variant="quiet" size="sm" onClick={() => onChange(r)} aria-label={`${TURN.change}: ${r.label}`}>
                        {TURN.change}
                      </Key>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
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
  return A.measured.line(formatNumber(measured.value, 0), measured.unit, A.measured.kind[measured.kind], A.measured.methodsShort[measured.method], monthText(measured.date), use);
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
  /** Inset region (in the answered list) or a standalone faceplate body (Your body draws the faceplate). */
  inset?: boolean;
}

/**
 * The maintenance result (design v3 §4.2): the engine's number and 80 % range, the driver bar with its table twin,
 * the biggest unknown when fixing it narrows the range by ≥ 20 kcal, and the measured figure once answered. Every
 * "change" opens a question; nothing opens a sheet.
 */
export function MaintenanceResult({ m, view, unit, quiet = false, typicalBody, measured, onChangeAnswer, title = MAINT.title, headingLevel = 'h3', id, inset = true }: MaintenanceResultProps) {
  const [show, setShow] = useState(!quiet);
  const hidden = quiet && !show;
  const b = view.explanation.biggestUnknown;
  const H = headingLevel;
  const fixRow = (row: DriverRow) => {
    if (row.question) onChangeAnswer(row.question);
    else if (row.path === 'measured') onChangeAnswer('measuredEver');
  };
  const line = measuredLine(measured, m);
  return (
    <section id={id} className={inset ? 'lm-ik-result' : 'lm-ik-result lm-ik-result--plain'} aria-live="polite" aria-label={title}>
      {inset ? <H className="lm-ik-result__title">{title}</H> : null}
      {hidden ? (
        <p className="lm-ik-note">{MAINT.quietHeadline}</p>
      ) : (
        <Readout label={MAINT.label} value={energyOut(m.kcal, unit)} decimals={0} unit={`${unitWord(unit)}/day`} range={[energyOut(m.band80[0], unit), energyOut(m.band80[1], unit)]} size="md" animate />
      )}
      {hidden ? null : <p className="lm-sr">{view.headline}</p>}
      <DriverBar rows={view.rows} unit={unit} quiet={hidden} onChange={fixRow} />
      {quiet ? (
        <div className="lm-ik-actions">
          <Key variant="quiet" size="sm" aria-pressed={show} onClick={() => setShow((s) => !s)}>
            {show ? MAINT.hideNumbers : MAINT.showNumbers}
          </Key>
        </div>
      ) : null}
      <div className="lm-ik-maint__lines">
        {view.palNote ? <InlineWarning severity="caution">{view.palNote}</InlineWarning> : null}
        {typicalBody ? <p>{MAINT.needsBody}</p> : null}
        {line ? <p className="lm-ik-result__measured">{line}</p> : null}
        {view.unknownText && b ? (
          <div className="lm-ik-maint__unknown">
            <p>{view.unknownText}</p>
            <Key size="sm" onClick={() => onChangeAnswer(b.driver === 'rmr' ? 'measuredEver' : b.driver === 'steps' ? 'stepsKnown' : b.driver === 'work' ? 'job' : (DRIVER_QUESTION[b.driver] ?? b.driver))}>
              {MAINT.fix[b.driver as keyof typeof MAINT.fix] ?? TURN.change}
            </Key>
          </div>
        ) : null}
        {view.comparison ? <p>{view.comparison}</p> : null}
        <p>{MAINT.calibration}</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------- rail + faceplate */

/** Readout rail below 1024 px; ▾ unfolds the driver bar in place (no sheet). */
export function MaintenanceRail({ view, unit, quiet }: { view: MaintenanceView; unit: EnergyUnit; quiet?: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="lm-ik-rail" data-open={open || undefined}>
      <div className="lm-ik-rail__head">
        <span className="lm-ik-rail__text" aria-live="polite">
          {quiet ? MAINT.railQuiet : view.rail}
        </span>
        <IconKey icon={ChevronDown} className="lm-ik-rail__toggle" label={MAINT.openDrivers} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)} />
      </div>
      <div id={panelId} className="lm-ik-rail__panel" hidden={!open}>
        {open ? <DriverBar rows={view.rows} unit={unit} quiet={quiet} table={false} /> : null}
      </div>
    </div>
  );
}

/** Desktop: "Your picture so far" — maintenance, its bar and the other chapters in one line each. */
export function PictureFace({ m, view, unit, quiet, lines, title }: { m: MaintenanceEstimate; view: MaintenanceView; unit: EnergyUnit; quiet?: boolean; lines: ReadonlyArray<{ key: string; value: string }>; title: string }) {
  return (
    <Faceplate className="lm-ik-picture" title={title}>
      {quiet ? (
        <p className="lm-ik-note">{MAINT.quietHeadline}</p>
      ) : (
        <Readout label={MAINT.label} value={energyOut(m.kcal, unit)} decimals={0} unit={`${unitWord(unit)}/day`} range={[energyOut(m.band80[0], unit), energyOut(m.band80[1], unit)]} size="sm" animate />
      )}
      <DriverBar rows={view.rows} unit={unit} quiet={quiet} table={false} />
      {view.unknownText ? <p className="lm-ik-note">{view.unknownText}</p> : null}
      <dl className="lm-ik-summary__rows">
        {lines.map((l) => (
          <div key={l.key} className="lm-ik-summary__row">
            <dt>{l.key}</dt>
            <dd>{l.value}</dd>
          </div>
        ))}
      </dl>
    </Faceplate>
  );
}
