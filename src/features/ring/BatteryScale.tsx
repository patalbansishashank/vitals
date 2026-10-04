/**
 * The ring's battery as a printed 10-segment scale (design/screens/ring-pages.md §5.2): segments 4 × 10 px with 2 px
 * gaps, ink fill, empty segments are wells; the value follows in wide tabular figures. At 15 % or less the scale and
 * value stay ink and a caution mark with "low · charge it soon" follows (never red).
 */
import { Icon } from '@/components/icons/Icon';
import { CautionMark } from '@/components/icons/glyphs';
import { RING_PAGE_COPY, percent } from './copy';

export const LOW_BATTERY = 15;

export interface BatteryScaleProps {
  /** 0–100; undefined when the ring has not been read yet. */
  value?: number;
  charging?: boolean;
  /** "when last read" after the value (the ring is not connected now). */
  lastKnown?: boolean;
}

const C = RING_PAGE_COPY.card;

export function BatteryScale({ value, charging, lastKnown }: BatteryScaleProps) {
  if (value === undefined || !Number.isFinite(value)) return <span className="rg-batt__none">{C.batteryUnknown}</span>;
  const v = Math.max(0, Math.min(100, value));
  const lit = v > 0 ? Math.max(1, Math.round(v / 10)) : 0;
  const low = v <= LOW_BATTERY;
  return (
    <span className="rg-batt" data-low={low || undefined}>
      <span className="rg-batt__scale" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="rg-batt__seg" data-on={i < lit || undefined} />
        ))}
      </span>
      <span className="rg-batt__value lm-num">{percent(v)}</span>
      {low ? (
        <span className="rg-batt__low">
          <Icon icon={CautionMark} size={16} className="rg-caution" />
          <span>{C.batteryLow}</span>
        </span>
      ) : null}
      {charging ? <span className="rg-batt__note">· {C.batteryCharging}</span> : null}
      {lastKnown ? <span className="rg-batt__note">· {C.batteryWhenLastRead}</span> : null}
    </span>
  );
}
