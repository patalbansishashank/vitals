/**
 * Heart-rate zones of one activity (§V4.3, §V2.2): `hr-zones/1` over the window's supported HR (each raw reading's own
 * interval when the evidence carries them, else the minute means, and the chart says which: Codex #11), with the person's
 * frozen boundaries (%HRmax by Tanaka until a waking resting HR is entered, D6). Zone minutes as a share bar, then the
 * highest held reading, the average and the time without a reading; time above the configured maximum is its own row. Never Gauge's own 220 − age zone seconds.
 * Quiet mode (0.6.3 INT): the zones by name and their shares in words, no bpm, minutes or percentages (aria too).
 */
import { ShareBar, durationText, formatNumber, type ShareBarRow } from '@/components';
import { zoneTime, type ZoneBoundaries } from '@/living/sensors';
import { windowHrSegments, type WindowMinutes } from '@/living/activityCandidates';
import { QUIET_ZONE_EDGES, aboveMaxText, quietZoneLabel } from '@/features/lib/zoneRange';
import { ACTIVITY_COPY as C } from '../copy';

const ZONE_HUE = ['var(--lm-hr-zone-1)', 'var(--lm-hr-zone-2)', 'var(--lm-hr-zone-3)', 'var(--lm-hr-zone-4)', 'var(--lm-hr-zone-5)'];

/**
 * (r068 V10) One format for every zone row of the sheet: whole beats, both ends held ("145–162 bpm"; a reading of 162.5
 * rounds into the zone that holds it), so the rows never mix "163–181 bpm" with "145 to under 163 bpm".
 */
export function zoneRowRange(edges: readonly number[], z: number): string {
  const lo = Math.round(edges[z]!);
  const hi = z === 4 ? Math.round(edges[5]!) : Math.round(edges[z + 1]!) - 1;
  return `${lo}–${Math.max(lo, hi)} bpm`;
}

export function HrZoneChart({
  window,
  minutes,
  boundaries,
  pauses,
  quiet = false,
}: {
  window: { start: number; end: number };
  minutes: WindowMinutes | null | undefined;
  boundaries: ZoneBoundaries | null;
  pauses?: ReadonlyArray<{ start: number; end: number }>;
  /** (0.6.3 INT) words only, aria too: zones by name, shares as words, no heart-rate figures. */
  quiet?: boolean;
}) {
  const { segments, source } = windowHrSegments(minutes, window);
  if (!boundaries || segments.length === 0) return <p className="lv-act__fact">{C.noHr}</p>;
  const z = zoneTime({ window, segments, boundaries, ...(pauses?.length ? { pauses } : {}), ...(source ? { hrSource: source } : {}) });
  const moving = Math.max(1, z.elapsedS - z.pausedS);
  const rows: ShareBarRow[] = [
    ...z.zonesS.map((s, i) => ({ id: `z${i + 1}`, label: quiet ? quietZoneLabel(i) : `Zone ${i + 1} · ${zoneRowRange(boundaries.edgesBpm, i)}`, valueText: durationText(s / 60), share: s / moving, hue: ZONE_HUE[i]! })).reverse(),
    // (UI audit #23) supported time above the configured maximum is its own row, so the rows add up to the moving time
    ...(z.aboveEstimateS > 0 ? [{ id: 'above', label: quiet ? QUIET_ZONE_EDGES.above : `Above your maximum · ${aboveMaxText(boundaries)}`, valueText: durationText(z.aboveEstimateS / 60), share: z.aboveEstimateS / moving, hue: 'var(--lm-hr-zone-5)' }] : []),
    ...(z.below50S > 0 ? [{ id: 'below', label: quiet ? QUIET_ZONE_EDGES.below : 'Under zone 1', valueText: durationText(z.below50S / 60), share: z.below50S / moving, hue: 'var(--lm-ink-3)' }] : []),
    ...(z.unknownS > 0 ? [{ id: 'unknown', label: 'No reading', valueText: durationText(z.unknownS / 60), share: z.unknownS / moving, hue: 'var(--lm-raised)', unknown: true }] : []),
  ];
  return (
    <div className="lv-act__zones">
      <ShareBar label={C.heartRate} rows={rows} size="sm" note={C.zonesBasis[boundaries.basis]} shareOf="of the activity" quiet={quiet} />
      {/* (r068 V10) which readings timed the zones is said only when it matters (minute averages); never a line of method */}
      {/* (r068 G8) the three figures as one key-value list: no orphan cell on a narrow sheet */}
      {quiet ? null : (
        <dl className="lv-kv">
          {(
            [
              [C.peak, z.observedPeakBpm !== null ? formatNumber(z.observedPeakBpm, 0) : null, 'bpm'],
              [C.mean, z.meanBpm !== null ? formatNumber(z.meanBpm, 0) : null, 'bpm'],
              ...(z.coveragePct !== null && z.coveragePct < 99.5 ? [[C.hrCovered, formatNumber(z.coveragePct, 0), '%'] as const] : []),
            ] as const
          ).map(([k, v, u]) => (
            <div key={k} className="lv-kv__row">
              <dt>{k}</dt>
              <dd className="lm-num">
                {v ?? '—'}
                {v !== null ? <span className="lm-unit">{u}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
