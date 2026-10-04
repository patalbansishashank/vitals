// V1h: a lazy route opened directly (first load) needs a hydrate fallback, or the router warns and shows nothing.
import { describe, expect, it } from 'vitest';
import type { RouteObject } from 'react-router';
import { routes } from '../routes';

const flat = (rs: RouteObject[]): RouteObject[] => rs.flatMap((r) => [r, ...flat(r.children ?? [])]);

describe('lazy routes', () => {
  it('every route with lazy() has a HydrateFallback', () => {
    const lazy = flat(routes).filter((r) => r.lazy);
    expect(lazy.length).toBeGreaterThan(0);
    for (const r of lazy) expect(r.HydrateFallback, r.path).toBeTruthy();
  });
});
