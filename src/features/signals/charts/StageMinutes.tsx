/**
 * Stage minutes of one night (design/screens/ring-pages.md §7.3.3, the E29 table): stage, minutes, share of time
 * asleep. Deep, light and REM first, then awake and unknown below a hairline; awake is not part of "asleep". Each row
 * carries the stage swatch and the word, so identity is never colour alone.
 */
import { Engraved } from '@/components';
import { THIN_SPACE } from '@/components/lib/format';
import { RING_COPY } from './copy';
import { SLEEP_COPY as S } from './copySleep';
import { sharePercents, type SleepNight, type StackStage } from './sleepModels';
import './ring.css';
import './sleep.css';

const ASLEEP_ROWS: readonly StackStage[] = ['deep', 'light', 'rem'];

export function StageMinutes({ night }: { night: SleepNight }) {
  const pct = night.asleepMin > 0 ? sharePercents({ deep: night.stack.deep / night.asleepMin, light: night.stack.light / night.asleepMin, rem: night.stack.rem / night.asleepMin, unknown: night.stack.unknown / night.asleepMin }) : null;
  const share = (k: StackStage) => (pct ? `${pct[k]}${THIN_SPACE}%` : S.noData);
  const row = (k: StackStage | 'awake', minutes: string, sh: string, sep = false) => (
    <tr key={k} data-stage={k} className={sep ? 'sl-sep' : undefined}>
      <th scope="row">
        <i className="lv-ring-key" data-stage={k} aria-hidden="true" /> {RING_COPY.stage[k]}
      </th>
      <td className="lm-num">{minutes}</td>
      <td className="lm-num">{sh}</td>
    </tr>
  );
  return (
    <div className="sl-minutes">
      <Engraved as="p" className="sg-chart__title">
        {S.title.minutes}
      </Engraved>
      <table className="sl-table">
        <caption className="lm-sr">{`${S.title.minutes}${night.provisional ? ` ${S.stillChangingTable}` : ''}`}</caption>
        <thead>
          <tr>
            <th scope="col">{S.col.stage}</th>
            <th scope="col">{S.col.minutes}</th>
            <th scope="col">{S.col.share}</th>
          </tr>
        </thead>
        <tbody>
          {/* no classified stage: deep, light and REM were not recorded (not 0) */}
          {ASLEEP_ROWS.map((k) => (night.hasStages ? row(k, String(night.stack[k]), share(k)) : row(k, S.noData, S.noData)))}
          {row('awake', night.awakeMin === null ? S.noData : String(night.awakeMin), S.notAsleep, true)}
          {row('unknown', String(night.stack.unknown), share('unknown'))}
        </tbody>
      </table>
      {night.stack.unknown > 0 ? <p className="sl-note">{`${RING_COPY.stage.unknown}: ${RING_COPY.stageHelp.unknown}`}</p> : null}
      {night.provisional ? <p className="sl-note">{S.stillChangingTable}</p> : null}
    </div>
  );
}
