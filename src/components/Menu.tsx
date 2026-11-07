import { Fragment, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Icon, type IconComponent } from './icons/Icon';
import { Popover } from './Popover';
import type { Placement } from './lib/position';

export interface MenuItem {
  /** Optional discriminant; plain items may omit it. */
  kind?: 'item';
  id: string;
  label: string;
  /** Optional leading 20 px icon (stone). */
  icon?: IconComponent;
  onSelect: () => void;
  disabled?: boolean;
  /** Destructive items read in the danger colour. */
  tone?: 'default' | 'danger';
  /** Trailing hint ("⌘K"). */
  hint?: string;
  /** Draw a hairline above this item. */
  separatorBefore?: boolean;
}

/** A hairline between two groups (e.g. the page's own actions · the global items). */
export interface MenuDivider {
  kind: 'divider';
  id: string;
}

/**
 * Starts a labelled group: the items after it (up to the next section or divider) form a `role="group"`
 * named by `label`, drawn as a small stone heading. A hairline is drawn above it unless it is first.
 */
export interface MenuSection {
  kind: 'section';
  id: string;
  label: string;
}

export type MenuEntry = MenuItem | MenuDivider | MenuSection;

export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
}

export interface MenuProps {
  /** Render the trigger with these props spread onto a Key/IconKey. */
  trigger: (props: MenuTriggerProps) => ReactNode;
  /** Items, optionally split by `{ kind: 'divider' }` or grouped under `{ kind: 'section', label }`. */
  items: ReadonlyArray<MenuEntry>;
  /** Accessible name of the menu. */
  label: string;
  placement?: Placement;
}

const isItem = (e: MenuEntry): e is MenuItem => e.kind === undefined || e.kind === 'item';

interface Group {
  key: string;
  section?: MenuSection;
  /** A hairline goes above this group. */
  ruled: boolean;
  entries: MenuItem[];
}

/** Split the flat entry list into groups at sections and dividers (empty groups are dropped). */
function groupEntries(items: ReadonlyArray<MenuEntry>): Group[] {
  const groups: Group[] = [];
  let current: Group = { key: 'g0', ruled: false, entries: [] };
  let pendingRule = false;
  const flush = () => {
    if (current.entries.length > 0 || current.section) groups.push(current);
  };
  for (const e of items) {
    if (e.kind === 'divider') {
      flush();
      pendingRule = groups.length > 0;
      current = { key: e.id, ruled: false, entries: [] };
    } else if (e.kind === 'section') {
      flush();
      current = { key: e.id, section: e, ruled: pendingRule || groups.length > 0, entries: [] };
      pendingRule = false;
    } else if (isItem(e)) {
      if (current.entries.length === 0 && !current.section && pendingRule) {
        current.ruled = true;
        pendingRule = false;
      }
      current.entries.push(e);
    }
  }
  flush();
  return groups;
}

/**
 * Action menu (the screen's one ⋯, per-row ⋯ on object rows). Elevated surface, 44 px rows, optional
 * leading icons, hairline dividers and labelled sections. Arrow keys move, Home/End jump, typing a letter
 * jumps to the next matching item, Enter/Space activate, Escape closes and returns focus to the trigger.
 */
export function Menu({ trigger, items, label, placement = 'bottom-end' }: MenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const focusItem = (index: number) => {
    const els = listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    if (!els || els.length === 0) return;
    const i = ((index % els.length) + els.length) % els.length;
    els[i]?.focus();
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    const cur = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(cur + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(cur - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(els.length - 1);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const ch = e.key.toLowerCase();
      const start = cur + 1;
      for (let k = 0; k < els.length; k++) {
        const el = els[(start + k) % els.length];
        if (el?.textContent?.trim().toLowerCase().startsWith(ch)) {
          el.focus();
          break;
        }
      }
    }
  };

  const triggerProps: MenuTriggerProps = {
    ref: anchorRef,
    onClick: () => setOpen((o) => !o),
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      }
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
  };

  const renderItem = (it: MenuItem) => (
    <Fragment key={it.id}>
      {it.separatorBefore ? <div className="lm-menu__sep" role="separator" /> : null}
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="lm-menu__item"
        data-tone={it.tone === 'danger' ? 'danger' : undefined}
        aria-disabled={it.disabled || undefined}
        onClick={() => {
          if (it.disabled) return;
          setOpen(false);
          anchorRef.current?.focus();
          it.onSelect();
        }}
      >
        {it.icon ? <Icon icon={it.icon} size={20} /> : null}
        <span>{it.label}</span>
        {it.hint ? <span className="lm-menu__hint">{it.hint}</span> : null}
      </button>
    </Fragment>
  );

  return (
    <>
      {trigger(triggerProps)}
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchorRef} placement={placement} role="menu" label={label} id={id}>
        <div ref={listRef} className="lm-menu" onKeyDown={onListKey}>
          {groupEntries(items).map((g) => {
            const headId = g.section ? `${id}-${g.section.id}` : undefined;
            return (
              <Fragment key={g.key}>
                {g.ruled ? <div className="lm-menu__sep" role="separator" /> : null}
                {g.section ? (
                  <div className="lm-menu__group" role="group" aria-labelledby={headId}>
                    <div className="lm-menu__section" id={headId} role="presentation">
                      {g.section.label}
                    </div>
                    {g.entries.map(renderItem)}
                  </div>
                ) : (
                  g.entries.map(renderItem)
                )}
              </Fragment>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
