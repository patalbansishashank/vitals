/**
 * Coarse preview under the raster (COMPONENTS §5 PreviewStrip): a nominal run in the simulator's preview worker after
 * every stroke (debounced), drawn with the chart module's read-only <PreviewStrip>. Labelled "preview", rounded.
 */
import { useEffect, useState } from 'react';
import type { PersonProfile, Schedule } from '@/engine';
import { PreviewStrip } from '@/features/charts';
import { formatSigned } from '@/components';
import { getSimulationClient, type PreviewSeries } from '@/workers/simulationClient';

const DEBOUNCE_MS = 250;

export function SchedulePreview({
  profile,
  schedule,
  cautions,
}: {
  profile: PersonProfile;
  schedule: Schedule;
  cautions: number;
}) {
  const [data, setData] = useState<{ key: Schedule; series: PreviewSeries } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const id = window.setTimeout(() => {
      getSimulationClient()
        .preview({ ...profile, startDate: schedule.startDate }, schedule)
        .then((series) => {
          if (live) {
            setData({ key: schedule, series });
            setFailed(false);
          }
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [profile, schedule]);

  const pending = !data || data.key !== schedule;
  const fat = data?.series.fatMass;
  const n = fat?.length ?? 0;
  const delta = fat && n > 1 ? fat[n - 1]! - fat[0]! : Number.NaN;
  let ketoDays = 0;
  // engine ketosis state: 0 none · 1 light · 2 nutritional · 3 fasting · 4 warning → strip levels 0–3
  const states = data ? Array.from(data.series.ketosis) : [];
  const keto = states.map((v) => (v >= 1 ? Math.min(3, Math.round(v)) : 0));
  for (const v of states) if (v >= 2) ketoDays++;
  return (
    <div className="sim-preview" data-pending={pending || undefined}>
      <p className="sim-preview__cap">
        <span>
          preview · coarse{pending ? ' · …' : ''}
          {Number.isFinite(delta) ? (
            <>
              {' '}
              · fat mass <b>{formatSigned(Math.round(delta * 10) / 10, 1)} kg</b> · ketosis{' '}
              <b>{ketoDays} d</b>
            </>
          ) : null}
          {cautions > 0 ? ` · ${cautions} flagged day${cautions === 1 ? '' : 's'}` : ''}
        </span>
        <span className="sim-preview__hint">
          {failed ? 'preview unavailable — Run still works' : 'press Run for the full projection'}
        </span>
      </p>
      <div aria-hidden="true">
        {fat && n > 1 ? (
          <PreviewStrip fat={fat} ketosis={keto} height={48} />
        ) : (
          <div className="sim-preview__empty" />
        )}
      </div>
    </div>
  );
}
