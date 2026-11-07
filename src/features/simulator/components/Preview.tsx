/**
 * Coarse preview under the raster (COMPONENTS §5 PreviewStrip): a nominal run in the simulator's preview worker after
 * every stroke (debounced), drawn with the chart module's read-only <PreviewStrip>. One fact line, rounded:
 * "Fat mass −4.5 kg by 27 Dec · 6 days in ketosis".
 */
import { useEffect, useState } from 'react';
import type { PersonProfile, Schedule } from '@/engine';
import { PreviewStrip } from '@/features/charts';
import { HeroNumber, MonoMeta, formatSigned } from '@/components';
import { getSimulationClient, type PreviewSeries } from '@/workers/simulationClient';
import { addDaysISO, formatDateShort } from '../lib/calendar';

const DEBOUNCE_MS = 250;

type PreviewOutcome =
  | { profile: PersonProfile; schedule: Schedule; status: 'ready'; series: PreviewSeries }
  | { profile: PersonProfile; schedule: Schedule; status: 'failed' };

export function SchedulePreview({
  profile,
  schedule,
  cautions,
}: {
  profile: PersonProfile;
  schedule: Schedule;
  cautions: number;
}) {
  const [outcome, setOutcome] = useState<PreviewOutcome | null>(null);
  useEffect(() => {
    let live = true;
    const id = window.setTimeout(() => {
      getSimulationClient()
        .preview({ ...profile, startDate: schedule.startDate }, schedule)
        .then((series) => {
          if (live) setOutcome({ profile, schedule, status: 'ready', series });
        })
        .catch(() => {
          if (live) setOutcome({ profile, schedule, status: 'failed' });
        });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [profile, schedule]);

  // A previous result or failure belongs to its exact inputs. Never pair its values with this schedule's end date.
  const current = outcome?.profile === profile && outcome.schedule === schedule ? outcome : null;
  const pending = !current;
  const failed = current?.status === 'failed';
  const data = current?.status === 'ready' ? current.series : null;
  const fat = data?.fatMass;
  const n = fat?.length ?? 0;
  const delta = fat && n > 1 ? fat[n - 1]! - fat[0]! : Number.NaN;
  let ketoDays = 0;
  // engine ketosis state: 0 none · 1 light · 2 nutritional · 3 fasting · 4 warning → strip levels 0–3
  const states = data ? Array.from(data.ketosis) : [];
  const keto = states.map((v) => (v >= 1 ? Math.min(3, Math.round(v)) : 0));
  for (const v of states) if (v >= 2) ketoDays++;
  const end = formatDateShort(addDaysISO(schedule.startDate, schedule.horizonDays - 1));
  return (
    <div className="sim-preview" data-pending={pending || undefined}>
      <div className="sim-preview__cap">
        {Number.isFinite(delta) ? (
          <>
            <span>Fat mass</span>
            <HeroNumber
              value={delta}
              format={(v) => formatSigned(Math.round(v * 10) / 10, 1)}
              decimals={1}
              unit="kg"
              size="num"
              range="Preview · no range"
              label={`Fat mass change ${formatSigned(delta, 1)} kilograms by ${end}, preview with no range`}
            />
            <MonoMeta>
              By {end}
              {ketoDays > 0 ? ` · ${ketoDays} day${ketoDays === 1 ? '' : 's'} in ketosis` : ''}
              {cautions > 0 ? ` · ${cautions} flagged day${cautions === 1 ? '' : 's'}` : ''}
            </MonoMeta>
          </>
        ) : failed ? (
          <span>Preview unavailable</span>
        ) : null}
      </div>
      <div aria-hidden="true">
        {fat && n > 1 ? (
          // r068 SC7: the ketosis band is drawn only when the caption names it ("· 6 days in ketosis"), never as an
          // unlabelled bar under the line
          <PreviewStrip fat={fat} ketosis={ketoDays > 0 ? keto : keto.map(() => 0)} height={48} />
        ) : (
          <div className="sim-preview__empty" />
        )}
      </div>
    </div>
  );
}
