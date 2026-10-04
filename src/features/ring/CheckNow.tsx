/**
 * Check now (design/screens/ring-pages.md §5.3): one key per spot measurement the ring's driver supports (heart rate,
 * blood oxygen, heart-rate variability, skin temperature), then Start. Phases: ready (with the last check of the chosen
 * measurement today), measuring (Stop, a determinate 2 px rule over the driver's ceiling, seconds left, live heart
 * rate), result (saved by the service as a spot sample; tier C measurements add the change from the person's normal),
 * no steady reading, ring not on a finger, stopped (nothing saved; back to ready after 4 s). One check at a time; the
 * measurement cannot change while one runs; a polite live region announces the phase and the result. The page mounts
 * this only while a ring is connected or reading.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Engraved, Faceplate, InlineWarning, Key, KeyBank, MQ, ProgressRule, useMediaQuery } from '@/components';
import { formatNumber, formatSigned, THIN_SPACE } from '@/components/lib/format';
import type { SpotMetric } from '@/biometrics/core/types';
import { useToday } from '@/features/living/clock';
import { clockAt } from '@/features/signals/charts/ringData';
import { useBaselines, useDays, useSignalsPerson } from '@/features/signals/data';
import { useRingService, type CheckMetric, type CheckResult, type RingStatus } from './data';
import { RING_SECTIONS_COPY } from './copySections';
import { clockOf } from './todayModel';
import './ring-sections.css';

const C = RING_SECTIONS_COPY.check;

type FailReason = 'no_reading' | 'off_finger';
type Phase =
  | { kind: 'ready' }
  | { kind: 'measuring'; metric: CheckMetric; startedAt: number }
  | { kind: 'result'; metric: CheckMetric; result: CheckResult }
  | { kind: 'failed'; metric: CheckMetric; reason: FailReason }
  | { kind: 'stopped' };

const DEFAULT_CHECKS: readonly CheckMetric[] = ['hr'];
/** Where a saved check lands among the day's spot values. Skin temperature has no spot metric of its own yet. */
const SPOT_OF: Record<CheckMetric, SpotMetric | null> = { hr: 'hr_bpm', spo2: 'spo2_pct', hrv: 'hrv_ms', skin_temp: null };
const UNIT_OF: Record<CheckMetric, string> = { hr: 'bpm', spo2: '%', hrv: 'ms', skin_temp: '°C' };
const DECIMALS: Record<CheckMetric, number> = { hr: 0, spo2: 0, hrv: 0, skin_temp: 1 };
/** Tier C checks compare with the person's normal of the same quantity (`bio.baselines` metric ids, same unit). */
const NORMAL_OF: Partial<Record<CheckMetric, string>> = { hrv: 'hrv_rmssd_ms', spo2: 'spo2_avg_pct', skin_temp: 'skin_temp_c' };
const STOPPED_MS = 4000;

function failReason(e: unknown): FailReason {
  const code = e && typeof e === 'object' && 'code' in e ? (e as { code?: unknown }).code : null;
  return code === 'off_finger' ? 'off_finger' : 'no_reading';
}

/** Value and unit as shown (°C → °F when the person reads Fahrenheit). */
function shown(metric: CheckMetric, value: number, unit: string, fahrenheit: boolean): { value: number; unit: string; scale: number } {
  if (metric === 'skin_temp' && fahrenheit && unit === '°C') return { value: (value * 9) / 5 + 32, unit: '°F', scale: 9 / 5 };
  return { value, unit, scale: 1 };
}

function Value({ text, unit }: { text: string; unit: string }) {
  return (
    <p className="rs-readout">
      <span className="lm-num">{text}</span>
      {THIN_SPACE}
      <span className="lm-unit">{unit}</span>
    </p>
  );
}

export function CheckNow({ ring }: { ring: RingStatus }) {
  const service = useRingService();
  const today = useToday();
  const days = useDays(today, today);
  const baselines = useBaselines();
  const person = useSignalsPerson();
  const fahrenheit = person.tempUnit === 'F';
  const checks = ring.caps?.checks?.length ? ring.caps.checks : DEFAULT_CHECKS;
  const [picked, setPicked] = useState<CheckMetric>(checks[0]!);
  const metric = checks.includes(picked) ? picked : checks[0]!;
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' });
  const [live, setLive] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const run = useRef(0);
  const total = Math.max(1, ring.caps?.checkSeconds ?? 30);
  const wide = useMediaQuery(MQ.md);
  const ringKey = ring.ringKey;

  const start = (m: CheckMetric) => {
    const id = ++run.current;
    const startedAt = Date.now();
    setLive(null);
    setTick(startedAt);
    setPhase({ kind: 'measuring', metric: m, startedAt });
    service.checkNow(ringKey, m).then(
      (result) => {
        if (run.current === id) setPhase({ kind: 'result', metric: m, result });
      },
      (e: unknown) => {
        if (run.current === id) setPhase({ kind: 'failed', metric: m, reason: failReason(e) });
      },
    );
  };

  const stop = () => {
    run.current++; // a late result is ignored: nothing is shown, the service saves nothing on stop
    void service.stopCheck?.(ringKey)?.catch(() => undefined);
    setPhase({ kind: 'stopped' });
  };

  // measuring: the seconds count down and heart rate shows its live value
  useEffect(() => {
    if (phase.kind !== 'measuring') return;
    const t = window.setInterval(() => setTick(Date.now()), 1000);
    const off = phase.metric === 'hr' && service.checkProgress ? service.checkProgress(ringKey, (v) => setLive(v)) : undefined;
    return () => {
      window.clearInterval(t);
      off?.();
    };
  }, [phase, service, ringKey]);

  // stopped: back to ready after 4 s
  useEffect(() => {
    if (phase.kind !== 'stopped') return;
    const t = window.setTimeout(() => setPhase({ kind: 'ready' }), STOPPED_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  // ready: the last check of the chosen measurement today
  const lastLine = useMemo(() => {
    const spot = SPOT_OF[metric];
    const day = days.find((d) => d.localDate === today);
    if (!spot || !day) return null;
    const newest = day.spots
      .filter((s) => s.metric === spot && s.time.at && Number.isFinite(Date.parse(s.time.at)))
      .reduce<(typeof day.spots)[number] | null>((best, s) => (!best || Date.parse(s.time.at!) > Date.parse(best.time.at!) ? s : best), null);
    if (!newest) return null;
    const v = shown(metric, newest.value, UNIT_OF[metric], fahrenheit);
    return C.last(`${formatNumber(v.value, DECIMALS[metric])}${THIN_SPACE}${v.unit}`, clockAt(Date.parse(newest.time.at!), newest.time.tz_offset_s));
  }, [days, today, metric, fahrenheit]);

  const measuring = phase.kind === 'measuring';
  // The real service has no check-progress stream: its live heart rate (watched by the today rows while the page is
  // visible) fills in once a value newer than the start arrives.
  const streamed = measuring && ring.liveHr && Date.parse(ring.liveHr.at) >= phase.startedAt ? ring.liveHr.bpm : null;
  const liveNow = live ?? streamed;
  const elapsedS = measuring ? Math.max(0, (tick - phase.startedAt) / 1000) : 0;
  const left = Math.max(0, Math.ceil(total - elapsedS));

  let result: { text: string; unit: string; saved: string; change: string | null } | null = null;
  if (phase.kind === 'result') {
    const r = phase.result;
    const v = shown(phase.metric, r.value, r.unit, fahrenheit);
    const d = DECIMALS[phase.metric];
    const normalId = NORMAL_OF[phase.metric];
    const normal = normalId ? baselines?.find((b) => b.metric === normalId && !b.forming && b.unit === r.unit) : undefined;
    result = {
      text: formatNumber(v.value, d),
      unit: v.unit,
      saved: C.saved(clockOf(Date.parse(r.at))),
      change: normal ? C.change(`${formatSigned((r.value - normal.mean) * v.scale, d)}${THIN_SPACE}${v.unit}`) : null,
    };
  }

  const name = (m: CheckMetric) => C.metric[m];
  const announce =
    phase.kind === 'measuring'
      ? C.say.measuring(name(phase.metric))
      : phase.kind === 'result' && result
        ? C.say.result(name(phase.metric), `${result.text}${THIN_SPACE}${result.unit}`)
        : phase.kind === 'failed'
          ? phase.reason === 'off_finger'
            ? C.offFinger
            : C.noReading
          : phase.kind === 'stopped'
            ? C.stopped
            : '';

  return (
    <Faceplate title={C.title} className="rs-check">
      <p className="rs-help">{C.help}</p>
      <div className="rs-check__controls">
        <KeyBank<CheckMetric>
          className="rs-check__bank"
          label={C.bankLabel}
          size="lg"
          orientation={wide ? 'horizontal' : 'vertical'}
          options={checks.map((m) => ({ value: m, label: name(m), disabled: measuring }))}
          value={metric}
          onChange={setPicked}
        />
        {measuring ? (
          // Stop only where the service can really abort a check: otherwise "Nothing was saved" would not be true
          service.stopCheck ? <Key onClick={stop}>{C.stop}</Key> : null
        ) : (
          <Key onClick={() => start(metric)}>{C.start}</Key>
        )}
      </div>
      <div className="rs-check__status" data-phase={phase.kind}>
        {phase.kind === 'ready' && lastLine ? <p className="rs-line">{lastLine}</p> : null}
        {phase.kind === 'measuring' ? (
          <>
            <ProgressRule value={Math.min(1, elapsedS / total)} label={C.progress} />
            <p className="rs-line">{left > 0 ? C.measuring(left) : C.finishing}</p>
            {phase.metric === 'hr' ? <Value text={liveNow === null ? C.noLive : formatNumber(liveNow, 0)} unit={UNIT_OF.hr} /> : null}
          </>
        ) : null}
        {result ? (
          <>
            <Value text={result.text} unit={result.unit} />
            <Engraved as="p">{result.saved}</Engraved>
            {result.change ? <p className="rs-line">{result.change}</p> : null}
          </>
        ) : null}
        {phase.kind === 'failed' ? (
          <>
            <InlineWarning severity="caution">{phase.reason === 'off_finger' ? C.offFinger : C.noReading}</InlineWarning>
            <Key size="sm" className="rs-check__retry" onClick={() => start(phase.metric)}>
              {C.tryAgain}
            </Key>
          </>
        ) : null}
        {phase.kind === 'stopped' ? <p className="rs-line">{C.stopped}</p> : null}
        <p className="lm-sr" aria-live="polite">
          {announce}
        </p>
      </div>
    </Faceplate>
  );
}
