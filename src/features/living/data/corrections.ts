/** Writes for the correction sheet and the "Use the device value again" action (both go through the command bus). */
import { dispatch, type CommandResult } from '@/commands';
import type { LocalDate } from '@/living';
import type { ActionOutcome } from './actions';
import type { OwnedKind } from './useDeviceOwnership';

export type CorrectionValueInput =
  | { kind: 'sleep'; asleepS: number; bedAt?: string; wakeAt?: string }
  | { kind: 'steps'; steps: number }
  | { kind: 'weight'; kg: number };

function outcome(r: CommandResult): ActionOutcome {
  if (!r.ok) return { ok: false, message: r.error.message };
  const cs = 'changeSet' in r ? r.changeSet?.id : undefined;
  return cs
    ? { ok: true, undo: async () => outcome(await dispatch('history.undo', { changeSetId: cs })) }
    : { ok: true };
}

export async function submitCorrection(
  date: LocalDate,
  v: CorrectionValueInput,
  note?: string,
): Promise<ActionOutcome> {
  const target =
    v.kind === 'sleep'
      ? { kind: 'sleep' as const, localDate: date }
      : v.kind === 'steps'
        ? { kind: 'daily' as const, localDate: date, metric: 'steps' as const }
        : { kind: 'spot' as const, localDate: date, metric: 'weight_kg' as const };
  const value =
    v.kind === 'sleep'
      ? {
          asleepS: v.asleepS,
          ...(v.bedAt ? { bedAt: v.bedAt } : {}),
          ...(v.wakeAt ? { wakeAt: v.wakeAt } : {}),
        }
      : v.kind === 'steps'
        ? { fields: { steps: v.steps } }
        : { value: v.kg };
  const n = note?.trim();
  return outcome(await dispatch('biometrics.correct', { target, value, ...(n ? { note: n } : {}) } as never));
}

export async function clearCorrection(key: string): Promise<ActionOutcome> {
  return outcome(await dispatch('biometrics.clearCorrection', { key } as never));
}

export type { OwnedKind };
