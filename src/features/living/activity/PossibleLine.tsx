/**
 * (r070) The one quiet line under a day's activities for a weak detection ("Possible walk, 14:20, 25 min"): never counted,
 * never a task. "Add" counts it with one tap (a detection that still needs its type opens the activity sheet to choose
 * one); "Not this" removes it. No badge, no count; the line is absent when there is nothing possible.
 */
import { Key, clockText, toast } from '@/components';
import type { ReviewRow } from '@/living/activityCandidates';
import { ACTIVITY_COPY as C } from '../copy';
import { useActivityData } from './data';
import { partOfDayWords, rowName } from './model';
import { detectionLabelInfo } from '@/living/detectionLabels';

export const POSSIBLE_WORDS = {
  add: 'Add',
  dismiss: 'Not this',
  added: (name: string) => `${name} added`,
  dismissed: 'Left out',
} as const;

/** "Possible walk" (a detection reads by its label, "Walk detected" becomes "Possible walk"), or the type's name. */
function possibleName(r: ReviewRow): string {
  if (!r.detection) return rowName(r);
  const t = detectionLabelInfo(r.detection.label).title;
  return /^possible/i.test(t) ? t : `Possible ${t.replace(/ detected$/, '').toLowerCase()}`;
}

/** "Possible walk, 14:20, 25 min"; quiet: "Possible walk, in the afternoon" (no clock, no minutes). */
export function possibleLineText(r: ReviewRow, quiet: boolean): string {
  const name = possibleName(r);
  const start = Date.parse(r.startAt);
  if (r.timeUnknown) return name;
  return quiet
    ? `${name}, ${partOfDayWords(start)}`
    : `${name}, ${clockText(start)}${r.minutes ? `, ${r.minutes} min` : ''}`;
}

export function PossibleLine({
  rows,
  quiet,
  onOpenRow,
}: {
  rows: readonly ReviewRow[];
  quiet: boolean;
  onOpenRow: (row: ReviewRow) => void;
}) {
  const data = useActivityData();
  const r = rows[0];
  if (!r) return null;
  const text = possibleLineText(r, quiet);
  const needsType = r.detection?.needsType === true;
  const add = () => {
    if (needsType) return onOpenRow(r);
    void data.approve(r.id, r.revision).then((o) => {
      if (!o.ok) return void toast(o.message ?? C.failed);
      toast(
        POSSIBLE_WORDS.added(rowName({ ...r, status: 'approved', detection: undefined })),
        o.undo ? { action: { label: C.undo, onClick: () => void o.undo?.() } } : {},
      );
    });
  };
  const dismiss = () => {
    void data.reject(r.id).then((o) => {
      if (!o.ok) return void toast(o.message ?? C.failed);
      toast(POSSIBLE_WORDS.dismissed, o.undo ? { action: { label: C.undo, onClick: () => void o.undo?.() } } : {});
    });
  };
  return (
    <p className="lv-act__possible lm-num" aria-label={text}>
      <span className="lv-act__possible-text">{text}</span>
      <span className="lv-act__possible-keys">
        <Key variant="text" size="sm" onClick={add} aria-label={`${POSSIBLE_WORDS.add}: ${text}`}>
          {POSSIBLE_WORDS.add}
        </Key>
        <Key variant="text" size="sm" onClick={dismiss} aria-label={`${POSSIBLE_WORDS.dismiss}: ${text}`}>
          {POSSIBLE_WORDS.dismiss}
        </Key>
      </span>
    </p>
  );
}
