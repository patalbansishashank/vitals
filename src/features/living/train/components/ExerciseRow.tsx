/**
 * One exercise as a stop on the session's rail (the same rail as Today's plan and Food's meals): its number, a status
 * node, the name (full on first use), the prescription as a readout (sets × reps, rest, the effort cue, energy for
 * cardio-like items), ONE labelled key — Done, or Undo once done or skipped — and a quiet ⋯ with Swap and Skip. The
 * per-set log controls and a swap's note sit below.
 */
import { Ellipsis } from 'lucide-react';
import type { ConcreteItem, EquivalenceResult, ExerciseRecord } from '@/catalogues';
import { IconKey, Key, Menu, VisuallyHidden, energyInText, type MenuItem } from '@/components';
import { TargetReadout } from '../../components/TargetReadout';
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
  /** Position in the session (0-based). */
  index: number;
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
  const rx = energyInText(rxWords(p.item, p.ex, { energy: p.energy }), eu);
  // the node shows the state: solid = done, half = some sets logged, struck = skipped
  const node = p.state === 'done' ? 'done' : p.state === 'partial' ? 'partial' : p.state === 'skipped' ? 'skipped' : 'empty';
  const primary =
    p.state === 'done' ? (
      <Key size="sm" variant="quiet" aria-label={TRAIN_COPY.undoName(short)} onClick={p.onTick}>
        {TRAIN_COPY.undo}
      </Key>
    ) : p.state === 'skipped' ? (
      <Key size="sm" variant="quiet" aria-label={TRAIN_COPY.unskipName(short)} onClick={p.onSkip}>
        {TRAIN_COPY.undo}
      </Key>
    ) : (
      <Key size="sm" aria-label={TRAIN_COPY.tickName(short)} onClick={p.onTick}>
        {TRAIN_COPY.done}
      </Key>
    );
  const more: MenuItem[] = [
    { id: 'swap', label: TRAIN_COPY.swapItem, onSelect: p.onSwap },
    ...(p.state === 'skipped' ? [] : [{ id: 'skip', label: TRAIN_COPY.skipItem, onSelect: p.onSkip }]),
  ];
  return (
    <li className="lv-item lv-train-row" data-state={node} data-item-state={p.state}>
      <span className="lv-item__time lm-num">{p.index + 1}</span>
      <span className="lv-item__node" aria-hidden="true" />
      <h3 className="lv-item__label lv-train-row__name">{p.name}</h3>
      <span className="lv-item__sub">
        {p.state === 'done' && !p.log ? <span className="lv-item__word">{TRAIN_COPY.state.done}</span> : p.state === 'skipped' ? <span className="lv-item__word">{TRAIN_COPY.state.skipped}</span> : <TargetReadout text={rx} />}
      </span>
      {p.interactive ? (
        <span className="lv-item__keys">
          {primary}
          <Menu label={TRAIN_COPY.moreName(short)} items={more} trigger={(t) => <IconKey {...t} size="sm" icon={Ellipsis} label={TRAIN_COPY.moreName(short)} />} />
        </span>
      ) : null}
      <div className="lv-item__body">
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
    </li>
  );
}
