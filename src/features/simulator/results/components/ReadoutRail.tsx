/**
 * Start → end strip (simulator-results.md §6): one flush faceplate of readouts divided by hairlines — engraved name
 * with category swatch (a button: opens Explain), "24.1 → 19.7 kg", the signed change, the likely range on a printed
 * range gauge, and the evidence grade. Pinned metrics join at the end (`PinMetricMenu` pins one).
 * Never run: every readout shows "—".
 */
import { useMemo } from 'react';
import { Pin, Plus } from 'lucide-react';
import { GradeBadge, Menu, ReadoutStrip, formatNumber, formatSigned, type ReadoutStripItem, type MenuItem } from '@/components';
import type { DisplayMetric } from '../lib/metrics';
import type { ReadoutDatum } from '../lib/readouts';

export interface ReadoutRailProps {
  readouts: readonly ReadoutDatum[];
  /** Ids shown as "—" (never run) with their catalogue names. */
  placeholders?: ReadonlyArray<Pick<DisplayMetric, 'id' | 'shortLabel' | 'category' | 'unit'>>;
  pinnedIds: readonly string[];
  onExplain?: (id: string) => void;
  /** Roll the digits (a new result arrived). */
  animate?: boolean;
  /** Caption under the "—" placeholders (default: never run). */
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

export function ReadoutRail({ readouts, placeholders, pinnedIds, onExplain, animate, placeholderCaption = 'run to see the projection' }: ReadoutRailProps) {
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
      const caption = (
        <span className="rs-strip__meta">
          <GradeBadge grade={r.grade} size="sm" onClick={onExplain ? () => onExplain(r.id) : undefined} />
          {Number.isFinite(r.pctChange) ? <span className="rs-strip__pct">{formatSigned(r.pctChange, Math.abs(r.pctChange) < 10 ? 1 : 0)} %</span> : null}
          {r.wide ? <span className="rs-strip__wide">wide range</span> : null}
        </span>
      );
      const pinned = pinnedIds.includes(r.id);
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

  return <ReadoutStrip items={items} label="Start to end" className="rs-strip" />;
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
