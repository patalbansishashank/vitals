/**
 * Groceries faceplate: the horizon bank (today · 3 days · week) in the head with one summary line ("6 to buy · 2 at
 * home"), the list grouped by aisle, one line per item (bought tick, name, the buy amount as a readout, an "at home"
 * key: covered items go quiet, never struck through), Share and Print as quiet keys, and — the first time a list is
 * made — the lazy budget question.
 */
import { Printer, Share2 } from 'lucide-react';
import { Checkbox, Engraved, Faceplate, Key, KeyBank, cx } from '@/components';
import { TargetReadout } from '../../components/TargetReadout';
import { FOOD_COPY } from '../copy';
import type { BudgetAnswer, GroceryHorizon, GroceryItem, GroceryList } from '../groceries';
import type { BudgetTier } from '../mealPlanStore';

const G = FOOD_COPY.groceries;

export interface GroceriesFaceProps {
  list: GroceryList;
  horizon: GroceryHorizon;
  onHorizon(h: GroceryHorizon): void;
  budget: BudgetAnswer;
  onBudget(tier: BudgetTier | 'later'): void;
  onBought(key: string, bought: boolean): void;
  onHave(name: string, have: boolean): void;
  onShare(): void;
  onPrint(): void;
  /** Recipes can be generated at all (otherwise the empty line says where groceries come from). */
  recipesAvailable: boolean;
  printing?: boolean;
}

/** "paneer 200 g pack × 2" → name "paneer", amount "200 g pack × 2" (the buy unit always starts with the name). */
function splitBuy(i: GroceryItem): { name: string; amount: string } {
  if (i.buy.toLowerCase().startsWith(i.name.toLowerCase())) return { name: i.buy.slice(0, i.name.length), amount: i.buy.slice(i.name.length).trim() };
  const m = i.buy.match(/^(.*?)\s+(×.*)$/);
  return m ? { name: m[1]!, amount: m[2]! } : { name: i.buy, amount: '' };
}

export function GroceriesFace(p: GroceriesFaceProps) {
  const { list } = p;
  const askBudget = list.count > 0 && p.budget.tier === null && !p.budget.deferred;
  const items = list.groups.flatMap((g) => g.items);
  const atHome = items.filter((i) => i.have).length;
  const bought = items.filter((i) => i.bought && !i.have).length;
  const toBuy = list.count - atHome;
  // one summary line in the head: what is left to buy, what is covered at home, what is already bought
  const summary = list.count === 0 ? undefined : [G.toBuy(toBuy - bought), atHome ? G.atHomeCount(atHome) : null, bought ? G.boughtCount(bought) : null].filter(Boolean).join(' · ');
  return (
    <Faceplate
      id="groceries"
      className={cx('lv-food-groceries', p.printing && 'is-printing')}
      title={G.title}
      caption={summary}
      actions={
        <KeyBank<GroceryHorizon>
          size="sm"
          label={G.horizonLabel}
          value={p.horizon}
          onChange={p.onHorizon}
          options={[
            { value: 'today', label: G.horizon.today },
            { value: '3days', label: G.horizon['3days'] },
            { value: 'week', label: G.horizon.week },
          ]}
        />
      }
      footer={
        list.count > 0 ? (
          <div className="lv-food-groceries__foot">
            <Key size="sm" variant="quiet" icon={Share2} onClick={p.onShare}>
              {G.share}
            </Key>
            <Key size="sm" variant="quiet" icon={Printer} onClick={p.onPrint}>
              {G.print}
            </Key>
            {p.budget.tier ? <Engraved className="lv-food-groceries__budget">{G.budgetSet(G.budget[p.budget.tier])}</Engraved> : null}
          </div>
        ) : undefined
      }
    >
      {askBudget ? (
        <div className="lv-food-budget" role="group" aria-label={G.budgetQ}>
          <p>{G.budgetQ}</p>
          <div className="lv-food-budget__keys">
            {(['tight', 'normal', 'flexible'] as const).map((t) => (
              <Key key={t} size="sm" onClick={() => p.onBudget(t)}>
                {G.budget[t]}
              </Key>
            ))}
            <Key size="sm" variant="quiet" onClick={() => p.onBudget('later')}>
              {G.later}
            </Key>
          </div>
        </div>
      ) : null}
      {list.count === 0 ? (
        <p className="lv-food-note">{p.recipesAvailable ? G.empty : G.emptyNoProvider}</p>
      ) : (
        list.groups.map((g) => (
          <section key={g.aisle} className="lv-food-aisle" aria-labelledby={`aisle-${g.aisle}`}>
            <h3 id={`aisle-${g.aisle}`} className="lv-food-aisle__name lm-eng">
              {G.aisles[g.aisle]}
            </h3>
            <ul className="lv-food-groceries__items">
              {g.items.map((i) => {
                const { name, amount } = splitBuy(i);
                return (
                  <li key={i.key} className={cx('lv-food-grocery', i.have && 'is-have', i.bought && 'is-bought')}>
                    <Checkbox
                      checked={i.bought}
                      onChange={(on) => p.onBought(i.key, on)}
                      label={
                        <span className="lv-food-grocery__label">
                          <span className="lv-food-grocery__name">{name}</span>
                          {amount ? <TargetReadout text={amount} className="lv-food-grocery__amount" /> : null}
                        </span>
                      }
                    />
                    <Key size="sm" variant="quiet" pressed={i.have} onClick={() => p.onHave(i.name, !i.have)} aria-label={G.haveName(i.name)}>
                      {i.have ? G.atHome : G.have}
                    </Key>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </Faceplate>
  );
}
