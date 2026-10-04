/**
 * Today's 24 h dial in display mode (COMPONENTS §4 ClockRing; REVIEW_FINDINGS #3): a printed dial — hairline bezel,
 * 24 hour ticks, the eating window and any prescribed fast as thin bands (never a thick donut), meals as dots on the
 * window band (size by energy), sessions as short ticks outside the ring, sleep as a thin inner arc, and the yellow
 * now-hand with its counterweight dot. The centre readout sits inside the 00/06/12/18 numerals. A text summary sits
 * under the dial for assistive tech (the SVG itself is decorative).
 */
import type { PrescribedDaySnapshot } from '@/living';
import { energyInText } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import { fmtClock, fmtHours, kcal, mealName } from '../../format';

export interface TodayDialProps {
  rx: PrescribedDaySnapshot;
  /** Current clock hour on today's date; null on other dates (no hand). */
  nowH: number | null;
  size?: number;
  /** Centre readout: "eat until 20:00", "fast · 14 h done". */
  centre: { primary: string; secondary?: string };
  quiet?: boolean;
}

const ang = (h: number) => ((((h % 24) + 24) % 24) / 24) * Math.PI * 2;
const pt = (c: number, r: number, h: number): [number, number] => [c + r * Math.sin(ang(h)), c - r * Math.cos(ang(h))];

function arc(c: number, r: number, h0: number, h1: number): string {
  let span = h1 - h0;
  while (span <= 0) span += 24;
  if (span >= 24) span = 23.999;
  const [x0, y0] = pt(c, r, h0);
  const [x1, y1] = pt(c, r, h0 + span);
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${span > 12 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/** The plain-language summary under the dial (COMPONENTS §4 a11y). */
export function dialSummary(rx: PrescribedDaySnapshot, quiet = false): string {
  const parts: string[] = [];
  if (rx.window) {
    const meals = rx.meals.map((m) => `${fmtClock(m.clockH)}${quiet ? ` (${mealName(m.slot, m.clockH)})` : ` (${kcal(m.energyKcal)} kcal)`}`);
    parts.push(`Eat ${fmtClock(rx.window.startH)}–${fmtClock(rx.window.endH)}, ${rx.meals.length} meal${rx.meals.length === 1 ? '' : 's'}${meals.length ? `: ${meals.join(', ')}` : ''}.`);
  } else if (rx.meals.length === 0) parts.push('No meals today.');
  if (rx.fast) parts.push(`Fast ${Math.round(rx.fast.hours)} h.`);
  for (const s of rx.sessions) parts.push(`${s.kind === 'resistance' ? 'Lift' : 'Cardio'} ${fmtClock(s.startH)}–${fmtClock(s.startH + s.durationMin / 60)}.`);
  if (rx.sleep) parts.push(`Sleep ${fmtClock(rx.sleep.bedH)}–${fmtClock(rx.sleep.wakeH)} (${fmtHours((rx.sleep.wakeH - rx.sleep.bedH + 24) % 24)}).`);
  return parts.join(' ');
}

export function TodayDial({ rx, nowH, size = 200, centre, quiet = false }: TodayDialProps) {
  const eu = useEnergyUnit();
  const c = size / 2;
  const R = c - 6; // bezel
  const band = R - 9; // window band radius
  const inner = R - 24; // sleep arc
  const maxK = Math.max(1, ...rx.meals.map((m) => m.energyKcal));
  return (
    <figure className="lv-dial">
      <svg className="lv-dial__svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle cx={c} cy={c} r={R} className="lv-dial__bezel" />
        {Array.from({ length: 24 }, (_, h) => {
          const major = h % 6 === 0;
          const [x0, y0] = pt(c, R, h);
          const [x1, y1] = pt(c, R - (major ? 6 : 3), h);
          return <line key={h} x1={x0} y1={y0} x2={x1} y2={y1} className={major ? 'lv-dial__tick lv-dial__tick--major' : 'lv-dial__tick'} />;
        })}
        {[0, 6, 12, 18].map((h) => {
          const [x, y] = pt(c, R - 15, h);
          return (
            <text key={h} x={x} y={y} className="lv-dial__num" textAnchor="middle" dominantBaseline="central">
              {String(h).padStart(2, '0')}
            </text>
          );
        })}
        <circle cx={c} cy={c} r={band} className="lv-dial__track" />
        {rx.window ? <path d={arc(c, band, rx.window.startH, rx.window.endH)} className="lv-dial__window" /> : null}
        {rx.fast ? <path d={arc(c, band, rx.window?.endH ?? 20, (rx.window?.endH ?? 20) + Math.min(23.9, rx.fast.hours))} className="lv-dial__fast" /> : null}
        {rx.sleep ? <path d={arc(c, inner, rx.sleep.bedH, rx.sleep.wakeH)} className="lv-dial__sleep" /> : null}
        {rx.sessions.map((s) => (
          <path key={s.slotKey} d={arc(c, R + 3, s.startH, s.startH + Math.max(0.25, s.durationMin / 60))} className="lv-dial__session" />
        ))}
        {rx.meals.map((m) => {
          const [x, y] = pt(c, band, m.clockH);
          const r = quiet ? 4 : 3.5 + 3 * Math.sqrt(m.energyKcal / maxK);
          return <circle key={m.slot} cx={x} cy={y} r={r} className="lv-dial__meal" />;
        })}
        {nowH !== null ? (
          <g className="lv-dial__now">
            {(() => {
              const [x0, y0] = pt(c, R * 0.5, nowH);
              const [x1, y1] = pt(c, R + 2, nowH);
              return (
                <>
                  <line x1={x0} y1={y0} x2={x1} y2={y1} />
                  <circle cx={x0} cy={y0} r={3} />
                </>
              );
            })()}
          </g>
        ) : null}
      </svg>
      <div className="lv-dial__centre" aria-hidden="true">
        <span className="lv-dial__primary">{centre.primary}</span>
        {centre.secondary ? <span className="lv-dial__secondary">{centre.secondary}</span> : null}
      </div>
      <figcaption className="lm-sr">{energyInText(dialSummary(rx, quiet), eu)}</figcaption>
    </figure>
  );
}

/** Centre readout text for a date (fast state / window). */
export function dialCentre(rx: PrescribedDaySnapshot, nowH: number | null, fast?: { state: string; sinceH?: number; remainingH?: number }): { primary: string; secondary?: string } {
  if (fast?.state === 'running' && fast.sinceH !== undefined) return { primary: `fast · ${fmtHours(fast.sinceH)}`, ...(fast.remainingH !== undefined ? { secondary: `${fmtHours(fast.remainingH)} to go` } : {}) };
  if (fast?.state === 'broken') return { primary: 'fast broken', ...(fast.sinceH !== undefined ? { secondary: `${Math.round(fast.sinceH)} h counted` } : {}) };
  const w = rx.window;
  if (!w) return { primary: rx.meals.length ? `${rx.meals.length} meals` : 'no meals' };
  if (nowH === null) return { primary: `eat ${fmtClock(w.startH)}–${fmtClock(w.endH)}` };
  if (nowH < w.startH) return { primary: `fast · ${fmtHours(nowH + 24 - w.endH)}`, secondary: `window opens ${fmtClock(w.startH)}` };
  if (nowH < w.endH) return { primary: `eat until ${fmtClock(w.endH)}`, secondary: `${fmtHours(w.endH - nowH)} left` };
  return { primary: 'window closed', secondary: `opens ${fmtClock(w.startH)} tomorrow` };
}
