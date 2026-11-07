/**
 * Summary above the calendar (task §5): for the focused week or the whole horizon — average energy, average macros,
 * fasting hours and training — computed from the compiled schedule in the UI thread. A 2-column grid on phones, one
 * row of four from 768 px. Each metric is its label, its value (with units) and at most one fact line; the training
 * source (as usual / custom / none) is spoken only, the program tiles and the day editor show it.
 */
import { useMemo, useState } from 'react';
import { Flame } from 'lucide-react';
import { CardHead, Faceplate, HeroNumber, KeyBank, formatNumber } from '@/components';
import { rowDays, rowOf } from '../lib/calendar';
import { activitySentence, fastingGaps, summarise } from '../lib/summary';
import type { ScheduleModel } from '../useScheduleModel';
import { balanceKind, formatKcal } from '../lib/energy';
import { habitualText, type TrainingMode } from '../lib/training';
import { N_REGIONS } from '@/engine/types/inputs';
import { useEnergyUnit } from '@/state/settingsStore';

export function SummaryStrip({ model, focusDay }: { model: ScheduleModel; focusDay: number }) {
  const [scope, setScope] = useState<'week' | 'all'>('week');
  const unit = useEnergyUnit();
  const row = rowOf(model.grid, Math.min(focusDay, model.grid.nDays - 1));
  const gaps = useMemo(() => fastingGaps(model.compiled), [model.compiled]);
  const days = useMemo(
    () =>
      scope === 'week' ? rowDays(model.grid, row) : Array.from({ length: model.grid.nDays }, (_, i) => i),
    [scope, model.grid, row],
  );
  const s = useMemo(
    () => summarise(model.compiled, model.resolved, days, gaps),
    [model.compiled, model.resolved, days, gaps],
  );
  const weeks = days.length / 7;
  const perWeek = (v: number) => (scope === 'week' ? v : v / Math.max(1, weeks));
  const activityNote = activitySentence(model.activity.deltaKcal, unit);
  const source = trainingSource(model, days);
  // the value carries the energy; only an all-fast period needs its one fact ("0 kcal/d" alone reads as missing)
  const energySub = balanceKind(s.energyPct) === 'fast' ? 'water only' : null;
  const weekly = scope === 'all' ? ' per week' : '';
  return (
    <Faceplate className="sim-summary" data-domain="energy" aria-label="Schedule summary">
      <CardHead
        icon={Flame}
        title={scope === 'week' ? 'This week' : 'All weeks'}
        info={{
          title: 'What this week adds up to',
          body: `These are averages of the days you painted, for the week shown or the whole plan. Energy is compared with maintenance at this plan’s activity. Fasting counts every gap of twelve hours or more, overnight ones included. Hard sets are counted per body region, so a squat counts for quads and glutes.${activityNote ? ` ${activityNote}` : ''}`,
        }}
      />
      <div className="sim-summary__scope">
        <KeyBank
          size="sm"
          label="Summary for"
          options={[
            { value: 'week', label: `Week ${row + 1}` },
            { value: 'all', label: 'All weeks' },
          ]}
          value={scope}
          onChange={setScope}
        />
      </div>
      <div className="sim-summary__items">
        <div className="sim-summary__item">
          <span className="lm-eng">Energy</span>
          <HeroNumber
            value={s.energyKcal}
            format={(v) => formatKcal(v, unit)}
            unit={`${unit}/d`}
            size="num"
            label={`${formatKcal(s.energyKcal, unit)} ${unit} a day`}
          />
          {energySub ? <span className="sim-summary__sub">{energySub}</span> : null}
        </div>
        <div className="sim-summary__item">
          <span className="lm-eng">Macros</span>
          {/* r068 SC3: the split as a P · C · F bar (by energy) over three aligned values, never a wrapping sentence */}
          <span className="sim-summary__mbar" aria-hidden="true">
            <i data-m="protein" style={{ flexGrow: s.proteinG * 4 }} />
            <i data-m="carbs" style={{ flexGrow: s.carbG * 4 }} />
            <i data-m="fat" style={{ flexGrow: s.fatG * 9 }} />
          </span>
          <dl className="sim-summary__macros lm-num">
            <div>
              <dt>Protein</dt>
              <dd>{Math.round(s.proteinG)}&nbsp;g</dd>
            </div>
            <div>
              <dt>Carbs</dt>
              <dd>{Math.round(s.carbG)}&nbsp;g</dd>
            </div>
            <div>
              <dt>Fat</dt>
              <dd>{Math.round(s.fatG)}&nbsp;g</dd>
            </div>
          </dl>
          <span className="sim-summary__sub">{formatNumber(s.proteinGPerKg, 1)} g/kg protein</span>
        </div>
        <div className="sim-summary__item">
          <span className="lm-eng">Fasting{weekly}</span>
          <span className="sim-summary__big lm-num">
            {Math.round(perWeek(s.fastingHours))}
            <span className="lm-unit">h</span>
          </span>
          <span className="sim-summary__sub">longest {Math.round(s.longestFastH)} h</span>
        </div>
        <div className="sim-summary__item">
          <span className="lm-eng">Training{weekly}</span>
          <span className="sim-summary__big lm-num">
            {formatNumber(perWeek(s.resistanceSessions), scope === 'week' ? 0 : 1)}
            <span className="lm-unit">lifts</span>
            <span className="sim-summary__sep" aria-hidden="true">
              ·
            </span>
            {formatNumber(perWeek(s.cardioSessions), scope === 'week' ? 0 : 1)}
            <span className="lm-unit">cardio</span>
          </span>
          <span className="sim-summary__sub">
            {/* hard sets are counted per body region (a squat counts for quads, glutes…): the region average is the
                number lifters recognise ("moderate" = 11 sets per region a week), the 9-region sum ("99 hard sets") is not */}
            {Math.round(perWeek(s.hardSets) / N_REGIONS)} sets per region
          </span>
          {/* where the training comes from (R-DETRAIN), for screen readers; on screen the tiles and the day editor say it */}
          <span className="lm-sr sim-summary__src" data-source={source.mode}>
            {source.mode === 'habitual' ? (
              <>as usual · from Your body: {habitualText(model.habitual)}</>
            ) : (
              source.text
            )}
          </span>
        </div>
      </div>
      {activityNote ? <p className="sim-summary__note">{activityNote}</p> : null}
    </Faceplate>
  );
}

const MODE_WORD: Record<TrainingMode, string> = { habitual: 'as usual', custom: 'custom', none: 'none' };

/** Where the period's training comes from (R-DETRAIN): one source, or the mix by days. */
function trainingSource(
  model: ScheduleModel,
  days: readonly number[],
): { mode: TrainingMode | 'mixed'; text: string } {
  const n: Record<TrainingMode, number> = { habitual: 0, custom: 0, none: 0 };
  for (const d of days) {
    const m = model.training.byDay[d];
    if (m) n[m]++;
  }
  const used = (Object.keys(n) as TrainingMode[]).filter((k) => n[k] > 0);
  if (used.length === 1) {
    const m = used[0]!;
    return { mode: m, text: m === 'custom' ? 'custom sessions' : m === 'none' ? 'no training' : 'as usual' };
  }
  return { mode: 'mixed', text: used.map((k) => `${MODE_WORD[k]} ${n[k]} d`).join(' · ') };
}
