/**
 * "I did something else" (and "Something else…" from the swap sheet): pick from the catalogue (names and aliases, the
 * ones on your equipment first) or type it ("wooden wheel rollouts 3 × 10"). Typed items the catalogue doesn't know are
 * resolved into what they most likely train and added — never rejected. The EquivalenceMeter shows the verdict before
 * saving.
 */
import { useMemo, useState } from 'react';
import type { Catalogue, EquivalenceResult, ExerciseRecord, PerformedExercise } from '@/catalogues';
import { sessionEquivalence } from '@/catalogues';
import type { LocalDate } from '@/living';
import { Field, InlineWarning, Key, NumberField, ResponsivePanel, Section, TextInput } from '@/components';
import { EquivalenceMeter } from '../../components/EquivalenceMeter';
import { TRAIN_COPY } from '../copy';
import {
  catalogueWith,
  defaultDoneDose,
  parseDone,
  perfFor,
  resolveTyped,
  searchDone,
  shortName,
  targetOf,
  type DoneDose,
  type SessionModel,
  type TrainSetup,
} from '../session';

export interface ElseSaveInput {
  record: ExerciseRecord;
  /** New to the catalogue (resolved from free text). */
  isNew: boolean;
  perf: PerformedExercise;
  result: EquivalenceResult;
}

export interface ElsePanelProps {
  model: SessionModel;
  /** The item it replaces; null = the whole session. */
  index: number | null;
  date: LocalDate;
  today: LocalDate;
  setup: TrainSetup;
  onClose: () => void;
  /** Resolves to an error message, or null when saved. */
  onSave: (input: ElseSaveInput) => Promise<string | null>;
}

interface Chosen {
  record: ExerciseRecord;
  isNew: boolean;
  /** What was typed, kept with new items. */
  text: string | null;
}

export function ElsePanel({ model, index, date, today, setup, onClose, onSave }: ElsePanelProps) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [dose, setDose] = useState<DoneDose>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const item = index !== null ? model.session.items[index] : undefined;
  const prescribed = useMemo(() => (item ? [item.perf] : model.session.items.map((i) => i.perf)), [item, model]);
  const target = targetOf(date, today, item ? shortName(item.name) : model.noun);
  const results = useMemo(() => searchDone(query, setup.catalogue, setup.profile), [query, setup]);

  const catalogue: Catalogue = useMemo(() => {
    if (!chosen?.isNew) return setup.catalogue;
    const own = setup.catalogue.exercises.filter((e) => e.origin !== 'seed' && e.id !== chosen.record.id);
    return catalogueWith([...own, chosen.record]);
  }, [chosen, setup.catalogue]);
  const perf = useMemo(() => (chosen ? perfFor(chosen.record, dose, chosen.isNew && chosen.text ? chosen.text : undefined) : null), [chosen, dose]);
  const result = useMemo(() => (perf ? sessionEquivalence(prescribed, [perf], catalogue, setup.ctx) : null), [perf, prescribed, catalogue, setup.ctx]);

  const choose = (record: ExerciseRecord, isNew: boolean) => {
    const typed = parseDone(query);
    setChosen({ record, isNew, text: isNew ? query.trim() : null });
    setDose(defaultDoneDose(record, typed.sets !== undefined || typed.minutes !== undefined ? typed : null));
  };
  const useTyped = () => {
    const r = resolveTyped(query, setup.catalogue);
    choose(r.record, r.isNew);
  };
  const save = async () => {
    if (!chosen || !perf || !result) return;
    setBusy(true);
    setError(null);
    const msg = await onSave({ record: chosen.record, isNew: chosen.isNew, perf, result });
    setBusy(false);
    if (msg) setError(msg);
  };

  const minutesDose = dose.minutes !== undefined && dose.sets === undefined;
  const typedName = parseDone(query).name || query.trim();
  return (
    <ResponsivePanel
      open
      onClose={onClose}
      title={item ? TRAIN_COPY.else.titleItem(shortName(item.name)) : TRAIN_COPY.else.title}
      defaultDetent="full"
      footer={
        <div className="lv-train-panelfoot">
          <Key loading={busy} onClick={() => void save()} {...(!chosen ? { disabledReason: TRAIN_COPY.else.pickFirst } : {})}>
            {TRAIN_COPY.else.save}
          </Key>
        </div>
      }
    >
      <div className="lv-train-panel">
        <Field label={TRAIN_COPY.else.field} help={TRAIN_COPY.else.help}>
          <TextInput
            value={query}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setChosen(null);
            }}
          />
        </Field>
        {query.trim() ? (
          <>
            {results.length > 0 ? (
              <ul className="lv-train-results" aria-label={TRAIN_COPY.else.results}>
                {results.map(({ ex, ready }) => (
                  <li key={ex.id}>
                    <button type="button" className="lv-train-result" aria-pressed={chosen?.record.id === ex.id} onClick={() => choose(ex, false)}>
                      <span className="lv-train-result__name">{ex.name}</span>
                      <span className="lm-eng">{ready ? TRAIN_COPY.else.ready : TRAIN_COPY.else.needsKit}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lv-train-note">{TRAIN_COPY.else.noMatch}</p>
            )}
            <Key variant="quiet" onClick={useTyped}>
              {TRAIN_COPY.else.asTyped(typedName)}
            </Key>
          </>
        ) : null}
        {chosen && result ? (
          <Section label={TRAIN_COPY.else.picked}>
            <p className="lv-train-swap__name">{chosen.record.name}</p>
            {chosen.isNew ? <p className="lv-train-note">{TRAIN_COPY.else.newItem}</p> : null}
            <div className="lv-train-sets__row">
              {minutesDose ? (
                <NumberField value={dose.minutes ?? null} onChange={(v) => setDose({ minutes: Math.max(1, v) })} min={1} max={600} step={1} inputMode="numeric" unit="min" name={TRAIN_COPY.else.minutes} />
              ) : (
                <>
                  <NumberField value={dose.sets ?? null} onChange={(v) => setDose((d) => ({ ...d, sets: Math.max(1, v) }))} min={1} max={30} step={1} inputMode="numeric" unit={TRAIN_COPY.else.sets} name={TRAIN_COPY.else.sets} />
                  {dose.reps !== undefined ? (
                    <NumberField value={dose.reps} onChange={(v) => setDose((d) => ({ ...d, reps: Math.max(1, v) }))} min={1} max={500} step={1} inputMode="numeric" unit={TRAIN_COPY.else.reps} name={TRAIN_COPY.else.reps} />
                  ) : null}
                </>
              )}
            </div>
            <EquivalenceMeter result={result} target={target} detail />
          </Section>
        ) : null}
        {error ? (
          <InlineWarning severity="caution" alert>
            {error}
          </InlineWarning>
        ) : null}
      </div>
    </ResponsivePanel>
  );
}
