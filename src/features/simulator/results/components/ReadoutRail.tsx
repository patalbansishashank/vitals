/**
 * Projection end values with their model-variation ranges at every width. Start and change stay as secondary facts.
 * The metric name and (i) open the existing Explain drawer; C6 statuses and acknowledgement placeholders keep their
 * words instead of exposing a value. Pinned metrics follow the five defaults.
 */
import { useMemo } from 'react';
import { Pin, Plus } from 'lucide-react';
import {
  GradeBadge,
  GradientCard,
  HeroNumber,
  InfoKey,
  Menu,
  MonoMeta,
  OverflowText,
  formatNumber,
  formatRange,
  formatSigned,
  type ReadoutStripItem,
  type MenuItem,
  type Domain,
} from '@/components';
import type { DisplayMetric } from '../lib/metrics';
import { qualifierWord, type ReadoutDatum } from '../lib/readouts';

export interface ReadoutRailProps {
  readouts: readonly ReadoutDatum[];
  /** Ids shown as "—" (acknowledgement pending) with their catalogue names. */
  placeholders?: ReadonlyArray<Pick<DisplayMetric, 'id' | 'shortLabel' | 'category' | 'unit'>>;
  pinnedIds: readonly string[];
  onExplain?: (id: string) => void;
  /** Roll the digits (a new result arrived). */
  animate?: boolean;
  /** Caption under the "—" placeholders. */
  placeholderCaption?: string;
}

function Name({ r, onExplain, pinned }: { r: Pick<ReadoutDatum, 'id' | 'shortLabel' | 'label'>; onExplain?: (id: string) => void; pinned?: boolean }) {
  return (
    <button type="button" className="rs-strip__name" onClick={() => onExplain?.(r.id)} aria-label={`${r.label}: explain`}>
      {r.shortLabel}
      {pinned ? <Pin className="rs-strip__pin" size={11} strokeWidth={1.75} aria-label="pinned" /> : null}
    </button>
  );
}

export function ReadoutRail({ readouts, placeholders, pinnedIds, onExplain, animate, placeholderCaption }: ReadoutRailProps) {
  const items = useMemo<ReadoutStripItem[]>(() => {
    if (placeholders) {
      return placeholders.map((p) => ({
        id: p.id,
        label: <span className="rs-strip__name rs-strip__name--static">{p.shortLabel}</span>,
        value: null,
        unit: p.unit,
        category: p.category,
        unknownCaption: placeholderCaption,
      }));
    }
    return readouts.map((r) => {
      const unit = r.unit === 'index' ? undefined : r.unit;
      const pinned = pinnedIds.includes(r.id);
      // C6: a status that forbids reading the value shows its word where the number would be (never 0, NaN or the last
      // value carried forward); the Explain sheet says why
      if (r.statusText) {
        return {
          id: r.id,
          label: <Name r={r} onExplain={onExplain} pinned={pinned} />,
          value: null,
          unit,
          category: r.category,
          // D7-02: an accepted measurement stays visible as measured at the start; the status covers the forecast
          unknownCaption: r.measuredStart !== undefined ? `${formatNumber(r.measuredStart, r.decimals)}${r.measuredUnit && r.measuredUnit !== 'index' ? ` ${r.measuredUnit}` : ''} at start · ${r.statusText}` : r.statusText,
        };
      }
      const word = qualifierWord(r);
      const caption = (
        <span className="rs-strip__meta">
          <GradeBadge grade={r.grade} size="sm" onClick={onExplain ? () => onExplain(r.id) : undefined} />
          {/* a scenario, limited, partial or exploratory estimate carries its status word beside the number (C6) */}
          {word ? <span className="rs-strip__wide">{word}</span> : null}
          {Number.isFinite(r.pctChange) && r.status !== 'exploratory' ? <OverflowText className="rs-strip__pct" text={`${formatSigned(r.pctChange, Math.abs(r.pctChange) < 10 ? 1 : 0)} %`} /> : null}
          {r.wide ? <span className="rs-strip__wide">wide range</span> : null}
        </span>
      );
      if (r.relative) {
        return {
          id: r.id,
          label: <Name r={r} onExplain={onExplain} pinned={pinned} />,
          value: r.end,
          decimals: r.decimals,
          unit,
          format: (v: number) => formatSigned(v, r.decimals),
          range: r.range,
          category: r.category,
          animate,
          caption,
        };
      }
      return {
        id: r.id,
        label: <Name r={r} onExplain={onExplain} pinned={pinned} />,
        value: r.end,
        from: r.start,
        decimals: r.decimals,
        unit,
        format: (v: number) => formatNumber(v, r.decimals),
        range: r.range,
        category: r.category,
        animate,
        caption,
      };
    });
  }, [readouts, placeholders, pinnedIds, onExplain, animate, placeholderCaption]);

  return (
    <section className="rs-strip rs-readouts" aria-label="Start to end">
      {items.map(
        (
          { id, label, value, unit, decimals = 0, from, format, range, caption, unknownCaption, category },
          i,
        ) => {
          const domain: Domain =
            category === 'energy'
              ? 'energy'
              : category === 'performance'
                ? 'steps'
                : category === 'cardio'
                  ? 'heart'
                  : category === 'recovery'
                    ? 'recovery'
                    : category === 'hormones'
                      ? 'sleep'
                      : category === 'cellular'
                        ? 'food'
                        : 'body';
          const fmt = format ?? ((v: number) => formatNumber(v, decimals));
          const known = value !== null && Number.isFinite(value);
          const withUnit = (text: string) => `${text}${unit ? ` ${unit}` : ''}`;
          const rangeValue = range ? withUnit(formatRange(range[0], range[1], decimals)) : null;
          const rangeText = rangeValue ? `range ${rangeValue}` : 'No range';
          return (
            <GradientCard
              key={id}
              domain={domain}
              size="tile"
              className="rs-readout"
              animate={animate}
              aria-label={placeholders?.[i]?.shortLabel ?? readouts[i]?.label ?? id}
            >
              <div className="rs-readout__head">
                <span className="rs-readout__name">{label}</span>
                {onExplain && !placeholders ? (
                  <InfoKey label={`About ${readouts[i]?.label ?? id}`} onClick={() => onExplain(id)} />
                ) : null}
              </div>
              <div className="rs-readout__value">
                <HeroNumber
                  value={known ? value : null}
                  format={fmt}
                  decimals={decimals}
                  unit={known ? unit : undefined}
                  size={i === 0 ? 'num-l' : 'num'}
                  animate={animate}
                  label={
                    known
                      ? `${fmt(value!)}${unit ? ` ${unit}` : ''}, ${rangeText}`
                      : typeof unknownCaption === 'string'
                        ? unknownCaption
                        : 'Unknown'
                  }
                />
              </div>
              {known ? (
                <MonoMeta tone="hue" className="rs-readout__range rs-readout__fact" aria-hidden="true">
                  {rangeValue ? <><span>range</span>{' '}<OverflowText text={rangeValue} /></> : 'No range'}
                </MonoMeta>
              ) : null}
              {known && from !== undefined ? (
                <MonoMeta className="rs-readout__start">
                  <span className="rs-readout__fact"><span>Start</span>{' '}<OverflowText text={withUnit(fmt(from))} /></span>{' '}
                  <span className="rs-readout__fact"><span>Change</span>{' '}<OverflowText text={withUnit(formatSigned(value! - from, decimals))} /></span>
                </MonoMeta>
              ) : null}
              {!known && unknownCaption ? (
                <span className="rs-readout__unknown">{unknownCaption}</span>
              ) : null}
              {caption}
            </GradientCard>
          );
        },
      )}
    </section>
  );
}

/** "+ Pin a metric" (desktop): pins a channel to the end of the strip. */
export function PinMetricMenu({ pinnable, pinnedIds, onPin }: { pinnable: ReadonlyArray<{ id: string; label: string }>; pinnedIds: readonly string[]; onPin: (id: string) => void }) {
  const items: MenuItem[] = useMemo(() => pinnable.filter((m) => !pinnedIds.includes(m.id)).map((m) => ({ id: m.id, label: m.label, onSelect: () => onPin(m.id) })), [pinnable, pinnedIds, onPin]);
  if (!items.length) return null;
  return (
    <span className="rs-pinslot">
      <Menu
        label="Pin a metric to the strip"
        placement="bottom-end"
        items={items}
        trigger={(t) => (
          <button type="button" className="rs-pinkey" {...t}>
            <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
            <span>Pin a metric</span>
          </button>
        )}
      />
    </span>
  );
}
