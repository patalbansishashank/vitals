/**
 * Program list (COMPONENTS §5 ProgramKey): the lettered day templates as flat rows of the schedule card — no card in
 * the card. Each row reads its letter and name, then "80 % · 2 310 kcal", the eating window and training marks; the
 * full detail (macros, maintenance, training source, day count) is its accessible name. A tap on the row opens its
 * sheet (ProgramSheet: Edit all A days · Duplicate · Delete); the row keeps one key of its own, Paint, a toggle that
 * picks the program to paint with (pressed: the row takes the gold-soft wash and a gold letter; again lets it go). No
 * row has a ⋯ of its own: the header's is the screen's only one (SPEC §4). "New program" offers composition presets.
 */
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Glyphs, Icon, Key, Menu, cx, formatNumber, type EnergyUnitChoice } from '@/components';
import type { DayTemplate, ResolvedProfile } from '@/engine';
import { PRESETS, type PresetId } from '../presets';
import { resolveTemplate } from '../lib/resolve';
import { formatKcal } from '../lib/energy';
import { MAX_PROGRAMS } from '../lib/ops';
import { useEnergyUnit } from '@/state/settingsStore';
import { ProgramSheet } from './ProgramSheet';
import { habitualTraining, trainingMode, trainingSourceText, type TrainingMode } from '../lib/training';

export interface ProgramTrayProps {
  programs: readonly DayTemplate[];
  resolved: ResolvedProfile;
  /** Each program's maintenance reference at this plan's activity (R-MAINT), kcal/d; habitual when omitted. */
  maintKcal?: readonly number[];
  usage: readonly number[];
  /** The program picked to paint with (its Paint key is pressed). */
  armed: number | null;
  onArm: (index: number | null) => void;
  /** The sheet's actions; each one closes the sheet first. */
  onEdit: (index: number) => void;
  onAdd: (preset: PresetId) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  className?: string;
}

export interface ProgramSummary {
  /** The tile's second line: "80 % · 2 310 kcal" ("0 kcal · water only"). */
  text: string;
  /** Macros in words, for the accessible name: "protein 2.0 g/kg · carbs 202 g · fat 85 g". Empty for water-only. */
  macrosText: string;
  /** The maintenance reference behind the %: "maintenance 2 890 kcal". Empty for water-only programs. */
  kcalText: string;
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
      macrosText: '',
      kcalText: '',
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
  const len = d.windowLengthH;
  const whole = Math.abs(len - Math.round(len)) < 1e-6;
  const hm = (h: number) => {
    const m = Math.round((h % 1) * 60);
    return m ? `${Math.floor(h)}:${String(m).padStart(2, '0')}` : String(Math.floor(h));
  };
  return {
    text: `${pct} % · ${formatKcal(r.energyKcal, unit)} ${unit}`,
    macrosText: `protein ${formatNumber(pk, 1)} g/kg · carbs ${Math.round(r.carbG)} g · fat ${Math.round(r.fatG)} g`,
    kcalText: `maintenance ${formatKcal(maintKcal, unit)} ${unit}`,
    zero,
    // the eating window: "8 h eating" for whole hours, else the window itself ("8–19:30")
    window:
      d.nMeals > 1
        ? whole
          ? `${Math.round(len)} h eating`
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
  // the row whose sheet is open, by letter (indices shift when a program goes); kept while the sheet slides away
  const [sheet, setSheet] = useState<{ id: string; open: boolean } | null>(null);
  const si = sheet ? programs.findIndex((t) => t.id === sheet.id) : -1;
  const sp = si >= 0 ? programs[si]! : null;
  const ss = si >= 0 ? summaries[si]! : null;
  const act = (fn: (index: number) => void) => () => {
    if (si >= 0) fn(si);
  };
  return (
    <div className={cx('sim-tray', className)}>
      <ul className="sim-tray__keys" aria-label="Programs">
        {programs.map((t, i) => {
          const s = summaries[i]!;
          const on = armed === i;
          return (
            <li key={t.id} className="sim-pkey" data-program={t.id} data-armed={on || undefined}>
              <button
                type="button"
                className="sim-pkey__cap"
                aria-haspopup="dialog"
                onClick={() => setSheet({ id: t.id, open: true })}
                aria-label={`Program ${t.id}, ${t.label}, ${s.text}${s.macrosText ? `, ${s.macrosText}` : ''}${s.kcalText ? `, ${s.kcalText} at this plan's activity` : ''}, training ${s.trainingText}, ${usage[i] ?? 0} days`}
              >
                <span className="sim-pkey__letter">{t.id}</span>
                <span className="sim-pkey__name">{t.label}</span>
                <span className="sim-pkey__glyphs" aria-hidden="true">
                  <span className="sim-pkey__sum">{s.text}</span>
                  {s.zero ? null : s.window ? <span>{s.window}</span> : null}
                  {s.training === 'none' ? (
                    <span data-source="none">no training</span>
                  ) : (
                    <span className="sim-pkey__train" data-source={s.training}>
                      {s.lift ? <Icon icon={Glyphs.DumbbellPlate} size={16} /> : null}
                      {s.cardio || s.steps >= 12000 ? <Icon icon={Glyphs.Footsteps} size={16} /> : null}
                    </span>
                  )}
                </span>
              </button>
              {/* named apart from the raster bar's "Paint with A", which paints the selected days once */}
              <Key
                size="sm"
                className="sim-pkey__paint"
                pressed={on}
                aria-label={`Paint with program ${t.id}`}
                onClick={() => onArm(on ? null : i)}
              >
                Paint
              </Key>
            </li>
          );
        })}
      </ul>
      <Menu
        label="New program from a preset"
        placement="bottom-start"
        trigger={(tp) => (
          <button {...tp} type="button" className="sim-pkey--new" disabled={full}>
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
      <ProgramSheet
        open={!!sheet?.open && !!sp}
        program={sp}
        summary={ss ? [ss.text, ss.zero ? null : ss.window].filter(Boolean).join(' · ') : ''}
        days={si >= 0 ? (usage[si] ?? 0) : 0}
        full={full}
        last={programs.length <= 1}
        onClose={() => setSheet((x) => (x ? { ...x, open: false } : x))}
        onEdit={act(onEdit)}
        onDuplicate={act(onDuplicate)}
        onDelete={act(onDelete)}
      />
    </div>
  );
}
