/**
 * <ScoreTile>, <BaselineGauge> and <SignalsStrip> (COMPONENTS §13.14; design/screens/scores.md §3–§4).
 * Tiles live inside ONE faceplate as a strip (one column on mobile) or a 3-column grid (≥ 1024) with hairlines between
 * cells — never separate cards or KPI tiles. Every value carries its version, evidence grade, likely range or normal,
 * the device it came from and the device's tier; tier C heart-rate variability, autonomic load, SpO2 and temperature
 * show change from your normal only, never an absolute number. Flags show a status mark and a word, never a level code.
 * The tile renders what the scores source gives; it computes nothing.
 */
import { useMemo, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Chip, EmptyStage, Faceplate, GradeBadge, Key, KeyLink, StatusMark, cx, formatNumber, formatSigned, niceStep, scaleTicks, EN_DASH, EM_DASH } from '@/components';
import type { ScoreTileModel } from '../data/scores';
import { fmtHours } from '../format';
import { livingPaths } from '../paths';
import { SCORE_COPY as C } from '../progress/copy';
import './ScoreTile.css';

/* ------------------------------------------------------------------ helpers */

/** Score families a tier C device may only show as change from your normal. */
const RELATIVE_FAMILIES = /^(hrv|autonomic|spo2|temp)\./;

/** True when the tile must never show an absolute number (tier C on HRV, autonomic load, SpO2, temperature). */
export function isRelativeOnly(tile: Pick<ScoreTileModel, 'scoreId' | 'trendOnly' | 'device'>): boolean {
  return !!tile.trendOnly || (tile.device?.tier === 'C' && RELATIVE_FAMILIES.test(tile.scoreId));
}

function fmtValue(v: number, unit: string, decimals: number): string {
  if (unit === 'h') return fmtHours(v);
  return `${formatNumber(v, decimals)}${unit ? ` ${unit}` : ''}`;
}

function fmtRange(lo: number, hi: number, unit: string, decimals: number): string {
  if (unit === 'h') return `${fmtHours(lo)}${EN_DASH}${fmtHours(hi)}`;
  return `${formatNumber(lo, decimals)}${EN_DASH}${formatNumber(hi, decimals)}`;
}

const FLAG_MARK = { yellow: 'info', amber: 'caution', red: 'caution' } as const;

/** "ring · Colmi R10 · tier C · trend only". */
export function provenanceText(tile: ScoreTileModel): string | null {
  if (!tile.device) return null;
  const parts: string[] = [tile.device.kind, tile.device.name, C.tier(tile.device.tier)];
  if (isRelativeOnly(tile)) parts.push(C.trendOnly);
  return parts.join(' · ');
}

/** The value line as text (number display), honouring relative-only and quiet mode (indices as words). */
function valueLine(tile: ScoreTileModel, relative: boolean, quiet = false): { main: string; rest: string[] } {
  const rest: string[] = [];
  if (tile.status === 'withheld' || tile.value === null) return { main: EM_DASH, rest };
  if (quiet && tile.quietWord) return { main: tile.quietWord, rest: tile.line ? [tile.line] : [] };
  if (relative) {
    return { main: tile.vsNormalText ?? C.changeOnly, rest: tile.line ? [tile.line] : [] };
  }
  const main = `${fmtValue(tile.value, tile.unit, tile.decimals)}${tile.valueSuffix ? ` ${tile.valueSuffix}` : ''}`;
  if (tile.band) rest.push(C.likely(fmtRange(tile.band.lo, tile.band.hi, tile.unit, tile.decimals)));
  if (tile.line) rest.push(tile.line);
  if (tile.vsNormalText) rest.push(tile.vsNormalText);
  return { main, rest };
}

/** The value line of a number display: main text + the parts after it (range, line, vs normal). Relative-only aware. */
export function scoreValueText(tile: ScoreTileModel, quiet = false): { main: string; rest: string[] } {
  return valueLine(tile, isRelativeOnly(tile), quiet);
}

/** "7-day 42 ms · normal 38–47 ms" (or the change-from-normal text for relative-only tiles). */
function gaugeCaption(tile: ScoreTileModel, relative: boolean): string | null {
  if (relative) return tile.vsNormalText ?? null;
  const parts: string[] = [];
  if (tile.mean7 !== undefined) parts.push(C.sevenDay(fmtValue(tile.mean7, tile.unit, tile.decimals)));
  if (tile.normal && tile.status !== 'insufficient_baseline') parts.push(C.normal(`${fmtRange(tile.normal.lo, tile.normal.hi, tile.unit, tile.decimals)}${tile.unit && tile.unit !== 'h' ? ` ${tile.unit}` : ''}`));
  return parts.length ? parts.join(' · ') : null;
}

/** The full sentence a screen reader hears for a tile (scores.md §12). */
export function scoreSentence(tile: ScoreTileModel, quiet = false): string {
  const relative = isRelativeOnly(tile);
  const name = tile.title.charAt(0).toUpperCase() + tile.title.slice(1);
  const parts: string[] = [];
  if (tile.flag) parts.push(`${tile.flag.word}${tile.flag.nights ? `, ${C.nights(tile.flag.nights)}` : ''}`);
  else if (tile.status === 'withheld' && tile.withheld) parts.push(`no value yet, ${C.needs(tile.withheld.needed, tile.withheld.have, tile.withheld.unit)}`);
  else if (tile.display === 'state' || tile.display === 'band') {
    if (tile.status !== 'insufficient_baseline' && tile.state) parts.push(tile.state);
    const cap = gaugeCaption(tile, relative);
    if (cap) parts.push(cap);
  } else {
    const v = valueLine(tile, relative, quiet);
    parts.push([v.main, ...v.rest].join(', '));
  }
  if (tile.status === 'insufficient_baseline' && tile.baselineForming) parts.push(C.forming(tile.baselineForming.have, tile.baselineForming.needed));
  if (tile.kind === 'index') parts.push(C.indexChip);
  if (tile.kind === 'estimate') parts.push(C.estimateChip);
  const prov = provenanceText(tile);
  if (prov) parts.push(prov);
  if (tile.vendor) parts.push(`${C.vendor(tile.vendor.name, tile.vendor.says)}, ${C.vendorLabel}`);
  parts.push(C.versionSpoken(tile.version, tile.grade));
  return `${name}: ${parts.join('. ')}.`;
}

/* ------------------------------------------------------------------ BaselineGauge */

export interface BaselineGaugeProps {
  /** Domain of the printed scale. */
  min: number;
  max: number;
  /** The personal normal range: a 6 px band, ink at 18 %. */
  normal: { lo: number; hi: number };
  /** 7-day mean: a 2 px ink bar. */
  mean7?: number;
  /** Last night: a hollow 6 px dot. */
  lastNight?: number;
  /** Borderline: the 7-day mean's likely range as a thin bracket straddling a band edge. */
  borderline?: { lo: number; hi: number };
  /** Optional population reference ticks ("median 81"). */
  references?: ReadonlyArray<{ value: number; label: string }>;
  /** 160–320 px (detail: 320). */
  width?: number;
  unit: string;
  decimals: number;
  className?: string;
}

/** Printed tick scale with the normal band, the 7-day mean and last night — a text equivalent rides along. */
export function BaselineGauge({ min, max, normal, mean7, lastNight, borderline, references, width = 200, unit, decimals, className }: BaselineGaugeProps) {
  const W = Math.max(160, Math.min(320, width));
  const H = references?.length ? 46 : 34;
  const pad = 10;
  const span = max - min || 1;
  const X = (v: number) => pad + ((Math.min(max, Math.max(min, v)) - min) / span) * (W - 2 * pad);
  const signed = min < 0;
  const fmt = (v: number) => `${signed ? formatSigned(v, decimals) : formatNumber(v, decimals)}${unit === '%' ? ' %' : ''}`;
  const ticks = useMemo(() => {
    const major = niceStep(span, 4);
    const pxPerMajor = ((W - 2 * pad) * major) / span;
    return scaleTicks(min, max, pxPerMajor >= 16 ? major / 2 : major, major, 60);
  }, [min, max, span, W]);
  const unitText = unit && unit !== '%' && unit !== 'h' ? ` ${unit}` : '';
  const label = [
    `${C.gaugeNormal} ${fmt(normal.lo)} to ${fmt(normal.hi)}${unitText}`,
    mean7 !== undefined ? `${C.gaugeMean} ${fmt(mean7)}${unitText}` : null,
    lastNight !== undefined ? `${C.gaugeLast} ${fmt(lastNight)}${unitText}` : null,
    borderline ? C.gaugeBorderline : null,
  ]
    .filter(Boolean)
    .join('; ');
  const close = X(normal.hi) - X(normal.lo) < 26;
  return (
    <svg className={cx('lv-gauge', className)} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <line className="lv-gauge__axis" x1={X(min)} x2={X(max)} y1={12.5} y2={12.5} />
      {ticks.map((t) => (
        <line key={t.value} className="lv-gauge__tick" data-major={t.major} x1={Math.round(X(t.value)) + 0.5} x2={Math.round(X(t.value)) + 0.5} y1={16} y2={t.major ? 21 : 19} />
      ))}
      <rect className="lv-gauge__normal" x={X(normal.lo)} y={9.5} width={Math.max(1, X(normal.hi) - X(normal.lo))} height={6} />
      {borderline ? <path className="lv-gauge__bracket" d={`M${X(borderline.lo)} 7V3H${X(borderline.hi)}V7`} /> : null}
      {mean7 !== undefined ? <rect className="lv-gauge__mean" x={X(mean7) - 1} y={5} width={2} height={15} /> : null}
      {lastNight !== undefined ? <circle className="lv-gauge__last" cx={X(lastNight)} cy={12.5} r={3} /> : null}
      <text className="lv-gauge__num" x={X(normal.lo) - (close ? 2 : 0)} y={32} textAnchor={close ? 'end' : 'middle'}>
        {fmt(normal.lo)}
      </text>
      <text className="lv-gauge__num" x={X(normal.hi) + (close ? 2 : 0)} y={32} textAnchor={close ? 'start' : 'middle'}>
        {fmt(normal.hi)}
      </text>
      {references?.map((r) => (
        <g key={r.label}>
          <line className="lv-gauge__ref" x1={X(r.value)} x2={X(r.value)} y1={3} y2={22} />
          <text className="lv-gauge__num" x={X(r.value)} y={44} textAnchor="middle">
            {r.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ count scale (withheld) */

/** A printed count, not a ring: `needed` ticks, `have` of them inked. */
export function CountScale({ needed, have, unit }: { needed: number; have: number; unit: string }) {
  const step = 7;
  const W = needed * step + 2;
  return (
    <svg className="lv-count" width={W} height={14} viewBox={`0 0 ${W} 14`} role="img" aria-label={C.countLabel(have, needed, unit)}>
      {Array.from({ length: needed }, (_, i) => {
        const inked = i < have;
        const x = 1.5 + i * step;
        return <line key={i} data-count-tick="" data-inked={inked ? 'true' : 'false'} className="lv-count__tick" x1={x} x2={x} y1={inked ? 1 : 6} y2={13} />;
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ ScoreTile */

export interface ScoreTileProps {
  tile: ScoreTileModel;
  /** Heading level of the tile title (default h3, under the strip's h2). */
  titleAs?: 'h3' | 'h4';
  /** The plan link's Undo (undoes the change card the score made). */
  onUndo?: (changeId: string) => void;
  /** Render as a list item (inside SignalsStrip) or a plain block. */
  as?: 'li' | 'div';
  /** Gauge width (160–240 in tiles). */
  gaugeWidth?: number;
  /** Quiet mode: convenience indices show their word ("about usual"); the other scores stay (they aren't about weight). */
  quiet?: boolean;
  className?: string;
}

export function ScoreTile({ tile, titleAs = 'h3', onUndo, as = 'li', gaugeWidth = 200, quiet = false, className }: ScoreTileProps) {
  const Root = as;
  const Title = titleAs;
  const relative = isRelativeOnly(tile);
  const detail = livingPaths.progress(tile.scoreId);
  const prov = provenanceText(tile);
  const withheld = tile.status === 'withheld';
  const forming = tile.status === 'insufficient_baseline';

  let body: ReactNode;
  if (tile.flag) {
    body = (
      <>
        <p className="lv-score__state lv-score__flag">
          <StatusMark severity={FLAG_MARK[tile.flag.level]} size={16} />
          <span>{tile.flag.word}</span>
        </p>
        {tile.flag.nights ? (
          <p className="lv-score__line">
            {tile.flag.word} · {C.nights(tile.flag.nights)}
          </p>
        ) : null}
      </>
    );
  } else if (withheld) {
    body = (
      <>
        <p className="lv-score__value lm-num">{EM_DASH}</p>
        {tile.withheld ? (
          <div className="lv-score__withheld">
            <span className="lv-score__line">{C.needs(tile.withheld.needed, tile.withheld.have, tile.withheld.unit)}</span>
            <CountScale needed={tile.withheld.needed} have={tile.withheld.have} unit={tile.withheld.unit} />
          </div>
        ) : null}
      </>
    );
  } else if (tile.display === 'state') {
    const caption = gaugeCaption(tile, relative);
    body = (
      <>
        {!forming && tile.state ? <p className="lv-score__state">{tile.state}</p> : null}
        {tile.gauge && tile.normal && !forming ? (
          <BaselineGauge
            min={tile.gauge.min}
            max={tile.gauge.max}
            normal={tile.normal}
            {...(tile.mean7 !== undefined ? { mean7: tile.mean7 } : {})}
            {...(tile.lastNight !== undefined ? { lastNight: tile.lastNight } : {})}
            {...(tile.status === 'borderline' && tile.mean7Range ? { borderline: tile.mean7Range } : {})}
            width={gaugeWidth}
            unit={tile.unit}
            decimals={tile.decimals}
          />
        ) : null}
        {caption ? <p className="lv-score__line">{caption}</p> : null}
      </>
    );
  } else if (tile.display === 'band') {
    body = <p className="lv-score__state">{tile.state ?? EM_DASH}</p>;
  } else {
    const v = valueLine(tile, relative, quiet);
    body = (
      <p className="lv-score__valueline">
        <span className="lv-score__value lm-num">{v.main}</span>
        {v.rest.map((r) => (
          <span key={r} className="lv-score__rest">
            {' · '}
            {r}
          </span>
        ))}
      </p>
    );
  }

  return (
    <Root className={cx('lv-score', className)} data-status={tile.status} data-kind={tile.kind}>
      <span className="lm-sr">{scoreSentence(tile, quiet)}</span>
      <div className="lv-score__head">
        <Title className="lv-score__title lm-eng">
          <Link to={detail} className="lv-score__link">
            {tile.title}
          </Link>
        </Title>
        {tile.kind === 'index' ? <Chip className="lv-score__kind">{C.indexChip}</Chip> : null}
        {tile.kind === 'estimate' ? <Chip className="lv-score__kind">{C.estimateChip}</Chip> : null}
        <span className="lv-score__meta">
          <GradeBadge grade={tile.grade} size="sm" />
          <Link to={`${detail}#versions`} className="lv-score__ver" aria-label={C.versionName(tile.version)}>
            {tile.version}
          </Link>
        </span>
      </div>
      <div className="lv-score__body" aria-hidden="true">
        {body}
        {forming && tile.baselineForming ? <p className="lv-score__line">{C.forming(tile.baselineForming.have, tile.baselineForming.needed)}</p> : null}
        {prov ? <p className="lv-score__prov">{prov}</p> : null}
        {tile.vendor ? (
          <p className="lv-score__vendor">
            {C.vendor(tile.vendor.name, tile.vendor.says)} · {C.vendorLabel}
          </p>
        ) : null}
      </div>
      {tile.planLink ? (
        <p className="lv-score__plan">
          <span>→ {tile.planLink.text}</span>
          {onUndo ? (
            <>
              <span aria-hidden="true"> · </span>
              <Key variant="quiet" size="sm" onClick={() => onUndo(tile.planLink!.changeId)} aria-label={C.undoName(tile.planLink.text)}>
                {C.undo}
              </Key>
            </>
          ) : null}
        </p>
      ) : null}
    </Root>
  );
}

/* ------------------------------------------------------------------ SignalsStrip */

export interface SignalsStripProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  tiles: readonly ScoreTileModel[];
  /** 3 = one column on mobile, a 3-column grid from 1024 px (default); 1 = always one column. */
  columns?: 1 | 3;
  /** Faceplate title (default "Body signals"). */
  title?: string;
  /** Header actions (the scope KeyBank). */
  actions?: ReactNode;
  /** Under the tiles, above a hairline (the quiet "more:" list). */
  footer?: ReactNode;
  onUndo?: (changeId: string) => void;
  /** Quiet mode (indices as words). */
  quiet?: boolean;
  /** Shown instead of the tiles when there are none (default: "No body signals yet." + Add a device). */
  empty?: ReactNode;
}

/** The body-signals faceplate: tiles in one faceplate with hairline dividers. */
export function SignalsStrip({ tiles, columns = 3, title = C.signals, actions, footer, onUndo, quiet = false, empty, className, ...rest }: SignalsStripProps) {
  return (
    <Faceplate variant="flush" title={title} actions={actions} footer={footer} className={cx('lv-signals', className)} aria-label={title} {...rest}>
      {tiles.length === 0 ? (
        <div className="lv-signals__empty">
          {empty ?? (
            <EmptyStage title={C.noSignals} titleAs="h3" perforated={false} art={null} action={<KeyLink to="/settings/devices">{C.addDevice}</KeyLink>}>
              {C.noSignalsBody}
            </EmptyStage>
          )}
        </div>
      ) : (
        <ul className="lv-score-grid" data-columns={columns}>
          {tiles.map((t) => (
            <ScoreTile key={t.scoreId} tile={t} quiet={quiet} {...(onUndo ? { onUndo } : {})} />
          ))}
        </ul>
      )}
    </Faceplate>
  );
}
