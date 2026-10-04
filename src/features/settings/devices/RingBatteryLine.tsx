/**
 * One line for a ring's source row on the Devices card (R16 §3 G3, §6 gap 2): "Battery 64 % at 12:35 · last data
 * received 12:41". E28 places it in the card (src/features/settings/devices/DevicesSection.tsx) and passes the source's
 * device state (`battery` with the time it was read, and the newest `received_at` the ingest saw). Each part is left out
 * when unknown; a reading older than a day says its date so a stale battery is never shown as current.
 */
export interface RingBatteryLineProps {
  /** 0–100, as the ring reported it. */
  battery?: { percent: number; at: string } | null;
  /** When Vitals last received data from this source (ISO instant). */
  lastDataAt?: string | null;
  /** Reference time (ISO); defaults to now. Tests pass a fixed value. */
  now?: string;
  className?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12:35" today, "yesterday 12:35" or "28 Sep 12:35"; local time of the browser. */
export function whenText(iso: string, nowIso?: string): string | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const now = nowIso ? new Date(nowIso) : new Date();
  const clock = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (day(t) === day(now)) return clock;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day(t) === day(y)) return `yesterday ${clock}`;
  return `${t.getDate()} ${MONTHS[t.getMonth()]} ${clock}`;
}

export function ringBatteryText({ battery, lastDataAt, now }: RingBatteryLineProps): string | null {
  const parts: string[] = [];
  if (battery && Number.isFinite(battery.percent)) {
    const when = whenText(battery.at, now);
    parts.push(`Battery ${Math.round(Math.max(0, Math.min(100, battery.percent)))} %${when ? ` at ${when}` : ''}`);
  }
  const last = lastDataAt ? whenText(lastDataAt, now) : null;
  if (last) parts.push(`last data received ${last}`);
  return parts.length ? parts.join(' · ') : null;
}

export function RingBatteryLine(props: RingBatteryLineProps) {
  const text = ringBatteryText(props);
  if (!text) return null;
  return <p className={['lm-devices__battery', props.className].filter(Boolean).join(' ')}>{text}</p>;
}
