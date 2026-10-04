/**
 * One exercise of a session (PrescriptionRow look, COMPONENTS §13.10): name (full on first use), the prescription in
 * plain words, energy for cardio-like items, the log controls, and the keys — tick = done as planned, Swap ›, skip.
 */
import { Check, ChevronRight } from 'lucide-react';
import type { ConcreteItem, EquivalenceResult, ExerciseRecord } from '@/catalogues';
import { Icon, Key, VisuallyHidden, energyInText } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import { EquivalenceMeter } from '../../components/EquivalenceMeter';
import { TRAIN_COPY } from '../copy';
import { rxWords, shortName, type ItemLog, type ItemState, type LogStyle } from '../session';
import { LogControls } from './LogControls';

export interface ExerciseRowProps {
  /** The item as it will be done (the swap when there is one). */
  item: ConcreteItem;
  /** The plan's item when swapped. */
  original: ConcreteItem | null;
  /** Display name (full on first use). */
  name: string;
  ex: ExerciseRecord | undefined;
  state: ItemState;
  log: ItemLog | undefined;
  style: LogStyle;
  /** Logging is open (not a preview, not a logged session). */
  interactive: boolean;
  energy: boolean;
  loadKg?: number;
  /** "Wednesday" for the every-weekday proposal. */
  weekday: string;
  onTick: () => void;
  onSkip: () => void;
  onSwap: () => void;
  onUndoSwap: () => void;
  onPropose: () => void;
  /** A swapped row: how close the swap comes to what was prescribed (the credit it gets). */
  equivalence?: { result: EquivalenceResult; target: string } | undefined;
  onLog: (log: ItemLog | null) => void;
}

export function ExerciseRow(p: ExerciseRowProps) {
  const short = shortName(p.item.name);
  const eu = useEnergyUnit();
  return (
    <li className="lv-train-row" data-state={p.state}>
      <div className="lv-train-row__main">
        <h3 className="lv-train-row__name">{p.name}</h3>
        <p className="lv-train-row__rx">{energyInText(rxWords(p.item, p.ex, { energy: p.energy }), eu)}</p>
        {p.interactive ? <VisuallyHidden>{TRAIN_COPY.state[p.state]}</VisuallyHidden> : null}
        {p.original ? (
          <div className="lv-train-row__swap">
            <span className="lm-eng">{TRAIN_COPY.instead(shortName(p.original.name))}</span>
            {p.equivalence ? <EquivalenceMeter result={p.equivalence.result} target={p.equivalence.target} size="sm" /> : null}
            {p.interactive ? (
              <>
                <Key size="sm" variant="quiet" onClick={p.onUndoSwap} aria-label={TRAIN_COPY.undoSwapName(short)}>
                  {TRAIN_COPY.undoSwap}
                </Key>
                <Key size="sm" variant="quiet" onClick={p.onPropose}>
                  {TRAIN_COPY.everyWeekday(p.weekday)}
                </Key>
              </>
            ) : null}
          </div>
        ) : null}
        {p.interactive && p.state !== 'skipped' ? (
          <LogControls item={p.item} ex={p.ex} name={short} style={p.style} log={p.log} ticked={p.state === 'done' && !p.log} {...(p.loadKg !== undefined ? { loadKg: p.loadKg } : {})} onLog={p.onLog} />
        ) : null}
      </div>
      {p.interactive ? (
        <div className="lv-train-row__keys">
          <button type="button" className="lv-train-tick" data-state={p.state} aria-pressed={p.state === 'done'} aria-label={TRAIN_COPY.tickName(short)} onClick={p.onTick}>
            <Icon icon={Check} size={20} />
          </button>
          <Key size="sm" variant="quiet" trailingIcon={ChevronRight} onClick={p.onSwap} aria-label={TRAIN_COPY.swapName(short)}>
            {TRAIN_COPY.swap}
          </Key>
          <Key size="sm" variant="quiet" pressed={p.state === 'skipped'} onClick={p.onSkip} aria-label={TRAIN_COPY.skipName(short)}>
            {TRAIN_COPY.skip}
          </Key>
        </div>
      ) : null}
    </li>
  );
}
