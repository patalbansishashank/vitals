import { isValidElement } from 'react';
import type { RouteObject } from 'react-router';
import { routes } from '@/app/routes';
import { paths } from '@/app/paths';

function find(list: readonly RouteObject[], path: string): RouteObject | undefined {
  for (const r of list) {
    if (r.path === path) return r;
    const hit = r.children ? find(r.children, path) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

describe('/ring', () => {
  it('redirects to Body signals, the one ring page', () => {
    const el = find(routes, 'ring')?.element;
    expect(isValidElement(el)).toBe(true);
    const props = (el as { props: { to: string; replace?: boolean } }).props;
    expect(props.to).toBe(paths.signals());
    expect(props.replace).toBe(true);
  });
});
