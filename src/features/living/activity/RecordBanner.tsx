/**
 * A recording in progress (A.3.5 item 3) in the app's one banner slot, mounted once by the app shell so Pause, Resume
 * and Stop stay on every screen (0.6.3 A31), ahead of any other banner (One Header Rule: not a
 * docked bar): "Recording walk · 12:41" from `startedAt`, Pause or Resume, Stop. No live heart rate. The state comes from
 * Gauge (`commands/state`, whichever way the recording was started) and from this device's own acknowledged commands.
 * After Stop the session uploads and comes back through the import as an activity to review; a late stop is trimmed in
 * the activity sheet.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { Key, toast } from '@/components';
import { GlobalNotice } from '@/app/shell';
import { useGaugeCommand, useGaugeLink, type GaugeCommandsController } from '@/state/gaugeCommands';
import type { GaugeRecordingState, WorkoutType } from '@/net/gaugeCommands';
import { codeWords, failureWords, pendingWords } from '@/features/ring/commands';
import { quietDuration } from '@/features/ring/quiet';
import type { GaugeCommandView } from '@/state/gaugeCommands';
import { useQuietMode } from '@/state/settingsStore';
import { canOpenGaugeGpsFix, openGaugeGpsFix } from '@/platform/gaugeLocal';
import { ACTIVITY_COPY as C } from '../copy';
import { useActivityData, useTicker } from './data';
import { elapsedText } from './model';
import { recordingWord } from './recordType';

/** What this device learned from its own acks (Gauge's state wins once it reports). */
interface LocalRecording extends GaugeRecordingState {
  pausedAt?: number;
  /** When this device learned it (ms): a Gauge report from a poll after this is authoritative. */
  learnedAt?: number;
  /** (0.6.3 S26) The catalogue activity this device started it as ("Recording air bike"). */
  activityTypeId?: string;
  /** (r063 FX3, S20) A start that asked for GPS: Gauge's outcome (`off` = recording without a route) and why. */
  gps?: 'on' | 'off';
  gpsWarning?: string;
}

/** (r063 FX3, S20) The GPS outcome of a start's ack (both transports carry Gauge's `gps` and `warning`). */
export function gpsOutcome(result: Record<string, unknown> | undefined): { gps?: 'on' | 'off'; gpsWarning?: string } {
  const gps = result?.gps === 'on' || result?.gps === 'off' ? result.gps : undefined;
  const warning = typeof result?.warning === 'string' && result.warning ? result.warning : undefined;
  return { ...(gps ? { gps } : {}), ...(gps === 'off' || warning ? { gps: gps ?? 'off', ...(warning ? { gpsWarning: warning } : {}) } : {}) };
}

/** (Claude P2-3) A workout command's failure in words: Ring's `failureWords` (the workout codes, `expired`, a lost watch). */
export function workoutFailureWords(v: GaugeCommandView): string {
  return failureWords(v) ?? codeWords(v.code);
}

/** Slack between this device's clock and the server's poll stamp. */
const POLL_SLACK_MS = 5_000;

/**
 * (UI audit #20) The recording to show: Gauge's report when it has one; with no recording in it, this device's copy only
 * while that report is not yet authoritative (Gauge has not polled since we learned of the recording). An idle report from
 * a later poll (the person stopped on the phone) clears it.
 */
export function recordingToShow(reported: GaugeRecordingState | null, lastPollAt: string | null, mine: LocalRecording | null): { rec: LocalRecording | null; staleLocal: boolean } {
  if (reported) {
    const same = mine !== null && mine.sessionId === reported.sessionId;
    return {
      rec: {
        ...reported,
        ...(same && reported.status === 'paused' && mine.pausedAt !== undefined ? { pausedAt: mine.pausedAt } : {}),
        ...(same && mine.activityTypeId ? { activityTypeId: mine.activityTypeId } : {}),
        // (r063 FX3) Gauge's state report has no GPS outcome: this device's ack keeps it for the same recording
        ...(same && mine.gps ? { gps: mine.gps, ...(mine.gpsWarning ? { gpsWarning: mine.gpsWarning } : {}) } : {}),
      },
      staleLocal: mine !== null && !same,
    };
  }
  if (!mine) return { rec: null, staleLocal: false };
  const polled = lastPollAt ? Date.parse(lastPollAt) : Number.NaN;
  const since = mine.learnedAt ?? Date.parse(mine.startedAt);
  const authoritative = Number.isFinite(polled) && Number.isFinite(since) && polled > since + POLL_SLACK_MS;
  return authoritative ? { rec: null, staleLocal: true } : { rec: mine, staleLocal: false };
}

let local: LocalRecording | null = null;
const listeners = new Set<() => void>();
const setLocal = (r: LocalRecording | null) => {
  local = r;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const getLocal = () => local;

/** Tests: forget the local recording. */
export function resetLocalRecording(): void {
  setLocal(null);
}

/** The recording now (Gauge's report, else this device's last acknowledged start), and the keys that drive it. */
export function useRecording() {
  const ctl: GaugeCommandsController = useActivityData().commands();
  const link = useGaugeLink(ctl);
  const mine = useSyncExternalStore(subscribe, getLocal, getLocal);
  const start = useGaugeCommand('workout.start', ctl);
  const pause = useGaugeCommand('workout.pause', ctl);
  const resume = useGaugeCommand('workout.resume', ctl);
  const stop = useGaugeCommand('workout.stop', ctl);
  // Gauge's own report wins when it has one; an idle report from a poll after we learned of the recording clears ours
  const shown = recordingToShow(link.recording, link.lastPollAt, mine);
  const rec = shown.rec;
  useEffect(() => {
    if (shown.staleLocal && getLocal() === mine) setLocal(null);
  }, [shown.staleLocal, mine]);
  // (0.6.3 S4/A23) Gauge on this phone without the grant also opens Record: the sheet offers to allow local control
  const available = link.paired || link.local === true || link.localControl === 'askable';
  const via = ctl.transportFor('workout.start');

  /** Start a recording as the coarse ring `type`, and (0.6.3 S26) the catalogue activity picked, when one was. */
  const begin = async (type: WorkoutType, useGps: boolean, activityTypeId?: string) => {
    const v = await start.send({ type, useGps, ...(activityTypeId ? { activityTypeId } : {}) });
    const r = v.result as { sessionId?: string; startedAt?: string; type?: string; gps?: unknown; warning?: unknown } | undefined;
    if (v.state === 'done' || (v.state === 'rejected' && v.code === 'already_recording' && r?.sessionId)) {
      // a recording already running was not started as this activity: only a new one carries the pick
      const picked = v.state === 'done' && activityTypeId ? { activityTypeId } : {};
      // (r063 FX3, S20) Gauge's deliberate fallback: asked for GPS, started without it (server and local acks alike)
      const outcome = v.state === 'done' && useGps ? gpsOutcome(r as Record<string, unknown> | undefined) : {};
      setLocal({ sessionId: r?.sessionId ?? v.id, status: 'recording', type: r?.type ?? type, startedAt: r?.startedAt ?? new Date().toISOString(), learnedAt: Date.now(), ...picked, ...outcome });
      return { ok: true as const, ...outcome };
    }
    return { ok: false as const, message: workoutFailureWords(v) };
  };
  const toggle = async () => {
    if (!rec) return;
    const v = rec.status === 'paused' ? await resume.send({ sessionId: rec.sessionId }) : await pause.send({ sessionId: rec.sessionId });
    if (v.state === 'done' || v.state === 'noop') setLocal({ ...rec, status: rec.status === 'paused' ? 'recording' : 'paused', learnedAt: Date.now(), ...(rec.status === 'paused' ? {} : { pausedAt: Date.now() }) });
    else toast(workoutFailureWords(v));
  };
  const end = async () => {
    if (!rec) return;
    const v = await stop.send({ sessionId: rec.sessionId });
    if (v.state === 'done' || v.state === 'noop') {
      setLocal(null);
      toast(C.stopped);
    } else toast(workoutFailureWords(v));
  };
  // (Claude P2-4) while Pause, Resume or Stop waits on Gauge, say why ("Waiting for Gauge", "Gauge hasn't checked in · expires 07:40")
  const waiting = [stop, pause, resume].find((c) => c.pending && c.last);
  const waitingWords = waiting?.last ? pendingWords(waiting.last, C.waiting) : null;
  /** (0.6.3 S4/A23) The person's "Allow Vitals to control Gauge on this phone": the system prompt, then a re-probe. */
  const allowLocal = () => ctl.requestLocalControl();
  return {
    rec, available, via, online: link.online, paired: link.paired, localControl: link.localControl, allowLocal,
    begin, toggle, end, starting: start.pending, busy: pause.pending || resume.pending || stop.pending, waitingWords,
  };
}

function Elapsed({ rec }: { rec: LocalRecording }) {
  const paused = rec.status === 'paused';
  // (r063 FX3 sR10/aR10) quiet: the time so far in words ("about half an hour"), no running clock
  const quiet = useQuietMode().on;
  const now = useTicker(quiet ? 60_000 : 1000, !paused);
  const at = paused && rec.pausedAt ? rec.pausedAt : now;
  const t = quiet ? quietDuration((at - Date.parse(rec.startedAt)) / 60_000) : elapsedText(rec.startedAt, at);
  const type = recordingWord(rec.type, rec.activityTypeId);
  return <span className={quiet ? undefined : 'lm-num'}>{paused ? C.paused(type, t) : C.recording(type, t)}</span>;
}

/**
 * (r063 FX3, S20) The action behind "Recording without GPS", for the next recording: Gauge's location prompt (or the
 * phone's location switch) when this is the Android app, else what to do on the phone.
 */
export function gpsFix(warning: string | undefined) {
  return {
    here: canOpenGaugeGpsFix(),
    label: warning === 'gps_location_off' ? C.gpsTurnOn : C.gpsAllow,
    open: () =>
      void openGaugeGpsFix(warning).then((opened) => {
        if (!opened) toast(C.gpsNotOpened);
      }),
    elsewhere: C.gpsElsewhere(warning),
  };
}

function NoGps({ warning }: { warning: string | undefined }) {
  const fix = gpsFix(warning);
  return (
    <span className="lv-rec__gps">
      <strong>{C.noGps}.</strong> {C.noGpsWhy(warning)} {fix.here ? null : fix.elsewhere}
    </span>
  );
}

/** The banner while a recording exists (nothing otherwise). */
export function RecordBanner() {
  const r = useRecording();
  const rec = r.rec;
  if (!rec) return null;
  const noGps = rec.gps === 'off';
  const keys = (
    <span className="lv-rec__keys">
      {noGps ? <GpsFixKey warning={rec.gpsWarning} /> : null}
      {r.busy ? (
        <span className="lv-rec__wait" role="status">
          {r.waitingWords ?? C.waiting}
        </span>
      ) : null}
      <Key size="sm" variant="text" disabled={r.busy} onClick={() => void r.toggle()}>
        {rec.status === 'paused' ? C.resume : C.pause}
      </Key>
      <Key size="sm" variant="action" disabled={r.busy} onClick={() => void r.end()}>
        {C.stop}
      </Key>
    </span>
  );
  // info severity with the lowest rank: it outranks every other banner while it lasts
  return <GlobalNotice id="recording" severity="info" priority={-2000} title={<Elapsed rec={rec} />} {...(noGps ? { body: <NoGps warning={rec.gpsWarning} /> } : {})} actions={keys} />;
}

function GpsFixKey({ warning }: { warning: string | undefined }) {
  const fix = gpsFix(warning);
  if (!fix.here) return null;
  return (
    <Key size="sm" variant="text" onClick={fix.open}>
      {fix.label}
    </Key>
  );
}
