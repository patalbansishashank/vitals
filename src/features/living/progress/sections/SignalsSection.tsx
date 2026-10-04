/**
 * Progress › Body signals (living-mode.md §8.2 item 5; scores.md §3.1): the score tiles for a scope
 * (last night · 7 days · 28 days) inside one faceplate, and a quiet "more:" list to the person's other scores.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { KeyBank, toast } from '@/components';
import { SignalsStrip } from '../../components/ScoreTile';
import { ScoresChip } from '../../scores/ScoresChip';
import { useLivingActions } from '../../data/actions';
import { useMoreScores, useScores, type ScoreScope } from '../../data/scores';
import { livingPaths } from '../../paths';
import { PROGRESS_COPY as C } from '../copy';

type Scope = Exclude<ScoreScope, 'today'>;

export function SignalsSection({ quiet = false }: { quiet?: boolean }) {
  const [scope, setScope] = useState<Scope>('lastNight');
  const tiles = useScores(scope);
  const more = useMoreScores();
  const actions = useLivingActions();

  const undo = async (changeId: string) => {
    const r = await actions.undoChange(changeId);
    toast(r.ok ? C.undone : (r.message ?? C.failed));
  };

  return (
    <SignalsStrip
      id="signals"
      className="lv-prog-face"
      title={C.faces.signals}
      tiles={tiles}
      quiet={quiet}
      onUndo={(id) => void undo(id)}
      actions={
        <>
          <ScoresChip />
          <KeyBank<Scope>
            size="sm"
            label={C.scopeLabel}
            value={scope}
            onChange={setScope}
            options={(Object.keys(C.scopes) as Scope[]).map((s) => ({ value: s, label: C.scopes[s] }))}
          />
        </>
      }
      footer={
        more.length ? (
          <p className="lv-prog-more">
            <span className="lm-eng">{C.more}</span>{' '}
            {more.map((m, i) => (
              <span key={m.scoreId}>
                {i > 0 ? ' · ' : null}
                {m.broughtIn ? (
                  <Link to={livingPaths.progress(m.scoreId)}>{m.title}</Link>
                ) : (
                  <>
                    {m.title} <Link to="/settings/devices">({C.notBroughtIn})</Link>
                  </>
                )}
              </span>
            ))}
          </p>
        ) : undefined
      }
    />
  );
}
