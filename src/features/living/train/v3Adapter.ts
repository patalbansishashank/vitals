/**
 * `activity.logManual` (energy SPEC §V3.2) for the Train screens, plus a context so tests and the screenshot harness can
 * stand in for the command. V3's command takes exactly `ActivityLogManualInput`.
 */
import { createContext, useContext } from 'react';
import { dispatch, type CommandResult } from '@/commands';
import { timeZone } from '@/commands/bus';
import { manualCheck, manualCheckNow, type ManualCheck, type ManualResolution } from '@/commands/living/activity';
import type { LocalDate } from '@/living';
import type { ActivityIntensity, CandidateRecord, PersonForEstimate } from '@/living/activityCandidates';
import type { ActionOutcome } from '../data/actions';

export type { ActivityIntensity, ManualCheck, ManualResolution };


/** §V3.2: `activity.logManual {exerciseId, date, startH?, durationMin, intensity{…}, kcalOverride?, resolution?}`. */
export interface ActivityLogManualInput {
  exerciseId: string;
  date: LocalDate;
  startH?: number;
  durationMin: number;
  intensity: ActivityIntensity;
  kcalOverride?: number;
  /** (0.6.3 A5) What the person chose for an overlap with a recording (replace, link, separate). */
  resolution?: ManualResolution;
}

/**
 * (0.6.3 S12/A26, A5) What a manual log would book and what it overlaps, before anything is saved: the same placement,
 * dated person facts and estimator request as `activity.logManual` (`manualCheck`).
 */
export type CheckManualActivity = (input: ActivityLogManualInput) => ManualCheck;

const tzNow = (): string => {
  try {
    return timeZone();
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
};

/** The app's check: the person's stored weigh-ins, entered basics and recorded activities now. */
export const checkManualActivity: CheckManualActivity = (input) => manualCheckNow(input, tzNow());

/** A check over fixed person facts and recordings (tests, the screenshot harness): the same estimator request. */
export function fixedManualCheck(person: PersonForEstimate | null, records: readonly CandidateRecord[] = []): CheckManualActivity {
  return (input) => manualCheck(input, { ent: { measurements: [] }, records, tz: tzNow(), person });
}

const CheckCtx = createContext<CheckManualActivity>(checkManualActivity);
/** Tests and the screenshot harness stand in for the check here. */
export const ManualCheckProvider = CheckCtx.Provider;
export const useCheckManualActivity = (): CheckManualActivity => useContext(CheckCtx);


/**
 * Writes one activity (or resolves an overlap); undo reverts the command's whole ChangeSet (0.6.3 S30): the approved
 * candidate, its session entry, its alias and a recording it replaced or linked into, together. Never only the entry.
 */
export type LogManualActivity = (input: ActivityLogManualInput) => Promise<ActionOutcome & { overlap?: boolean; saved?: ManualSaved }>;

/** (r063 FX3 aR16) What `activity.logManual` saved (a link: the recording's own window and minutes). */
export interface ManualSaved {
  exerciseId: string;
  durationMin: number;
  startAt: string | null;
  endAt: string | null;
}

function outcome(r: CommandResult): ActionOutcome & { overlap?: boolean; saved?: ManualSaved } {
  if (!r.ok) return { ok: false, message: r.error.message, ...(r.error.detail?.reason === 'overlap' ? { overlap: true } : {}) };
  const cs = 'output' in r ? r.changeSet?.id : undefined;
  const saved = 'output' in r ? (r.output as { saved?: ManualSaved } | undefined)?.saved : undefined;
  return { ok: true, ...(cs ? { undo: async () => outcome(await dispatch('history.undo', { changeSetId: cs })) } : {}), ...(saved ? { saved } : {}) };
}

/** `activity.logManual` over the bus. */
export const logManualActivity: LogManualActivity = async (input) => outcome(await dispatch('activity.logManual', input));

const Ctx = createContext<LogManualActivity>(logManualActivity);
/** Tests and the screenshot harness stand in for the command here. */
export const ManualLogProvider = Ctx.Provider;
export const useLogManualActivity = (): LogManualActivity => useContext(Ctx);
