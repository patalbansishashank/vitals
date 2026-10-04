/**
 * "Open in Simulator" (plan-ladder.md §7): copies a rung's engine `Schedule` into a new scenario through the
 * `planner.openInSimulator` command (a copy, not a link: the plan stays a stable reference), makes it active and returns
 * its id. The scenario is named after the rung ("Hard plan · Deficit 22 % · 4 sessions"); the Ideal is never copied.
 * Undo deletes that scenario and restores the previously active one.
 */
import { dispatchSync, outputOf } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import { useScheduleStore } from '@/state/scheduleStore';
import { fmtDate, todayISO } from './format';
import { RUNG_TITLE, V1_ID, planLabel, type RungId } from './ladder';

export interface OpenedScenario {
  sid: string;
  undo: () => void;
}

export function openRungAsScenario(kind: RungId, subtitle: string, today: string = todayISO()): OpenedScenario {
  const previous = useScheduleStore.getState().activeId;
  const r = dispatchSync('planner.openInSimulator', {
    kind: V1_ID[kind],
    name: planLabel(kind, subtitle),
    provenance: `from the ${RUNG_TITLE[kind]} plan · ${fmtDate(today)}`,
  });
  const sid = outputOf(r)?.scenarioId ?? '';
  const changeSetId = r.ok && 'changeSet' in r ? r.changeSet?.id : undefined;
  return {
    sid,
    // undo deletes the copy and makes the previously active scenario active again
    undo: () => {
      if (changeSetId) void sendCommand('history.undo', { changeSetId });
      else if (previous) void sendCommand('scenario.setActive', { id: previous });
    },
  };
}
