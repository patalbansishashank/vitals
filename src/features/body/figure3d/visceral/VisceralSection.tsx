// True-to-scale waist slice (R2 sec. 3.4 panel 2): layers from the engine's `params.visceral`, deep fat as an
// area-exact lobulated fill, reference rings at 100 and 130 cm2, an uncertainty halo and an optional ghost.

import { useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { AvatarParams, AvatarVisceral } from '@/engine/body';
import { visceralBandOf } from '@/engine/body';
import { rangeSpanWords, roundArea, visceralWords } from '@/features/body/avatar/describe';
import { polyD, sliceGeometry, type Pt, type SliceGeometry } from './geometry';
import './visceral.css';

export interface VisceralSectionProps {
  params: AvatarParams;
  /** Start state: drawn as a ghost outline and a ghost deep-fat contour. */
  compareTo?: AvatarParams;
  /** Numbers, band bar and legend under the slice (default true). */
  legend?: boolean;
  /** Accessible name. Default: `visceralWords`. */
  label?: string;
  /** Hide the SVG from assistive tech (when a parent carries the name, as in `VisceralView`). */
  decorative?: boolean;
  className?: string;
}

/** The engine block with a frame-accurate band (interpolated params keep the start band until t = 1). */
export function liveVisceral(v: AvatarVisceral): AvatarVisceral {
  return { ...v, band: visceralBandOf(v.vatAreaCm2) };
}

const BAND_WORDS = ['typical', 'raised', 'high'] as const;

function niceScale(spanCm: number): number {
  return spanCm >= 36 ? 20 : spanCm >= 18 ? 10 : 5;
}

function topOf(pts: readonly Pt[]): Pt {
  let best = pts[0] ?? [0, 0];
  for (const p of pts) if (p[1] < best[1]) best = p;
  return best;
}

/**
 * Numbers, band bar and legend (plain words, R2 sec. 3.4 item 3; body-figure-v2.md §6.3-6.4). When the likely range
 * crosses a threshold the band line says what it spans, never a single confident word over a wide range.
 */
export function VisceralLegend({
  params,
  compareTo,
  cutaway = false,
  caption,
  how,
}: {
  params: AvatarParams;
  compareTo?: AvatarParams;
  cutaway?: boolean;
  /** Caption under the legend ("Waist slice, drawn to scale from your estimate …"). */
  caption?: ReactNode;
  /** How the number is made, with a link to the evidence. */
  how?: ReactNode;
}) {
  const v = liveVisceral(params.visceral);
  const [t1, t2] = v.thresholdsCm2;
  const [lo, hi] = v.areaRangeCm2;
  const max = Math.max(200, Math.ceil((hi * 1.08) / 50) * 50);
  const pct = (x: number) => `${Math.min(100, Math.max(0, (100 * x) / max)).toFixed(2)}%`;
  const barStyle = { '--vs-t1': pct(t1), '--vs-t2': pct(t2) } as CSSProperties;
  const kg = Number.isFinite(v.vatKg) ? v.vatKg.toFixed(1) : '?';
  const span = rangeSpanWords(v);
  return (
    <div className="lm-visc__caption">
      <p className="lm-visc__number">
        Deep fat around the organs: <strong>about {roundArea(v.vatAreaCm2)} cm²</strong>{' '}
        <span className="lm-visc__range">
          (likely {roundArea(lo)}–{roundArea(hi)})
        </span>
      </p>
      <div className="lm-visc__bar" style={barStyle} aria-hidden="true">
        <span
          className="lm-visc__bar-range"
          style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }}
        />
        <span className="lm-visc__bar-mark" data-testid="visc-mark" style={{ left: pct(v.vatAreaCm2) }} />
        <span className="lm-visc__bar-tick" style={{ left: pct(t1) }}>
          {t1}
        </span>
        <span className="lm-visc__bar-tick" style={{ left: pct(t2) }}>
          {t2}
        </span>
      </div>
      <p className="lm-visc__bands">
        {BAND_WORDS.map((b, i) => (
          <span key={b}>
            {i > 0 ? ' · ' : ''}
            <span data-current={b === v.band ? '' : undefined}>{b}</span>
          </span>
        ))}
        <span>
          {' '}
          — under {t1} cm² is typical, {t1} to {t2} raised, {t2} and over high
        </span>
      </p>
      {span ? (
        <p className="lm-visc__span" data-testid="visc-span">
          {span.charAt(0).toUpperCase() + span.slice(1)}. A waist measurement narrows it.
        </p>
      ) : null}
      <ul className="lm-visc__legend">
        <li>
          <span className="lm-visc__swatch" data-k="sat" />
          Under the skin (you can pinch it)
        </li>
        <li>
          <span className="lm-visc__swatch" data-k="deep" />
          Deep, around the organs (visceral)
        </li>
        <li>
          <span className="lm-visc__swatch" data-k="wall" />
          Muscle wall
        </li>
        <li>
          <span className="lm-visc__swatch" data-k="organs" />
          Organs
        </li>
        <li>
          <span className="lm-visc__swatch" data-k="ring" />
          Dashed rings: where deep fat would reach at {t1} and {t2} cm²
        </li>
        {compareTo ? (
          <li>
            <span className="lm-visc__swatch" data-k="ghost" />
            Grey lines: the start
          </li>
        ) : null}
      </ul>
      <details className="lm-visc__details">
        <summary>Details</summary>
        <p>
          Deep fat about {kg} kg in the whole belly. This waist slice shows about {roundArea(v.vatAreaCm2)}{' '}
          cm² of it, about {roundArea(v.satAreaCm2)} cm² of fat under the skin and about {roundArea(v.wallAreaCm2)} cm²
          of muscle wall.
          {cutaway ? ' The line on the side view marks where the slice is taken.' : ''} The shaded band is the
          likely range. Estimates from your inputs, not a scan.
        </p>
        <p>The bands are the same for everyone. Your estimate already allows for your basics and ancestry.</p>
      </details>
      {caption ? <p className="lm-visc__note">{caption}</p> : null}
      {how ? <p className="lm-visc__note">{how}</p> : null}
    </div>
  );
}

function SliceSvg({
  g,
  ghost,
  decorative,
  label,
}: {
  g: SliceGeometry;
  ghost: SliceGeometry | null;
  decorative: boolean;
  label: string;
}) {
  const titleId = useId();
  const extentX = Math.max(g.a, ghost?.a ?? 0, ...g.refs[1].map((p) => Math.abs(p[0])));
  const extentY = Math.max(g.b, ghost?.b ?? 0);
  const W = 2 * extentX + 6;
  const fs = Math.max(W / 24, 1.4);
  const top = -extentY - 2.4 * fs;
  const bottom = extentY + 3.2 * fs;
  const H = bottom - top;
  const scale = niceScale(2 * g.a);
  const sx = -W / 2 + 1.5;
  const sy = bottom - 1.2 * fs;
  const ref100 = topOf(g.refs[0]);
  const ref130 = topOf(g.refs[1]);
  const deepD = `${polyD(g.vat)}${polyD([...g.organs].reverse())}`;
  const haloD = `${polyD(g.halo[1])}${polyD([...g.halo[0]].reverse())}`;
  return (
    <svg
      className="lm-visc__svg"
      viewBox={`${(-W / 2).toFixed(2)} ${top.toFixed(2)} ${W.toFixed(2)} ${H.toFixed(2)}`}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-labelledby={decorative ? undefined : titleId}
      focusable="false"
      data-testid="visc-section"
    >
      {decorative ? null : <title id={titleId}>{label}</title>}
      <path className="lm-visc__sat" d={polyD(g.outer)} />
      <path className="lm-visc__wall" d={polyD(g.wallOuter)} />
      <path className="lm-visc__organs" d={polyD(g.wallInner)} />
      <path className="lm-visc__deep" d={deepD} data-testid="visc-deep" />
      <path className="lm-visc__organs-edge" d={polyD(g.organs)} />
      <circle
        className="lm-visc__spine"
        cx={g.spine.cx.toFixed(2)}
        cy={g.spine.cy.toFixed(2)}
        r={g.spine.r.toFixed(2)}
      />
      <path className="lm-visc__halo" d={haloD} data-testid="visc-halo" />
      <path className="lm-visc__ref" data-ref="100" d={polyD(g.refs[0])} />
      <path className="lm-visc__ref" data-ref="130" d={polyD(g.refs[1])} />
      <text
        className="lm-visc__ref-label"
        x={(ref100[0] - 0.4 * fs).toFixed(2)}
        y={(ref100[1] - 0.3 * fs).toFixed(2)}
        fontSize={fs * 0.8}
        textAnchor="end"
      >
        100
      </text>
      <text
        className="lm-visc__ref-label"
        x={(ref130[0] + 0.4 * fs).toFixed(2)}
        y={(ref130[1] - 0.3 * fs).toFixed(2)}
        fontSize={fs * 0.8}
      >
        130
      </text>
      {ghost ? (
        <g data-testid="visc-ghost">
          <path className="lm-visc__ghost" data-ghost="outline" d={polyD(ghost.outer)} />
          <path className="lm-visc__ghost" data-ghost="deep" d={polyD(ghost.vat)} />
        </g>
      ) : null}
      <text x="0" y={(-extentY - 0.9 * fs).toFixed(2)} fontSize={fs} textAnchor="middle">
        front
      </text>
      <g data-testid="visc-scale">
        <path
          className="lm-visc__scale"
          d={`M${sx} ${sy - 0.4}V${sy + 0.4}M${sx} ${sy}H${sx + scale}M${sx + scale} ${sy - 0.4}V${sy + 0.4}`}
        />
        <text x={(sx + scale + 0.6).toFixed(2)} y={(sy + 0.35 * fs).toFixed(2)} fontSize={fs}>
          {scale} cm
        </text>
      </g>
    </svg>
  );
}

/** True-to-scale waist slice with words. */
export function VisceralSection({
  params,
  compareTo,
  legend = true,
  label,
  decorative = false,
  className,
}: VisceralSectionProps) {
  const g = useMemo(() => sliceGeometry(params.visceral), [params.visceral]);
  const ghost = useMemo(() => (compareTo ? sliceGeometry(compareTo.visceral) : null), [compareTo]);
  const name = label ?? visceralWords(liveVisceral(params.visceral));
  return (
    <figure className={['lm-visc', 'lm-visc__section', className].filter(Boolean).join(' ')}>
      <SliceSvg g={g} ghost={ghost} decorative={decorative} label={name} />
      {legend ? (
        <figcaption>
          <VisceralLegend params={params} compareTo={compareTo} />
        </figcaption>
      ) : null}
    </figure>
  );
}
