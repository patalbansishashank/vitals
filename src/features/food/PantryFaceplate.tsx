/**
 * Food tab › Pantry: a slim inventory card with the count and recent names, one Edit pantry foot link and a
 * "From your staples" quick-add row. The (i) explains how the pantry feeds recipes and groceries.
 * Names only: never nutrient numbers. Shown at every width (on phones too, under the supplements).
 */
import { useMemo } from 'react';
import { Plus, Package } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  Chip,
  GradientCard,
  HeroNumber,
  Icon,
  MonoMeta,
  VisuallyHidden,
  cx,
} from '@/components';
import { INFO } from '@/features/living/food/copy';
import { infoSpec } from '@/features/living/components/info';
import './pantry.css';
import { quickAddPantry, useKitchenView, usePantryView, type PantryView } from './pantryData';

export const RECENT_MAX = 12;
const STAPLES_MAX = 8;

const when = (p: PantryView['items'][number]) =>
  p.lastConfirmedAt && p.lastConfirmedAt > p.addedAt ? p.lastConfirmedAt : p.addedAt;

export function PantryFaceplate({
  className,
  coverage,
}: {
  className?: string;
  coverage?: { have: number; total: number };
}) {
  const pantry = usePantryView();
  const kitchen = useKitchenView();
  const items = useMemo(() => pantry.view?.items ?? [], [pantry.view]);
  const recent = useMemo(
    () => [...items].sort((a, b) => when(b).localeCompare(when(a))).slice(0, RECENT_MAX),
    [items],
  );
  const fromStaples = useMemo(() => {
    const have = new Set(items.map((i) => i.id));
    return (kitchen.view?.staples ?? []).filter((s) => !have.has(s.id)).slice(0, STAPLES_MAX);
  }, [items, kitchen.view]);
  const count = items.length;

  return (
    <GradientCard
      id="pantry"
      domain="food"
      glow="bl"
      size="slim"
      className={cx('lv-pantry-card', className)}
      href="/food/pantry"
      openLabel="Open pantry"
      head={<CardHead icon={Package} title="Pantry" info={infoSpec(INFO.pantry)} />}
      foot={<CardFoot link={{ to: '/food/pantry', label: 'Edit pantry' }} />}
    >
      {pantry.loading && !pantry.view ? (
        <p className="m-0 text-sm text-ink-2">Loading…</p>
      ) : pantry.error && !pantry.view ? (
        <p className="m-0 text-sm text-ink-2">{pantry.error}</p>
      ) : count === 0 ? (
        <p className="m-0 text-sm text-ink-2">Nothing listed</p>
      ) : (
        <div className="lv-pantry-summary">
          <div className="lv-pantry-summary__count">
            <HeroNumber
              value={count}
              size="num"
              label={`${count} ${count === 1 ? 'item' : 'items'} at home`}
            />
            <MonoMeta>Items at home</MonoMeta>
          </div>
          {coverage && coverage.total > 0 ? (
            <MonoMeta>{`Covers ${coverage.have} of ${coverage.total} on your list`}</MonoMeta>
          ) : null}
          <ul className="lv-pantry-summary__names" aria-label="Recently added">
            {recent.map((p) => (
              <li key={p.id}>{p.label}</li>
            ))}
            {count > recent.length ? <li>and {count - recent.length} more</li> : null}
          </ul>
        </div>
      )}
      {fromStaples.length ? (
        <div className="lv-pantry-staples">
          <MonoMeta>From your staples</MonoMeta>
          <ul>
            {fromStaples.map((s) => (
              <li key={s.id}>
                <Chip onClick={() => void quickAddPantry([{ id: s.id, label: s.label }])}>
                  <Icon icon={Plus} size={12} />
                  <span aria-hidden="true">{s.label}</span>
                  <VisuallyHidden>{`Add ${s.label} to the pantry`}</VisuallyHidden>
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </GradientCard>
  );
}
