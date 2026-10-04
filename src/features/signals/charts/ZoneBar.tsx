/**
 * Time in zones as one horizontal stacked bar (ring-pages.md §7.4.2): segments in the zone ramp with 2 px gaps, a
 * label "zone 2 · 24 min" under each segment at least 40 px wide, every zone in the table twin. `mini` is the 64 px
 * bar of the workouts list: no labels, `role="img"` with a text summary. The resting range is not a zone and is not
 * drawn.
 */
import { useId, useRef, useState } from 'react';
import { Engraved, Key } from '@/components';
import { THIN_SPACE } from '@/components/lib/format';
import { useElementWidth } from '@/features/charts/core/hooks';
import { HEART_COPY as C } from './copyHeart';
import { SHELL_COPY, TwinTable } from './kit';
import { ZONE_WORD, type Zone } from './zones';
import './heart.css';

export interface ZoneBarProps {
  /** Minutes per zone, index 0 = resting range (not drawn), 1..5 = zones. */
  minutes: readonly number[];
  mini?: boolean;
  /** Engraved label above the full bar (default "time in zones"); null hides it. */
  title?: string | null;
}

const ZONES = [1, 2, 3, 4, 5] as const;
const GAP = 2;
const LABEL_MIN_PX = 40;

/** The zones with time, in order. */
function parts(minutes: readonly number[]): Array<{ zone: Zone; min: number }> {
  return ZONES.map((z) => ({ zone: z as Zone, min: Math.max(0, Math.round(minutes[z] ?? 0)) })).filter((p) => p.min > 0);
}

/** "zone 2 · steady 24 min, zone 3 · moderate 10 min". */
export function zoneBarSummary(minutes: readonly number[]): string {
  const ps = parts(minutes);
  if (!ps.length) return C.noZoneTime;
  return C.zoneSummary(ps.map((p) => `zone ${p.zone} · ${ZONE_WORD[p.zone]} ${C.min(p.min)}`));
}

export function ZoneBar({ minutes, mini, title = C.title.zones }: ZoneBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const measured = useElementWidth(ref, 320);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const ps = parts(minutes);
  const total = ps.reduce((a, p) => a + p.min, 0);
  const summary = zoneBarSummary(minutes);

  if (mini) {
    return (
      <span className="hr-zonebar" data-mini="true" role="img" aria-label={summary}>
        {total > 0 ? (
          <span className="hr-zonebar__track">
            {ps.map((p) => (
              <span key={p.zone} className="hr-zonebar__seg" data-zone={p.zone} style={{ flexGrow: p.min, flexBasis: 0 }} />
            ))}
          </span>
        ) : (
          <span className="hr-zonebar__well" />
        )}
      </span>
    );
  }

  if (total <= 0) return null;
  const width = measured || 320;
  const usable = Math.max(0, width - GAP * (ps.length - 1));
  const widths = ps.map((p) => (p.min / total) * usable);
  const placed = ps.map((p, i) => ({ ...p, w: widths[i]!, x: widths.slice(0, i).reduce((a, b) => a + b + GAP, 0) }));
  const rows = ZONES.map((z) => {
    const m = Math.max(0, Math.round(minutes[z] ?? 0));
    return [`zone ${z} · ${ZONE_WORD[z]}`, C.min(m), `${Math.round((m / total) * 100)}${THIN_SPACE}%`];
  });
  return (
    <div ref={ref} className="hr-zonebar">
      <div className="hr-zonebar__head">
        {title ? (
          <Engraved as="p" className="hr-zonebar__title">
            {title}
          </Engraved>
        ) : (
          <span />
        )}
        <Key size="sm" variant="quiet" aria-label={C.zoneTableKey(showTable)} aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((v) => !v)}>
          {showTable ? SHELL_COPY.hideTable : SHELL_COPY.table}
        </Key>
      </div>
      <div className="hr-zonebar__track" role="img" aria-label={summary}>
        {placed.map((p) => (
          <span key={p.zone} className="hr-zonebar__seg" data-zone={p.zone} style={{ flexGrow: p.min, flexBasis: 0 }} />
        ))}
      </div>
      <div className="hr-zonebar__labels" aria-hidden="true">
        {placed
          .filter((p) => p.w >= LABEL_MIN_PX)
          .map((p) => (
            <span key={p.zone} className="hr-zonebar__label" data-zone-label={p.zone} style={{ left: p.x }}>
              {p.w >= 96 ? (
                C.zoneMinutes(p.zone, p.min)
              ) : (
                <>
                  <span>{`zone ${p.zone}`}</span>
                  <span>{C.min(p.min)}</span>
                </>
              )}
            </span>
          ))}
      </div>
      {showTable ? (
        <div id={tableId}>
          <TwinTable caption={C.zoneTable} head={C.zoneCols} rows={rows} />
        </div>
      ) : null}
    </div>
  );
}
