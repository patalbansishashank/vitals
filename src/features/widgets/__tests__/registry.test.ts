/** design/widgets.json: the screens a widget tap may open are screens of the app, and the web feed's placement keys are the registry's ids. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAppPath } from '@/app/navPort';
import { routes } from '@/app/routes';
import { FEED_CARDS } from '../status';

const registry = JSON.parse(readFileSync(resolve(__dirname, '../../../../design/widgets.json'), 'utf8')) as {
  targets: Record<string, string>;
  widgets: Array<{ id: string; tap: string }>;
};

describe('the widget registry', () => {
  it('every tap target is a screen of the app, as a path starting with a single slash', () => {
    for (const [id, path] of Object.entries(registry.targets)) {
      expect(path.startsWith('/') && !path.startsWith('//'), `${id}: ${path}`).toBe(true);
      expect(isAppPath(routes, path), `${id}: ${path}`).toBe(true);
    }
  });

  it('every widget taps a target the registry holds', () => {
    for (const w of registry.widgets) expect(Object.keys(registry.targets), w.id).toContain(w.tap);
  });

  it('the feed asks for placed widgets by registry ids', () => {
    const ids = registry.widgets.map((w) => w.id);
    for (const cards of Object.values(FEED_CARDS)) for (const c of cards) expect(ids, c).toContain(c);
  });
});
