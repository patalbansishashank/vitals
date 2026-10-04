/**
 * Groceries faceplate: horizon bank (today · 3 days · week), the list grouped by aisle in buy units with bought ticks
 * and "already have" marks, Share (text) and Print, and — the first time a list is made — the lazy budget question.
 */
import { Printer, Share2 } from 'lucide-react';
import { Checkbox, Engraved, Faceplate, Key, KeyBank, Section, cx } from '@/components';
import { FOOD_COPY } from '../copy';
import type { BudgetAnswer, GroceryHorizon, GroceryList } from '../groceries';
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

export function GroceriesFace(p: GroceriesFaceProps) {
  const { list } = p;
  const askBudget = list.count > 0 && p.budget.tier === null && !p.budget.deferred;
  return (
    <Faceplate
      id="groceries"
      className={cx('lv-food-groceries', p.printing && 'is-printing')}
      title={G.title}
      caption={G.caption[p.horizon]}
      actions={<span className="lv-food-count lm-num">{G.count(list.count)}</span>}
      footer={
        list.count > 0 ? (
          <div className="lv-food-groceries__foot">
            <Key size="sm" icon={Share2} onClick={p.onShare}>
              {G.share}
            </Key>
            <Key size="sm" icon={Printer} onClick={p.onPrint}>
              {G.print}
            </Key>
            {p.budget.tier ? <Engraved>{G.budgetSet(G.budget[p.budget.tier])}</Engraved> : null}
          </div>
        ) : undefined
      }
    >
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
          <Section key={g.aisle} label={G.aisles[g.aisle]} labelAs="h3">
            <ul className="lv-food-groceries__items">
              {g.items.map((i) => (
                <li key={i.key} className={cx('lv-food-grocery', i.have && 'is-have')}>
                  <Checkbox checked={i.bought} onChange={(on) => p.onBought(i.key, on)} label={i.buy} />
                  <Key size="sm" variant="quiet" pressed={i.have} onClick={() => p.onHave(i.name, !i.have)} aria-label={G.haveName(i.name)}>
                    {G.have}
                  </Key>
                </li>
              ))}
            </ul>
          </Section>
        ))
      )}
    </Faceplate>
  );
}
