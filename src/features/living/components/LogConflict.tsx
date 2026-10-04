import { useState } from 'react';
import { Key, Notice, toast } from '@/components';
import { sourceLabel } from './Estimate';
import { useLivingActions, type ActionOutcome } from '../data/actions';
import type { HistoryConflict } from '../data/types';

const SUBJECT: Record<HistoryConflict['kind'], string> = {
  meal: 'meal',
  workout: 'workout',
  measurement: 'measurement',
  entry: 'entry',
};

export function LogConflict({ conflict, quiet = false }: { conflict: HistoryConflict; quiet?: boolean }) {
  const actions = useLivingActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subject = SUBJECT[conflict.kind];

  const undoChoice = (undone: Array<() => Promise<ActionOutcome>>, message: string) => {
    toast(message, { action: { label: 'Undo', onClick: () => void (async () => {
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
    })() } });
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
          setError(`${result.message ?? 'That version could not be removed.'}${undone.length ? ' Earlier changes can be undone.' : ' Try again.'}`);
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
      actions={conflict.versions.map((version, index) => (
        <Key key={version.id} size="sm" disabled={pending} onClick={() => void keep(version.id)} aria-label={`Keep version ${index + 1}: ${version.label}`}>
          Keep version {index + 1}
        </Key>
      ))}
    >
      <p className="lv-log-conflict__count">{conflict.versions.length} versions · one counted in totals until you choose</p>
      <ol className="lv-log-conflict__versions">
        {conflict.versions.map((version, index) => (
          <li key={version.id}>
            <strong>Version {index + 1}</strong>
            <span>{version.label}</span>
            {!quiet && version.energyKcal !== undefined ? <span>{Math.round(version.energyKcal)} kcal</span> : null}
            {version.at ? <small>saved {new Date(version.at).toLocaleString()}</small> : null}
            {version.source ? <small>{sourceLabel(version.source)}</small> : null}
          </li>
        ))}
      </ol>
      {error ? <p className="lv-log-conflict__error" role="alert">{error}</p> : null}
    </Notice>
  );
}
