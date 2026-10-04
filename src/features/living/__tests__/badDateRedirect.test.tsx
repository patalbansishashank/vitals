/** A bad date in the address of Today, Food or Train goes to the page for today and drops the bad address. */
import type { ReactElement } from 'react';
import { screen, waitFor } from '@testing-library/react';
import TodayPage from '../today/TodayPage';
import FoodPage from '../food/FoodPage';
import TrainPage from '../train/TrainPage';
import { renderLiving } from '../testing';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

const pages: Array<[string, ReactElement]> = [
  ['today', <TodayPage key="today" />],
  ['food', <FoodPage key="food" />],
  ['train', <TrainPage key="train" />],
];

describe('bad date in the address', () => {
  it.each(pages)('/%s/<not a date> redirects to /%s', async (name, page) => {
    for (const bad of ['xx', 'zz', '2026-13-45', 'garbage']) {
      const h = renderLiving(page, { path: `/${name}/${bad}`, route: `${name}/:date`, routes: [{ path: name, element: <p>{`${name} for today`}</p> }] });
      await waitFor(() => expect(h.router.state.location.pathname).toBe(`/${name}`));
      expect(h.router.state.historyAction).toBe('REPLACE');
      expect(await screen.findByText(`${name} for today`)).toBeInTheDocument();
      h.result.unmount();
    }
  });

  it.each(pages)('/%s/<a real date> stays where it is', async (name, page) => {
    const h = renderLiving(page, { path: `/${name}/2026-09-30`, route: `${name}/:date`, routes: [{ path: name, element: <p>{`${name} for today`}</p> }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.router.state.location.pathname).toBe(`/${name}/2026-09-30`);
    expect(screen.queryByText(`${name} for today`)).toBeNull();
    h.result.unmount();
  });
});
