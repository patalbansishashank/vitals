import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { formatNumber } from '@/components';
import { useEnergyUnit, type EnergyUnit } from '@/state/settingsStore';
import { fmtClock, fmtDate, fmtKcal, fmtKcalValue, fmtPctValue } from '../format';
import { fastText, sessionText, windowText, type DayRx, type Prescription } from '../prescription';
import type { ConcreteSession } from '@/catalogues';

/** The one-page ladder summary printed before the selected plan's day-by-day pages. */
export interface LadderSummary {
  columns: string[];
  rows: Array<{ label: string; cells: string[] }>;
}

export interface PrintPrescriptionProps {
  /** "Hard plan" (never a letter). */
  planTitle: string;
  /** The measurable subtitle. */
  planName: string;
  sessions?: readonly ConcreteSession[];
  ladder?: LadderSummary;
  rx: Prescription;
  /** Printed under the heading and at the end of the document. */
  disclaimer: string;
  /** Called after the print dialog closes (the portal is then removed). */
  onDone: () => void;
}

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
function mealsText(d: DayRx, energy: EnergyUnit): string {
  if (d.zero) return 'no food · water and electrolytes';
  if (!d.meals.length) return '—';
  return d.meals.map((m) => `${fmtClock(m.clockH)} ${fmtKcal(m.kcal, energy)} (P ${formatNumber(m.proteinG, 0)})`).join(' · ');
}

function trainingText(d: DayRx): string {
  const parts = d.sessions.map(sessionText);
  if (d.fast) parts.push(fastText(d.fast));
  return parts.join(' · ') || 'rest';
}

/**
 * The whole plan day by day for paper (planner nice-to-have): rendered into a portal next to the app root only while
 * printing; `planner.css` @media print hides everything else. One table per week (never split across pages), with the
 * energy, macros, eating window, meal times, training and steps of every day, and the disclaimer at both ends.
 */
export function PrintPrescription({ planTitle, planName, rx, sessions, ladder, disclaimer, onDone }: PrintPrescriptionProps) {
  const energy = useEnergyUnit();
  useEffect(() => {
    const done = () => onDone();
    window.addEventListener('afterprint', done);
    // let the portal paint before the dialog snapshots the page
    const id = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        onDone();
      }
    }, 50);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('afterprint', done);
    };
  }, [onDone]);

  const first = rx.days[0];
  const last = rx.days[rx.days.length - 1];
  return createPortal(
    <div className="lp-print-root" aria-hidden="true">
      <header className="lp-print__head">
        <h1>
          {planTitle}
          {planName ? `: ${planName}` : ''}
        </h1>
        <p>
          {rx.weeks} weeks · {first ? fmtDate(first.dateISO) : ''} to {last ? fmtDate(last.dateISO) : ''} · Vitals day-by-day prescription
        </p>
        <p className="lp-print__disc">{disclaimer}</p>
      </header>
      {ladder ? (
        <section className="lp-print__ladder">
          <h2>The plans side by side</h2>
          <table>
            <thead>
              <tr>
                <th />
                {ladder.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ladder.rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {r.cells.map((c, i) => (
                    <td key={i}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <section className="lp-print__types">
        <h2>Day types</h2>
        <ul>
          {rx.types.map((t) => (
            <li key={t.key}>
              <b>{t.key}</b> {t.label} ·{' '}
              {t.sample.zero ? 'no food' : `${fmtKcal(t.sample.energyKcal, energy)} · P ${formatNumber(t.sample.proteinG, 0)} · C ${formatNumber(t.sample.carbG, 0)} · F ${formatNumber(t.sample.fatG, 0)} g`} · {t.count} days
            </li>
          ))}
        </ul>
      </section>
      {Array.from({ length: rx.weeks }, (_, w) => {
        const days = rx.days.filter((d) => d.week === w);
        if (!days.length) return null;
        return (
          <table key={w} className="lp-print__week">
            <caption>
              Week {w + 1} · {fmtDate(days[0]!.dateISO)} to {fmtDate(days[days.length - 1]!.dateISO)}
              {days[0]!.phase ? ` · ${days[0]!.phase}` : ''}
            </caption>
            <thead>
              <tr>
                <th>day</th>
                <th>type</th>
                <th className="num">{energy}</th>
                <th className="num">% maint.</th>
                <th className="num">protein</th>
                <th className="num">net carbs</th>
                <th className="num">fat</th>
                <th className="num">fibre</th>
                <th>window</th>
                <th>meals</th>
                <th>training</th>
                <th className="num">steps</th>
                <th>done</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <th scope="row">
                    {WD[d.weekday]} {fmtDate(d.dateISO)}
                  </th>
                  <td>{d.typeKey}</td>
                  <td className="num">{d.zero ? '0' : fmtKcalValue(d.energyKcal, energy)}</td>
                  <td className="num">{d.zero || d.energyPct === null ? '—' : fmtPctValue(d.energyPct)}</td>
                  <td className="num">{d.zero ? '0' : formatNumber(d.proteinG, 0)} g</td>
                  <td className="num">{d.zero ? '0' : formatNumber(d.carbG, 0)} g</td>
                  <td className="num">{d.zero ? '0' : formatNumber(d.fatG, 0)} g</td>
                  <td className="num">{d.zero ? '0' : formatNumber(d.fibreG, 0)} g</td>
                  <td>{d.zero ? '—' : windowText(d)}</td>
                  <td>{mealsText(d, energy)}</td>
                  <td>{trainingText(d)}</td>
                  <td className="num">{formatNumber(Math.round(d.steps / 100) * 100, 0)}</td>
                  <td className="lp-print__check" />
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
      {sessions?.length ? (
        <section className="lp-print__sessions">
          <h2>Sessions</h2>
          <ol>
            {sessions.map((s, i) => (
              <li key={i}>
                <b>{s.prescription.date ? fmtDate(s.prescription.date) : `session ${i + 1}`}</b> · {s.items.map((it) => it.text).join(' · ')}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <p className="lp-print__disc">{disclaimer}</p>
    </div>,
    document.body,
  );
}
