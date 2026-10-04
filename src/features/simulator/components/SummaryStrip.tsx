/**
 * Summary strip above the calendar (task §5): for the focused week or the whole horizon — average energy vs
 * maintenance, average macros, fasting hours and training — computed from the compiled schedule in the UI thread.
 */
import { useMemo, useState } from 'react';
import { Faceplate, KeyBank, formatNumber } from '@/components';
import { formatDateShort, rowDays, rowOf } from '../lib/calendar';
import { fastingGaps, summarise } from '../lib/summary';
import type { ScheduleModel } from '../useScheduleModel';
import { MacroMicroBar } from './ProgramTray';
import { balanceKind, balanceLabel, formatKcal } from '../lib/energy';
import { activitySentence } from '../lib/summary';
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
  const kc = 4 * s.proteinG + 4 * s.carbG + 9 * s.fatG || 1;
  const first = model.cells[days[0] ?? 0]?.iso;
  const last = model.cells[days[days.length - 1] ?? 0]?.iso;
  const perWeek = (v: number) => (scope === 'week' ? v : v / Math.max(1, weeks));
  const activityNote = activitySentence(model.activity.deltaKcal, unit);
  const source = trainingSource(model, days);
  return (
    <Faceplate variant="flush" className="sim-summary" aria-label="Schedule summary">
      <div className="sim-summary__scope">
        <KeyBank
          size="sm"
          label="Summary for"
          options={[
            { value: 'week', label: `wk ${row + 1}` },
            { value: 'all', label: 'all weeks' },
          ]}
          value={scope}
          onChange={setScope}
          orientation="vertical"
        />
        <span className="lm-eng sim-summary__dates">
          {first && last ? `${formatDateShort(first)} → ${formatDateShort(last)}` : ''}
        </span>
      </div>
      <div className="lm-strip sim-summary__items">
        <div className="lm-strip__item">
          <span className="lm-eng">energy · mean</span>
          <span className="sim-summary__big lm-num">
            {Math.round(s.energyPct)}
            <span className="lm-unit">% maint.</span>
          </span>
          <span className="sim-summary__sub">
            {formatKcal(s.energyKcal, unit)} {unit}/d ·{' '}
            {balanceLabel(s.energyPct, balanceKind(s.energyPct) === 'maintenance' ? undefined : s.balanceKcal, unit)}
          </span>
          <span className="sim-summary__sub">
            100 % = {formatKcal(s.maintKcal, unit)} {unit} at this plan’s activity
          </span>
        </div>
        <div className="lm-strip__item">
          <span className="lm-eng">macros · mean</span>
          <span className="sim-summary__big lm-num sim-summary__macros">
            P{Math.round(s.proteinG)} C{Math.round(s.carbG)} F{Math.round(s.fatG)}
            <span className="lm-unit">g</span>
          </span>
          <MacroMicroBar
            shares={s.energyKcal > 0 ? [(4 * s.proteinG) / kc, (4 * s.carbG) / kc, (9 * s.fatG) / kc] : null}
            className="sim-summary__bar"
          />
          <span className="sim-summary__sub">
            protein {formatNumber(s.proteinGPerKg, 1)} g/kg · fibre {Math.round(s.fibreG)} g
          </span>
        </div>
        <div className="lm-strip__item">
          <span className="lm-eng">fasting{scope === 'all' ? ' · per week' : ''}</span>
          <span className="sim-summary__big lm-num">
            {Math.round(perWeek(s.fastingHours))}
            <span className="lm-unit">h</span>
          </span>
          <span className="sim-summary__sub">
            longest {Math.round(s.longestFastH)} h · window {formatNumber(s.windowH, 1)} h
            {s.waterOnlyDays ? ` · ${s.waterOnlyDays} water-only d` : ''}
          </span>
        </div>
        <div className="lm-strip__item">
          <span className="lm-eng">training{scope === 'all' ? ' · per week' : ''}</span>
          <span className="sim-summary__big lm-num">
            {formatNumber(perWeek(s.resistanceSessions), scope === 'week' ? 0 : 1)}
            <span className="lm-unit">lifts</span>{' '}
            {formatNumber(perWeek(s.cardioSessions), scope === 'week' ? 0 : 1)}
            <span className="lm-unit">cardio</span>
          </span>
          <span className="sim-summary__sub">
            {/* hard sets are counted per body region (a squat counts for quads, glutes…): the region average is the
                number lifters recognise ("moderate" = 11 sets per region a week), the 9-region sum ("99 hard sets") is not */}
            {Math.round(perWeek(s.hardSets) / N_REGIONS)} sets/region ·{' '}
            {formatNumber(Math.round(s.avgSteps / 100) * 100, 0)} steps/d
          </span>
          <span className="sim-summary__sub sim-summary__src" data-source={source.mode}>
            {source.mode === 'habitual' ? (
              <>
                <span className="sim-legend__usual">as usual</span> · from Your body: {habitualText(model.habitual)}
              </>
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
function trainingSource(model: ScheduleModel, days: readonly number[]): { mode: TrainingMode | 'mixed'; text: string } {
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
