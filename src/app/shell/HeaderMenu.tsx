import { useMemo } from 'react';
import { Ellipsis } from 'lucide-react';
import { IconKey } from '@/components/Key';
import { Menu, type MenuEntry } from '@/components/Menu';

/** The trigger's (and the menu's) accessible name: one ⋯ per screen, so one name everywhere. */
export const HEADER_MENU_LABEL = 'More';

/** True when the page handed the header at least one action of its own (dividers and section labels alone don't count). */
export function hasPageItems(items?: ReadonlyArray<MenuEntry>): boolean {
  return !!items?.some((e) => e.kind === undefined || e.kind === 'item');
}

/**
 * The screen's one ⋯ (SPEC §4, §8.2; r068 U14): rendered by the header itself — pages never render a top-level ⋯ of
 * their own. It holds the page's own actions only: first the status icons the bar had no room for (`moved`: each opens
 * what its icon opens; one with nothing to open is its words as a heading), then the page's items
 * (`<TopBar menu={…} />`). Global places live in the navigation (the phone dock and its More page, the desktop
 * sidebar), never here, so a page without actions of its own shows no ⋯ at all.
 */
export function HeaderMenu({
  items,
  moved,
}: {
  items?: ReadonlyArray<MenuEntry>;
  /** The status icons the bar had no room for (TopBar): first, before the page's items. */
  moved?: ReadonlyArray<MenuEntry>;
}) {
  const all = useMemo<MenuEntry[]>(
    () => (moved?.length ? [...moved, ...(hasPageItems(items) ? [{ kind: 'divider', id: 'shell-status-divider' } as const] : []), ...(items ?? [])] : [...(items ?? [])]),
    [moved, items],
  );
  if (!hasPageItems(items) && !moved?.length) return null;
  return (
    <Menu
      label={HEADER_MENU_LABEL}
      items={all}
      trigger={(t) => <IconKey {...t} className="lm-ctx__more" icon={Ellipsis} label={HEADER_MENU_LABEL} />}
    />
  );
}
