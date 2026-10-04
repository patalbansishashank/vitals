import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, Moon, Printer } from 'lucide-react';
import { Glyphs, Icon, IconKey, Key, ScrollRail, Section, formatNumber } from '@/components';
import { ClockDial, type ChartData, type Meal } from '@/features/charts';
import { useEnergyUnit, type EnergyUnit } from '@/state/settingsStore';
import { fmtClock, fmtDate, fmtDateWd, fmtKcal, fmtKcalValue, fmtPct } from '../format';
import { fastText, sessionText, windowText, type DayRx, type Prescription } from '../prescription';
import { PrintPrescription, type LadderSummary } from './PrintPrescription';
import type { ConcreteSession } from '@/catalogues';

export interface DaysTabProps {
  /** "Hard plan" (the plan's name in captions and print; never a letter). */
  planTitle: string;
  rx: Prescription;
  /** Composed sessions on the person's equipment, one per training session of the horizon (when a training profile exists). */
  sessions?: readonly ConcreteSession[];
  /** One-page ladder summary printed before the day-by-day pages. */
  ladderSummary?: LadderSummary;
  onCsv: () => void;
  onText: () => void;
  onJson: () => void;
  /** Initial day (e.g. from a deep link). */
  initialDay?: number;
  /** For the printed prescription's heading and disclaimer. */
  planName?: string;
  disclaimer?: string;
}

function MacroBar({ p, c, f }: { p: number; c: number; f: number }) {
  const kp = p * 4;
  const kc = c * 4;
  const kf = f * 9;
  const tot = kp + kc + kf || 1;
  return (
    <span className="lp-macrobar" aria-hidden="true">
      <i data-m="protein" style={{ flexGrow: kp / tot }} />
      <i data-m="carbs" style={{ flexGrow: kc / tot }} />
      <i data-m="fat" style={{ flexGrow: kf / tot }} />
    </span>
  );
}

/** Clock-dial data for one day: meals of the neighbouring days too, so the dial can measure the fast it breaks. */
function dialData(rx: Prescription, day: number): ChartData {
  const n = rx.days.length;
  const zeros = () => new Float32Array(n);
  const meals: Meal[] = [];
  for (let d = Math.max(0, day - 4); d <= Math.min(n - 1, day + 4); d++) {
    for (const m of rx.days[d]!.meals)
      meals.push({ day: d, startHour: m.clockH, durationMin: 30, grams: { protein: m.proteinG, netCarbs: m.carbG, fibre: m.fibreG, fat: m.fatG, alcohol: 0 } });
  }
  const today = rx.days[day]!;
  return {
    time: { days: n, startDate: rx.startDate },
    series: [],
    intake: {
      grams: { protein: zeros(), netCarbs: zeros(), fibre: zeros(), fat: zeros(), alcohol: zeros() },
      maintenance: zeros(),
      meals,
      eatingWindows: today.windowStartH !== null && today.windowEndH !== null ? [{ day, startHour: today.windowStartH, endHour: Math.max(today.windowEndH, today.windowStartH + 0.5) }] : [],
      sleep: [day - 1, day].filter((d) => d >= 0).map((d) => ({ day: d, startHour: rx.days[d]!.sleepBedH, endHour: rx.days[d]!.sleepWakeH + (rx.days[d]!.sleepWakeH < rx.days[d]!.sleepBedH ? 24 : 0) })),
      exercise: today.sessions.map((s) => ({ day, startHour: s.startH, durationMin: s.durationMin, type: s.kind === 'resistance' ? ('resistance' as const) : ('cardio' as const), label: s.label })),
    },
  };
}

const WD = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * Days tab (planner-results.md §6): day types, week navigation, a 7-row week table (energy and macros in grams, window,
 * meals, training, steps) and the selected day in full on the 24 h dial, with CSV / text / JSON exports.
 */
/** This week's sessions: by their dates when the composer set them, else by order within the week's training days. */
function weekSessions(sessions: readonly ConcreteSession[], rx: Prescription, week: number): ConcreteSession[] {
  const days = rx.days.filter((d) => d.week === week);
  const dates = new Set(days.map((d) => d.dateISO));
  const dated = sessions.filter((s) => s.prescription.date && dates.has(s.prescription.date));
  if (dated.length || sessions.some((s) => s.prescription.date)) return dated;
  const before = rx.days.filter((d) => d.week < week).reduce((a, d) => a + d.sessions.length, 0);
  const now = days.reduce((a, d) => a + d.sessions.length, 0);
  return sessions.slice(before, before + now);
}

export function DaysTab({ planTitle, rx, sessions, ladderSummary, onCsv, onText, onJson, initialDay = 0, planName, disclaimer = '' }: DaysTabProps) {
  const [picked, setDay] = useState(Math.max(0, initialDay));
  const [printing, setPrinting] = useState(false);
  const energy = useEnergyUnit();
  const donePrinting = useCallback(() => setPrinting(false), []);
  const day = Math.min(picked, rx.days.length - 1);
  const week = Math.floor(day / 7);
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    railRef.current?.querySelector<HTMLElement>(`[data-week="${week}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [week]);
  const days = rx.days.filter((d) => d.week === week);
  const sel = rx.days[day]!;
  const data = useMemo(() => dialData(rx, day), [rx, day]);
  const goWeek = (w: number) => {
    const target = Math.max(0, Math.min(rx.weeks - 1, w));
    setDay(Math.min(rx.days.length - 1, target * 7 + (day % 7)));
  };
  const first = days[0];
  const last = days[days.length - 1];

  return (
    <div className="lp-days-tab">
      <Section label="Day types in this plan" aside={<span className="lm-eng">{rx.types.length} kinds of day</span>}>
        <ul className="lp-types">
          {rx.types.map((t) => (
            <li key={t.key} className="lp-type">
              <span className="lp-type__key" aria-hidden="true">
                {t.key}
              </span>
              <span className="lp-type__text">
                <span className="lp-type__label">{t.label}</span>
                <span className="lp-type__nums">
                  {t.sample.zero ? 'no food · water and electrolytes' : `${fmtKcal(t.sample.energyKcal, energy)} · P ${formatNumber(t.sample.proteinG, 0)} · C ${formatNumber(t.sample.carbG, 0)} · F ${formatNumber(t.sample.fatG, 0)} g`}
                </span>
                {t.sample.zero ? null : <MacroBar p={t.sample.proteinG} c={t.sample.carbG} f={t.sample.fatG} />}
              </span>
              <span className="lp-type__count lm-num">
                {t.count}
                <span className="lm-unit">days</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <div className="lp-weeknav">
        <IconKey icon={ChevronLeft} label="Previous week" size="sm" onClick={() => goWeek(week - 1)} disabled={week === 0} />
        <p className="lp-weeknav__label" aria-live="polite">
          <span className="lp-weeknav__wk">week {week + 1}</span>
          <span className="lm-eng">
            {' '}
            of {rx.weeks} · {first ? fmtDate(first.dateISO) : ''}–{last ? fmtDate(last.dateISO) : ''}
          </span>
        </p>
        <IconKey icon={ChevronRight} label="Next week" size="sm" onClick={() => goWeek(week + 1)} disabled={week >= rx.weeks - 1} />
      </div>
      <div ref={railRef}>
        <ScrollRail className="lp-weekrail" bleed={false} gap={4} role="group" aria-label="Weeks">
          {Array.from({ length: rx.weeks }, (_, w) => (
            <Key key={w} size="sm" pressed={w === week} data-week={w} onClick={() => goWeek(w)} aria-label={`Week ${w + 1}`}>
              {w + 1}
            </Key>
          ))}
        </ScrollRail>
      </div>

      <div className="lp-days-grid">
        {/* the week table scrolls inside its own box on phones; the page never scrolls sideways */}
        <div className="lp-table-wrap" tabIndex={0} role="region" aria-label={`${planTitle}, week ${week + 1}, day by day`}>
          <table className="lp-week">
          <caption className="lm-sr">
            {planTitle}, week {week + 1}: energy, macronutrients, eating window, training and steps for each day. Select a day for its full prescription.
          </caption>
          <thead>
            <tr>
              <th scope="col">day</th>
              <th scope="col">type</th>
              <th scope="col" className="num">
                energy <span className="lm-unit">{energy}</span>
              </th>
              <th scope="col" className="num">
                protein
              </th>
              <th scope="col" className="num">
                net carbs
              </th>
              <th scope="col" className="num">
                fat
              </th>
              <th scope="col" className="num lp-col-wide">
                fibre
              </th>
              <th scope="col" className="lp-col-wide">
                window
              </th>
              <th scope="col">training</th>
              <th scope="col" className="num lp-col-wide">
                steps
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <DayRow key={d.day} d={d} energy={energy} selected={d.day === day} onSelect={() => setDay(d.day)} />
            ))}
          </tbody>
        </table>
        </div>

        <DayDetail d={sel} data={data} energy={energy} />
      </div>

      {sessions?.length ? <WeekSessions sessions={weekSessions(sessions, rx, week)} week={week} /> : null}

      <div className="lp-exports">
        <Key size="sm" icon={Download} onClick={onCsv}>
          Download CSV
        </Key>
        <Key size="sm" icon={Printer} onClick={() => setPrinting(true)} loading={printing}>
          Print day by day
        </Key>
        <Key size="sm" icon={FileText} onClick={onText}>
          Summary (text)
        </Key>
        <Key size="sm" variant="quiet" icon={Download} onClick={onJson}>
          Export JSON
        </Key>
        {rx.notes.length ? <span className="lm-eng">{rx.notes.length} compiler notes in the exports</span> : null}
      </div>
      {printing ? <PrintPrescription planTitle={planTitle} planName={planName ?? ''} rx={rx} sessions={sessions} ladder={ladderSummary} disclaimer={disclaimer} onDone={donePrinting} /> : null}
    </div>
  );
}

/** "This week's sessions" (plan-ladder.md §6.6): concrete exercises on the person's equipment. */
function WeekSessions({ sessions, week }: { sessions: readonly ConcreteSession[]; week: number }) {
  if (!sessions.length) return null;
  return (
    <Section label="This week’s sessions" aside={<span className="lm-eng">week {week + 1}</span>}>
      <ol className="lp-sessions">
        {sessions.map((s, i) => (
          <li key={i} className="lp-session">
            <p className="lp-session__head">
              <span className="lm-eng">{s.prescription.date ? fmtDateWd(s.prescription.date) : `session ${i + 1}`}</span>
              <span className="lm-num">{formatNumber(s.minutes, 0)} min</span>
            </p>
            <ul className="lp-session__items">
              {s.items.map((it, j) => (
                <li key={j}>{it.text}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function DayRow({ d, energy, selected, onSelect }: { d: DayRx; energy: EnergyUnit; selected: boolean; onSelect: () => void }) {
  const kind = d.zero ? 'fast' : d.refeed ? 'refeed' : d.fast ? 'fastpart' : undefined;
  return (
    <tr data-selected={selected || undefined} data-kind={kind} onClick={onSelect}>
      <th scope="row">
        <button type="button" className="lp-week__day" aria-pressed={selected} onClick={onSelect}>
          <span className="lp-week__wd">{WD[d.weekday]}</span> <span className="lm-num">{fmtDate(d.dateISO)}</span>
        </button>
      </th>
      <td>
        <span className="lp-week__type" title={d.typeLabel}>
          {d.typeKey}
        </span>
      </td>
      <td className="num">
        {d.zero ? (
          <span className="lp-week__fast">fast</span>
        ) : (
          <>
            <span className="lm-num">{fmtKcalValue(d.energyKcal, energy)}</span>
            {d.energyPct !== null ? <span className="lp-week__pct"> {fmtPct(d.energyPct)}</span> : null}
          </>
        )}
      </td>
      <td className="num lm-num">{d.zero ? '0' : formatNumber(d.proteinG, 0)}</td>
      <td className="num lm-num">{d.zero ? '0' : formatNumber(d.carbG, 0)}</td>
      <td className="num lm-num">{d.zero ? '0' : formatNumber(d.fatG, 0)}</td>
      <td className="num lm-num lp-col-wide">{d.zero ? '0' : formatNumber(d.fibreG, 0)}</td>
      <td className="lp-col-wide">{d.fast && d.fast.part !== 'end' && d.fast.part !== 'start' ? '—' : `${windowText(d)}${d.meals.length ? ` · ${d.meals.length}` : ''}`}</td>
      <td>
        <span className="lp-week__train">
          {d.sessions.map((s, i) => (
            <Icon key={i} icon={s.kind === 'resistance' ? Glyphs.DumbbellPlate : Glyphs.RunGlyph} size={16} label={s.label} />
          ))}
          {d.fast ? <Icon icon={Glyphs.FastClock} size={16} label={fastText(d.fast)} /> : null}
          {!d.sessions.length && !d.fast ? <span className="lm-eng">rest</span> : null}
        </span>
      </td>
      <td className="num lm-num lp-col-wide">{formatNumber(Math.round(d.steps / 100) * 100, 0)}</td>
    </tr>
  );
}

function DayDetail({ d, data, energy }: { d: DayRx; data: ChartData; energy: EnergyUnit }) {
  return (
    <section className="lp-daydetail" aria-label={`Prescription for ${fmtDateWd(d.dateISO)}`}>
      <header className="lp-daydetail__head">
        <h4 className="lp-daydetail__title">{fmtDateWd(d.dateISO)}</h4>
        <span className="lm-eng">
          day {d.day + 1} · type {d.typeKey} · {d.typeLabel}
        </span>
      </header>
      <div className="lp-daydetail__body">
        <ClockDial data={data} day={d.day} size={200} energyUnit={energy} />
        <div className="lp-daydetail__facts">
          {d.zero || d.fast ? (
            <p className="lp-daydetail__fast">
              <Icon icon={Glyphs.FastClock} size={16} />
              <span>{d.fast ? fastText(d.fast) : 'Water-only day'}. Water, electrolytes and non-caloric drinks only.</span>
            </p>
          ) : null}
          {d.refeed ? <p className="lp-daydetail__fast">Graded refeed: a smaller, easy-to-digest day after the fast.</p> : null}
          {!d.zero ? (
            <dl className="lp-daydetail__energy">
              <div>
                <dt className="lm-eng">energy</dt>
                <dd className="lm-num">
                  {fmtKcalValue(d.energyKcal, energy)}
                  <span className="lm-unit">{energy}</span>
                  {d.energyPct !== null ? <span className="lp-daydetail__pct">{fmtPct(d.energyPct)} of maintenance</span> : null}
                </dd>
              </div>
              <div>
                <dt className="lm-eng">protein</dt>
                <dd className="lm-num">
                  {formatNumber(d.proteinG, 0)}
                  <span className="lm-unit">g</span>
                </dd>
              </div>
              <div>
                <dt className="lm-eng">net carbs</dt>
                <dd className="lm-num">
                  {formatNumber(d.carbG, 0)}
                  <span className="lm-unit">g</span>
                </dd>
              </div>
              <div>
                <dt className="lm-eng">fat</dt>
                <dd className="lm-num">
                  {formatNumber(d.fatG, 0)}
                  <span className="lm-unit">g</span>
                </dd>
              </div>
              <div>
                <dt className="lm-eng">fibre</dt>
                <dd className="lm-num">
                  {formatNumber(d.fibreG, 0)}
                  <span className="lm-unit">g</span>
                </dd>
              </div>
            </dl>
          ) : null}
          {d.meals.length ? (
            <ol className="lp-meals" aria-label="Meals">
              {d.meals.map((m, i) => (
                <li key={i}>
                  <span className="lp-meals__t lm-num">{fmtClock(m.clockH)}</span>
                  <span>
                    {fmtKcal(m.kcal, energy)} · P {formatNumber(m.proteinG, 0)} · C {formatNumber(m.carbG, 0)} · F {formatNumber(m.fatG, 0)} g
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          <ul className="lp-daydetail__list">
            {d.sessions.map((s, i) => (
              <li key={i}>
                <Icon icon={s.kind === 'resistance' ? Glyphs.DumbbellPlate : Glyphs.RunGlyph} size={16} />
                <span>{sessionText(s)}</span>
              </li>
            ))}
            <li>
              <Icon icon={Glyphs.Footsteps} size={16} />
              <span>{formatNumber(Math.round(d.steps / 100) * 100, 0)} steps</span>
            </li>
            <li>
              <Icon icon={Moon} size={16} />
              <span>
                sleep {fmtClock(d.sleepBedH)}–{fmtClock(d.sleepWakeH)} · {formatNumber(d.sleepHours, 1)} h
              </span>
            </li>
            {d.extras.map((x) => (
              <li key={x}>
                <Icon icon={Glyphs.MealDot} size={16} />
                <span>{x}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

