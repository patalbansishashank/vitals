// The visceral view (R2 sec. 3.4): side cutaway (where the slice is) + true-to-scale waist slice, one accessible
// image named by `visceralWords`, with the numbers and plain-word legend underneath. Pure view of AvatarParams;
// morph it with the same `lerpAvatarParams` timeline as the figure.

import type { ReactNode } from 'react';
import type { AvatarParams } from '@/engine/body';
import { visceralWords } from '@/features/body/avatar/describe';
import { VisceralCutaway } from './VisceralCutaway';
import { VisceralLegend, VisceralSection, liveVisceral } from './VisceralSection';
import './visceral.css';

export interface VisceralViewProps {
  params: AvatarParams;
  /** Start state: ghost outline + ghost deep-fat contour on the slice. */
  compareTo?: AvatarParams;
  /** Accessible name of the image. Default: `visceralWords(params.visceral)` (with the start when comparing). */
  label?: string;
  /** Numbers, band bar and legend (default true). */
  legend?: boolean;
  /** Caption under the legend. */
  caption?: ReactNode;
  /** How the number is made (with a link to the evidence). */
  how?: ReactNode;
  className?: string;
  id?: string;
}

/**
 * Narrow containers stack the panels over the words; from 38rem the readout, band scale and legend sit in a column
 * beside the slice (body-figure-v2.md §4), via a container query, so the same component fits the Body stage, the
 * Simulator's aside and the dev page.
 */
export function VisceralView({ params, compareTo, label, legend = true, caption, how, className, id }: VisceralViewProps) {
  const live = liveVisceral(params.visceral);
  const name = label ?? visceralWords(live, compareTo ? { compareTo: compareTo.visceral } : {});
  return (
    <figure id={id} className={['lm-visc', 'lm-visc--view', className].filter(Boolean).join(' ')} data-band={live.band}>
      <div className="lm-visc__grid">
        <div className="lm-visc__panels" role="img" aria-label={name}>
          <VisceralCutaway params={params} decorative />
          <VisceralSection params={params} compareTo={compareTo} legend={false} decorative />
        </div>
        {legend ? (
          <figcaption>
            <VisceralLegend params={params} compareTo={compareTo} cutaway caption={caption} how={how} />
          </figcaption>
        ) : null}
      </div>
    </figure>
  );
}
