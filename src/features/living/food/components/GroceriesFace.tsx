/** Groceries: one item, one dot; bought and already at home share the same progress scale. */
import { House, Printer, Share2, ShoppingBasket } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  Checkbox,
  DottedTrack,
  GradientCard,
  HeroNumber,
  Key,
  KeyBank,
  MonoMeta,
  cx,
} from '@/components';
import { infoSpec } from '../../components/info';
import { FOOD_COPY, INFO } from '../copy';
import {
  groceryProgress,
  type BudgetAnswer,
  type GroceryHorizon,
  type GroceryItem,
  type GroceryList,
} from '../groceries';
import type { BudgetTier } from '../mealPlanStore';
import './foodLists.css';

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
  printing?: boolean;
  quiet?: boolean;
}

/** The buy unit always starts with the name. */
function splitBuy(i: GroceryItem): { name: string; amount: string } {
  if (i.buy.toLowerCase().startsWith(i.name.toLowerCase()))
    return { name: i.buy.slice(0, i.name.length), amount: i.buy.slice(i.name.length).trim() };
  const m = i.buy.match(/^(.*?)\s+(×.*)$/);
  return m ? { name: m[1]!, amount: m[2]! } : { name: i.buy, amount: '' };
}

export function GroceriesFace(p: GroceriesFaceProps) {
  const { list, quiet = false } = p;
  const progress = groceryProgress(list);
  const askBudget = progress.total > 0 && p.budget.tier === null && !p.budget.deferred;
  return (
    <GradientCard
      id="groceries"
      domain="food"
      glow="tl"
      className={cx('lv-food-groceries lv-food-list-card', p.printing && 'is-printing')}
      head={<CardHead icon={ShoppingBasket} title={G.title} info={infoSpec(INFO.groceries)} />}
      foot={
        progress.total > 0 ? (
          <CardFoot right={p.budget.tier ? G.budgetSet(G.budget[p.budget.tier]) : undefined}>
            <div className="lv-food-groceries__foot">
              <Key size="sm" variant="text" icon={Share2} onClick={p.onShare}>
                {G.share}
              </Key>
              <Key size="sm" variant="text" icon={Printer} onClick={p.onPrint}>
                {G.print}
              </Key>
            </div>
          </CardFoot>
        ) : undefined
      }
    >
      {progress.total > 0 ? (
        <div className="lv-food-list-progress">
          <HeroNumber
            value={progress.toBuy}
            size="num"
            label={quiet ? progress.word : G.toBuy(progress.toBuy)}
            quietWord={quiet ? progress.word : undefined}
            countUp
          />
          {!quiet ? <MonoMeta tone="hue">To buy</MonoMeta> : null}
          <DottedTrack
            className={progress.total === 1 ? 'lv-food-list-track--single' : undefined}
            label="Grocery progress"
            value={progress.done}
            goal={progress.total}
            dots={progress.total}
            valueText={`${progress.done} covered`}
            goalText={`${progress.total} items`}
            hue="food"
            litB="food"
            valueB={progress.atHome}
            thumb={false}
            quiet={quiet}
            quietWord={progress.word}
          />
          {!quiet ? (
            <MonoMeta tone="hue">
              Bought {progress.bought} · At home {progress.atHome}
            </MonoMeta>
          ) : null}
        </div>
      ) : (
        <p className="lv-food-note">{G.nothing}</p>
      )}
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
              <Key key={t} size="sm" variant="outlined" onClick={() => p.onBudget(t)}>
                {G.budget[t]}
              </Key>
            ))}
            <Key size="sm" variant="text" onClick={() => p.onBudget('later')}>
              {G.later}
            </Key>
          </div>
        </div>
      ) : null}
      {list.groups.map((g) => (
        <section key={g.aisle} className="lv-food-aisle" aria-labelledby={`aisle-${g.aisle}`}>
          <h3 id={`aisle-${g.aisle}`} className="lv-food-aisle__name lm-meta">
            {G.aisles[g.aisle]}
          </h3>
          <ul className="lv-food-groceries__items">
            {g.items.map((i) => {
              const { name, amount } = splitBuy(i);
              return (
                <li
                  key={i.key}
                  className={cx('lv-food-grocery', i.have && 'is-have', i.bought && 'is-bought')}
                >
                  <Checkbox
                    checked={i.bought}
                    onChange={(on) => p.onBought(i.key, on)}
                    label={
                      <span className="lv-food-grocery__label">
                        <span className="lv-food-grocery__name">{name}</span>
                        {amount ? <MonoMeta className="lv-food-grocery__amount">{amount}</MonoMeta> : null}
                      </span>
                    }
                  />
                  <Key
                    size="sm"
                    variant="text"
                    icon={House}
                    pressed={i.have}
                    onClick={() => p.onHave(i.name, !i.have)}
                    aria-label={G.haveName(i.name)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </GradientCard>
  );
}
