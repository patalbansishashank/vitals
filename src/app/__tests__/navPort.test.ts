/** `nav.open` → the app router (the `navigate` port, src/app/navPort.ts). */
import { createMemoryRouter, type RouteObject } from 'react-router';
import { dispatch, getPorts, outputOf } from '@/commands';
import { ROUTES, type RouteId } from '@/commands/defs/core';
import { livingPaths } from '@/features/living/paths';
import { routes } from '../routes';
import { paths } from '../paths';
import { installNavigatePort, isAppPath } from '../navPort';

/** Sample params per route id, and the path the app's own link helpers give for them. */
const SAMPLES: Record<RouteId, { params: Record<string, string>; helper: string | null }> = {
  body: { params: {}, helper: paths.body },
  simulate: { params: {}, helper: paths.simulate },
  schedule: { params: { scenarioId: 'sc 1' }, helper: paths.schedule('sc 1') },
  results: { params: { scenarioId: 'sc1' }, helper: paths.results('sc1') },
  plan: { params: {}, helper: paths.plan },
  planGoals: { params: {}, helper: paths.planGoals },
  planResults: { params: {}, helper: paths.planResults },
  evidence: { params: {}, helper: paths.evidence },
  evidenceTopic: { params: { slug: 'fasting' }, helper: paths.evidenceTopic('fasting') },
  settings: { params: { section: 'data' }, helper: paths.settings('data') },
  safety: { params: {}, helper: paths.safety },
  onboarding: { params: { section: 'diet' }, helper: null },
  today: { params: { date: '2026-10-01' }, helper: livingPaths.today('2026-10-01') },
  food: { params: { date: '2026-10-01' }, helper: livingPaths.food('2026-10-01') },
  train: { params: {}, helper: livingPaths.train() },
  coach: { params: { conversationId: 'c1' }, helper: livingPaths.coach('c1') },
  progress: { params: { metric: 'weight' }, helper: livingPaths.progress('weight') },
  planActive: { params: { version: '3' }, helper: livingPaths.planVersion(3) },
};

describe('nav.open route ids', () => {
  it('every route id builds the path the app links to, and the path is a screen of the app', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(ROUTES).sort());
    for (const id of Object.keys(ROUTES) as RouteId[]) {
      const { params, helper } = SAMPLES[id];
      const path = ROUTES[id](params);
      if (helper !== null) expect(path, id).toBe(helper);
      expect(isAppPath(routes, path), `${id} → ${path}`).toBe(true);
      // schedule and results need their scenario: without it the port refuses instead of opening a broken screen
      expect(isAppPath(routes, ROUTES[id]({})), `${id} without params`).toBe(id !== 'schedule' && id !== 'results');
    }
  });

  it('paths the app does not know are not screens', () => {
    expect(isAppPath(routes, '/nowhere')).toBe(false);
    expect(isAppPath(routes, 'evidence')).toBe(false);
    expect(isAppPath(routes, '/settings#data')).toBe(true);
    // SUITE_SPEC §6.2 section deep links (Progress and Today link to /settings/devices)
    for (const s of ['sync', 'coach', 'agents', 'data-sources', 'devices', 'data']) expect(isAppPath(routes, `/settings/${s}`)).toBe(true);
  });
});

describe('the navigate port', () => {
  // a light route table: the real one mounts lazy screens, which these tests do not need to render
  const light: RouteObject[] = [{ path: '/', children: [{ path: 'evidence' }, { path: 'today' }, { path: 'today/:date' }, { path: '*' }] }];

  it('nav.open moves the router and reports opened', async () => {
    const router = createMemoryRouter(light, { initialEntries: ['/'] });
    const off = installNavigatePort(router);
    try {
      expect(outputOf(await dispatch('nav.open', { route: 'today', params: { date: '2026-10-02' } }))).toEqual({ opened: true, path: '/today/2026-10-02' });
      expect(router.state.location.pathname).toBe('/today/2026-10-02');
      expect(outputOf(await dispatch('nav.open', { route: 'evidence' }))).toEqual({ opened: true, path: '/evidence' });
      expect(router.state.location.pathname).toBe('/evidence');
      // a route this table has no screen for lands on the catch-all: refused, nothing moves
      expect(outputOf(await dispatch('nav.open', { route: 'body' }))).toEqual({ opened: false, path: '/body' });
      expect(router.state.location.pathname).toBe('/evidence');
    } finally {
      off();
    }
    expect(getPorts().navigate).toBeUndefined();
    expect(outputOf(await dispatch('nav.open', { route: 'evidence' }))).toEqual({ opened: false, path: '/evidence' });
  });

  it('uninstalling an old port leaves a newer one in place', () => {
    const a = createMemoryRouter(light);
    const b = createMemoryRouter(light);
    const offA = installNavigatePort(a);
    const offB = installNavigatePort(b);
    offA();
    expect(getPorts().navigate).toBeDefined();
    offB();
    expect(getPorts().navigate).toBeUndefined();
  });
});
