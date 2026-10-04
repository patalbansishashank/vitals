/**
 * Per-exercise log controls, chosen by the exercise's intensity scale and the person's log style: quick (a chip per
 * planned set — tap the sets you did), detailed (kg, reps, reps left per set), duration (minutes; speed and incline for
 * speed-scaled items such as a treadmill). Nothing is logged until a control is touched; untouched exercises count as
 * planned when the session is saved.
 */
import type { ConcreteItem, ExerciseRecord } from '@/catalogues';
import { Key, NumberField } from '@/components';
import { TRAIN_COPY } from '../copy';
import { isMinutesItem, plannedSets, type ItemLog, type LogStyle, type SetLog } from '../session';

export type ControlKind = 'chips' | 'sets' | 'minutes';

export function controlKind(item: Pick<ConcreteItem, 'sets'>, style: LogStyle): ControlKind {
  if (isMinutesItem(item) || style === 'duration') return 'minutes';
  return style === 'detailed' ? 'sets' : 'chips';
}

export interface LogControlsProps {
  item: ConcreteItem;
  ex: ExerciseRecord | undefined;
  /** Short exercise name for control labels ("dand"). */
  name: string;
  style: LogStyle;
  log: ItemLog | undefined;
  /** Ticked as planned: chips show every set done. */
  ticked: boolean;
  /** The person's weight for the implement, when known. */
  loadKg?: number;
  onLog: (log: ItemLog | null) => void;
}

export function LogControls(p: LogControlsProps) {
  const kind = controlKind(p.item, p.style);
  if (kind === 'chips') return <SetChips {...p} />;
  if (kind === 'sets') return <SetFields {...p} />;
  return <MinutesFields {...p} />;
}

function amountOf(item: ConcreteItem): { short: string; spoken: string } {
  if (item.reps !== undefined) return { short: String(item.reps), spoken: TRAIN_COPY.chipReps(item.reps) };
  const sec = item.holdSec ?? item.workSec;
  if (sec !== undefined) return { short: `${sec} s`, spoken: TRAIN_COPY.chipSec(sec) };
  return { short: '', spoken: '' };
}

function SetChips({ item, name, log, ticked, onLog }: LogControlsProps) {
  const n = Math.max(1, plannedSets(item));
  const done = log?.kind === 'chips' ? Array.from({ length: n }, (_, k) => !!log.done[k]) : Array.from({ length: n }, () => ticked);
  const amount = amountOf(item);
  const toggle = (k: number) => {
    const next = done.slice();
    next[k] = !next[k];
    onLog(next.some(Boolean) ? { kind: 'chips', done: next } : null);
  };
  return (
    <div className="lv-train-chips" role="group" aria-label={TRAIN_COPY.chips(name)}>
      <span className="lm-eng" aria-hidden="true">
        {TRAIN_COPY.setWord}
      </span>
      {done.map((on, k) => (
        <button
          key={k}
          type="button"
          className="lv-train-chip"
          aria-pressed={on}
          aria-label={TRAIN_COPY.chip(k + 1, amount.spoken || String(k + 1))}
          onClick={() => toggle(k)}
        >
          <span className="lv-train-chip__k" aria-hidden="true">
            {k + 1}
          </span>
          {amount.short ? (
            <span className="lv-train-chip__v lm-num" aria-hidden="true">
              {amount.short}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function initialSets(item: ConcreteItem, loadKg: number | undefined): SetLog[] {
  const n = Math.max(1, plannedSets(item));
  const kg = item.loadKg ?? loadKg;
  const rir = item.rir !== undefined ? Math.round(item.rir) : undefined;
  return Array.from({ length: n }, () => ({ ...(kg !== undefined ? { loadKg: kg } : {}), ...(item.reps !== undefined ? { reps: item.reps } : {}), ...(rir !== undefined ? { rir } : {}) }));
}

function SetFields({ item, ex, name, log, loadKg, onLog }: LogControlsProps) {
  const sets = log?.kind === 'sets' ? log.sets : initialSets(item, loadKg);
  const showKg = item.loadKg !== undefined || loadKg !== undefined || ex?.intensityScale === 'pct1RM' || ex?.intensityScale === 'kgRpe' || ex?.loadType === 'external';
  const set = (k: number, patch: Partial<SetLog>) => onLog({ kind: 'sets', sets: sets.map((s, i) => (i === k ? { ...s, ...patch } : s)) });
  const last = sets[sets.length - 1];
  return (
    <div className="lv-train-sets" role="group" aria-label={TRAIN_COPY.chips(name)}>
      {sets.map((s, k) => (
        <div key={k} className="lv-train-sets__row">
          <span className="lm-eng lv-train-sets__k">{TRAIN_COPY.setLabel(k + 1)}</span>
          {showKg ? (
            <NumberField value={s.loadKg ?? null} onChange={(v) => set(k, { loadKg: v })} min={0} max={500} step={0.5} decimals={1} unit={TRAIN_COPY.kg} name={`${name} ${TRAIN_COPY.setLabel(k + 1)} ${TRAIN_COPY.kg}`} />
          ) : null}
          <NumberField value={s.reps ?? null} onChange={(v) => set(k, { reps: v })} min={0} max={500} step={1} inputMode="numeric" unit={TRAIN_COPY.reps} name={`${name} ${TRAIN_COPY.setLabel(k + 1)} ${TRAIN_COPY.reps}`} />
          <NumberField value={s.rir ?? null} onChange={(v) => set(k, { rir: v })} min={0} max={10} step={1} inputMode="numeric" unit={TRAIN_COPY.repsLeft} name={`${name} ${TRAIN_COPY.setLabel(k + 1)} ${TRAIN_COPY.repsLeft}`} />
        </div>
      ))}
      <div className="lv-train-sets__keys">
        <Key size="sm" variant="quiet" onClick={() => onLog({ kind: 'sets', sets: [...sets, { ...(last ?? {}) }] })}>
          {TRAIN_COPY.addSet}
        </Key>
        {sets.length > 1 ? (
          <Key size="sm" variant="quiet" onClick={() => onLog({ kind: 'sets', sets: sets.slice(0, -1) })}>
            {TRAIN_COPY.removeSet}
          </Key>
        ) : null}
      </div>
    </div>
  );
}

function MinutesFields({ item, ex, name, log, onLog }: LogControlsProps) {
  const cur = log?.kind === 'minutes' ? log : { kind: 'minutes' as const, minutes: Math.max(1, Math.round(item.minutes)), ...(item.perf.speedKmh !== undefined ? { speedKmh: item.perf.speedKmh } : {}), ...(item.perf.gradePct !== undefined ? { gradePct: item.perf.gradePct } : {}) };
  const speed = ex?.intensityScale === 'speed';
  return (
    <div className="lv-train-sets" role="group" aria-label={TRAIN_COPY.chips(name)}>
      <div className="lv-train-sets__row">
        <NumberField value={cur.minutes} onChange={(v) => onLog({ ...cur, minutes: Math.max(1, v) })} min={1} max={600} step={1} inputMode="numeric" unit="min" name={`${name} ${TRAIN_COPY.minutes}`} />
        {speed ? (
          <>
            <NumberField value={cur.speedKmh ?? null} onChange={(v) => onLog({ ...cur, speedKmh: v })} min={1} max={30} step={0.1} decimals={1} unit="km/h" name={`${name} ${TRAIN_COPY.speed}`} />
            <NumberField value={cur.gradePct ?? null} onChange={(v) => onLog({ ...cur, gradePct: v })} min={0} max={40} step={0.5} decimals={1} unit="%" name={`${name} ${TRAIN_COPY.incline}`} />
          </>
        ) : null}
      </div>
    </div>
  );
}
