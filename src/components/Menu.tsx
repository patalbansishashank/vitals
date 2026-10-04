import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Icon, type IconComponent } from './icons/Icon';
import { Popover } from './Popover';
import type { Placement } from './lib/position';

export interface MenuItem {
  id: string;
  label: string;
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
  items: ReadonlyArray<MenuItem>;
  /** Accessible name of the menu. */
  label: string;
  placement?: Placement;
}

/**
 * Action menu (overflow ⋯, scenario actions). Arrow keys move, Home/End jump,
 * typing a letter jumps to the next matching item, Enter/Space activate, Escape
 * closes and returns focus to the trigger.
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

  return (
    <>
      {trigger(triggerProps)}
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchorRef} placement={placement} role="menu" label={label} id={id}>
        <div ref={listRef} className="lm-menu" onKeyDown={onListKey}>
          {items.map((it) => (
            <div key={it.id} style={{ display: 'contents' }}>
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
                {it.icon ? <Icon icon={it.icon} size={16} /> : null}
                <span>{it.label}</span>
                {it.hint ? <span className="lm-menu__hint">{it.hint}</span> : null}
              </button>
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}
