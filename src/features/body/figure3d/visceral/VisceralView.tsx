// The visceral view (R2 sec. 3.4): the waist slice as a plate on the same dotted stage as the 3D figure (a small
// figure in the corner marks where the slice is taken), one accessible image named by `visceralWords`, and the numbers,
// band scale and legend underneath, framed like the figure's layer strip. Pure view of AvatarParams; the drawing eases
// to new numbers (reduced motion snaps), the words change at once.

import type { ReactNode } from 'react';
import type { AvatarParams } from '@/engine/body';
import { visceralWords } from '@/features/body/avatar/describe';
import { VisceralLegend, VisceralPlate, liveVisceral } from './VisceralSection';
import './visceral.css';

export interface VisceralViewProps {
  params: AvatarParams;
  /** Start state: ghost outline + ghost deep-fat contour on the slice. */
  compareTo?: AvatarParams;
  /** Accessible name of the image. Default: `visceralWords(params.visceral)` (with the start when comparing). */
  label?: string;
  /** Numbers, band scale and legend (default true). */
  legend?: boolean;
  /** Caption under the legend. */
  caption?: ReactNode;
  /** How the number is made (with a link to the evidence). */
  how?: ReactNode;
  /** Whether a waist measurement sets the slice (see `VisceralLegend`): decides the "what narrows it" line. */
  waistMeasured?: boolean;
  className?: string;
  id?: string;
}

/** Plate over words in every container: the plate takes the room the words leave (it fills a fixed-height stage). */
export function VisceralView({
  params,
  compareTo,
  label,
  legend = true,
  caption,
  how,
  waistMeasured,
  className,
  id,
}: VisceralViewProps) {
  const live = liveVisceral(params.visceral);
  const name = label ?? visceralWords(live, compareTo ? { compareTo: compareTo.visceral } : {});
  return (
    <figure id={id} className={['lm-visc', 'lm-visc--view', className].filter(Boolean).join(' ')} data-band={live.band}>
      <VisceralPlate params={params} compareTo={compareTo} label={name} />
      {legend ? (
        <figcaption>
          <VisceralLegend
            params={params}
            compareTo={compareTo}
            caption={caption}
            how={how}
            waistMeasured={waistMeasured}
          />
        </figcaption>
      ) : null}
    </figure>
  );
}
