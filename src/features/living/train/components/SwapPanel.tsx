/**
 * The swap sheet (living-mode.md Train, "Swap"): alternatives on the person's equipment, each with an EquivalenceMeter,
 * in the catalogue's order (credit, then what they like). Items needing equipment they don't have show only with
 * "show all". A swap applies to this day only; footer: Something else… · Skip <exercise> (an exercise of several, while
 * it is not skipped: the row opens this sheet, so it is the exercise's one home for both) · Ask the Coach for options.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { LocalDate } from '@/living';
import { Key, ResponsivePanel, Switch, MonoMeta } from '@/components';
import { EquivalenceMeter, FULL_CREDIT_AT } from '../../components/EquivalenceMeter';
import { livingPaths } from '../../paths';
import { TRAIN_COPY } from '../copy';
import { dayWord, equipmentPhrase, needsText, rxWords, sharedTank, shortName, swapRows, tankShared, targetOf, type SessionModel, type SwapPick, type SwapRow, type TrainSetup } from '../session';

export interface SwapPanelProps {
  model: SessionModel;
  index: number;
  date: LocalDate;
  today: LocalDate;
  setup: TrainSetup;
  onClose: () => void;
  onPick: (pick: SwapPick) => void;
  onSomethingElse: () => void;
  /** Skip this exercise for the day (absent for a one-exercise session, which the header ⋯ skips, or once skipped). */
  onSkip?: (() => void) | undefined;
}

export function SwapPanel({ model, index, date, today, setup, onClose, onPick, onSomethingElse, onSkip }: SwapPanelProps) {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);
  const item = model.session.items[index];
  const rows = useMemo(() => (item ? swapRows(item, date, model.startH, setup) : { available: [], needing: [] }), [item, date, model.startH, setup]);
  if (!item) return null;
  const short = shortName(item.name);
  const target = targetOf(date, today, short);
  const tank = sharedTank([...rows.available, ...rows.needing].map((r) => r.item));
  const pick = (r: SwapRow) => onPick({ exerciseId: r.option.exerciseId, name: r.option.name, equipment: r.option.equipment, perf: r.option.perf, equivalence: r.option.equivalence });
  const row = (r: SwapRow) => {
    const kit = r.needs.length > 0 ? null : equipmentPhrase(r.option.equipment, setup.profile, setup.catalogue);
    const dose = rxWords(r.item, setup.catalogue.exercise(r.option.exerciseId), { energy: false, tank: tankShared(r.item, tank) ? false : tank !== null ? 'short' : true });
    return (
      <li key={r.option.exerciseId} className="lv-train-swap" data-needs={r.needs.length > 0 || undefined}>
        <div className="lv-train-swap__main">
          <p className="lv-train-swap__name">{r.option.name}</p>
          <p className="lv-train-swap__dose">{[kit, dose].filter(Boolean).join(' · ')}</p>
          {r.needs.length > 0 ? <p className="lv-train-swap__needs">{needsText(r.needs, setup.catalogue)}</p> : null}
          <EquivalenceMeter result={r.option.equivalence} target={target} size="line" />
        </div>
        <Key size="sm" variant="action" onClick={() => pick(r)} aria-label={TRAIN_COPY.swapSheet.use(r.option.name)}>
          {TRAIN_COPY.swapSheet.useShort}
        </Key>
      </li>
    );
  };
  return (
    <ResponsivePanel
      open
      onClose={onClose}
      title={TRAIN_COPY.swapSheet.title(short)}
      defaultDetent="full"
      footer={
        <div className="lv-train-panelfoot">
          <Key variant="outlined" onClick={onSomethingElse}>
            {TRAIN_COPY.swapSheet.somethingElse}
          </Key>
          {onSkip ? (
            <Key variant="outlined" onClick={onSkip}>
              {TRAIN_COPY.skipName(short)}
            </Key>
          ) : null}
          <Key variant="outlined" onClick={() => navigate(livingPaths.coach(), { state: { draft: { text: TRAIN_COPY.swapSheet.coachDraft(short), context: { date, screen: 'train' } } } })}>
            {TRAIN_COPY.swapSheet.askCoach}
          </Key>
        </div>
      }
    >
      <div className="lv-train-panel">
        {/* the list head (r068 L6): what the list is (today only, the full-credit line, the effort cue the options
            share, said once) and "Show all" at its end */}
        <div className="lv-train-swaps__head">
          <MonoMeta>
            {TRAIN_COPY.swapSheet.todayOnly(dayWord(date, today), Math.round(FULL_CREDIT_AT * 100))}
            {tank !== null ? ` · ${TRAIN_COPY.rx.tank(tank)}` : ''}
          </MonoMeta>
          {rows.needing.length > 0 ? <Switch checked={showAll} onChange={setShowAll} label={TRAIN_COPY.swapSheet.showAll} /> : null}
        </div>
        {rows.available.length > 0 ? <ul className="lv-train-swaps">{rows.available.map(row)}</ul> : <p className="lm-eng">{TRAIN_COPY.swapSheet.none}</p>}
        {showAll && rows.needing.length > 0 ? <ul className="lv-train-swaps">{rows.needing.map(row)}</ul> : null}
      </div>
    </ResponsivePanel>
  );
}
