import { describe, expect, it } from 'vitest';
import { groceryProgress, type GroceryItem } from '../groceries';

const item = (key: string, have = false, bought = false): GroceryItem => ({
  key,
  name: key,
  aisle: 'vegetables',
  grams: 100,
  buy: `${key} 100 g`,
  dates: [],
  have,
  bought,
});
const list = (...items: GroceryItem[]) => ({ groups: [{ aisle: 'vegetables' as const, items }] });

describe('grocery progress', () => {
  it('counts an item once when it is both bought and already at home', () => {
    expect(
      groceryProgress(list(item('onion', true, true), item('tomato', false, true), item('carrot'))),
    ).toEqual({ total: 3, atHome: 1, bought: 1, done: 2, toBuy: 1, ratio: 2 / 3, word: 'Mostly covered' });
  });

  it('counts the actual rows across aisles, without trusting a stale list count', () => {
    const progress = groceryProgress({
      groups: [
        { aisle: 'dairy', items: [item('curd', true)] },
        { aisle: 'vegetables', items: [item('onion')] },
      ],
    });
    expect(progress.total).toBe(2);
    expect(progress.toBuy).toBe(1);
    expect(progress.word).toBe('About half done');
  });

  it('keeps an empty list distinct from a list fully covered at home', () => {
    expect(groceryProgress(list())).toMatchObject({ total: 0, ratio: 0, word: 'Nothing to buy' });
    expect(groceryProgress(list(item('onion', true)))).toMatchObject({
      total: 1,
      ratio: 1,
      toBuy: 0,
      word: 'Everything covered',
    });
  });
});
