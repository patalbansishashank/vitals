/**
 * One exercise as a stop on the session's rail (the same rail as Today's plan and Food's meals): its number, a status
 * node, the name (full on first use), the prescription as a readout (sets × reps, rest, the effort cue, energy for
 * cardio-like items) and ONE labelled key — Done, or Undo once done or skipped. No ⋯ (one per screen): the row opens
 * its swap sheet, which also skips it, as a row on Today opens its sheet. The per-set log controls and a swap's note
 * sit below.
 *
 * `solo` (the session's only exercise): no rail, number or key — the session card names it, its done key logs it and
 * the header ⋯ swaps or skips it; what is left is the readout, a swap's note and the log controls. A row whose log
 * control is the minutes field drops its readout (the labelled field already says "46 min").
 */
import { useId } from 'react';
import type { ConcreteItem, EquivalenceResult, ExerciseRecord } from '@/catalogues';
import { Key, VisuallyHidden, RailNode, energyInText } from '@/components';
import { TargetReadout } from '../../components/TargetReadout';
import { useEnergyUnit } from '@/state/settingsStore';
import { EquivalenceMeter } from '../../components/EquivalenceMeter';
import { TRAIN_COPY } from '../copy';
import { isMinutesItem, loggedSets, plannedSets, rxWords, shortName, type ItemLog, type ItemState, type LogStyle } from '../session';
import { LogControls, controlKind } from './LogControls';

export interface ExerciseRowProps {
  /** The item as it will be done (the swap when there is one). */
  item: ConcreteItem;
  /** The plan's item when swapped. */
  original: ConcreteItem | null;
  /** Display name (full on first use). */
  name: string;
  /** Position in the session (0-based). */
  index: number;
  /** The session's only exercise: the card's done key and the header ⋯ act on it. */
  solo?: boolean;
  ex: ExerciseRecord | undefined;
  state: ItemState;
  log: ItemLog | undefined;
  style: LogStyle;
  /** Logging is open (not a preview, not a logged session). */
  interactive: boolean;
  /** The session says the effort cue once under its title: the row leaves it off (r068 T14). */
  tankInHead?: boolean;
  /** The session states a shared effort cue and this row differs: its own cue in the short form ("3 in the tank", r068 L21). */
  tankShort?: boolean;
  /** The session is logged as done: the node shows it, whatever the row's own draft says (r068 T3). */
  sessionDone?: boolean;
  energy: boolean;
  loadKg?: number;
  /** "Wednesday" for the every-weekday proposal. */
  weekday: string;
  onTick: () => void;
  /** Take a skip back (the row's Undo); skipping itself is in the swap sheet. */
  onSkip: () => void;
  /** Open the swap sheet (alternatives, something else, skip). */
  onSwap: () => void;
  onUndoSwap: () => void;
  onPropose: () => void;
  /** A swapped row: how close the swap comes to what was prescribed (the credit it gets). */
  equivalence?: { result: EquivalenceResult; target: string } | undefined;
  onLog: (log: ItemLog | null) => void;
}

export function ExerciseRow(p: ExerciseRowProps) {
  const hintId = useId();
  const short = shortName(p.item.name);
  const eu = useEnergyUnit();
  // a one-exercise session's card already says its minutes and energy in the head (r068 T5): its row does not repeat them
  const rx = energyInText(rxWords(p.item, p.ex, { energy: p.energy && !p.solo, tank: p.tankInHead ? false : p.tankShort ? 'short' : true }), eu);
  const logs = p.interactive && p.state !== 'skipped';
  // a minutes item's field states its dose, so its readout would say it twice; a set-based item logged by minutes keeps
  // its prescription (r068 T2)
  const readout = !(logs && isMinutesItem(p.item) && controlKind(p.item, p.style) === 'minutes') && !(p.solo && isMinutesItem(p.item));
  const word = p.state === 'done' && !p.log ? TRAIN_COPY.state.done : p.state === 'skipped' ? TRAIN_COPY.state.skipped : null;

  const swapNote = p.original ? (
    <div className="lv-train-row__swap">
      <span className="lm-eng">{TRAIN_COPY.instead(shortName(p.original.name))}</span>
      {p.equivalence ? <EquivalenceMeter result={p.equivalence.result} target={p.equivalence.target} size="sm" /> : null}
      {p.interactive ? (
        <>
          <Key size="sm" variant="text" onClick={p.onUndoSwap} aria-label={TRAIN_COPY.undoSwapName(short)}>
            {TRAIN_COPY.undoSwap}
          </Key>
          <Key size="sm" variant="text" onClick={p.onPropose}>
            {TRAIN_COPY.everyWeekday(p.weekday)}
          </Key>
        </>
      ) : null}
    </div>
  ) : null;
  const controls = logs ? (
    <LogControls item={p.item} ex={p.ex} name={short} style={p.style} log={p.log} ticked={p.state === 'done' && !p.log} {...(p.loadKg !== undefined ? { loadKg: p.loadKg } : {})} onLog={p.onLog} />
  ) : null;

  if (p.solo) {
    return (
      <li className="lv-train-solo" data-item-state={p.state}>
        {/* the card's title names it; the heading keeps it in the outline */}
        <h3 className="lm-sr">{p.name}</h3>
        {readout && rx ? <TargetReadout text={rx} /> : null}
        {swapNote}
        {controls}
      </li>
    );
  }

  // the node shows the state: solid = done, half = some sets logged, struck = skipped
  const node = p.log?.kind === 'sets' && loggedSets(p.item, p.log) === 0 ? 'empty' : p.state === 'done' || (p.sessionDone && p.state === 'open') ? 'done' : p.state === 'partial' ? 'partial' : p.state === 'skipped' ? 'skipped' : 'empty';
  return (
    <li className="lv-train-row" data-state={node} data-item-state={p.state}>
      <RailNode status={node} number={p.index + 1} hue="steps" segments={Math.max(1, plannedSets(p.item))}
        lit={node === 'done' ? Math.max(1, plannedSets(p.item)) : loggedSets(p.item, p.log)}
        label={p.state === 'done' ? TRAIN_COPY.undoName(short) : p.state === 'skipped' ? TRAIN_COPY.unskipName(short) : TRAIN_COPY.tickName(short)}
        onPress={p.interactive ? p.state === 'skipped' ? p.onSkip : p.onTick : undefined} />
      {/* the name opens the swap sheet; the whole row is the target, the key and the log controls sit above it */}
      <h3 className="lv-item__label lv-train-row__name">
        {p.interactive ? (
          <button type="button" className="lv-train-row__open" aria-haspopup="dialog" aria-describedby={hintId} onClick={p.onSwap}>
            {p.name}
          </button>
        ) : (
          p.name
        )}
      </h3>
      <span className="lv-item__sub">{word ? <span className="lv-item__word">{word}</span> : readout ? <TargetReadout text={rx} /> : null}</span>
      <div className="lv-item__body">
        {p.interactive ? (
          <VisuallyHidden id={hintId}>
            {`${TRAIN_COPY.state[p.state]}. ${TRAIN_COPY.rowHint}`}
          </VisuallyHidden>
        ) : null}
        {swapNote}
        {/* the row's controls and its one key on one line: Done trails the sets it marks (r068 T3) */}
        {controls || p.interactive ? (
          <div className="lv-train-row__act">
            {controls}

          </div>
        ) : null}
      </div>
    </li>
  );
}
