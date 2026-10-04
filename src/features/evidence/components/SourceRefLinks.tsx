import { Fragment } from 'react';
import { Link } from 'react-router';
import type { SourceRef } from '@/content/evidence/schema';
import { SOURCE_SEP, sourceRefLabel, topicShortName } from '@/content/evidence/sources';
import { topicHref, topicRefAnchor, type EvidenceNavState } from '../links';

export interface SourceRefLinksProps {
  refs: readonly SourceRef[];
  /** Router state for the links (e.g. `returnTo` from Explain). */
  state?: EvidenceNavState;
  /** Between references (default " · "). */
  separator?: string;
  className?: string;
}

/**
 * Evidence cited by topic, linked into the library: "Safety limits › references 6, 7". The topic name opens the
 * topic page; each reference number opens that numbered source on it. This is the only way engine data
 * (`SourceRef`) is shown, so no research-note pointer ever reaches a screen.
 */
export function SourceRefLinks({
  refs,
  state = { from: 'evidence' },
  separator = ' · ',
  className,
}: SourceRefLinksProps) {
  if (!refs.length) return null;
  return (
    <>
      {refs.map((r, i) => (
        <Fragment key={`${r.topic}-${i}`}>
          {i > 0 ? separator : null}
          <span className={className} data-source-ref={r.topic}>
            <Link to={topicHref(r.topic)} state={state} className="ev-link">
              {topicShortName(r.topic)}
            </Link>
            {r.refs?.length ? (
              <>
                {SOURCE_SEP}
                {r.refs.length === 1 ? 'reference ' : 'references '}
                {r.refs.map((n, j) => (
                  <Fragment key={n}>
                    {j > 0 ? ', ' : null}
                    <Link
                      to={topicHref(r.topic, topicRefAnchor(n))}
                      state={state}
                      className="ev-link"
                      aria-label={`${sourceRefLabel({ topic: r.topic })}, source ${n}`}
                    >
                      {n}
                    </Link>
                  </Fragment>
                ))}
              </>
            ) : null}
          </span>
        </Fragment>
      ))}
    </>
  );
}
