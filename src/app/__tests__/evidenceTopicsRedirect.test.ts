import { isValidElement } from 'react';
import type { RouteObject } from 'react-router';
import { routes } from '@/app/routes';
import { parseIndexParams } from '@/features/evidence/data/filters';

function find(list: readonly RouteObject[], path: string): RouteObject | undefined {
  for (const r of list) {
    if (r.path === path) return r;
    const hit = r.children ? find(r.children, path) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

describe('/evidence/topics', () => {
  it('redirects to the Evidence index grouped by topic, with the public group name', () => {
    const route = find(routes, 'evidence/topics');
    const el = route?.element;
    expect(isValidElement(el)).toBe(true);
    const to = (el as { props: { to: string } }).props.to;
    expect(to).toBe('/evidence?group=topic');
    expect(to).not.toMatch(/dossier/);
    expect(parseIndexParams(new URLSearchParams(to.split('?')[1])).group).toBe('topic');
  });
});
