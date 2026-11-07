import type { ReactNode } from 'react';
import { CardGrid, CardLibrary, Key, type CardGridItem } from '@/components';
import { todayCardRegistry, wholeDayCard } from './registry';
import type { useTodayCards } from './useTodayCards';
import type { TodayCardCtx } from './types';

export type TodayCardsController = ReturnType<typeof useTodayCards>;

export function TodayCards({
  ctx,
  cards,
  hero,
  planContent,
}: {
  ctx: TodayCardCtx;
  cards: TodayCardsController;
  hero: ReactNode;
  planContent?: ReactNode;
}) {
  const definitions = todayCardRegistry;
  const editing = cards.editing && ctx.state !== 'future';
  const items: CardGridItem[] = [{ id: 'hero', size: 'hero', node: hero }];
  if (ctx.state !== 'future')
    for (const choice of cards.selected) {
      const def = definitions.find((d) => d.id === choice.id);
      if (!def || !def.available(ctx).ok) continue;
      const size = def.sizes.find((s) => s === choice.size) ?? def.defaultSize;
      const onRemove = editing ? () => cards.remove(def.id) : undefined;
      const node = (contentSize: typeof size) =>
        choice.id === 'plan' && planContent
          ? wholeDayCard(planContent, onRemove)
          : def.render(ctx, contentSize, onRemove);
      items.push({ id: def.id, size, node, edit: { label: def.title, sizes: def.sizes } });
    }
  return (
    <div className="lv-cards-layout">
      <div className="lv-cards-layout__main">
        {editing ? <p className="lv-card-editing" role="status">Editing cards · Hold and drag to reorder.</p> : null}
        <CardGrid className="lv-today__grid" label="Today's cards" items={items} equalRows
          keyboardEditing={editing}
          editor={editing ? { onResize: cards.resize, onReorder: cards.reorderVisible } : undefined} />
        {editing ? (
          <div className="lv-add-card">
            <Key variant="text" onClick={() => cards.open('add')} aria-haspopup="dialog">
              Add a card
            </Key>
          </div>
        ) : null}
      </div>
      {editing ? <CardLibrary
        open={cards.library !== null}
        onOpenChange={(open) => !open && cards.close()}
        title="Today's cards"
        items={definitions.map((d) => {
          const a = d.available(ctx);
          return {
            id: d.id,
            label: d.title,
            icon: d.icon,
            hue: d.domain,
            group: d.group,
            description: d.description,
            sizes: d.sizes,
            default: d.presence === 'default',
            locked: d.presence === 'locked',
            unavailable: a.ok ? null : a.reason,
          };
        })}
        selected={cards.selected}
        organize={false}
        onChange={cards.change}
        onReset={cards.reset}
        quiet={ctx.quiet}
        startAt={cards.library ?? 'shown'}
        copy={{ shown: 'On Today', empty: 'Your day stays here. Add a card below.' }}
      /> : null}
    </div>
  );
}
