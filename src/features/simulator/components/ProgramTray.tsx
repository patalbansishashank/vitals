/**
 * Program tray (COMPONENTS §5 ProgramKey): the lettered day templates as Braun memory keys. Click arms a key for
 * painting (pressed cap + yellow indicator), click again disarms. Each key summarises energy, macros, window and
 * exercise, with its day count; its menu edits, duplicates or deletes it. "+ New program" offers composition presets.
 */
import { useMemo } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { Glyphs, Icon, IconKey, Menu, cx, formatNumber, type EnergyUnitChoice } from '@/components';
import type { DayTemplate, ResolvedProfile } from '@/engine';
import { PRESETS, type PresetId } from '../presets';
import { resolveTemplate } from '../lib/resolve';
import { formatKcal } from '../lib/energy';
import { MAX_PROGRAMS } from '../lib/ops';
import { useEnergyUnit } from '@/state/settingsStore';
import { habitualTraining, trainingMode, trainingSourceText, type TrainingMode } from '../lib/training';

export interface ProgramTrayProps {
  programs: readonly DayTemplate[];
  resolved: ResolvedProfile;
  /** Each program's maintenance reference at this plan's activity (R-MAINT), kcal/d; habitual when omitted. */
  maintKcal?: readonly number[];
  usage: readonly number[];
  armed: number | null;
  onArm: (index: number | null) => void;
  onEdit: (index: number) => void;
  onAdd: (preset: PresetId) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  className?: string;
}

export interface ProgramSummary {
  text: string;
  /** Resolved energy and the reference it came from: "2 410 kcal of 2 840". Empty for water-only programs. */
  kcalText: string;
  shares: [number, number, number] | null;
  zero: boolean;
  window: string | null;
  lift: boolean;
  cardio: boolean;
  /** Training source (R-DETRAIN): as usual (the habitual week), custom sessions, or none. */
  training: TrainingMode;
  /** "as usual (from Your body: 3 sessions/week · …)" / "custom sessions" / "none". */
  trainingText: string;
  steps: number;
}

export function summariseProgram(
  t: DayTemplate,
  resolved: ResolvedProfile,
  maintKcal: number = resolved.tdee0Kcal,
  unit: EnergyUnitChoice = 'kcal',
): ProgramSummary {
  // a % program resolves against the plan's maintenance reference (R-MAINT), not a one-day compile's
  const tAtRef: DayTemplate = t.energy.kind === 'pctMaintenance' ? { ...t, energy: { kind: 'kcal', kcal: (t.energy.pct / 100) * maintKcal } } : t;
  const r = resolveTemplate(tAtRef === t ? t : tAtRef, resolved);
  const d = r.day;
  const zero = t.energy.kind === 'zero' || r.energyKcal === 0;
  const training = trainingMode(t);
  const h = habitualTraining(resolved);
  const lift = (t.exercise ?? []).some((e) => e.kind === 'resistance') || (training === 'habitual' && h.lifts > 0);
  const cardio = (t.exercise ?? []).some((e) => e.kind === 'cardio') || (training === 'habitual' && h.cardio > 0);
  const trainingText = trainingSourceText(training, h);
  if (zero)
    return {
      text: `0 ${unit} · water only`,
      kcalText: '',
      shares: null,
      zero,
      window: null,
      lift,
      cardio,
      training,
      trainingText,
      steps: d.steps,
    };
  const pct = t.energy.kind === 'pctMaintenance' ? Math.round(t.energy.pct) : maintKcal > 0 ? Math.round((100 * r.energyKcal) / maintKcal) : 0;
  const pk = r.proteinG / resolved.weightKg;
  const kc = 4 * r.proteinG + 4 * r.carbG + 9 * r.fatG || 1;
  const len = d.windowLengthH;
  const whole = Math.abs(len - Math.round(len)) < 1e-6;
  const hm = (h: number) => {
    const m = Math.round((h % 1) * 60);
    return m ? `${Math.floor(h)}:${String(m).padStart(2, '0')}` : String(Math.floor(h));
  };
  return {
    text: `${pct} % · P${formatNumber(pk, 1)} C${Math.round(r.carbG)} F${Math.round(r.fatG)}`,
    kcalText: `${formatKcal(r.energyKcal, unit)} ${unit} · maint. ${formatKcal(maintKcal, unit)}`,
    shares: [(4 * r.proteinG) / kc, (4 * r.carbG) / kc, (9 * r.fatG) / kc],
    zero,
    // fast:window ("16:8") for whole hours, else the window itself ("8–19:30")
    window:
      d.nMeals > 1
        ? whole
          ? `${24 - Math.round(len)}:${Math.round(len)}`
          : `${hm(d.windowStartH)}–${hm(d.windowStartH + len)}`
        : d.nMeals === 1
          ? '1 meal'
          : null,
    lift,
    cardio,
    training,
    trainingText,
    steps: d.steps,
  };
}

export function MacroMicroBar({
  shares,
  zero,
  className,
}: {
  shares: [number, number, number] | null;
  zero?: boolean;
  className?: string;
}) {
  return (
    <span className={cx('sim-microbar', className)} aria-hidden="true" data-zero={zero || undefined}>
      {shares ? (
        <>
          <i style={{ flexGrow: shares[0], background: 'var(--lm-macro-protein)' }} />
          <i style={{ flexGrow: shares[1], background: 'var(--lm-macro-carbs)' }} />
          <i style={{ flexGrow: shares[2], background: 'var(--lm-macro-fat)' }} />
        </>
      ) : null}
    </span>
  );
}

export function ProgramTray({
  programs,
  resolved,
  maintKcal,
  usage,
  armed,
  onArm,
  onEdit,
  onAdd,
  onDuplicate,
  onDelete,
  className,
}: ProgramTrayProps) {
  const unit = useEnergyUnit();
  const summaries = useMemo(
    () => programs.map((t, i) => summariseProgram(t, resolved, maintKcal?.[i], unit)),
    [programs, resolved, maintKcal, unit],
  );
  const full = programs.length >= MAX_PROGRAMS;
  return (
    <div className={cx('sim-tray', className)}>
      <div className="sim-tray__head">
        <span className="lm-eng">program keys</span>
        <span className="lm-eng">
          {programs[0]?.id}
          {programs.length > 1 ? `–${programs[programs.length - 1]!.id}` : ''}
        </span>
      </div>
      <div className="sim-tray__keys" role="radiogroup" aria-label="Program keys: pick one to paint with">
        {programs.map((t, i) => {
          const s = summaries[i]!;
          const on = armed === i;
          return (
            <div key={t.id} className="sim-pkey" data-armed={on || undefined}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                className="sim-pkey__cap"
                onClick={() => onArm(on ? null : i)}
                aria-label={`Program ${t.id}, ${t.label}, ${s.text}${s.kcalText ? `, ${s.kcalText} at this plan's activity` : ''}, training ${s.trainingText}, ${usage[i] ?? 0} days`}
                title={s.kcalText ? `${s.kcalText} — 100 % is maintenance at this plan’s activity` : undefined}
              >
                <span className="sim-pkey__l1">
                  <span className="sim-pkey__letter">{t.id}</span>
                  <span className="sim-pkey__ind" aria-hidden="true" />
                  <span className="sim-pkey__name">{t.label}</span>
                </span>
                <span className="sim-pkey__sum">{s.text}</span>
                {s.kcalText ? <span className="sim-pkey__kcal">{s.kcalText}</span> : null}
                <MacroMicroBar shares={s.shares} zero={s.zero} className="sim-pkey__bar" />
                <span className="sim-pkey__glyphs" aria-hidden="true">
                  {s.zero ? (
                    <span>
                      <Icon icon={Glyphs.FastClock} size={16} />
                      water
                    </span>
                  ) : s.window ? (
                    <span>
                      <Icon icon={Glyphs.MealDot} size={16} />
                      {s.window}
                    </span>
                  ) : null}
                  {s.training === 'habitual' ? (
                    <span className="sim-pkey__src sim-legend__usual" data-source="habitual">
                      {s.lift ? <Icon icon={Glyphs.DumbbellPlate} size={16} /> : null}
                      {s.cardio ? <Icon icon={Glyphs.Footsteps} size={16} /> : null}
                      as usual
                    </span>
                  ) : s.training === 'none' ? (
                    <span className="sim-pkey__src" data-source="none">
                      no training
                    </span>
                  ) : (
                    <>
                      {s.lift ? <Icon icon={Glyphs.DumbbellPlate} size={16} /> : null}
                      {s.cardio ? <Icon icon={Glyphs.Footsteps} size={16} /> : null}
                    </>
                  )}
                  {s.steps >= 12000 && !s.cardio ? <Icon icon={Glyphs.Footsteps} size={16} /> : null}
                  <span className="sim-pkey__count">{usage[i] ?? 0} d</span>
                </span>
              </button>
              <Menu
                label={`Program ${t.id} actions`}
                placement="bottom-end"
                trigger={(tp) => (
                  <IconKey
                    {...tp}
                    className="sim-pkey__more"
                    icon={MoreHorizontal}
                    label={`Program ${t.id} actions`}
                    size="sm"
                    variant="quiet"
                  />
                )}
                items={[
                  { id: 'edit', label: `Edit all ${t.id} days`, onSelect: () => onEdit(i) },
                  { id: 'dup', label: 'Duplicate', onSelect: () => onDuplicate(i), disabled: full },
                  {
                    id: 'del',
                    label: (usage[i] ?? 0) > 0 ? 'Delete · replace with…' : 'Delete',
                    tone: 'danger',
                    onSelect: () => onDelete(i),
                    disabled: programs.length <= 1,
                    separatorBefore: true,
                  },
                ]}
              />
            </div>
          );
        })}
        <Menu
          label="New program from a preset"
          placement="bottom-start"
          trigger={(tp) => (
            <button {...tp} type="button" className="sim-pkey sim-pkey--new" disabled={full}>
              <Icon icon={Plus} size={16} />
              New program
            </button>
          )}
          items={PRESETS.map((pr) => ({
            id: pr.id,
            label: pr.name,
            hint: pr.alias,
            onSelect: () => onAdd(pr.id),
          }))}
        />
      </div>
    </div>
  );
}
