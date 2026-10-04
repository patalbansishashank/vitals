/**
 * The swap sheet (living-mode.md Train, "Swap"): alternatives on the person's equipment, each with an EquivalenceMeter,
 * in the catalogue's order (credit, then what they like). Items needing equipment they don't have show only with
 * "show all". A swap applies to this day only; footer: Something else… · Ask the Coach for options.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { LocalDate } from '@/living';
import { Key, ResponsivePanel, Switch } from '@/components';
import { EquivalenceMeter } from '../../components/EquivalenceMeter';
import { livingPaths } from '../../paths';
import { TRAIN_COPY } from '../copy';
import { dayWord, equipmentPhrase, needsText, rxWords, shortName, swapRows, targetOf, type SessionModel, type SwapPick, type SwapRow, type TrainSetup } from '../session';

export interface SwapPanelProps {
  model: SessionModel;
  index: number;
  date: LocalDate;
  today: LocalDate;
  setup: TrainSetup;
  onClose: () => void;
  onPick: (pick: SwapPick) => void;
  onSomethingElse: () => void;
}

export function SwapPanel({ model, index, date, today, setup, onClose, onPick, onSomethingElse }: SwapPanelProps) {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);
  const item = model.session.items[index];
  const rows = useMemo(() => (item ? swapRows(item, date, model.startH, setup) : { available: [], needing: [] }), [item, date, model.startH, setup]);
  if (!item) return null;
  const short = shortName(item.name);
  const target = targetOf(date, today, short);
  const pick = (r: SwapRow) => onPick({ exerciseId: r.option.exerciseId, name: r.option.name, equipment: r.option.equipment, perf: r.option.perf, equivalence: r.option.equivalence });
  const row = (r: SwapRow) => {
    const kit = r.needs.length > 0 ? null : equipmentPhrase(r.option.equipment, setup.profile, setup.catalogue);
    const dose = rxWords(r.item, setup.catalogue.exercise(r.option.exerciseId), { energy: false });
    return (
      <li key={r.option.exerciseId} className="lv-train-swap" data-needs={r.needs.length > 0 || undefined}>
        <div className="lv-train-swap__main">
          <p className="lv-train-swap__name">{r.option.name}</p>
          <p className="lv-train-swap__dose">{[kit, dose].filter(Boolean).join(' · ')}</p>
          {r.needs.length > 0 ? <p className="lv-train-swap__needs">{needsText(r.needs, setup.catalogue)}</p> : null}
          <EquivalenceMeter result={r.option.equivalence} target={target} size="sm" />
        </div>
        <Key size="sm" onClick={() => pick(r)} aria-label={TRAIN_COPY.swapSheet.use(r.option.name)}>
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
          <Key variant="quiet" onClick={onSomethingElse}>
            {TRAIN_COPY.swapSheet.somethingElse}
          </Key>
          <Key variant="quiet" onClick={() => navigate(livingPaths.coach(), { state: { draft: { text: TRAIN_COPY.swapSheet.coachDraft(short), context: { date, screen: 'train' } } } })}>
            {TRAIN_COPY.swapSheet.askCoach}
          </Key>
        </div>
      }
    >
      <div className="lv-train-panel">
        <p className="lv-train-note">{TRAIN_COPY.swapSheet.todayOnly(dayWord(date, today))}</p>
        {rows.available.length > 0 ? <ul className="lv-train-swaps">{rows.available.map(row)}</ul> : <p className="lv-train-note">{TRAIN_COPY.swapSheet.none}</p>}
        {rows.needing.length > 0 ? <Switch checked={showAll} onChange={setShowAll} label={TRAIN_COPY.swapSheet.showAll} /> : null}
        {showAll && rows.needing.length > 0 ? <ul className="lv-train-swaps">{rows.needing.map(row)}</ul> : null}
      </div>
    </ResponsivePanel>
  );
}
