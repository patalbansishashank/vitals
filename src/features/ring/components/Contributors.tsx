/**
 * The contributor drawer of an experimental wellness index (SPEC §1.7, §V2.8): each part with its score and the weight
 * it carried after renormalisation, missing parts named. (r068 S06/G11/G08) The index row's own disclosure (a full-width
 * row with a chevron, flush with the content), each part a row with its weight drawn as a bar; no method ids or "(ln)"
 * on screen (the version is the drawer's spoken label). Quiet mode shows the parts and their weights in words.
 */
import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Icon, formatNumber, type Domain } from '@/components';
import type { IndexContributor } from '@/living/sensors';
import { RING_COPY as C } from '../copy';

/** A part's label as shown: no statistics shorthand or bracketed role ("HRV vs usual (ln)" → "HRV vs usual"). */
export function contributorLabel(label: string): string {
  return label.replace(/\s*\((?:ln|context)\)\s*$/i, '').trim();
}

export function Contributors({ parts, version, note, quiet = false, expanded = false, hue }: { parts: readonly IndexContributor[]; version?: string | null; note?: string | null; quiet?: boolean; expanded?: boolean; hue?: Domain }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!parts.length) return null;
  return (
    <div className="rg-contrib" data-hue={hue}>
      {!expanded ? <button type="button" className="rg-contrib__key" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} data-open={open || undefined}>
        <span>{C.contributors}</span>
        <Icon icon={ChevronDown} size={18} />
      </button> : null}
      {open || expanded ? (
        <div id={id} className="rg-contrib__body">
          <ul className="rg-contrib__list" aria-label={!quiet && version ? `${C.contributors} (${C.method(version)})` : C.contributors}>
            {parts.map((p) => {
              const missing = p.score === null && !p.context;
              return (
                <li key={p.id} className="rg-contrib__row" data-missing={missing || undefined}>
                  <span className="rg-contrib__label">{contributorLabel(p.label)}</span>
                  <span className="rg-contrib__value lm-num">
                    {p.context ? 'For context' : p.score === null ? 'Missing' : quiet ? p.applied >= 0.5 ? 'Most of it' : p.applied >= 0.25 ? 'A main part' : 'A smaller part' : formatNumber(p.score, 0)}
                  </span>
                  {!p.context && p.score !== null ? (
                    <span className="rg-contrib__weight" aria-label={quiet ? 'Share of the index' : `${formatNumber(p.applied * 100, 0)} % of the index`}>
                      <span style={{ width: `${Math.max(2, Math.min(100, p.applied * 100))}%` }} />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {note ? <p className="rg-note">{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
