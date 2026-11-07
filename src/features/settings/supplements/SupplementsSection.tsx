/**
 * Settings › Supplements (SUITE_SPEC §13.2; COMPONENTS.md §14.4): the stance and the person's rows, edited with the same
 * `SupplementRow` as the intake and the Food tab. Each change is saved through `supplements.set` / `supplements.remove`
 * (undo from history); taking rows are saved once they are complete (amount and time), until then they stay a draft
 * here with the field errors shown.
 * D7-03: the list's summary carries the worst safety status of the rows the person takes, from the same shared policy
 * Food and the Coach use ("2 listed · Review"); taking stays recordable and nothing is removed.
 */
import { useMemo, useState } from 'react';
import { dispatch } from '@/commands';
import { Select, StatusDot } from '@/components';
import {
  SUPPLEMENT_STANCES,
  presetState,
  sameRow,
  toSectionV2,
  validateDose,
  type SupplementRow,
  type SupplementStance,
} from '@/catalogues/supplements';
import { useIntakeDoc } from '@/features/intake/doc';
import { SupplementRowList } from '@/features/components/SupplementRowList';
import { removeSupplementRow, saveSupplementRow } from '@/features/components/SupplementRowWriter';
import { profileFromIntake, useFoodSafety } from '@/features/living/food/profile';
import { takingCaution } from '@/features/living/food/supplements';
import { SettingRow, SettingsDisclosure, SettingsGroup, useSavedFlash } from '../SettingRow';
import { SettingsSection } from '../sections';

export const SUPPLEMENTS_SETTINGS_COPY = {
  title: 'Supplements',
  stance: 'Do you take supplements?',
  stances: {
    taking: 'I take some',
    onHand: 'I have some at home, not taking',
    open: 'Open to them',
    food_first: 'Food first',
  } satisfies Record<SupplementStance, string>,
  choose: 'Choose an answer',
  rows: 'Your supplements',
  none: 'None',
  count: (n: number) => (n === 1 ? '1 listed' : `${n} listed`),
} as const;

/** Worst first: the one status word the summary shows for the rows the person takes (D7-03). */
const STATUS_ORDER = ['Review', 'Unchecked', 'Caution'] as const;

/** The summary's status word from the taking rows' statuses ("Review · kidney disease" → "Review"), or null. */
export function takingStatusWord(statuses: ReadonlyArray<string | null>): string | null {
  const words = statuses.flatMap((s) => (s ? [s.split(' · ')[0]!] : []));
  return STATUS_ORDER.find((w) => words.includes(w)) ?? null;
}
const C = SUPPLEMENTS_SETTINGS_COPY;

const same = (a: SupplementRow, b: SupplementRow) => JSON.stringify(a) === JSON.stringify(b);

export function SupplementsSection() {
  const doc = useIntakeDoc();
  const section = toSectionV2(doc.supplements);
  const stored = section?.rows ?? [];
  // local edits not stored yet: drafts (a taking row without an amount or a time) and saves in flight
  const [drafts, setDrafts] = useState<SupplementRow[]>([]);
  const [saved, flash] = useSavedFlash();
  const rows = [
    ...stored.map((s) => drafts.find((d) => sameRow(d, s)) ?? s),
    ...drafts.filter((d) => !stored.some((s) => sameRow(s, d))),
  ];

  const stance = section?.stance;
  // D7-03: the shared policy decision of each row the person takes (Food's input: screening, markers, allergies, stops)
  const foodProfile = useMemo(() => profileFromIntake(doc), [doc]);
  const safety = useFoodSafety(foodProfile);
  // D7-03/D7-04: the policy status of each taken row and its own exposure check (unknown potency is Unchecked, never a pass)
  const statusWord = takingStatusWord(
    stored
      .filter((r) => r.state === 'taking')
      .flatMap((r) => [
        takingCaution(r.supplementId, safety),
        r.safetyCheck === 'violation' ? 'Review' : r.safetyCheck === 'unchecked' ? 'Unchecked' : null,
      ]),
  );
  const onRows = async (next: SupplementRow[]) => {
    const prev = rows;
    const changed = next.filter((r) => {
      const before = prev.find((p) => sameRow(p, r));
      return !before || !same(before, r);
    });
    setDrafts((ds) => [
      ...ds.filter((d) => next.some((n) => sameRow(n, d)) && !changed.some((c) => sameRow(c, d))),
      ...changed,
    ]);
    let ok = true;
    for (const r of prev)
      if (!next.some((n) => sameRow(n, r)) && stored.some((s) => sameRow(s, r)))
        ok = (await removeSupplementRow(r)) && ok;
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
      <SettingsGroup
        info={{
          title: 'What the safety word means',
          body: 'Review means Vitals found a reason to check a supplement with a clinician: a safety answer, a marker, or a dose over a limit. Unchecked means the dose or strength is not known, so no limit could be checked. Neither removes anything, and you can still record taking it.',
        }}
      >
        <SettingRow label={C.stance} wide>
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
        {/* the person's list first, as one row; the catalogue to add from opens with it */}
        <SettingsDisclosure
          title={C.rows}
          value={
            stored.length ? (
              <>
                <span>{C.count(stored.length)}</span>
                {statusWord ? <StatusDot tone="caution" label={statusWord} /> : null}
              </>
            ) : (
              C.none
            )
          }
        >
          <SupplementRowList
            rows={rows}
            onChange={(n) => void onRows(n)}
            preset={presetState(stance ?? 'taking')}
            showErrors
          />
        </SettingsDisclosure>
      </SettingsGroup>
    </SettingsSection>
  );
}

async function saveStance(stance: SupplementStance): Promise<boolean> {
  const r = await dispatch('intake.answer', {
    section: 'supplements',
    answers: { _v: 2, stance, rows: [], taking: null },
  });
  return r.ok;
}
