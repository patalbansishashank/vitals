/**
 * Equipment and things to buy (living-mode.md Train): what you have (chips; Edit → the intake's training chapter),
 * places and days, and "Would help" from the plan's shopping list — item · price tier · what it unlocks · "needed for
 * this plan". "Bought it" never changes the plan by itself: using new equipment raises load, so it comes as a proposal.
 */
import { useId, useMemo, useState } from 'react';
import type { SessionPrescription } from '@/catalogues';
import { Chip, Faceplate, FaceplateHeader, Key, KeyLink, Section, toast } from '@/components';
import { TRAIN_COPY } from '../copy';
import { noEquipmentAnswered, placeLines, shopRows, type TrainSetup } from '../session';

/** The intake chapter where equipment, places and injuries are answered. */
export const TRAINING_SETUP_PATH = '/onboarding/training';

export interface EquipmentFaceProps {
  setup: TrainSetup;
  /** The week's session prescriptions (the shopping list is per plan). */
  prescriptions: readonly SessionPrescription[];
}

export function EquipmentFace({ setup, prescriptions }: EquipmentFaceProps) {
  const titleId = useId();
  const [noted, setNoted] = useState<ReadonlySet<string>>(() => new Set());
  // The shopping list re-composes the week once per candidate item: keyed by the prescriptions' content, not identity.
  const rxKey = JSON.stringify(prescriptions);
  const rows = useMemo(() => shopRows(JSON.parse(rxKey) as SessionPrescription[], setup), [rxKey, setup]);
  const none = noEquipmentAnswered(setup.profile);
  const owned = setup.profile.owned
    .map((id) => {
      const eq = setup.catalogue.equipmentItem(id);
      const kg = setup.profile.loadsKg?.[id]?.[0];
      return eq ? { id, label: kg ? `${eq.name} · ${kg} kg` : eq.name } : null;
    })
    .filter((x): x is { id: string; label: string } => !!x);
  const places = placeLines(setup.profile);

  const bought = (key: string) => {
    // TODO(E4/E7b): add the item to the person's equipment; TODO(E5): the plan then proposes the sessions that use it.
    setNoted((s) => new Set([...s, key]));
    toast(TRAIN_COPY.toast.bought);
  };

  return (
    <Faceplate id="equipment" aria-labelledby={titleId}>
      <FaceplateHeader
        title={TRAIN_COPY.equipment.title}
        titleId={titleId}
        actions={
          none ? undefined : (
            <KeyLink to={TRAINING_SETUP_PATH} size="sm" variant="quiet" aria-label={TRAIN_COPY.equipment.editName}>
              {TRAIN_COPY.equipment.edit}
            </KeyLink>
          )
        }
      />
      {none ? (
        <div className="lv-train-equip__none">
          <p>{TRAIN_COPY.equipment.none}</p>
          <KeyLink to={TRAINING_SETUP_PATH} size="sm">
            {TRAIN_COPY.equipment.tell}
          </KeyLink>
        </div>
      ) : (
        <>
          {owned.length > 0 ? (
            <ul className="lv-train-equip" aria-label={TRAIN_COPY.equipment.title}>
              {owned.map((o) => (
                <li key={o.id}>
                  <Chip>{o.label}</Chip>
                </li>
              ))}
            </ul>
          ) : null}
          {places.length > 0 ? (
            <Section label={TRAIN_COPY.equipment.places}>
              <ul className="lv-train-places">
                {places.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      )}
      <Section label={TRAIN_COPY.equipment.wouldHelp} id="buy">
        {rows.length === 0 ? (
          <p className="lv-train-note">{TRAIN_COPY.equipment.nothing}</p>
        ) : (
          <ul className="lv-train-buy">
            {rows.map((r) => (
              <li key={r.key} className="lv-train-buy__row">
                <div className="lv-train-buy__main">
                  <p className="lv-train-buy__name">
                    {r.name} <span className="lm-eng">· {TRAIN_COPY.equipment.tierName(r.tier)}</span>
                  </p>
                  <p className="lv-train-note">{[r.unlocks, r.benefit, r.required ? TRAIN_COPY.equipment.needed : null].filter(Boolean).join(' · ')}</p>
                </div>
                {noted.has(r.key) ? (
                  <span className="lm-eng">{TRAIN_COPY.equipment.noted}</span>
                ) : (
                  <Key size="sm" onClick={() => bought(r.key)} aria-label={TRAIN_COPY.equipment.boughtName(r.name)}>
                    {TRAIN_COPY.equipment.bought}
                  </Key>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Faceplate>
  );
}
