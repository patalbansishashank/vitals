/**
 * The `navigate` port behind `nav.open` (docs/COMMANDS.md §2 "Ports"): the Coach, WebMCP and the screens' own tools open
 * a screen of the app through the router. `nav.open` builds the path from its route id (`ROUTES` in
 * src/commands/defs/core.ts, the same shapes as `paths` here and `livingPaths`); the port checks that the path is a
 * screen of this app — not the "not found" page — and navigates. A path the app does not know returns false
 * (`{ opened: false }`), so an agent never lands the person on a 404.
 *
 *   const off = installNavigatePort(router);   // App: once the router exists; `off()` on unmount
 */
import { matchRoutes, parsePath, type RouteObject } from 'react-router';
import { getPorts, installPorts } from '@/commands/bus';

/** The part of a data router the port needs (`createBrowserRouter` / `createMemoryRouter`). */
export interface NavigableRouter {
  readonly routes: readonly RouteObject[];
  navigate(to: string): unknown;
}

/** Is `path` a screen of the app (any route but the catch-all "not found")? Query and hash are ignored. */
export function isAppPath(routes: readonly RouteObject[], path: string): boolean {
  const { pathname } = parsePath(path);
  if (!pathname || !pathname.startsWith('/')) return false;
  const matches = matchRoutes(routes as RouteObject[], pathname);
  const leaf = matches?.[matches.length - 1]?.route;
  return !!leaf && leaf.path !== '*';
}

/** The port function: navigate when the path is a screen of the app; false otherwise. */
export function navigatePort(router: NavigableRouter): (path: string) => boolean {
  return (path) => {
    if (!isAppPath(router.routes, path)) return false;
    void router.navigate(path);
    return true;
  };
}

/** Install the port for `router`; returns the uninstall (the port is removed only if it is still this one). */
export function installNavigatePort(router: NavigableRouter): () => void {
  const port = navigatePort(router);
  installPorts({ navigate: port });
  return () => {
    if (getPorts().navigate === port) installPorts({ navigate: undefined });
  };
}
