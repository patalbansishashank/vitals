/**
 * Stream matrix (COMPONENTS §13.15): rows = the streams the chosen devices offer, columns = the four `StreamPolicy`
 * fields (bring in · my scores · my plan · Coach sees). Switches carry full names ("Use HRV in my plan"); the Coach is a
 * 3-key bank. "—" = not applicable, "never" = not allowed, with the reason on demand. Columns 2–4 are disabled while
 * "bring in" is off. Suggested cells show a hollow dot until the person sets them; nothing is stored by suggestion.
 * Below 768 px each stream is a block (name + bring in on line 1, the rest under a hairline).
 */
import { useState, type ReactNode } from 'react';
import { KeyBank, MQ, Switch, cx, useMediaQuery } from '@/components';
import { STREAM_RULES, setCell } from '../chapters/devices';
import { D } from '../copy';
import type { CoachVisibility, StreamId, StreamPolicy } from '../types';

export interface StreamMatrixProps {
  policies: readonly StreamPolicy[];
  onChange: (next: StreamPolicy[]) => void;
  /** Streams nobody has set yet (suggested cells marked hollow). */
  untouched?: ReadonlySet<StreamId>;
  className?: string;
}

type BoolCol = 'imported' | 'scores' | 'engine';
const BOOL_COLS: readonly BoolCol[] = ['imported', 'scores', 'engine'];
const COACH: readonly CoachVisibility[] = ['hidden', 'daily', 'daily+series'];

function Never({ stream }: { stream: StreamId }) {
  const [open, setOpen] = useState(false);
  const why = D.matrix.neverWhy[stream as keyof typeof D.matrix.neverWhy];
  return (
    <span className="lm-ik-never">
      {why ? (
        <button type="button" className="lm-ik-never__key" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {D.matrix.never} <span aria-hidden="true">ⓘ</span>
        </button>
      ) : (
        <span>{D.matrix.never}</span>
      )}
      {open && why ? <span className="lm-ik-never__why">{why}</span> : null}
    </span>
  );
}

export function StreamMatrix({ policies, onChange, untouched, className }: StreamMatrixProps) {
  const wide = useMediaQuery(MQ.md);
  const set = (stream: StreamId, col: BoolCol | 'coach', v: boolean | CoachVisibility) => onChange(policies.map((p) => (p.stream === stream ? setCell(p, col, v) : p)));

  const cell = (p: StreamPolicy, col: BoolCol): ReactNode => {
    const rule = STREAM_RULES[p.stream];
    const name = D.matrix.streams[p.stream];
    if (col !== 'imported' && rule[col] === 'na') return <span aria-label={`${D.matrix.cols[col]}: not applicable`}>{D.matrix.na}</span>;
    if (col !== 'imported' && rule[col] === 'never') return <Never stream={p.stream} />;
    const suggested = untouched?.has(p.stream) && rule.recommend[col];
    return (
      <span className="lm-ik-cell" data-suggested={suggested || undefined}>
        <Switch
          checked={p[col]}
          onChange={(v) => set(p.stream, col, v)}
          label={<span className="lm-sr">{D.matrix.switchLabel(col, name)}</span>}
          disabled={col !== 'imported' && !p.imported}
        />
        {suggested ? (
          <span className="lm-ik-cell__hint" aria-label={D.matrix.suggested}>
            ○
          </span>
        ) : null}
      </span>
    );
  };
  const coach = (p: StreamPolicy) => (
    <KeyBank<CoachVisibility>
      label={D.matrix.coachLabel(D.matrix.streams[p.stream])}
      size="lg"
      value={p.coach}
      onChange={(v) => set(p.stream, 'coach', v)}
      options={COACH.map((c) => ({ value: c, label: D.matrix.coach[c], disabled: !p.imported }))}
    />
  );

  if (wide) {
    return (
      <table className={cx('lm-ik-matrix', className)}>
        <caption className="lm-sr">{D.matrix.caption}</caption>
        <thead>
          <tr>
            <td />
            {BOOL_COLS.map((c) => (
              <th key={c} scope="col">
                {D.matrix.cols[c]}
              </th>
            ))}
            <th scope="col">{D.matrix.cols.coach}</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((p) => (
            <tr key={p.stream}>
              <th scope="row">{D.matrix.streams[p.stream]}</th>
              {BOOL_COLS.map((c) => (
                <td key={c}>{cell(p, c)}</td>
              ))}
              <td>{coach(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <div className={cx('lm-ik-matrix-blocks', className)} role="list" aria-label={D.matrix.caption}>
      {policies.map((p) => (
        <div key={p.stream} className="lm-ik-matrix-block" role="listitem">
          <div className="lm-ik-matrix-block__head">
            <span className="lm-ik-matrix-block__name">{D.matrix.streams[p.stream]}</span>
            {cell(p, 'imported')}
          </div>
          <dl className="lm-ik-matrix-block__rest">
            <div>
              <dt>{D.matrix.cols.scores}</dt>
              <dd>{cell(p, 'scores')}</dd>
            </div>
            <div>
              <dt>{D.matrix.cols.engine}</dt>
              <dd>{cell(p, 'engine')}</dd>
            </div>
            <div>
              <dt>{D.matrix.cols.coach}</dt>
              <dd>{coach(p)}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}
