/**
 * Equipment (living-mode.md Train), opened from the header ⋯ so the day's training stays the whole page: what you have,
 * places and days, and "Would help" from the plan's shopping list — item · price tier · what it adds. Read-only: the
 * equipment itself is edited in the intake's training chapter (Edit equipment).
 */
import { useMemo } from 'react';
import type { SessionPrescription } from '@/catalogues';
import { KeyLink, ResponsivePanel, Section, MonoMeta } from '@/components';
import { TRAIN_COPY } from '../copy';
import { noEquipmentAnswered, placeLines, shopRows, type TrainSetup } from '../session';

/** The intake chapter where equipment, places and injuries are answered. */
export const TRAINING_SETUP_PATH = '/onboarding/training';

export interface EquipmentPanelProps {
  setup: TrainSetup;
  /** The week's session prescriptions (the shopping list is per plan). */
  prescriptions: readonly SessionPrescription[];
  onClose: () => void;
}

export function EquipmentPanel({ setup, prescriptions, onClose }: EquipmentPanelProps) {
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

  return (
    <ResponsivePanel
      open
      onClose={onClose}
      title={TRAIN_COPY.equipment.title}
      footer={
        <div className="lv-train-panelfoot">
          {/* r068 L20: a real key across the foot, never a gold text link */}
          <KeyLink to={TRAINING_SETUP_PATH} variant={none ? 'primary' : 'outlined'} block>
            {none ? TRAIN_COPY.equipment.add : TRAIN_COPY.equipment.edit}
          </KeyLink>
        </div>
      }
    >
      <div className="lv-train-panel">
        {none ? (
          <p className="lv-train-equip__none">{TRAIN_COPY.equipment.none}</p>
        ) : (
          <>
            {owned.length > 0 ? (
              <Section label={TRAIN_COPY.equipment.owned}>
                <ul className="lv-train-list" aria-label={TRAIN_COPY.equipment.owned}>
                  {owned.map((o) => (
                    <li key={o.id}>{o.label}</li>
                  ))}
                </ul>
              </Section>
            ) : null}
            {places.length > 0 ? (
              <Section label={TRAIN_COPY.equipment.places}>
                <ul className="lv-train-list" aria-label={TRAIN_COPY.equipment.places}>
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
            <p className="lm-eng">{TRAIN_COPY.equipment.nothing}</p>
          ) : (
            <ul className="lv-train-buy" aria-label={TRAIN_COPY.equipment.wouldHelp}>
              {rows.map((r) => {
                const facts = [r.unlocks, r.benefit, r.required ? TRAIN_COPY.equipment.needed : null].filter(Boolean).join(' · ');
                return (
                  <li key={r.key} className="lv-train-buy__row">
                    <p className="lv-train-buy__name">
                      {r.name} <MonoMeta><span className="lv-train-price" aria-hidden="true">{Array.from({ length: 4 }, (_, i) => <i key={i} data-lit={i < Math.max(1, Math.min(4, r.tier)) || undefined} />)}</span> {TRAIN_COPY.equipment.tierName(r.tier)}</MonoMeta>
                    </p>
                    {facts ? <p className="lm-eng">{facts}</p> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </ResponsivePanel>
  );
}
