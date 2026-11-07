import { useMemo, useState } from 'react';
import { DottedTrack, Key, MonoMeta, Notice, ResponsivePanel, formatEnergy, toast } from '@/components';
import { GlobalNotice } from '@/app/shell';
import { useEnergyUnit } from '@/state/settingsStore';
import { sourceLabel } from './Estimate';
import { TODAY_COPY } from '../copy';
import { useLivingActions, type ActionOutcome } from '../data/actions';
import type { HistoryConflict } from '../data/types';
import { fmtClock, fmtDay } from '../format';

const CC = TODAY_COPY.conflict;

const SUBJECT: Record<HistoryConflict['kind'], string> = {
  meal: 'meal',
  workout: 'workout',
  measurement: 'measurement',
  entry: 'entry',
};

export function LogConflict({ conflict, quiet = false }: { conflict: HistoryConflict; quiet?: boolean }) {
  const eu = useEnergyUnit();
  const actions = useLivingActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subject = SUBJECT[conflict.kind];
  const energy = (n: number) => formatEnergy(n, eu);
  const scale = Math.max(1, ...conflict.versions.map((v) => v.energyKcal ?? 0));
  const choice = (v: HistoryConflict['versions'][number]) =>
    `Keep: ${v.label}${!quiet && v.energyKcal !== undefined ? ` (${energy(v.energyKcal)})` : ''}`;

  const undoChoice = (undone: Array<() => Promise<ActionOutcome>>, message: string) => {
    toast(message, {
      action: {
        label: 'Undo',
        onClick: () =>
          void (async () => {
            for (const undo of [...undone].reverse()) {
              try {
                const result = await undo();
                if (!result.ok) {
                  toast(result.message ?? 'Could not undo that change. Try again.');
                  return;
                }
              } catch {
                toast('Could not undo that change. Try again.');
                return;
              }
            }
          })(),
      },
    });
  };

  const keep = async (id: string) => {
    if (pending) return;
    setPending(true);
    setError(null);
    const undone: Array<() => Promise<ActionOutcome>> = [];
    try {
      for (const version of conflict.versions) {
        if (version.id === id) continue;
        const result = await actions.retract(version.id, id);
        if (!result.ok) {
          setError(
            `${result.message ?? 'That version could not be removed.'}${undone.length ? ' Earlier changes can be undone.' : ' Try again.'}`,
          );
          if (undone.length) undoChoice(undone, 'Some versions changed.');
          return;
        }
        if (result.undo) undone.push(result.undo);
      }
      if (undone.length) undoChoice(undone, `Kept your chosen ${subject}.`);
      else toast(`Kept your chosen ${subject}.`);
    } catch {
      setError('That choice could not be saved. Try again.');
      if (undone.length) undoChoice(undone, 'Some versions changed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Notice
      severity="caution"
      layout="ruled"
      announce
      className="lv-log-conflict"
      title={`This ${subject} was changed on ${conflict.versions.length === 2 ? 'two' : 'several'} devices. Keep which one?`}
      actions={conflict.versions.map((version) => (
        <Key
          key={version.id}
          size="sm"
          variant="outlined"
          disabled={pending}
          onClick={() => void keep(version.id)}
        >
          {choice(version)}
        </Key>
      ))}
    >
      <p className="lv-log-conflict__count">
        {conflict.versions.length} versions · one counted in totals until you choose
      </p>
      <ol className="lv-log-conflict__versions">
        {conflict.versions.map((version, index) => (
          <li key={version.id}>
            <strong>Version {index + 1}</strong>
            <span>{version.label}</span>
            {!quiet && version.energyKcal !== undefined ? (
              <MonoMeta>{energy(version.energyKcal)}</MonoMeta>
            ) : null}
            <MonoMeta className="lv-log-conflict__saved">
              {[version.at ? savedAt(version.at) : null, version.source ? sourceLabel(version.source) : null]
                .filter(Boolean)
                .join(' · ')}
            </MonoMeta>
            {!quiet && conflict.kind === 'meal' && version.energyKcal !== undefined ? (
              <DottedTrack
                className="lv-log-conflict__track"
                label={version.label}
                value={version.energyKcal}
                to={scale}
                valueText={energy(version.energyKcal)}
                hue="food"
              />
            ) : null}
          </li>
        ))}
      </ol>
      {error ? (
        <p className="lv-log-conflict__error" role="alert">
          {error}
        </p>
      ) : null}
    </Notice>
  );
}

/** Stored timestamps are instants; the app's day and clock words use this device's local time. */
function savedAt(at: string): string {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return '';
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `Saved ${fmtDay(day)} · ${fmtClock(d.getHours() + d.getMinutes() / 60)}`;
}

/** Entries changed on two devices, each with its versions to keep (opened from the banner's Review). */
export function ConflictSheet({
  open,
  onClose,
  conflicts,
  quiet,
}: {
  open: boolean;
  onClose: () => void;
  conflicts: readonly HistoryConflict[];
  quiet: boolean;
}) {
  return (
    <ResponsivePanel open={open} onClose={onClose} title={CC.sheetTitle}>
      <div className="lv-sheet">
        {conflicts.map((conflict) => (
          <LogConflict key={conflict.parentId} conflict={conflict} quiet={quiet} />
        ))}
      </div>
    </ResponsivePanel>
  );
}

/**
 * A day's entries changed on two devices (SPEC §4: an app-level state, never a notice between the page's sections): the
 * one banner under the header ("An entry was changed on two devices" · Review) and the sheet that resolves them.
 * Renders nothing in the page flow.
 */
export function ConflictNotice({
  id,
  conflicts,
  quiet,
}: {
  id: string;
  conflicts: readonly HistoryConflict[];
  quiet: boolean;
}) {
  const [open, setOpen] = useState(false);
  const review = useMemo(
    () => (
      <Key size="sm" variant="text" onClick={() => setOpen(true)}>
        {CC.review}
      </Key>
    ),
    [],
  );
  if (!conflicts.length) return null;
  return (
    <>
      <GlobalNotice id={id} severity="caution" title={CC.title(conflicts.length)} actions={review} />
      <ConflictSheet open={open} onClose={() => setOpen(false)} conflicts={conflicts} quiet={quiet} />
    </>
  );
}
