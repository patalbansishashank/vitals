/**
 * B0 · the entry card of the blood-markers chapter (design intake-v3 §8.1, SUITE_SPEC §13.5.5): the two statements as
 * a ruled info notice, shown every time and before any choice, then the question and its three answers.
 */
import { useId } from 'react';
import { Notice } from '@/components';
import { M, type MarkersHas } from './markers';
import { MarkersCard } from './markersParts';

export interface MarkersEntryProps {
  value?: MarkersHas;
  onChoose: (v: MarkersHas) => void;
  /** A choice is being saved (the keys stay, pressed one shows it). */
  busy?: boolean;
  footer?: React.ReactNode;
}

/** The two statements (verbatim) and the lab-abnormal sentence. */
export function MarkersStatements() {
  return (
    <Notice severity="info" layout="ruled" title={M.statement1} className="lm-mk-statements">
      <span className="lm-mk-statements__line">{M.statement2}</span> <span className="lm-mk-statements__line">{M.statement3}</span>
    </Notice>
  );
}

export function MarkersEntry({ value, onChoose, busy, footer }: MarkersEntryProps) {
  const subId = useId();
  const legendId = useId();
  const options: Array<{ v: MarkersHas; label: string; sub?: string }> = [
    { v: 'skip', label: M.has.options.skip },
    { v: 'manual', label: M.has.options.manual },
    { v: 'report', label: M.has.options.report, sub: M.has.reportSub },
  ];
  return (
    <MarkersCard lead={<MarkersStatements />} prompt={M.has.prompt} why={M.has.why} skipText={M.has.skipText} legendId={legendId} footer={footer} id="ik-markers-has">
      <div className="lm-ik-keys lm-ik-keys--cards lm-mk-keys">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            className="lm-ik-key"
            data-cards="true"
            aria-pressed={value === o.v}
            aria-describedby={o.sub ? subId : undefined}
            aria-busy={(busy && value === o.v) || undefined}
            onClick={() => onChoose(o.v)}
          >
            <span className="lm-ik-key__label">{o.label}</span>
            {o.sub ? (
              <span className="lm-ik-key__examples" id={subId}>
                {o.sub}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </MarkersCard>
  );
}
