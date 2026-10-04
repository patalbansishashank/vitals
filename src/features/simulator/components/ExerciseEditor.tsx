/**
 * Exercise section (COMPONENTS §5 SessionRow): resistance sessions (volume descriptor or hard sets by region,
 * proximity to failure, load, rest, style, time of day) and cardio (modality, duration, intensity by %VO2max / MET /
 * speed / power / RPE, carbohydrate during), plus steps. Defaults are the engine's (MODEL_SPEC §5.3).
 */
import { useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import {
  Glyphs,
  Icon,
  IconKey,
  Key,
  KeyBank,
  Menu,
  ScaleSlider,
  Select,
  Stepper,
  Switch,
  formatEnergy,
  formatNumber,
  type EnergyUnitChoice,
} from '@/components';
import type {
  CardioModality,
  CardioSession,
  DayTemplate,
  ExerciseSession,
  ResistanceSession,
  RtVolumePreset,
  TrainingRegion,
} from '@/engine';
import { DEFAULTS, RT_PRESETS, TRAINING_REGIONS } from '@/engine';
import { WEEKDAYS_SHORT, formatClock } from '../lib/calendar';
import { newSession, removeSession, sessionLabel, updateSession, type NewSessionKind } from '../editing';
import {
  TRAINING_MODE_LABEL,
  habitualText,
  trainingMode,
  withTrainingMode,
  type HabitualTraining,
  type TrainingMode,
} from '../lib/training';
import { TimeField } from './editorParts';

export interface ExerciseEditorProps {
  t: DayTemplate;
  apply: (recipe: (t: DayTemplate) => DayTemplate, key?: string) => void;
  commit: () => void;
  typicalSteps: number;
  /** The user's habitual training (Your body → habits): what "as usual" trains. */
  habitual: HabitualTraining;
  /** Weekday of the day being edited (0 = Monday), or null when editing the program's days in general. */
  weekday?: number | null;
  /** Settings › energy unit. */
  energyUnit?: EnergyUnitChoice;
}

const MODES: Array<{ value: TrainingMode; label: string }> = (['habitual', 'custom', 'none'] as const).map((m) => ({
  value: m,
  label: TRAINING_MODE_LABEL[m],
}));

const VOLUME: Array<{ value: RtVolumePreset; label: string }> = [
  { value: 'minimal', label: 'minimal' },
  { value: 'light', label: 'light' },
  { value: 'moderate', label: 'moderate' },
  { value: 'high', label: 'high' },
  { value: 'veryHigh', label: 'very high' },
];
const REGION_LABEL: Record<TrainingRegion, string> = {
  chest: 'chest',
  upperBack: 'upper back',
  shoulders: 'shoulders',
  arms: 'arms',
  core: 'core',
  glutes: 'glutes',
  quads: 'quads',
  hamstrings: 'hamstrings',
  calves: 'calves',
};
const MODALITIES: CardioModality[] = ['walk', 'run', 'cycle', 'swim', 'row', 'hiit', 'other'];
const ADD: Array<{ id: NewSessionKind; label: string }> = [
  { id: 'resistance', label: 'Resistance training' },
  { id: 'walk', label: 'Walk' },
  { id: 'run', label: 'Run' },
  { id: 'cycle', label: 'Cycle' },
  { id: 'swim', label: 'Swim' },
  { id: 'row', label: 'Row' },
  { id: 'hiit', label: 'HIIT' },
  { id: 'other', label: 'Other cardio' },
];

type IntensityMode = 'pct' | 'met' | 'speed' | 'power' | 'rpe';

function intensityMode(c: CardioSession): IntensityMode {
  if (c.met !== undefined) return 'met';
  if (c.speedKmh !== undefined) return 'speed';
  if (c.powerW !== undefined) return 'power';
  if (c.rpe !== undefined) return 'rpe';
  return 'pct';
}

function totalSets(r: ResistanceSession): number {
  if (r.setsByRegion) return Object.values(r.setsByRegion).reduce<number>((a, v) => a + (v ?? 0), 0);
  const p = RT_PRESETS[r.volume ?? 'moderate'];
  return (p.setsPerRegionWeek / p.sessionsPerWeek) * TRAINING_REGIONS.length;
}

export function sessionSummary(s: ExerciseSession): string {
  const dur =
    s.kind === 'resistance' ? (s.durationMin ?? totalSets(s) * DEFAULTS.rtMinPerSet) : s.durationMin;
  if (s.kind === 'resistance') {
    const vol = s.setsByRegion
      ? `${Math.round(totalSets(s))} hard sets`
      : `${VOLUME.find((v) => v.value === (s.volume ?? 'moderate'))!.label} volume`;
    return `${formatClock(s.startH)} · ${Math.round(dur)} min · ${vol} · RIR ${s.rir ?? DEFAULTS.rtRir}${s.toFailure ? ' · to failure' : ''}`;
  }
  const m = intensityMode(s);
  const inten =
    m === 'met'
      ? `${formatNumber(s.met!, 1)} MET`
      : m === 'speed'
        ? `${formatNumber(s.speedKmh!, 1)} km/h`
        : m === 'power'
          ? `${Math.round(s.powerW!)} W`
          : m === 'rpe'
            ? `RPE ${s.rpe}`
            : `${Math.round((s.pctVo2max ?? DEFAULTS.cardioPctVo2max[s.modality]) * 100)} % VO₂max`;
  return `${formatClock(s.startH)} · ${Math.round(dur)} min · ${inten}`;
}

export function ExerciseEditor({
  t,
  apply,
  commit,
  typicalSteps,
  habitual,
  weekday = null,
  energyUnit = 'kcal',
}: ExerciseEditorProps) {
  const [open, setOpen] = useState<number | null>(null);
  const ex = t.exercise ?? [];
  const mode = trainingMode(t);
  const set = (i: number, patch: Partial<ExerciseSession>, key = `ex:${i}`) =>
    apply((x) => updateSession(x, i, patch), key);
  return (
    <div className="sim-ex">
      <div className="sim-field sim-ex__source">
        <span className="lm-eng">training</span>
        <KeyBank
          size="sm"
          block
          label="Training"
          options={MODES}
          value={mode}
          onChange={(m) => {
            apply((x) => withTrainingMode(x, m));
            commit();
            setOpen(null);
          }}
        />
        <span className="sim-row__def">
          {mode === 'habitual'
            ? `from Your body: ${habitualText(habitual)}`
            : mode === 'custom'
              ? 'these days train the sessions below instead of your usual training'
              : 'no training on these days; steps still count'}
        </span>
      </div>
      {mode === 'habitual' ? <UsualTraining habitual={habitual} weekday={weekday} energyUnit={energyUnit} /> : null}
      {mode === 'habitual' && ex.length > 0 ? <p className="lm-eng sim-ex__extra">plus these sessions</p> : null}
      {mode === 'none' ? <p className="sim-empty">No sessions. Steps below still count.</p> : null}
      <ul className="sim-ex__list">
        {ex.map((s, i) => (
          <li key={i} className="sim-session" data-open={open === i || undefined}>
            <div className="sim-session__row">
              <Icon
                icon={
                  s.kind === 'resistance'
                    ? Glyphs.DumbbellPlate
                    : s.modality === 'run' || s.modality === 'hiit'
                      ? Glyphs.RunGlyph
                      : Glyphs.Footsteps
                }
                size={20}
              />
              <button
                type="button"
                className="sim-session__sum"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
              >
                <b>
                  {s.kind === 'resistance'
                    ? 'Resistance'
                    : sessionLabel(s).replace(/^./, (c) => c.toUpperCase())}
                </b>
                <span>{sessionSummary(s)}</span>
              </button>
              <Icon icon={ChevronDown} size={16} className="sim-session__chev" />
              <IconKey
                size="sm"
                variant="quiet"
                icon={X}
                label={`Remove ${sessionLabel(s)} session`}
                onClick={() => {
                  apply((x) => removeSession(x, i));
                  commit();
                  setOpen(null);
                }}
              />
            </div>
            {open === i ? (
              s.kind === 'resistance' ? (
                <ResistanceFields s={s} set={(p, k) => set(i, p, k)} commit={commit} />
              ) : (
                <CardioFields s={s} set={(p, k) => set(i, p, k)} commit={commit} />
              )
            ) : null}
          </li>
        ))}
      </ul>
      <div className="sim-ex__add">
        <Menu
          label="Add a session"
          placement="bottom-start"
          trigger={(tp) => (
            <Key {...tp} size="sm" variant="quiet" icon={Plus} disabled={ex.length >= 6}>
              {mode === 'habitual' ? 'Add an extra session' : 'Add'}
            </Key>
          )}
          items={ADD.map((a) => ({
            id: a.id,
            label: a.label,
            onSelect: () => {
              // adding to "none" makes the days' training custom; "as usual" keeps the usual sessions and adds one
              apply((x) => ({
                ...x,
                habitualTraining: x.habitualTraining === true,
                exercise: [...(x.exercise ?? []), newSession(a.id)],
              }));
              commit();
              setOpen(ex.length);
            },
          }))}
        />
      </div>
      <ScaleSlider
        label="steps"
        size="sm"
        value={t.steps ?? typicalSteps}
        min={0}
        max={30000}
        step={500}
        majorStep={5000}
        minorStep={1000}
        labels={[0, 15000, 30000].map((v) => ({ value: v, label: v === 0 ? '0' : `${v / 1000}k` }))}
        reference={{ value: typicalSteps, label: 'your typical' }}
        format={(v) => formatNumber(v, 0)}
        valueText={(v) => `${formatNumber(v, 0)} steps a day`}
        onChange={(v) => apply((x) => ({ ...x, steps: v }), 'steps')}
        onCommit={commit}
        note={
          t.steps === undefined ? `default: your typical ${formatNumber(typicalSteps, 0)} a day` : undefined
        }
      />
    </div>
  );
}

/**
 * The habitual week's sessions, read-only (Your body → habits is where they change), with this day's own entry when a
 * day is open, and their weekly energy — already part of maintenance, so training as usual moves nothing.
 */
function UsualTraining({
  habitual,
  weekday,
  energyUnit,
}: {
  habitual: HabitualTraining;
  weekday: number | null;
  energyUnit: EnergyUnitChoice;
}) {
  if (habitual.perWeek === 0)
    return (
      <p className="sim-usual__none">
        Your body lists no regular training sessions, so “as usual” adds none. Set sessions a week in Your body → habits,
        or choose custom.
      </p>
    );
  const today = weekday !== null ? (habitual.byWeekday[weekday] ?? []) : null;
  // the usual week's lifting volume, per region (the number the summary strip and the volume presets use)
  const perRegion = habitual.sessions.reduce(
    (a, { session: x }) => a + (x.kind === 'resistance' ? (x.setsByRegion?.chest ?? 0) : 0),
    0,
  );
  const brief = (x: ExerciseSession) =>
    `${x.kind === 'resistance' ? 'lift' : 'cardio'} · ${formatClock(x.startH)} · ${Math.round(x.durationMin ?? 60)} min`;
  return (
    <div className="sim-usual" role="group" aria-label="Your usual training (read-only)">
      {today !== null && weekday !== null ? (
        <p className="sim-usual__today">
          <b>{WEEKDAYS_SHORT[weekday]}</b>{' '}
          {today.length > 0
            ? `· ${today.map(brief).join(' · ')}`
            : '· a rest day in your usual week'}
        </p>
      ) : null}
      <ul className="sim-usual__list">
        {habitual.sessions.map(({ weekday: w, session }, i) => (
          <li key={i} data-today={w === weekday || undefined}>
            <Icon icon={session.kind === 'resistance' ? Glyphs.DumbbellPlate : Glyphs.RunGlyph} size={16} />
            <span className="sim-usual__wd">{WEEKDAYS_SHORT[w]}</span>
            <span>{brief(session)}</span>
          </li>
        ))}
      </ul>
      <p className="sim-sub">
        {perRegion > 0 ? `lifting ≈ ${formatNumber(perRegion, 0)} hard sets per region a week · ` : ''}≈{' '}
        {formatEnergy(habitual.kcalPerWeek, energyUnit, { step: 10 })} of exercise a week, already inside your
        maintenance · change it in Your body → habits
      </p>
    </div>
  );
}

function ResistanceFields({
  s,
  set,
  commit,
}: {
  s: ResistanceSession;
  set: (p: Partial<ResistanceSession>, key?: string) => void;
  commit: () => void;
}) {
  const byRegion = Boolean(s.setsByRegion);
  const once = (p: Partial<ResistanceSession>) => {
    set(p);
    commit();
  };
  return (
    <div className="sim-session__body">
      <div className="sim-grid2">
        <TimeField label="start" value={s.startH} onChange={(h) => once({ startH: h })} />
        <div className="sim-field">
          <span className="lm-eng">duration</span>
          <Stepper
            name="duration"
            value={s.durationMin ?? Math.round(totalSets(s) * DEFAULTS.rtMinPerSet)}
            onChange={(v) => once({ durationMin: v })}
            min={10}
            max={240}
            step={5}
            unit="min"
          />
        </div>
      </div>
      <div className="sim-field">
        <span className="lm-eng">volume</span>
        <KeyBank
          size="sm"
          block
          label="Volume"
          options={[
            { value: 'preset', label: 'descriptor' },
            { value: 'regions', label: 'hard sets by region' },
          ]}
          value={byRegion ? 'regions' : 'preset'}
          onChange={(v) => {
            if (v === 'regions') {
              const p = RT_PRESETS[s.volume ?? 'moderate'];
              const per = Math.round((p.setsPerRegionWeek / p.sessionsPerWeek) * 2) / 2;
              once({
                setsByRegion: Object.fromEntries(
                  TRAINING_REGIONS.map((r) => [r, per]),
                ) as ResistanceSession['setsByRegion'],
                volume: undefined,
              });
            } else once({ setsByRegion: undefined, volume: s.volume ?? 'moderate' });
          }}
        />
        {byRegion ? (
          <div className="sim-regions">
            {TRAINING_REGIONS.map((r) => (
              <div key={r} className="sim-field">
                <span className="lm-eng">{REGION_LABEL[r]}</span>
                <Stepper
                  name={`${REGION_LABEL[r]} sets`}
                  value={s.setsByRegion?.[r] ?? 0}
                  onChange={(v) => once({ setsByRegion: { ...s.setsByRegion, [r]: v } })}
                  min={0}
                  max={20}
                  step={0.5}
                  unit="sets"
                />
              </div>
            ))}
          </div>
        ) : (
          <KeyBank
            size="sm"
            block
            label="Volume descriptor"
            options={VOLUME}
            value={s.volume ?? 'moderate'}
            onChange={(v) => once({ volume: v })}
          />
        )}
      </div>
      <div className="sim-grid2">
        <div className="sim-field">
          <span className="lm-eng">reps in reserve</span>
          <Stepper
            name="reps in reserve"
            value={s.rir ?? DEFAULTS.rtRir}
            onChange={(v) => once({ rir: v })}
            min={0}
            max={5}
            step={1}
          />
        </div>
        <div className="sim-field">
          <span className="lm-eng">load</span>
          <Stepper
            name="load"
            value={s.loadPct1RM ?? DEFAULTS.rtLoadPct1RM}
            onChange={(v) => once({ loadPct1RM: v })}
            min={30}
            max={100}
            step={5}
            unit="% 1RM"
          />
        </div>
        <div className="sim-field">
          <span className="lm-eng">rest between sets</span>
          <Stepper
            name="rest"
            value={s.restSec ?? DEFAULTS.rtRestSec}
            onChange={(v) => once({ restSec: v })}
            min={30}
            max={300}
            step={15}
            unit="s"
          />
        </div>
        <div className="sim-field">
          <span className="lm-eng">style</span>
          <Select
            label="Training style"
            value={s.style ?? 'general'}
            onChange={(v) => once({ style: v })}
            options={[
              { value: 'general', label: 'general' },
              { value: 'heavyCompound', label: 'heavy compound' },
              { value: 'bodybuilding', label: 'bodybuilding' },
              { value: 'circuit', label: 'circuit' },
              { value: 'bodyweight', label: 'bodyweight' },
            ]}
          />
        </div>
      </div>
      <Switch
        checked={s.toFailure ?? false}
        onChange={(v) => once({ toFailure: v })}
        label="Sets taken to failure"
        labelStyle="sentence"
      />
      <Switch
        checked={s.coldWaterImmersion ?? false}
        onChange={(v) => once({ coldWaterImmersion: v })}
        label="Cold-water immersion straight after (blunts muscle gain)"
        labelStyle="sentence"
      />
    </div>
  );
}

function CardioFields({
  s,
  set,
  commit,
}: {
  s: CardioSession;
  set: (p: Partial<CardioSession>, key?: string) => void;
  commit: () => void;
}) {
  const mode = intensityMode(s);
  const once = (p: Partial<CardioSession>) => {
    set(p);
    commit();
  };
  const clearAll = {
    pctVo2max: undefined,
    met: undefined,
    speedKmh: undefined,
    powerW: undefined,
    rpe: undefined,
  };
  const def = DEFAULTS.cardioPctVo2max[s.modality];
  return (
    <div className="sim-session__body">
      <div className="sim-grid2">
        <div className="sim-field">
          <span className="lm-eng">modality</span>
          <Select
            label="Modality"
            value={s.modality}
            onChange={(v) => once({ modality: v })}
            options={MODALITIES.map((m) => ({ value: m, label: m === 'hiit' ? 'HIIT' : m }))}
          />
        </div>
        <TimeField label="start" value={s.startH} onChange={(h) => once({ startH: h })} />
        <div className="sim-field">
          <span className="lm-eng">duration</span>
          <Stepper
            name="duration"
            value={s.durationMin}
            onChange={(v) => once({ durationMin: v })}
            min={5}
            max={360}
            step={5}
            unit="min"
          />
        </div>
        <div className="sim-field">
          <span className="lm-eng">carbs during</span>
          <Stepper
            name="carbs during"
            value={s.carbDuringGPerH ?? 0}
            onChange={(v) => once({ carbDuringGPerH: v })}
            min={0}
            max={120}
            step={5}
            unit="g/h"
          />
        </div>
      </div>
      <div className="sim-field">
        <span className="lm-eng">intensity</span>
        <KeyBank
          size="sm"
          block
          label="Intensity measure"
          options={[
            { value: 'pct', label: '% VO₂max' },
            { value: 'met', label: 'MET' },
            { value: 'speed', label: 'km/h' },
            { value: 'power', label: 'watts' },
            { value: 'rpe', label: 'RPE' },
          ]}
          value={mode}
          onChange={(m) => {
            const v = {
              pct: { pctVo2max: def },
              met: { met: 6 },
              speed: { speedKmh: s.modality === 'run' ? 10 : 5 },
              power: { powerW: 150 },
              rpe: { rpe: 5 },
            }[m];
            once({ ...clearAll, ...v });
          }}
        />
        {mode === 'pct' ? (
          <Stepper
            name="intensity"
            value={Math.round((s.pctVo2max ?? def) * 100)}
            onChange={(v) => once({ pctVo2max: v / 100 })}
            min={20}
            max={100}
            step={5}
            unit="% VO₂max"
          />
        ) : mode === 'met' ? (
          <Stepper
            name="MET"
            value={s.met ?? 6}
            onChange={(v) => once({ met: v })}
            min={1.5}
            max={20}
            step={0.5}
            unit="MET"
          />
        ) : mode === 'speed' ? (
          <Stepper
            name="speed"
            value={s.speedKmh ?? 8}
            onChange={(v) => once({ speedKmh: v })}
            min={2}
            max={30}
            step={0.5}
            unit="km/h"
          />
        ) : mode === 'power' ? (
          <Stepper
            name="power"
            value={s.powerW ?? 150}
            onChange={(v) => once({ powerW: v })}
            min={30}
            max={500}
            step={10}
            unit="W"
          />
        ) : (
          <Stepper
            name="RPE"
            value={s.rpe ?? 5}
            onChange={(v) => once({ rpe: v })}
            min={1}
            max={10}
            step={1}
            unit="of 10"
          />
        )}
        {mode === 'pct' && s.pctVo2max === undefined ? (
          <span className="sim-row__def">
            default for {s.modality}: {Math.round(def * 100)} % VO₂max
          </span>
        ) : null}
      </div>
    </div>
  );
}
