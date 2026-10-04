// Side cutaway pictogram (R2 sec. 3.4 panel 1): the torso's side silhouette cut open from rib cage to pelvis -
// skin, the pinchable fat band, the muscle wall, and the cavity where deep fat packs around stylised bowel loops.
// A dashed line marks the waist slice drawn by `VisceralSection`.

import { useId, useMemo } from 'react';
import type { AvatarParams } from '@/engine/body';
import { cutawayGeometry, polyD, smoothD } from './geometry';
import './visceral.css';

export interface VisceralCutawayProps {
  params: AvatarParams;
  /** Accessible name. Default: a short description of the pictogram. */
  label?: string;
  decorative?: boolean;
  className?: string;
}

export function VisceralCutaway({ params, label, decorative = false, className }: VisceralCutawayProps) {
  const c = useMemo(() => cutawayGeometry(params), [params]);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const clipId = `lmvc${uid}`;
  const titleId = `${clipId}t`;
  const padX = 3;
  const W = c.extent.maxX - c.extent.minX + 2 * padX;
  const fs = Math.max(W / 11, 1.4);
  const x0 = c.extent.minX - padX;
  const y0 = c.extent.minY - 2.2 * fs;
  const H = c.extent.maxY - y0 + 1.5;
  const name =
    label ??
    `Side view of the belly, cut open. Deep fat fills about ${Math.round(c.vatFraction * 100)} percent of the space around the gut.`;
  return (
    <svg
      className={['lm-visc__svg', 'lm-visc__cutaway', className].filter(Boolean).join(' ')}
      viewBox={`${x0.toFixed(2)} ${y0.toFixed(2)} ${W.toFixed(2)} ${H.toFixed(2)}`}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-labelledby={decorative ? undefined : titleId}
      focusable="false"
      data-testid="visc-cutaway"
    >
      {decorative ? null : <title id={titleId}>{name}</title>}
      <defs>
        <clipPath id={clipId}>
          <path d={smoothD(c.cavity)} />
        </clipPath>
      </defs>
      <path className="lm-visc__sat" d={smoothD(c.skin)} />
      <path className="lm-visc__wall" d={smoothD(c.wall)} />
      <path className="lm-visc__deep" d={smoothD(c.cavity)} />
      <g clipPath={`url(#${clipId})`}>
        {c.loops.map((l, i) => (
          <circle
            key={i}
            className="lm-visc__loop"
            cx={l.cx.toFixed(2)}
            cy={l.cy.toFixed(2)}
            r={l.r.toFixed(2)}
          />
        ))}
      </g>
      <path className="lm-visc__cavity-edge" d={smoothD(c.cavity)} />
      <path
        className="lm-visc__slice"
        d={polyD([
          [c.slice.x0 - 1.5, c.slice.y],
          [c.slice.x1 + 1.5, c.slice.y],
        ]).replace('Z', '')}
        data-testid="visc-slice-line"
      />
      <text
        x={(c.extent.maxX + padX - 0.3).toFixed(2)}
        y={(c.extent.minY - 0.8 * fs).toFixed(2)}
        fontSize={fs}
        textAnchor="end"
      >
        front →
      </text>
    </svg>
  );
}
