/**
 * Food's small panels (⋯ menu and supplement links): Pantry (what's already at home), Things that won't help your
 * goals (the no-benefit list with reasons), and Use what's in my kitchen (recipes from the pantry).
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { Field, GradeBadge, IconKey, Key, KeyLink, ResponsivePanel, TextInput } from '@/components';
import { FOOD_COPY } from '../copy';
import { noBenefitItems } from '../supplements';

export function PantryEditor({ pantry, onHave }: { pantry: readonly string[]; onHave(name: string, have: boolean): void }) {
  const P = FOOD_COPY.pantry;
  const [draft, setDraft] = useState('');
  const add = () => {
    if (!draft.trim()) return;
    onHave(draft, true);
    setDraft('');
  };
  return (
    <div className="lv-food-pantry">
      {pantry.length === 0 ? (
        <p className="lv-food-note">{P.empty}</p>
      ) : (
        <ul className="lv-food-pantry__items">
          {pantry.map((n) => (
            <li key={n}>
              <span>{n}</span>
              <IconKey icon={X} size="sm" label={P.remove(n)} onClick={() => onHave(n, false)} />
            </li>
          ))}
        </ul>
      )}
      <form
        className="lv-food-pantry__add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Field label={P.add} help={P.addHelp}>
          <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
        </Field>
        <Key type="submit" size="sm">
          {P.addKey}
        </Key>
      </form>
    </div>
  );
}

export function PantryPanel({ open, onClose, pantry, onHave }: { open: boolean; onClose(): void; pantry: readonly string[]; onHave(name: string, have: boolean): void }) {
  return (
    <ResponsivePanel open={open} onClose={onClose} title={FOOD_COPY.pantry.title}>
      <div className="lv-food-sheet">
        <p>{FOOD_COPY.pantry.intro}</p>
        <PantryEditor pantry={pantry} onHave={onHave} />
      </div>
    </ResponsivePanel>
  );
}

export function NoBenefitPanel({ open, onClose }: { open: boolean; onClose(): void }) {
  const items = noBenefitItems();
  return (
    <ResponsivePanel open={open} onClose={onClose} title={FOOD_COPY.noBenefit.title}>
      <div className="lv-food-sheet">
        <p>{FOOD_COPY.noBenefit.intro}</p>
        <ul className="lv-food-nobenefit">
          {items.map((i) => (
            <li key={i.record.id}>
              <span className="lv-food-nobenefit__name">
                {i.name} <GradeBadge grade={i.grade} size="sm" />
              </span>
              <span className="lv-food-note">{i.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </ResponsivePanel>
  );
}

export interface KitchenPanelProps {
  open: boolean;
  onClose(): void;
  pantry: readonly string[];
  onHave(name: string, have: boolean): void;
  /** Why recipes can't be made now (no provider, food rules not answered, past day), or null. */
  blocked: { reason: string; link?: { to: string; label: string } } | null;
  onRun(): void;
}

export function KitchenPanel({ open, onClose, pantry, onHave, blocked, onRun }: KitchenPanelProps) {
  const K = FOOD_COPY.kitchen;
  const footer = blocked ? undefined : (
    <Key onClick={onRun} disabledReason={pantry.length === 0 ? K.needPantry : undefined}>
      {K.run}
    </Key>
  );
  return (
    <ResponsivePanel open={open} onClose={onClose} title={K.title} footer={footer}>
      <div className="lv-food-sheet">
        <p>{K.intro}</p>
        {blocked ? (
          <p>
            {blocked.reason}{' '}
            {blocked.link ? (
              <KeyLink to={blocked.link.to} variant="quiet" size="sm">
                {blocked.link.label}
              </KeyLink>
            ) : null}
          </p>
        ) : (
          <>
            {pantry.length === 0 ? <p className="lv-food-note">{K.needPantry}</p> : null}
            <PantryEditor pantry={pantry} onHave={onHave} />
          </>
        )}
      </div>
    </ResponsivePanel>
  );
}
