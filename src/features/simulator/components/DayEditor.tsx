/**
 * <DayEditor> (COMPONENTS §5; simulator-schedule.md §6). Edits apply to "this day" (an override: triangle mark on
 * the cell), "this block" (the program's days in this phase) or "all A days" (the program). Sections: energy, macros,
 * meals & window (clock ring, or the multi-day timeline inside a long fast), exercise, sleep, more detail.
 * Every change re-tints the raster live; slider drags form one undo step (sealed on release).
 */
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Trash2 } from 'lucide-react';
import {
  Glyphs,
  Icon,
  IconKey,
  InlineWarning,
  Key,
  KeyBank,
  MQ,
  Notice,
  ScaleRange,
  ScaleSlider,
  Stepper,
  Switch,
  KJ_PER_KCAL,
  energyInText,
  energyUnitSpoken,
  formatEnergy,
  formatNumber,
  useMediaQuery,
  type EnergyUnitChoice,
  type ScaleZone,
} from '@/components';
import type { DayTemplate, MealSplit } from '@/engine';
import { DEFAULTS } from '@/engine';
import { useScheduleStore } from '@/state/scheduleStore';
import { useEnergyUnit } from '@/state/settingsStore';
import { PRESETS } from '../presets';
import { addDaysISO, formatClock, formatDayShort, weekdayOf } from '../lib/calendar';
import { TRAINING_MODE_LABEL, trainingMode } from '../lib/training';
import { balanceLabel, dayMaintenance, energyZones, formatKcal, roundKcal, specKcal, specPct } from '../lib/energy';
import { dayFastInfo, formatFastHours, refeedRamp, type DayFastInfo, type FastSpan } from '../lib/fasts';
import { energyShares, type MacroGrams, type MacroRefs } from '../lib/macros';
import { dayTemplate } from '../lib/ops';
import { editSchedule, sealSchedule, templatePatch } from '../commands';
import { resolveTemplate } from '../lib/resolve';
import {
  blockDaysOf,
  sessionLabel,
  setMealCount,
  setSplit,
  writeMealTimes,
  type EditScope,
} from '../editing';
import type { ScheduleModel } from '../useScheduleModel';
import { AdvancedFields, advancedCount } from './AdvancedFields';
import { ClockRing } from './ClockRing';
import { EditorSection, TimeField } from './editorParts';
import { ExerciseEditor } from './ExerciseEditor';
import { FastTimeline, fastWhen } from './FastTimeline';
import { MacroSplit } from './MacroSplit';

export interface EditorTarget {
  /** Day being edited (null = the program itself, opened from its key). */
  day: number | null;
  program: number;
}

export interface DayEditorProps {
  sid: string;
  model: ScheduleModel;
  target: EditorTarget;
  scope: EditScope;
  onScope: (s: EditScope) => void;
  onNavigate: (day: number) => void;
}

/** "2 410 kcal" / "10 080 kJ" (stored values are kcal; Settings › energy unit decides the display). */
const en = (kcal: number, unit: EnergyUnitChoice): string => `${formatEnergy(kcal, unit, { withUnit: false })} ${unit}`;

export function DayEditor({ sid, model, target, scope, onScope, onNavigate }: DayEditorProps) {
  const store = useScheduleStore.getState;
  const unit = useEnergyUnit();
  const { schedule, resolved, compiled } = model;
  const day = target.day;
  const program = day !== null ? (schedule.days[day]?.program ?? 0) : target.program;
  const effScope: EditScope = day === null ? 'all' : scope;
  const prog = schedule.programs[program] ?? schedule.programs[0]!;
  const t: DayTemplate = effScope === 'all' || day === null ? prog : dayTemplate(schedule, day);
  const blockDays = useMemo(() => (day !== null ? blockDaysOf(model, day) : []), [model, day]);
  const usage = model.usage[program] ?? 0;
  const override = day !== null && Boolean(schedule.days[day]?.override);

  const apply = (recipe: (t: DayTemplate) => DayTemplate, key?: string) => {
    // the patch is what the recipe changes on the template shown (read now, not from the last render)
    const now = store().scenarios.find((x) => x.id === sid)?.schedule;
    if (!now) return;
    const all = effScope === 'all' || day === null;
    const patch = templatePatch(all ? (now.programs[program] ?? now.programs[0]!) : dayTemplate(now, day), recipe);
    if (!patch) return;
    if (all) editSchedule(sid, [{ op: 'updateProgram', index: program, patch }], key);
    else editSchedule(sid, [{ op: 'editDays', days: effScope === 'day' ? [day] : blockDays, patch }], key);
  };
  const commit = () => sealSchedule(sid);

  // The maintenance reference this day (or this program's days) resolves against: habitual maintenance adjusted to the
  // activity this schedule plans (ruling R-MAINT), from the full compile — a one-day compile would see one day's
  // training instead of the week's average.
  const habitual = resolved.tdee0Kcal;
  const maint = useMemo(() => {
    if (day !== null) return dayMaintenance(compiled.days[day] ?? {}, habitual);
    let sum = 0;
    let n = 0;
    for (const d of compiled.days)
      if (d.program === program && !schedule.days[d.day]?.override) {
        sum += dayMaintenance(d, habitual);
        n++;
      }
    return n > 0 ? sum / n : habitual;
  }, [compiled, day, program, schedule.days, habitual]);
  const reference = t.energy.kind === 'pctMaintenance' ? (t.energy.reference ?? schedule.defaults?.energyReference ?? 'baseline') : 'baseline';
  // grams are resolved at the energy the full schedule gives this day (a % day at its own maintenance reference)
  // (always: a one-day compile would resolve the % against that one day's own activity — e.g. a Monday lift of the
  // usual week — not the plan's phase/week average the full compile uses)
  const tAtRef = useMemo<DayTemplate>(
    () => (t.energy.kind === 'pctMaintenance' ? { ...t, energy: { kind: 'kcal', kcal: (t.energy.pct / 100) * maint } } : t),
    [t, maint],
  );
  const r = resolveTemplate(tAtRef, resolved, reference);
  // how a fast shapes this day (QA 2026-10-01): inside a fast the day is fasted whatever its program says
  const fi = useMemo(
    () =>
      day !== null
        ? dayFastInfo(compiled, model.spans, day, dayTemplate(schedule, day).energy.kind === 'zero')
        : null,
    [compiled, model.spans, day, schedule],
  );
  /** "This day" on a day a fast event covers entirely: shown as fasted (no kcal, no meals), food fields hidden. */
  const fastView = effScope === 'day' && Boolean(fi?.fasted && fi.overridden);
  const zero = t.energy.kind === 'zero' || fastView;
  const span = day !== null ? (model.fasts[day]?.span ?? (fi?.fasted ? (fi.span ?? undefined) : undefined)) : undefined;
  const longFast = span && span.hours > 24 ? span : undefined;
  // block / all-days edits that reach days a fast overrides
  const scopeDays = useMemo(() => {
    if (effScope === 'day') return [];
    if (effScope === 'block') return blockDays;
    const out: number[] = [];
    schedule.days.forEach((d, i) => {
      if (d.program === program) out.push(i);
    });
    return out;
  }, [effScope, blockDays, schedule.days, program]);
  const fastedInScope = useMemo(
    () => scopeDays.filter((d) => compiled.days[d]?.zeroIntake || (compiled.days[d]?.mealDropMask ?? 0) > 0).length,
    [scopeDays, compiled],
  );
  const issues = day !== null ? (model.check.byDay[day] ?? []) : [];
  const worst0 = issues[0]?.severity ?? null;
  const worst = worst0 === 'error' ? 'danger' : worst0;
  const md = useMediaQuery(MQ.md);
  const [macroView, setMacroView] = useState<'scales' | 'triangle'>('scales');

  const iso = day !== null ? addDaysISO(schedule.startDate, day) : null;
  const phase = day !== null ? model.phases.find((p) => day >= p.startDay && day < p.endDay) : undefined;

  const grams: MacroGrams = { protein: r.proteinG, carbs: r.carbG, fat: r.fatG };
  const refs: MacroRefs = {
    energyKcal: r.energyKcal,
    bodyMassKg: resolved.weightKg,
    ffmKg: resolved.ffm0Kg,
    fibreG: r.fibreG,
    alcoholG: r.alcoholG,
  };
  const presetMarks = useMemo(
    () =>
      PRESETS.filter((p) => p.statedPct > 0).map((p) => {
        const pr = resolveTemplate({ id: 'x', ...p.template }, resolved);
        return {
          label: p.template.label,
          shares: energyShares({ protein: pr.proteinG, carbs: pr.carbG, fat: pr.fatG }),
        };
      }),
    [resolved],
  );

  // training source (R-DETRAIN): "as usual" days train the habitual week's sessions for their weekday, then their own
  const tMode = trainingMode(t);
  const weekday = day !== null ? (weekdayOf(schedule.startDate) + day) % 7 : null;
  const usualToday = tMode === 'habitual' && weekday !== null ? (model.habitual.byWeekday[weekday] ?? []) : [];
  const shownSessions = [...usualToday.map((x) => ({ s: x, usual: true })), ...(t.exercise ?? []).map((x) => ({ s: x, usual: false }))];
  const ownOffset = usualToday.length;

  const times = Array.from({ length: r.day.nMeals }, (_, i) => r.day.meals[i]!).map((m) => ({
    clockH: m.clockH,
    kcal: m.kcal,
  }));
  const explicitMeals = effScope !== 'all';
  const sleep = { bedH: r.day.sleepBedH, wakeH: (r.day.sleepBedH + r.day.sleepHours) % 24 };

  return (
    <div className="sim-editor">
      <header className="sim-editor__head">
        <div className="sim-editor__r1">
          <div className="sim-editor__when">
            <div className="lm-eng">
              {day !== null
                ? `day ${day + 1} of ${schedule.horizonDays}${phase ? ` · ${phase.name}` : ''}`
                : `${usage} day${usage === 1 ? '' : 's'} use it`}
            </div>
          </div>
          <span className="sim-chip">
            <b>{prog.id}</b> {prog.label}
          </span>
          {day !== null ? (
            <span className="sim-editor__nav">
              <IconKey
                size="sm"
                icon={ChevronLeft}
                label="Previous day"
                disabled={day <= 0}
                onClick={() => onNavigate(day - 1)}
              />
              <IconKey
                size="sm"
                icon={ChevronRight}
                label="Next day"
                disabled={day >= schedule.horizonDays - 1}
                onClick={() => onNavigate(day + 1)}
              />
            </span>
          ) : null}
        </div>
        {day !== null ? (
          <div className="sim-editor__scope">
            <span className="lm-eng">edits apply to</span>
            <KeyBank
              size="sm"
              block
              label="Edits apply to"
              options={[
                { value: 'day', label: 'this day' },
                { value: 'block', label: `this block · ${blockDays.length}` },
                { value: 'all', label: `all ${usage} ${prog.id} days` },
              ]}
              value={scope}
              onChange={onScope}
            />
          </div>
        ) : null}
        {effScope === 'all' ? (
          <label className="sim-editor__name">
            <span className="lm-eng">program name</span>
            <input
              className="sim-input"
              value={prog.label}
              maxLength={40}
              onChange={(e) => {
                const v = e.currentTarget.value;
                editSchedule(sid, [{ op: 'updateProgram', index: program, patch: { label: v } }], 'label');
              }}
              onBlur={commit}
            />
          </label>
        ) : null}
        {override ? (
          <div className="sim-editor__override">
            <span className="sim-ovmark" aria-hidden="true" />
            <span>override · this day differs from {prog.id}</span>
            <Key
              size="sm"
              variant="quiet"
              icon={RotateCcw}
              onClick={() => void editSchedule(sid, [{ op: 'resetOverrides', days: [day!] }])}
            >
              Reset to program {prog.id}
            </Key>
          </div>
        ) : null}
        {fastView && fi ? (
          <FastOverrideNote
            fi={fi}
            prog={prog}
            energy={en(r.energyKcal, unit)}
            meals={r.day.nMeals}
            startDate={schedule.startDate}
            onEditProgram={() => onScope('all')}
          />
        ) : effScope !== 'day' && fastedInScope > 0 ? (
          <p className="sim-editor__fastnote" role="note">
            {fastedInScope} of these {scopeDays.length} days {fastedInScope === 1 ? 'is' : 'are'} inside a fast: the fast
            overrides their food (energy, macros, meals); training and sleep still apply.
          </p>
        ) : null}
        {issues.length > 0 ? (
          <ul className="sim-editor__issues">
            {issues.map((x) => (
              <li key={x.id}>
                <InlineWarning severity={x.severity === 'error' ? 'danger' : x.severity}>
                  {energyInText(x.message, unit)}
                </InlineWarning>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {longFast && day !== null ? (
        <EditorSection
          id="fast"
          title="Fast"
          aside={<span className="sim-sub">{formatFastHours(longFast.hours)}</span>}
        >
          <FastTimeline span={longFast} compiled={compiled} />
          <p className="sim-sub sim-editor__refeed">{refeedText(longFast, compiled, schedule.startDate)}</p>
          <Notice severity="info" layout="ruled" title="Fasts over 24 h: keep fluids and salt up.">
            Aim for 2–3 L of water and about 2 g of sodium across the day. Break the fast with a protein-first
            meal.
          </Notice>
          {longFast.eventIndex >= 0 ? (
            <FastEventFields sid={sid} index={longFast.eventIndex} model={model} />
          ) : null}
        </EditorSection>
      ) : null}

      <EditorSection
        id="energy"
        title="Energy"
        severity={issues.some((i) => i.id.startsWith('W-E')) ? worst : null}
        aside={
          <span className="sim-sub">
            {zero
              ? `0 ${unit}${fastView ? ' · fasted' : ''}${span ? ` · fast ${formatFastHours(span.hours)}` : ''}`
              : `${en(r.energyKcal, unit)} · ${balanceLabel((100 * r.energyKcal) / maint, r.energyKcal - maint, unit)}`}
          </span>
        }
      >
        {fastView ? (
          <p className="sim-sub">
            No energy and no protein on this day: water, electrolytes and black coffee or tea. Program {prog.id}’s
            energy applies again after the fast.
          </p>
        ) : (
          <EnergyFields t={t} maint={maint} habitual={habitual} unit={unit} apply={apply} commit={commit} />
        )}
        {effScope === 'day' && fi && !fi.fasted && fi.droppedMeals > 0 && day !== null ? (
          <p className="sim-editor__fastnote" role="note">
            The fast drops {fi.droppedMeals} of this day’s {r.day.nMeals} meals: about{' '}
            {en(compiled.days[day]?.energyKcal ?? 0, unit)} are eaten.
          </p>
        ) : null}
        {effScope === 'day' && fi?.refeed && day !== null ? (
          <p className="sim-editor__fastnote" role="note">
            Refeed day {fi.refeed.n} of {fi.refeed.of} after the fast: {Math.round(fi.refeed.factor * 100)} % of the
            planned energy, about {en(compiled.days[day]?.energyKcal ?? 0, unit)}.
          </p>
        ) : null}
      </EditorSection>

      {!zero ? (
        <EditorSection
          id="macros"
          title="Macros"
          severity={issues.some((i) => i.id === 'APP-MACROS' || i.id.startsWith('W-M0')) ? worst : null}
          aside={
            md ? (
              <KeyBank
                size="sm"
                label="Macro view"
                options={[
                  { value: 'scales', label: 'scales' },
                  { value: 'triangle', label: 'triangle' },
                ]}
                value={macroView}
                onChange={setMacroView}
              />
            ) : (
              <span className="sim-sub">energy held constant</span>
            )
          }
        >
          <MacroSplit
            macros={t.macros}
            grams={grams}
            refs={refs}
            view={md ? macroView : 'scales'}
            presetMarks={presetMarks}
            energyUnit={unit}
            onChange={(m, key) => apply((x) => ({ ...x, macros: m }), key)}
            onCommit={commit}
          />
          <ScaleSlider
            label="fibre"
            size="sm"
            value={Math.round(r.fibreG)}
            min={0}
            max={80}
            step={1}
            majorStep={20}
            minorStep={5}
            labels={false}
            reference={{
              value: Math.round((DEFAULTS.fibreGPer1000Kcal * r.energyKcal) / 1000),
              label: unit === 'kJ' ? 'typical (about 1.9 g per 1000 kJ)' : 'typical (8 g per 1000 kcal)',
            }}
            zones={[
              {
                from: 0,
                to: (14 * r.energyKcal) / 1000,
                tone: 'caution',
                label: unit === 'kJ' ? 'below about 3.3 g per 1000 kJ' : 'below 14 g per 1000 kcal',
              } satisfies ScaleZone,
            ]}
            unit="g"
            valueText={(v) => `fibre ${v} grams`}
            onChange={(v) =>
              apply((x) => ({ ...x, macros: { ...x.macros, fibre: { unit: 'g', value: v } } }), 'fibre')
            }
            onCommit={commit}
            note={
              t.macros.fibre
                ? `counts ${unit === 'kJ' ? '8 kJ/g' : '2 kcal/g'} in the energy total`
                : unit === 'kJ'
                  ? 'default: about 1.9 g per 1000 kJ · counts 8 kJ/g'
                  : 'default: 8 g per 1000 kcal · counts 2 kcal/g'
            }
          />
        </EditorSection>
      ) : null}

      <EditorSection
        id="meals"
        title="Meals & window"
        aside={<span className="sim-sub">{zero ? 'water only' : 'drag the window'}</span>}
      >
        {zero && longFast && day !== null ? (
          <p className="sim-sub">
            This day is inside a {formatFastHours(longFast.hours)} fast — see the timeline above.
          </p>
        ) : (
          <div className="sim-meals">
            <ClockRing
              meals={zero ? [] : times}
              fast={
                zero
                  ? {
                      hours: span?.hours ?? 24,
                      caption: span
                        ? fastWhen(span, schedule.startDate).split(' → ')[1]!.replace(/^/, 'ends ')
                        : 'water only',
                    }
                  : null
              }
              sessions={shownSessions.map(({ s, usual }) => ({
                kind: s.kind,
                startH: s.startH,
                durationMin: s.kind === 'resistance' ? (s.durationMin ?? 60) : s.durationMin,
                label: usual ? `${sessionLabel(s)} (as usual)` : sessionLabel(s),
                dotted: s.kind === 'cardio' && s.modality === 'walk',
              }))}
              sleep={sleep}
              onMealsChange={(ts) => {
                apply((x) => writeMealTimes(x, ts, explicitMeals));
                commit();
              }}
              onAddMeal={(h) => {
                if (times.length >= 8) return;
                apply((x) => writeMealTimes(x, [...times.map((m) => m.clockH), h], explicitMeals));
                commit();
              }}
              onSessionMove={(i, h) => {
                // the usual week's sessions are read-only here (Your body → habits); the day's own ones move
                if (i < ownOffset) return;
                apply((x) => ({
                  ...x,
                  exercise: (x.exercise ?? []).map((e, k) => (k === i - ownOffset ? { ...e, startH: h } : e)),
                }));
                commit();
              }}
              label={`${iso ? formatDayShort(iso) : `Program ${prog.id}`} clock`}
              energyUnit={unit}
            />
            <ul className="sim-meals__list">
              {times.map((m, i) => {
                const dropped =
                  effScope === 'day' && day !== null && ((compiled.days[day]?.mealDropMask ?? 0) & (1 << i)) !== 0;
                return (
                  <li key={`m${i}`} data-dropped={dropped || undefined}>
                    <i className="sim-dot" aria-hidden="true" />
                    {formatClock(m.clockH)} · {en(m.kcal, unit)}
                    {dropped ? ' · dropped (inside the fast)' : ''}
                  </li>
                );
              })}
              {shownSessions.map(({ s, usual }, i) => (
                <li key={`s${i}`} data-source={usual ? 'habitual' : undefined}>
                  <i className="sim-dot sim-dot--train" data-kind={s.kind} aria-hidden="true" />
                  {formatClock(s.startH)} {sessionLabel(s)} ·{' '}
                  {Math.round(s.kind === 'resistance' ? (s.durationMin ?? 60) : s.durationMin)} min
                  {usual ? ' · as usual' : ''}
                </li>
              ))}
              <li>
                <i className="sim-dot sim-dot--sleep" aria-hidden="true" />
                {formatClock(sleep.bedH)} sleep · {formatNumber(r.day.sleepHours, 1)} h
              </li>
            </ul>
          </div>
        )}
        {!zero ? (
          <div className="sim-meals__banks">
            <div className="sim-field">
              <span className="lm-eng">meals</span>
              <KeyBank
                size="sm"
                label="Number of meals"
                options={['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))}
                value={String(Math.min(5, times.length))}
                onChange={(v) => {
                  apply((x) =>
                    setMealCount(
                      x,
                      times.map((m) => m.clockH),
                      Number(v),
                      explicitMeals,
                    ),
                  );
                  commit();
                }}
              />
            </div>
            <div className="sim-field">
              <span className="lm-eng">split</span>
              <KeyBank
                size="sm"
                label="Meal split"
                options={[
                  { value: 'even', label: 'even' },
                  { value: 'biggerLast', label: 'bigger last' },
                  { value: 'biggerFirst', label: 'bigger first' },
                ]}
                value={t.meals?.split ?? 'even'}
                onChange={(v) => {
                  apply((x) =>
                    setSplit(
                      x,
                      times.map((m) => m.clockH),
                      v as MealSplit,
                      explicitMeals,
                    ),
                  );
                  commit();
                }}
              />
            </div>
          </div>
        ) : null}
      </EditorSection>

      <EditorSection
        id="exercise"
        title="Exercise"
        severity={issues.some((i) => i.id === 'W-F09') ? 'caution' : null}
        aside={<span className="sim-sub">training: {TRAINING_MODE_LABEL[tMode]}</span>}
      >
        <ExerciseEditor
          t={t}
          apply={apply}
          commit={commit}
          typicalSteps={resolved.habits.typicalSteps}
          habitual={model.habitual}
          weekday={weekday}
          energyUnit={unit}
        />
      </EditorSection>

      <EditorSection
        id="sleep"
        title="Sleep"
        defaultOpen={false}
        aside={<span className="sim-sub">{`${formatClock(sleep.bedH)}–${formatClock(sleep.wakeH)}`}</span>}
      >
        <SleepFields
          t={t}
          apply={apply}
          commit={commit}
          usualBed={resolved.habits.bedTimeH}
          usualWake={resolved.habits.wakeTimeH}
          usualQuality={resolved.habits.sleepQuality}
        />
      </EditorSection>

      <EditorSection
        id="scenario"
        title="Whole scenario"
        defaultOpen={false}
        aside={<span className="sim-sub">applies to every day</span>}
      >
        <ScenarioFields sid={sid} model={model} />
      </EditorSection>

      <EditorSection
        id="more"
        title="More detail"
        defaultOpen={false}
        aside={<span className="sim-sub">{advancedCount(t) ? `${advancedCount(t)} set` : 'defaults'}</span>}
      >
        <AdvancedFields
          t={t}
          resolved={resolved}
          apply={apply}
          commit={commit}
          zero={zero}
          scenarioReference={schedule.defaults?.energyReference ?? 'baseline'}
        />
      </EditorSection>
    </div>
  );
}

function EnergyFields({
  t,
  maint,
  habitual,
  unit,
  apply,
  commit,
}: {
  t: DayTemplate;
  maint: number;
  /** Habitual maintenance (the usual week), for "adjusted for this plan's training". */
  habitual: number;
  /** Settings › energy unit (display and entry; the template stores kcal). */
  unit: EnergyUnitChoice;
  apply: (r: (t: DayTemplate) => DayTemplate, key?: string) => void;
  commit: () => void;
}) {
  const e = t.energy;
  const mode = e.kind === 'zero' ? 'zero' : e.kind === 'kcal' ? 'kcal' : 'pct';
  const zones = energyZones(maint, unit);
  const toKcal = (pct: number) => (pct / 100) * maint;
  /** kcal → display unit factor. */
  const f = unit === 'kJ' ? KJ_PER_KCAL : 1;
  const kJ = unit === 'kJ';
  const adj = maint - habitual;
  const refLine = `100 % = ${formatKcal(maint, unit)} ${unit} at this plan’s activity${
    Math.abs(adj) >= 20
      ? ` (your usual ${formatKcal(habitual, unit)} ${adj > 0 ? '+' : '\u2212'} ${formatKcal(Math.abs(adj), unit)} for its training)`
      : ''
  }`;
  return (
    <div className="sim-energy">
      <KeyBank
        size="sm"
        block
        label="Energy entered as"
        options={[
          { value: 'pct', label: '% maintenance' },
          { value: 'kcal', label: unit },
          { value: 'zero', label: 'water only' },
        ]}
        value={mode}
        onChange={(m) => {
          apply((x) => {
            const cur = x.energy;
            if (m === 'zero') return { ...x, energy: { kind: 'zero' } };
            if (m === 'kcal')
              return {
                ...x,
                energy: {
                  kind: 'kcal',
                  kcal: cur.kind === 'zero' ? roundKcal(0.9 * maint) : roundKcal(specKcal(cur, maint)),
                },
              };
            return {
              ...x,
              energy: {
                kind: 'pctMaintenance',
                pct: cur.kind === 'zero' ? 90 : Math.round(specPct(cur, maint)),
              },
            };
          });
          commit();
        }}
      />
      {e.kind === 'pctMaintenance' ? (
        <ScaleSlider
          label="% of maintenance"
          value={e.pct}
          min={40}
          max={140}
          step={1}
          minorStep={5}
          majorStep={20}
          labels={[40, 60, 80, { value: 100, label: 'maint.' }, 120, 140]}
          zones={zones}
          reference={{ value: 100 }}
          unit="%"
          valueText={(v) =>
            `${v} percent of maintenance, ${formatEnergy(toKcal(v), unit, { withUnit: false })} ${energyUnitSpoken(unit)}`
          }
          onChange={(v) =>
            apply(
              (x) => ({
                ...x,
                energy: {
                  ...(x.energy.kind === 'pctMaintenance' ? x.energy : { kind: 'pctMaintenance' as const }),
                  kind: 'pctMaintenance',
                  pct: v,
                },
              }),
              'energy',
            )
          }
          onCommit={commit}
          note={`${en(toKcal(e.pct), unit)} · ${refLine}`}
        />
      ) : e.kind === 'kcal' ? (
        <ScaleSlider
          label={`${unit} a day`}
          value={kJ ? Math.round((e.kcal * f) / 50) * 50 : e.kcal}
          min={Math.floor((0.4 * maint * f) / 100) * 100}
          max={Math.ceil((1.4 * maint * f) / 100) * 100}
          step={kJ ? 50 : 10}
          minorStep={kJ ? 500 : 100}
          majorStep={kJ ? 2000 : 500}
          zones={zones.map((z) => ({ ...z, from: toKcal(z.from) * f, to: toKcal(z.to) * f }))}
          reference={{ value: Math.round(maint * f), label: 'maintenance' }}
          unit={unit}
          format={(v) => formatNumber(v, 0)}
          valueText={(v) =>
            `${formatNumber(v, 0)} ${energyUnitSpoken(unit)}, ${Math.round((100 * v) / (maint * f))} percent of maintenance`
          }
          onChange={(v) =>
            apply((x) => ({ ...x, energy: { kind: 'kcal', kcal: kJ ? Math.round(v / f) : v } }), 'energy')
          }
          onCommit={commit}
          note={`${Math.round((100 * e.kcal) / maint)} % · ${refLine}`}
        />
      ) : (
        <>
          <p className="sim-sub">
            No energy and no protein: water, electrolytes and black coffee or tea. Paint 2–3 days in a row for
            a multi-day fast, or insert an hour-exact fast from the raster bar.
          </p>
          <Switch
            checked={t.hydration?.electrolytes ?? DEFAULTS.fastElectrolytes}
            onChange={(v) => {
              apply((x) => ({ ...x, hydration: { ...x.hydration, electrolytes: v } }));
              commit();
            }}
            label="Electrolytes (salt, potassium, magnesium)"
            labelStyle="sentence"
          />
        </>
      )}
    </div>
  );
}

function SleepFields({
  t,
  apply,
  commit,
  usualBed,
  usualWake,
  usualQuality,
}: {
  t: DayTemplate;
  apply: (r: (t: DayTemplate) => DayTemplate, key?: string) => void;
  commit: () => void;
  usualBed: number;
  usualWake: number;
  usualQuality: 'poor' | 'fair' | 'good';
}) {
  const bed = t.sleep?.bedH ?? usualBed;
  const wake = t.sleep?.wakeH ?? usualWake;
  // one axis from 18:00 to 12:00 the next day
  const b = bed < 12 ? bed + 24 : bed;
  const w = wake + 24 <= b ? wake + 48 : wake < 18 ? wake + 24 : wake;
  const unwrap = (v: number) => ((v % 24) + 24) % 24;
  return (
    <div className="sim-sleep">
      <ScaleRange
        label="bed → wake"
        value={[Math.min(30, Math.max(18, b)), Math.min(36, Math.max(24, w))]}
        min={18}
        max={36}
        step={0.25}
        minGap={3}
        minorStep={1}
        majorStep={3}
        labels={[18, 21, 24, 27, 30, 33, 36].map((v) => ({
          value: v,
          label: String(unwrap(v)).padStart(2, '0'),
        }))}
        format={(v) => formatClock(unwrap(v))}
        thumbLabels={['bedtime', 'wake time']}
        valueText={(v, which) => `${which === 'low' ? 'bedtime' : 'wake time'} ${formatClock(unwrap(v))}`}
        onChange={([lo, hi]) =>
          apply(
            (x) => ({ ...x, sleep: { ...x.sleep, bedH: unwrap(lo), wakeH: unwrap(hi), hours: undefined } }),
            'sleep',
          )
        }
        onCommit={commit}
        note={`${formatNumber((w - b) % 24 || 24, 1)} h in bed${t.sleep ? '' : ' · same as usual'}`}
      />
      <div className="sim-row">
        <span className="sim-row__label">quality</span>
        <KeyBank
          size="sm"
          label="Sleep quality"
          options={[
            { value: 'poor', label: 'poor' },
            { value: 'fair', label: 'fair' },
            { value: 'good', label: 'good' },
          ]}
          value={t.sleep?.quality ?? usualQuality}
          onChange={(v) => {
            apply((x) => ({ ...x, sleep: { ...x.sleep, quality: v } }));
            commit();
          }}
        />
      </div>
      <Switch
        checked={t.sleep?.shiftWork ?? false}
        onChange={(v) => {
          apply((x) => ({ ...x, sleep: { ...x.sleep, shiftWork: v } }));
          commit();
        }}
        label="Shift work"
        labelStyle="sentence"
      />
      {t.sleep ? (
        <Key
          size="sm"
          variant="quiet"
          icon={RotateCcw}
          onClick={() => {
            apply((x) => {
              const { sleep: _drop, ...rest } = x;
              void _drop;
              return rest;
            });
            commit();
          }}
        >
          Same as usual
        </Key>
      ) : null}
    </div>
  );
}

const LEVERS: Array<{ key: keyof NonNullable<ScheduleModel['schedule']['adherence']>; label: string }> = [
  { key: 'selfMonitoring', label: 'Daily self-monitoring (food log or weighing)' },
  { key: 'mealReplacement', label: 'Meal replacements for 1–2 meals a day' },
  { key: 'preMealWater', label: 'About 500 mL of water before main meals' },
  { key: 'flexibleRestraint', label: 'Flexible rather than rigid restraint' },
];

/** Scenario-wide inputs: what "% of maintenance" means by default, and behavioural adherence levers. */
function ScenarioFields({ sid, model }: { sid: string; model: ScheduleModel }) {
  const unit = useEnergyUnit();
  const ref = model.schedule.defaults?.energyReference ?? 'baseline';
  const lev = model.schedule.adherence ?? {};
  return (
    <div className="sim-adv">
      <div className="sim-field">
        <span className="lm-eng">% of maintenance means</span>
        <KeyBank
          size="sm"
          block
          label="Energy reference"
          options={[
            { value: 'baseline', label: 'at the start' },
            { value: 'current', label: 'each day (adapts)' },
            { value: 'blockStart', label: 'block start' },
          ]}
          value={ref}
          onChange={(v) => void editSchedule(sid, [{ op: 'setEnergyReference', ref: v }])}
        />
        <span className="sim-row__def">
          {ref === 'baseline'
            ? `default · fixed to your maintenance at the start, ${en(model.maintenanceKcal, unit)}`
            : ref === 'current'
              ? 'follows the modelled maintenance day by day, so a deficit stays a deficit as you adapt'
              : 'resets to the modelled maintenance at the start of each named block'}
        </span>
      </div>
      <h4 className="sim-adv__h">Sticking with it</h4>
      <p className="sim-sub">
        These change how likely the plan is followed in the model, never what is eaten.
      </p>
      {LEVERS.map((l) => (
        <Switch
          key={l.key}
          checked={Boolean(lev[l.key])}
          onChange={(v) => void editSchedule(sid, [{ op: 'setAdherence', patch: { [l.key]: v } }])}
          label={l.label}
          labelStyle="sentence"
        />
      ))}
    </div>
  );
}

function FastEventFields({ sid, index, model }: { sid: string; index: number; model: ScheduleModel }) {
  const ev = model.schedule.events?.[index];
  if (!ev) return null;
  return (
    <div className="sim-fastev">
      <div className="sim-grid2">
        <TimeField
          label={`last meal · ${formatDayShort(addDaysISO(model.schedule.startDate, ev.startDay)).split(' ')[0]!.toLowerCase()}`}
          value={ev.startH}
          onChange={(h) => void editSchedule(sid, [{ op: 'updateFast', index, patch: { startH: h } }])}
        />
        <div className="sim-field">
          <span className="lm-eng">meal to meal</span>
          <Stepper
            name="fast length"
            value={ev.durationH}
            onChange={(v) => void editSchedule(sid, [{ op: 'updateFast', index, patch: { durationH: v } }])}
            min={12}
            max={240}
            step={12}
            unit="h"
          />
        </div>
      </div>
      <Switch
        checked={ev.electrolytes !== false}
        onChange={(v) => void editSchedule(sid, [{ op: 'updateFast', index, patch: { electrolytes: v } }])}
        label="Electrolytes during the fast"
        labelStyle="sentence"
      />
      <Switch
        checked={ev.refeed === 'auto'}
        onChange={(v) => void editSchedule(sid, [{ op: 'updateFast', index, patch: { refeed: v ? 'auto' : 'none' } }])}
        label="Restart food gradually afterwards"
        labelStyle="sentence"
      />
      <Key size="sm" variant="danger" icon={Trash2} onClick={() => void editSchedule(sid, [{ op: 'removeFast', index }])}>
        Remove this fast
      </Key>
    </div>
  );
}

/** "This day" inside a fast (QA 2026-10-01): the fast, not the painted program, decides what is eaten. */
function FastOverrideNote({
  fi,
  prog,
  energy,
  meals,
  startDate,
  onEditProgram,
}: {
  fi: DayFastInfo;
  prog: DayTemplate;
  /** The program's planned energy, formatted in the display unit. */
  energy: string;
  meals: number;
  startDate: string;
  onEditProgram: () => void;
}) {
  const span = fi.span;
  return (
    <div className="sim-editor__fasted" role="note">
      <span className="sim-chip sim-chip--fast">
        <Icon icon={Glyphs.FastClock} size={16} />
        fasted
      </span>
      <p>
        {span ? (
          <>
            Inside the {formatFastHours(span.hours)} fast · {fastWhen(span, startDate)}.{' '}
          </>
        ) : null}
        The fast overrides program {prog.id} on this day (<span style={{ whiteSpace: 'nowrap' }}>{energy}</span>, {meals} meal
        {meals === 1 ? '' : 's'}): nothing is eaten. Shorten, move or remove the fast to eat on this day; painting
        another program here changes nothing until then.
      </p>
      <Key size="sm" variant="quiet" onClick={onEditProgram}>
        Edit program {prog.id} instead
      </Key>
    </div>
  );
}

/** Refeed after a fast, from the compiled ramp ("2 days at 50 % → 75 % of the planned energy"). */
export function refeedText(span: FastSpan, compiled: ScheduleModel['compiled'], startDate: string): string {
  const ramp = refeedRamp(compiled, span);
  const ends = fastWhen(span, startDate).split(' → ')[1] ?? '';
  if (ramp.length > 0)
    return `Refeed from ${ends}: ${ramp.length} day${ramp.length === 1 ? '' : 's'} at ${ramp
      .map((f) => `${Math.round(f * 100)} %`)
      .join(' → ')} of the planned energy, then the program as painted.`;
  if (span.eventIndex >= 0) return `No graded refeed: food restarts at the planned amount at ${ends}.`;
  return `Water-only days: food restarts with the next painted program at ${ends}.`;
}
