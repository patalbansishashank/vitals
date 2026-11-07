/** Dev-only synthetic cases absent from the ordinary day fixture: compact cards, a fast and grocery lists. */
import { CardGrid } from '@/components';
import type { LocalDate } from '@/living';
import type { ActivePlan } from '../../activePlan';
import { useActivityData } from '../../activity/data';
import { useLiving } from '../../data/source';
import { GroceriesFace, type GroceriesFaceProps } from '../../food/components/GroceriesFace';
import { TargetsFace } from '../../food/components/TargetsFace';
import { SoFarFace } from '../components/Faces';
import { EnergyContent } from '../cards/ActivityCards';
import { extraTodayCards } from '../cards/ExtraCards';
import type { TodayCardCtx } from '../cards/types';

export function DailyCardSamples({
  date,
  nowMs,
  plan,
  quiet,
  empty,
  long,
}: {
  date: LocalDate;
  nowMs: number;
  plan: ActivePlan | null;
  quiet: boolean;
  empty: boolean;
  long: boolean;
}) {
  const view = useLiving((s) => s.today(date), [date]);
  const data = useActivityData();
  const review = data.useReview(date, date);
  const ctx: TodayCardCtx = {
    date,
    today: date,
    isToday: true,
    plan,
    planless: false,
    state: 'active',
    view,
    trend: null,
    review,
    rows: [],
    nowH: 10,
    nowMs,
    quiet,
    lg: false,
    eu: 'kcal',
    ring: 'ready',
    openActivity: () => undefined,
    record: { can: false, open: () => undefined },
    log: { can: false, open: () => undefined },
  };
  const groceries: GroceriesFaceProps = {
    list: {
      from: date,
      to: date,
      count: empty ? 0 : 3,
      groups: empty
        ? []
        : [
            {
              aisle: 'dairy',
              items: [
                {
                  key: 'paneer',
                  name: long ? 'Unsalted paneer from the neighbourhood dairy counter' : 'paneer',
                  aisle: 'dairy',
                  grams: 200,
                  buy: long
                    ? 'Unsalted paneer from the neighbourhood dairy counter 200 g pack'
                    : 'paneer 200 g pack',
                  dates: [date],
                  have: false,
                  bought: false,
                },
                {
                  key: 'curd',
                  name: 'curd',
                  aisle: 'dairy',
                  grams: 400,
                  buy: 'curd 400 g tub',
                  dates: [date],
                  have: true,
                  bought: false,
                },
                {
                  key: 'milk',
                  name: 'milk',
                  aisle: 'dairy',
                  grams: 500,
                  buy: 'milk 500 ml carton',
                  dates: [date],
                  have: false,
                  bought: true,
                },
              ],
            },
          ],
    },
    horizon: 'today',
    budget: { tier: 'normal', deferred: false },
    quiet,
    onHorizon: () => undefined,
    onBudget: () => undefined,
    onBought: () => undefined,
    onHave: () => undefined,
    onShare: () => undefined,
    onPrint: () => undefined,
  };
  if (!view?.prescription) return null;
  return (
    <main className="lm-page">
      <CardGrid
        label="Synthetic compact cards"
        items={[
          {
            id: 'eaten',
            size: 'tile',
            node: <SoFarFace view={view} quiet={quiet} title="Eaten so far" size="sm" cardSize="tile" />,
          },
          {
            id: 'energy',
            size: 'tile',
            node: (
              <EnergyContent
                date={date}
                isToday
                quiet={quiet}
                review={review}
                onOpenRow={() => undefined}
                nowMs={nowMs}
                size="tile"
              />
            ),
          },
          {
            id: 'fast',
            size: 'tile',
            node: extraTodayCards.find((d) => d.id === 'fast')!.render(ctx, 'tile'),
          },
          { id: 'groceries', size: 'card', node: <GroceriesFace {...groceries} /> },
          ...(empty
            ? [
                {
                  id: 'targets',
                  size: 'card' as const,
                  node: (
                    <TargetsFace
                      rx={view.prescription}
                      totals={{
                        energyKcal: { value: 0, sd: 0 },
                        proteinG: { value: 0, sd: 0 },
                        carbG: { value: 0, sd: 0 },
                        fatG: { value: 0, sd: 0 },
                        fibreG: { value: 0, sd: 0 },
                      }}
                      logged={false}
                      quiet={quiet}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
    </main>
  );
}
