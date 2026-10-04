/**
 * Settings › Supplements (SUITE_SPEC §13.2; COMPONENTS.md §14.4): the stance and the person's rows, edited with the same
 * `SupplementRow` as the intake and the Food tab. Each change is saved through `supplements.set` / `supplements.remove`
 * (undo from history); taking rows are saved once they are complete (amount and time), until then they stay a draft
 * here with the field errors shown.
 */
import { useState } from 'react';
import { dispatch } from '@/commands';
import { Select } from '@/components';
import { SUPPLEMENT_STANCES, presetState, sameRow, toSectionV2, validateDose, type SupplementRow, type SupplementStance } from '@/catalogues/supplements';
import { useIntakeDoc } from '@/features/intake/doc';
import { SupplementRowList } from '@/features/components/SupplementRowList';
import { removeSupplementRow, saveSupplementRow } from '@/features/components/SupplementRowWriter';
import { SettingRow, useSavedFlash } from '../SettingRow';
import { SettingsSection } from '../sections';

export const SUPPLEMENTS_SETTINGS_COPY = {
  title: 'Supplements',
  stance: 'supplements',
  stanceHelp: 'Taking and at-home items shape the plan; the Coach suggests what you have before anything to buy.',
  stances: {
    taking: 'I take some',
    onHand: 'I have some at home, not taking',
    open: 'open to them',
    food_first: 'food first',
  } satisfies Record<SupplementStance, string>,
  choose: 'not answered',
} as const;
const C = SUPPLEMENTS_SETTINGS_COPY;

const same = (a: SupplementRow, b: SupplementRow) => JSON.stringify(a) === JSON.stringify(b);

export function SupplementsSection() {
  const doc = useIntakeDoc();
  const section = toSectionV2(doc.supplements);
  const stored = section?.rows ?? [];
  // local edits not stored yet: drafts (a taking row without an amount or a time) and saves in flight
  const [drafts, setDrafts] = useState<SupplementRow[]>([]);
  const [saved, flash] = useSavedFlash();
  const rows = [...stored.map((s) => drafts.find((d) => sameRow(d, s)) ?? s), ...drafts.filter((d) => !stored.some((s) => sameRow(s, d)))];

  const stance = section?.stance;
  const onRows = async (next: SupplementRow[]) => {
    const prev = rows;
    const changed = next.filter((r) => {
      const before = prev.find((p) => sameRow(p, r));
      return !before || !same(before, r);
    });
    setDrafts((ds) => [...ds.filter((d) => next.some((n) => sameRow(n, d)) && !changed.some((c) => sameRow(c, d))), ...changed]);
    let ok = true;
    for (const r of prev) if (!next.some((n) => sameRow(n, r)) && stored.some((s) => sameRow(s, r))) ok = (await removeSupplementRow(r)) && ok;
    for (const r of changed) {
      if (!validateDose(r).ok) continue; // a draft: saved once complete
      const done = await saveSupplementRow(r, stance ?? 'taking');
      ok = done && ok;
      if (done) setDrafts((ds) => ds.filter((d) => !(sameRow(d, r) && same(d, r))));
    }
    if (ok) flash();
  };

  return (
    <SettingsSection id="supplements" title={C.title} saved={saved}>
      <SettingRow label={C.stance} help={C.stanceHelp}>
        {() => (
          <Select<SupplementStance>
            size="sm"
            label={C.stance}
            placeholder={C.choose}
            value={stance}
            onChange={async (s) => {
              // the stance is saved with a row when there is one; with none it is an intake answer
              const first = rows.find((r) => validateDose(r).ok);
              const ok = first ? await saveSupplementRow(first, s) : await saveStance(s);
              if (ok) flash();
            }}
            options={SUPPLEMENT_STANCES.map((s) => ({ value: s, label: C.stances[s] }))}
          />
        )}
      </SettingRow>
      <SupplementRowList rows={rows} onChange={(n) => void onRows(n)} preset={presetState(stance ?? 'taking')} showErrors />
    </SettingsSection>
  );
}

async function saveStance(stance: SupplementStance): Promise<boolean> {
  const r = await dispatch('intake.answer', { section: 'supplements', answers: { _v: 2, stance, rows: [], taking: null } });
  return r.ok;
}
