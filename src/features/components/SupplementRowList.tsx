/**
 * The supplement list editor (design/screens/onboarding-intake-v3.md §6.2 S2; COMPONENTS.md §14.4): search the
 * catalogue, tick items (filter chips), or type something else; each pick becomes a `SupplementRow` whose state is
 * preset (taking, or have it, don't take). Used by the intake's "which supplements" card and Settings › Supplements.
 * Controlled: `onChange` gets the whole list.
 */
import { useId, useMemo, useState } from 'react';
import { Chip, Key, TextInput } from '@/components';
import { SEED_SUPPLEMENTS } from '@/content/catalogues/supplements';
import { newRow, sameRow, supplementShortName, type SupplementRow as Row, type SupplementState } from '@/catalogues/supplements';
import { SupplementRow } from './SupplementRow';
import './SupplementRow.css';

export const SUPPLEMENT_LIST_COPY = {
  search: 'Search supplements',
  searchPlaceholder: 'e.g. creatine, whey, vitamin D',
  pick: 'Supplements in the list',
  noMatch: (q: string) => `No match for “${q}” · add it as your own below`,
  other: 'Something else',
  otherPlaceholder: 'e.g. ashwagandha gummies',
  add: 'Add',
  yours: 'Your supplements',
  empty: 'None listed yet.',
} as const;
const L = SUPPLEMENT_LIST_COPY;

export interface SupplementRowListProps {
  rows: readonly Row[];
  onChange(rows: Row[]): void;
  /** State of a new pick. */
  preset: SupplementState;
  showErrors?: boolean;
  today?: string;
}

const CHOICES = SEED_SUPPLEMENTS.map((s) => ({ id: s.id, name: supplementShortName({ supplementId: s.id }), terms: [s.name, ...s.aliases].join(' ').toLowerCase() }));

export function SupplementRowList({ rows, onChange, preset, showErrors = false, today }: SupplementRowListProps) {
  const [q, setQ] = useState('');
  const [other, setOther] = useState('');
  const searchId = useId();
  const otherId = useId();
  const listId = useId();
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? CHOICES.filter((c) => c.terms.includes(t)) : CHOICES;
  }, [q]);
  const picked = new Set(rows.map((r) => r.supplementId).filter(Boolean));

  const toggle = (id: string, on: boolean) => {
    if (on) onChange([...rows, newRow({ supplementId: id }, preset)]);
    else onChange(rows.filter((r) => r.supplementId !== id));
  };
  const addOther = () => {
    const text = other.trim();
    if (!text) return;
    const row = newRow({ text }, preset);
    if (!rows.some((r) => sameRow(r, row))) onChange([...rows, row]);
    setOther('');
  };

  return (
    <div className="lm-supplist">
      <div className="lm-supplist__search">
        <label htmlFor={searchId} className="lm-supplist__label">
          {L.search}
        </label>
        <TextInput id={searchId} type="search" value={q} placeholder={L.searchPlaceholder} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div role="group" aria-label={L.pick} className="lm-supplist__chips">
        {shown.map((c) => (
          <Chip key={c.id} kind="filter" pressed={picked.has(c.id)} onPressedChange={(on) => toggle(c.id, on)}>
            {c.name}
          </Chip>
        ))}
        {shown.length === 0 ? <p className="lm-supplist__note">{L.noMatch(q.trim())}</p> : null}
      </div>
      <form
        className="lm-supplist__other"
        onSubmit={(e) => {
          e.preventDefault();
          addOther();
        }}
      >
        <label htmlFor={otherId} className="lm-supplist__label">
          {L.other}
        </label>
        <div className="lm-supplist__otherrow">
          <TextInput id={otherId} value={other} maxLength={80} placeholder={L.otherPlaceholder} onChange={(e) => setOther(e.target.value)} />
          <Key type="submit" disabled={!other.trim()}>
            {L.add}
          </Key>
        </div>
      </form>
      <h3 id={listId} className="lm-supplist__label">
        {L.yours}
      </h3>
      {/* the empty note sits outside the list: a list holds only list items (axe aria-required-children) */}
      {rows.length === 0 ? <p className="lm-supplist__note">{L.empty}</p> : null}
      <div role="list" aria-labelledby={listId} className="lm-supplist__rows">
        {rows.map((r, i) => (
          <div role="listitem" key={r.supplementId ?? `text:${r.text ?? i}`}>
            <SupplementRow
              row={r}
              today={today}
              showErrors={showErrors}
              onChange={(next) => onChange(rows.map((x, j) => (j === i ? next : x)))}
              onRemove={() => onChange(rows.filter((_, j) => j !== i))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
