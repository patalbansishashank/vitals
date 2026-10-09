// True-to-scale waist slice (R2 sec. 3.4 panel 2), drawn as an axial plate of the belly at about the navel, read like a
// CT slice (front at the top, the body's right on the viewer's left) in the 3D figure's materials: fat under the skin,
// the abdominal wall and back muscles, the lumbar vertebra with the aorta and vena cava in front of it, and inside the
// cavity the bowel loops with the deep fat (the subject) between and around them. Layers come from the engine's
// `params.visceral` (area-exact, see geometry.ts). The likely range is a soft band from its low to its high end; thin
// dashed outlines mark where the cavity would reach with 100 and 130 cm2 of deep fat, labelled in the corner; an
// optional ghost shows the start.

import { useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { AvatarParams, AvatarVisceral } from '@/engine/body';
import { visceralBandOf } from '@/engine/body';
import { rangeSpanWords, roundArea, visceralWords } from '@/features/body/avatar/describe';
import { lineD, polyD, polygonArea, radiusAt, sliceGeometry, type Loop, type Pt, type SliceGeometry } from './geometry';
import { useVisceralTween } from './useVisceralTween';
import './visceral.css';

export interface VisceralSectionProps {
  params: AvatarParams;
  /** Start state: drawn as a ghost outline and a ghost cavity outline. */
  compareTo?: AvatarParams;
  /** Numbers, band scale and legend under the slice (default true). */
  legend?: boolean;
  /** Accessible name. Default: `visceralWords`. */
  label?: string;
  /** Hide the drawing from assistive tech (when a parent carries the name, as in `VisceralView`). */
  decorative?: boolean;
  className?: string;
}

/** The engine block with a frame-accurate band (interpolated params keep the start band until t = 1). */
export function liveVisceral(v: AvatarVisceral): AvatarVisceral {
  return { ...v, band: visceralBandOf(v.vatAreaCm2) };
}

const BAND_WORDS = ['typical', 'raised', 'high'] as const;

function niceScale(spanCm: number): number {
  return spanCm >= 22 ? 10 : 5;
}

/** Reversed copy (for the inner edge of a ring path, so nonzero fill leaves the hole). */
const rev = (pts: readonly Pt[]): Pt[] => [...pts].reverse();
const ring = (outer: readonly Pt[], inner: readonly Pt[]) => `${polyD(outer)}${polyD(rev(inner))}`;
const pct = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2)}%`;
const fx = (n: number) => (Math.round((Number.isFinite(n) ? n : 0) * 100) / 100).toString();
const polar = (r: number, t: number): Pt => [r * Math.cos(t), r * Math.sin(t)];

/** A loop's lumen: its outline scaled about a point a little in front of its centre. */
function lumen(l: Loop, s: number): Pt[] {
  const c: Pt = [l.c[0], l.c[1] - 0.06 * (1 - s) * loopSize(l)];
  return l.pts.map(([x, y]) => [c[0] + (x - c[0]) * s, c[1] + (y - c[1]) * s] as Pt);
}

function loopSize(l: Loop): number {
  return Math.sqrt(polygonArea(l.pts) / Math.PI);
}

/** A small pocket of gas at the front of the colon's lumen (how a colon reads on a scan). */
function gasD(l: Loop): string {
  const r = loopSize(l);
  const cx = l.c[0];
  const cy = l.c[1] - 0.32 * r;
  const w = 0.36 * r;
  const h = 0.17 * r;
  return `M${fx(cx - w)} ${fx(cy + 0.25 * h)}Q${fx(cx)} ${fx(cy - 1.6 * h)} ${fx(cx + w)} ${fx(cy + 0.25 * h)}Q${fx(cx)} ${fx(cy + 0.6 * h)} ${fx(cx - w)} ${fx(cy + 0.25 * h)}Z`;
}

/**
 * The lumbar vertebra: the body (the geometry's oval) in front, the canal behind it, the arch, the spinous process
 * pointing back between the back muscles and the transverse processes reaching sideways. Each part is drawn twice
 * (a wider edge stroke under all fills), so the bone reads as one piece with one outline.
 */
function Vertebra({ g }: { g: SliceGeometry }) {
  const { cx, cy, rx, ry } = g.spine;
  if (!(rx > 0) || !Number.isFinite(cy)) return null;
  const yb = cy + ry; // back of the body
  const arch =
    `M${fx(cx - 0.5 * rx)} ${fx(yb - 0.2 * ry)}` +
    `C${fx(cx - 0.62 * rx)} ${fx(yb + 0.55 * rx)} ${fx(cx - 0.5 * rx)} ${fx(yb + 0.95 * rx)} ${fx(cx - 0.14 * rx)} ${fx(yb + 1.0 * rx)}` +
    `L${fx(cx - 0.11 * rx)} ${fx(yb + 1.72 * rx)}Q${fx(cx)} ${fx(yb + 1.86 * rx)} ${fx(cx + 0.11 * rx)} ${fx(yb + 1.72 * rx)}` +
    `L${fx(cx + 0.14 * rx)} ${fx(yb + 1.0 * rx)}` +
    `C${fx(cx + 0.5 * rx)} ${fx(yb + 0.95 * rx)} ${fx(cx + 0.62 * rx)} ${fx(yb + 0.55 * rx)} ${fx(cx + 0.5 * rx)} ${fx(yb - 0.2 * ry)}Z`;
  const tp = (s: 1 | -1) =>
    `M${fx(cx + s * 0.42 * rx)} ${fx(yb + 0.1 * rx)}L${fx(cx + s * 1.62 * rx)} ${fx(yb + 0.0 * rx)}` +
    `Q${fx(cx + s * 1.84 * rx)} ${fx(yb + 0.16 * rx)} ${fx(cx + s * 1.62 * rx)} ${fx(yb + 0.32 * rx)}` +
    `L${fx(cx + s * 0.5 * rx)} ${fx(yb + 0.62 * rx)}Z`;
  const parts = [tp(-1), tp(1), arch];
  const canal = { cx, cy: yb + 0.5 * rx, rx: 0.34 * rx, ry: 0.3 * rx };
  return (
    <g className="lm-visc__bone" data-testid="visc-spine">
      {parts.map((d, i) => (
        <path key={`e${i}`} className="lm-visc__bone-edge" d={d} />
      ))}
      <ellipse className="lm-visc__bone-edge" cx={fx(cx)} cy={fx(cy)} rx={fx(rx)} ry={fx(ry)} />
      {parts.map((d, i) => (
        <path key={`f${i}`} className="lm-visc__bone-fill" d={d} />
      ))}
      <ellipse className="lm-visc__bone-fill" cx={fx(cx)} cy={fx(cy)} rx={fx(rx)} ry={fx(ry)} />
      <ellipse className="lm-visc__bone-core" cx={fx(cx)} cy={fx(cy + 0.03 * ry)} rx={fx(0.78 * rx)} ry={fx(0.72 * ry)} />
      <ellipse className="lm-visc__canal" cx={fx(canal.cx)} cy={fx(canal.cy)} rx={fx(canal.rx)} ry={fx(canal.ry)} />
    </g>
  );
}

/**
 * The fascia lines that make the muscles read as muscles: the linea alba and the edges of the rectus pair in front,
 * the three flat layers on each flank, and behind, the borders of the back muscles and the midline between them.
 */
function Fascia({ g }: { g: SliceGeometry }) {
  const { wallOuter, wallOuterO, wallInner } = g.radii;
  const { cx, cy, rx, ry } = g.spine;
  const [ox, oy] = g.origin;
  const at = (r: number, t: number): Pt => [ox + r * Math.cos(t), oy + r * Math.sin(t)];
  const across = (t: number, f0 = 0, f1 = 1): string => {
    const ro = radiusAt(wallOuterO, t);
    const ri = radiusAt(wallInner, t);
    return lineD([at(ro - f0 * (ro - ri), t), at(ro - f1 * (ro - ri), t)]);
  };
  const layer = (from: number, to: number, f: number): string => {
    const n = 28;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      const ro = radiusAt(wallOuterO, t);
      pts.push(at(ro - f * (ro - radiusAt(wallInner, t)), t));
    }
    return lineD(pts);
  };
  const front = -Math.PI / 2;
  const rect = 0.6; // half-width of the rectus pair, rad
  const flankEnd = Math.PI / 2 - 1.22; // where the flat layers meet the quadratus lumborum (right side)
  const yb = cy + ry;
  const backOuter = radiusAt(wallOuter, Math.PI / 2);
  // the back muscles' lateral border: from the transverse process back to the skin side of the muscle, slightly bowed
  const erector = (s: 1 | -1) => {
    const tip: Pt = [cx + s * 1.75 * rx, yb + 0.16 * rx];
    let t = Math.PI / 2;
    for (let k = 0; k < 90; k++) {
      const tt = Math.PI / 2 - s * k * 0.02;
      if (Math.abs(polar(radiusAt(wallOuter, tt), tt)[0]) >= 2.9 * rx) break;
      t = tt;
    }
    const o = polar(0.985 * radiusAt(wallOuter, t), t);
    const mid: Pt = [(tip[0] + o[0]) / 2 + s * 0.35 * rx, (tip[1] + o[1]) / 2];
    return `M${fx(tip[0])} ${fx(tip[1])}Q${fx(mid[0])} ${fx(mid[1])} ${fx(o[0])} ${fx(o[1])}`;
  };
  const d = [
    across(front, 0, 1),
    across(front - rect),
    across(front + rect),
    layer(front + rect, flankEnd, 0.36),
    layer(front + rect, flankEnd, 0.68),
    layer(front - rect, -Math.PI - flankEnd, 0.36),
    layer(front - rect, -Math.PI - flankEnd, 0.68),
    erector(1),
    erector(-1),
    lineD([
      [cx, yb + 1.84 * rx],
      [cx, 0.985 * backOuter],
    ]),
  ].join('');
  return <path className="lm-visc__fascia" d={d} data-testid="visc-fascia" />;
}

interface Box {
  x0: number;
  top: number;
  W: number;
  H: number;
}

/**
 * The plate's drawing: an SVG in centimetres, and the scale bar, placed in the plate's bottom-right corner at the
 * drawing's true scale (HTML, so its type stays the same size on a phone and on a desktop).
 */
function SliceDrawing({
  v,
  ghost,
  decorative,
  label,
}: {
  v: AvatarVisceral;
  ghost: AvatarVisceral | null;
  decorative: boolean;
  label: string;
}) {
  const g = useMemo(() => sliceGeometry(v), [v]);
  const gg = useMemo(() => (ghost ? sliceGeometry(ghost) : null), [ghost]);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (k: string) => `lmvs${uid}${k}`;
  const xs = [...g.outer, ...(gg?.outer ?? [])].map((p) => p[0]);
  const ys = [...g.outer, ...(gg?.outer ?? [])].map((p) => p[1]);
  const extentX = Math.max(...xs.map(Math.abs));
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 0.035 * extentX + 0.3;
  const box: Box = { x0: -extentX - pad, top: minY - pad, W: 2 * (extentX + pad), H: maxY - minY + 2 * pad };
  const scale = niceScale(2 * g.a);
  const shadeSd = Math.max(0.25, 0.02 * extentX);
  const style = {
    '--vs-ar': (box.W / box.H).toFixed(4),
    '--vs-sf': (scale / box.W).toFixed(5),
  } as CSSProperties;
  const [loPts, hiPts] = g.halo;

  return (
    <>
      <div
        className="lm-visc__panels"
        style={style}
        role={decorative ? undefined : 'img'}
        aria-label={decorative ? undefined : label}
        aria-hidden={decorative ? true : undefined}
      >
        <svg
          className="lm-visc__svg"
          viewBox={`${fx(box.x0)} ${fx(box.top)} ${fx(box.W)} ${fx(box.H)}`}
          aria-hidden="true"
          focusable="false"
          data-testid="visc-section"
        >
          <defs>
            <filter id={id('lift')} x="-15%" y="-15%" width="130%" height="135%" colorInterpolationFilters="sRGB">
              <feDropShadow className="lm-visc__fx-lift" dx="0" dy={fx(0.025 * extentX)} stdDeviation={fx(0.03 * extentX)} />
            </filter>
            {/* an inner rim on each layer: the cut face reads as soft material with depth, not as flat fills */}
            <filter id={id('shade')} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
              <feGaussianBlur in="SourceAlpha" stdDeviation={fx(shadeSd)} result="blur" />
              <feOffset in="blur" dy={fx(shadeSd * 0.4)} result="drop" />
              <feComposite in="SourceAlpha" in2="drop" operator="out" result="rim" />
              <feFlood className="lm-visc__fx-shade" result="tint" />
              <feComposite in="tint" in2="rim" operator="in" result="shadow" />
              <feMerge>
                <feMergeNode in="SourceGraphic" />
                <feMergeNode in="shadow" />
              </feMerge>
            </filter>
            <filter id={id('feather')} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation={fx(0.012 * extentX + 0.08)} />
            </filter>
            <radialGradient id={id('sat')} cx="50%" cy="45%" r="60%">
              <stop offset="0.75" className="lm-visc__stop-sat" />
              <stop offset="1" className="lm-visc__stop-sat-rim" />
            </radialGradient>
            <radialGradient id={id('muscle')} cx="50%" cy="45%" r="60%">
              <stop offset="0.6" className="lm-visc__stop-muscle-in" />
              <stop offset="1" className="lm-visc__stop-muscle" />
            </radialGradient>
            <radialGradient id={id('deep')} cx="50%" cy="40%" r="62%">
              <stop offset="0.35" className="lm-visc__stop-deep-in" />
              <stop offset="1" className="lm-visc__stop-deep" />
            </radialGradient>
            <radialGradient id={id('loop')} cx="38%" cy="32%" r="75%">
              <stop offset="0" className="lm-visc__stop-loop-hi" />
              <stop offset="1" className="lm-visc__stop-loop" />
            </radialGradient>
            <radialGradient id={id('colon')} cx="38%" cy="32%" r="75%">
              <stop offset="0" className="lm-visc__stop-colon-hi" />
              <stop offset="1" className="lm-visc__stop-colon" />
            </radialGradient>
            <mask id={id('band')} maskUnits="userSpaceOnUse" x={fx(box.x0)} y={fx(box.top)} width={fx(box.W)} height={fx(box.H)}>
              <path d={ring(hiPts, loPts)} fill="#fff" filter={`url(#${id('feather')})`} />
            </mask>
            <clipPath id={id('inwall')}>
              <path d={polyD(g.wallOuter)} />
            </clipPath>
            <clipPath id={id('muscle-only')}>
              <path d={ring(g.wallOuter, g.cavity)} />
            </clipPath>
          </defs>

          {/* fat under the skin, then the muscle, then the cavity with its deep fat */}
          <path
            className="lm-visc__sat"
            d={polyD(g.outer)}
            fill={`url(#${id('sat')})`}
            filter={`url(#${id('lift')})`}
            data-testid="visc-sat"
          />
          <path
            className="lm-visc__muscle"
            d={polyD(g.wallOuter)}
            fill={`url(#${id('muscle')})`}
            filter={`url(#${id('shade')})`}
            data-testid="visc-muscle"
          />
          {g.psoas.map((o, i) => (
            <ellipse
              key={i}
              className="lm-visc__psoas"
              cx={fx(o.cx)}
              cy={fx(o.cy)}
              rx={fx(o.rx)}
              ry={fx(o.ry)}
              data-testid="visc-psoas"
            />
          ))}
          <g clipPath={`url(#${id('muscle-only')})`}>
            <Fascia g={g} />
          </g>
          <path
            className="lm-visc__deep"
            d={polyD(g.cavity)}
            fill={`url(#${id('deep')})`}
            filter={`url(#${id('shade')})`}
            data-testid="visc-deep"
          />
          {/* the likely range: a soft band from its low to its high end, never into the layer you can pinch */}
          <g clipPath={`url(#${id('inwall')})`}>
            <rect
              className="lm-visc__band-fill"
              x={fx(box.x0)}
              y={fx(box.top)}
              width={fx(box.W)}
              height={fx(box.H)}
              mask={`url(#${id('band')})`}
              data-testid="visc-halo"
            />
          </g>
          <g className="lm-visc__loops" data-testid="visc-organs">
            {g.loops.map((l, i) => (
              <g key={i} data-kind={l.kind}>
                <path
                  className="lm-visc__loop"
                  d={polyD(l.pts)}
                  fill={`url(#${id(l.kind === 'colon' ? 'colon' : 'loop')})`}
                />
                <path className="lm-visc__lumen" d={polyD(lumen(l, l.kind === 'colon' ? 0.62 : 0.5))} />
                {l.kind === 'colon' ? <path className="lm-visc__gas" d={gasD(l)} /> : null}
              </g>
            ))}
          </g>
          {g.vessels ? (
            <g data-testid="visc-vessels">
              <circle
                className="lm-visc__aorta"
                cx={fx(g.vessels.aorta.cx)}
                cy={fx(g.vessels.aorta.cy)}
                r={fx(g.vessels.aorta.r)}
              />
              <ellipse
                className="lm-visc__ivc"
                cx={fx(g.vessels.ivc.cx)}
                cy={fx(g.vessels.ivc.cy)}
                rx={fx(g.vessels.ivc.rx)}
                ry={fx(g.vessels.ivc.ry)}
              />
            </g>
          ) : null}
          <Vertebra g={g} />
          <path className="lm-visc__estimate" d={polyD(g.cavity)} />
          {g.refs.map((pts, i) => (
            <path key={i} className="lm-visc__ref" data-ref={v.thresholdsCm2[i]} d={polyD(pts)} />
          ))}
          {gg ? (
            <g data-testid="visc-ghost">
              <path className="lm-visc__ghost" data-ghost="outline" d={polyD(gg.outer)} />
              <path className="lm-visc__ghost" data-ghost="deep" d={polyD(gg.cavity)} />
            </g>
          ) : null}
          <path className="lm-visc__skin" d={polyD(g.outer)} />
        </svg>
        <span className="lm-visc__front">front</span>
      </div>
      <div className="lm-visc__scale" data-testid="visc-scale" style={style}>
        <span>{scale} cm</span>
        <i aria-hidden="true" />
      </div>
    </>
  );
}

/** Where the slice is taken: the app's small figure glyph with the cutting plane at the waist. */
export function VisceralLocator({ className }: { className?: string }) {
  return (
    <svg
      className={['lm-visc__locator', className].filter(Boolean).join(' ')}
      viewBox="2 0.5 16 18.5"
      aria-hidden="true"
      focusable="false"
      data-testid="visc-locator"
    >
      <circle className="lm-visc__locator-body" cx="10" cy="3.6" r="2" />
      <path className="lm-visc__locator-body" d="M6.2 7.2h7.6l-.9 5.3h-1.4l-.3 5.3H8.8l-.3-5.3H7.1z" />
      <ellipse className="lm-visc__locator-plane" cx="10" cy="10.3" rx="4.4" ry="1.05" data-testid="visc-slice-line" />
    </svg>
  );
}

/**
 * The plate: dotted stage; on one margin, the locator top left and the key to the two dashed outlines top right; the
 * slice centred and scaled to fit, "front" just above it; the scale bar bottom right on the same margin.
 */
export function VisceralPlate({
  params,
  compareTo,
  label,
  decorative = false,
}: {
  params: AvatarParams;
  compareTo?: AvatarParams;
  label: string;
  decorative?: boolean;
}) {
  const v = useVisceralTween(params.visceral);
  return (
    <div className="lm-visc__plate">
      <VisceralLocator />
      <ul className="lm-visc__key" aria-hidden="true">
        {params.visceral.thresholdsCm2.map((t) => (
          <li key={t} data-tag={t}>
            <svg viewBox="0 0 16 2" focusable="false">
              <line className="lm-visc__ref" data-ref={t} x1="0" y1="1" x2="16" y2="1" />
            </svg>
            {t} cm²
          </li>
        ))}
      </ul>
      <div className="lm-visc__fit">
        <SliceDrawing v={v} ghost={compareTo ? compareTo.visceral : null} decorative={decorative} label={label} />
      </div>
    </div>
  );
}

/**
 * Numbers, band scale and legend (plain words, R2 sec. 3.4 item 3; body-figure-v2.md §6.3-6.4). When the likely range
 * crosses a threshold the line under the scale says what it spans, never a single confident word over a wide range.
 */
export function VisceralLegend({
  params,
  compareTo,
  caption,
  how,
  waistMeasured,
}: {
  params: AvatarParams;
  compareTo?: AvatarParams;
  /** Short note beside Details ("Drawn to scale from your estimate, not a scan …"). */
  caption?: ReactNode;
  /** How the number is made, with a link to the evidence (inside Details). */
  how?: ReactNode;
  /**
   * Whether a waist measurement sets the slice. true: the readout never asks for one. false: it says once that one
   * narrows the range, even when the range stays in one band. Unset: only when the range crosses a band.
   */
  waistMeasured?: boolean;
}) {
  const v = liveVisceral(params.visceral);
  const [t1, t2] = v.thresholdsCm2;
  const [lo, hi] = v.areaRangeCm2;
  const max = Math.max(200, Math.ceil((hi * 1.08) / 50) * 50);
  const at = (x: number) => Math.min(100, Math.max(0, (100 * x) / max));
  const estAt = hi > lo ? Math.min(100, Math.max(0, (100 * (v.vatAreaCm2 - lo)) / (hi - lo))) : 50;
  const barStyle = {
    '--vs-t1': pct(at(t1)),
    '--vs-t2': pct(at(t2)),
  } as CSSProperties;
  const bandMid = [at(t1) / 2, (at(t1) + at(t2)) / 2, (at(t2) + 100) / 2];
  const kg = Number.isFinite(v.vatKg) ? v.vatKg.toFixed(1) : '?';
  const span = rangeSpanWords(v);
  const narrows = waistMeasured === true ? '' : 'A waist measurement narrows it.';
  return (
    <div className="lm-visc__readout">
      <p className="lm-visc__number">
        Deep fat around the organs: <strong>about {roundArea(v.vatAreaCm2)} cm²</strong>{' '}
        <span className="lm-visc__range">
          (likely {roundArea(lo)}–{roundArea(hi)})
        </span>
      </p>
      <div className="lm-visc__scalebar">
        <div className="lm-visc__ticks" aria-hidden="true">
          <span style={{ left: pct(at(t1)) }}>{t1}</span>
          <span style={{ left: pct(at(t2)) }}>{t2}</span>
        </div>
        <div className="lm-visc__bar" style={barStyle} aria-hidden="true">
          <span
            className="lm-visc__bar-range"
            style={{ left: pct(at(lo)), width: pct(at(hi) - at(lo)), '--vs-est': pct(estAt) } as CSSProperties}
          />
          <span className="lm-visc__bar-mark" data-testid="visc-mark" style={{ left: pct(at(v.vatAreaCm2)) }} />
        </div>
        {/* each band's word under its own stretch of the scale; the words read "typical · raised · high" in order */}
        <p className="lm-visc__bands">
          {BAND_WORDS.map((b, i) => (
            <span key={b} className="lm-visc__band" style={{ left: pct(bandMid[i]!) }}>
              {i > 0 ? <span className="lm-sr"> · </span> : null}
              <span data-current={b === v.band ? '' : undefined}>{b}</span>
            </span>
          ))}
        </p>
      </div>
      {span ? (
        <p className="lm-visc__span" data-testid="visc-span">
          {span.charAt(0).toUpperCase() + span.slice(1)}.{narrows ? ` ${narrows}` : ''}
        </p>
      ) : waistMeasured === false ? (
        <p className="lm-visc__span" data-testid="visc-narrows">
          A waist measurement narrows the range.
        </p>
      ) : null}
      {/* the layer names match the 3D figure's layer switches */}
      <ul className="lm-visc__legend">
        <li>
          <span className="lm-visc__swatch" data-k="deep" />
          Fat around organs
        </li>
        <li>
          <span className="lm-visc__swatch" data-k="sat" />
          Fat under skin
        </li>
        <li>
          <span className="lm-visc__swatch" data-k="wall" />
          Muscle
        </li>
        <li>
          <span className="lm-visc__swatch" data-k="organs" />
          Bowel and organs
        </li>
        <li>
          <span className="lm-visc__swatch" data-k="range" />
          Likely range
        </li>
        <li>
          <span className="lm-visc__swatch" data-k="ring" />
          {t1} and {t2} cm² outlines
        </li>
        {compareTo ? (
          <li>
            <span className="lm-visc__swatch" data-k="ghost" />
            Grey lines: the start
          </li>
        ) : null}
      </ul>
      <div className="lm-visc__foot">
        <details className="lm-visc__details">
          <summary>Details</summary>
          <p>
            Deep fat about {kg} kg in the whole belly. This waist slice shows about {roundArea(v.vatAreaCm2)} cm² of
            it, about {roundArea(v.satAreaCm2)} cm² of fat under the skin and about {roundArea(v.wallAreaCm2)} cm² of
            muscle. The slice is at about the navel, seen from below as on a scan: the front of the body is at the top,
            your right on the left. The deep fat sits between the bowel loops; the soft band around it is the likely
            range. Estimates from your inputs, not a scan.
          </p>
          <p>
            Under {t1} cm² is typical, {t1} to {t2} raised, {t2} and over high. The bands are the same for everyone.
            Your estimate already allows for your basics and ancestry.
          </p>
          {how ? <p>{how}</p> : null}
        </details>
        {caption ? <p className="lm-visc__note">{caption}</p> : null}
      </div>
    </div>
  );
}

/** True-to-scale waist slice with words, on its own (one image; the view composes the same parts). */
export function VisceralSection({
  params,
  compareTo,
  legend = true,
  label,
  decorative = false,
  className,
}: VisceralSectionProps) {
  const name = label ?? visceralWords(liveVisceral(params.visceral));
  return (
    <figure className={['lm-visc', 'lm-visc__section', className].filter(Boolean).join(' ')}>
      <VisceralPlate params={params} compareTo={compareTo} label={name} decorative={decorative} />
      {legend ? (
        <figcaption>
          <VisceralLegend params={params} compareTo={compareTo} />
        </figcaption>
      ) : null}
    </figure>
  );
}
