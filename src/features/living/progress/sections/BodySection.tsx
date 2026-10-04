/**
 * Progress › Body (living-mode.md §8.2 item 4): composition from the latest anchored state (each row with its likely
 * range and the change since day 1), the girths table (mean of repeats, method, date) and "Add a measurement".
 * Quiet mode keeps composition behind "show numbers". The visceral view and the figure belong to other screens.
 */
import { useState } from 'react';
import { CorrectedReadings } from '../../components/Correction';
import { Faceplate, Key, KeyLink, Section, formatNumber, formatSigned } from '@/components';
import type { LocalDate } from '@/living';
import { EstimateReadout } from '../../components/Estimate';
import { useLiving } from '../../data/source';
import { fmtDay } from '../../format';
import { MeasurementPanel } from '../components/MeasurementPanel';
import { MEASURE_COPY, PROGRESS_COPY as C } from '../copy';

const METHOD_LABEL: Record<string, string> = MEASURE_COPY.methods;

export interface BodySectionProps {
  today: LocalDate;
  quiet: boolean;
  onShowNumbers?: () => void;
}

export function BodySection({ today, quiet, onShowNumbers }: BodySectionProps) {
  const comp = useLiving((s) => s.composition(), []);
  const [open, setOpen] = useState(false);
  return (
    <Faceplate
      id="body"
      title={C.faces.body}
      className="lv-prog-face"
      actions={
        <Key size="sm" onClick={() => setOpen(true)}>
          {C.addMeasurement}
        </Key>
      }
    >
      <Section label={C.composition} aside={comp && !quiet ? C.compositionAsOf(fmtDay(comp.asOf)) : undefined}>
        {!comp ? (
          <p className="lv-prog-state">{C.noComposition}</p>
        ) : quiet ? (
          <p className="lv-prog-state">
            {C.quietComposition}{' '}
            {onShowNumbers ? (
              <Key size="sm" variant="quiet" onClick={onShowNumbers}>
                {C.showNumbers}
              </Key>
            ) : null}
          </p>
        ) : (
          <dl className="lv-prog-comp">
            {comp.rows.map((row) => (
              <div key={row.label} className="lv-prog-comp__row">
                <dt className="lm-eng">{row.label}</dt>
                <dd>
                  <EstimateReadout value={row.value} range={{ lo: row.lo, hi: row.hi }} unit={row.unit} decimals={row.decimals} />
                  {row.sinceStart !== null ? <span className="lv-prog-comp__since">{C.sinceDay1(`${formatSigned(row.sinceStart, row.decimals)} ${row.unit}`)}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section label={C.girths}>
        {comp && comp.girths.length ? (
          <table className="lv-prog-table">
            <thead>
              <tr>
                <th scope="col">{C.girthCols.what}</th>
                <th scope="col">{C.girthCols.value}</th>
                <th scope="col">{C.girthCols.method}</th>
                <th scope="col">{C.girthCols.date}</th>
              </tr>
            </thead>
            <tbody>
              {comp.girths.map((g, i) => (
                <tr key={`${g.label}:${g.date}:${i}`}>
                  <th scope="row">{g.label}</th>
                  <td className="lm-num">
                    {formatNumber(g.value, 1)} <span className="lm-unit">cm</span>
                    <span className="lv-prog-table__sub">{C.meanOf(g.repeats)}</span>
                  </td>
                  <td>{METHOD_LABEL[g.method] ?? g.method}</td>
                  <td>{fmtDay(g.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="lv-prog-state">{C.noGirths}</p>
        )}
      </Section>

      <CorrectedReadings />

      <Section label={C.setup}>
        <p className="lv-prog-state">{C.setupLine}</p>
        <KeyLink to="/onboarding/activity" size="sm">
          {C.updateAnswers}
        </KeyLink>
      </Section>

      <MeasurementPanel open={open} onClose={() => setOpen(false)} date={today} />
    </Faceplate>
  );
}
