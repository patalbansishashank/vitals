/* ==========================================================================
   <CardLibrary> (r071 0B, AUDIT §2.4, §2.5, §5.2): reorder, add and remove the cards a page shows, and size them.
   It is `MonitorSheet` generalised (that component is now a thin wrapper over this one, `variant="monitor"`, until the
   Ring migrates). Every change applies at once, so the header is title · ✕ (no Cancel, no verb): the One Way Out
   Rule. A bottom sheet on phones (60 and 92 % detents), a 392 px side panel from 1024 px (ResponsivePanel).

   Rows: a 48 px grip, a hue dot and icon, the label with its one-line description in stone (and its current value),
   a size toggle where a card has more than one size, a 48 px remove key (a minus in a circle; a plus in a circle to
   add). The hero is a locked row: a lock instead of a grip, no remove key, always first and never stored. Below, the
   "Add" list, grouped by domain with a mono group name and its hue dot (a hue is never the only word), with a search
   field above ten cards. A card that cannot be had now (no ring, no plan) is listed greyed with the reason and cannot
   be added; one the person already chose stays in their list, greyed, so pairing the ring later makes it appear.
   Foot: "Showing 6 of 29" and "Reset to default" (disabled, with its reason, when already default).

   Keyboard: Space picks a row up, arrows (Home, End) move it, Space drops, Esc cancels; a polite live region says
   where it went and focus stays on the row. Pointer: press the grip and drag (capture, edge auto-scroll). A removed
   item keeps its place (and size) for when it is added again. Rows slide to their new places in 160 ms (FLIP on
   transform; instant under reduced motion).
   ========================================================================== */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { CircleMinus, CirclePlus, GripVertical, Hourglass, Lock, Search } from 'lucide-react';
import { cx } from './lib/cx';
import { useFlip } from '@/app/motion';
import { useLatest } from './lib/hooks';
import { Icon, type IconComponent } from './icons/Icon';
import { TextInput } from './Field';
import { IconKey, Key } from './Key';
import { KeyBank } from './KeyBank';
import { MonoMeta } from './MonoMeta';
import { ResponsivePanel } from './SidePanel';
import type { Domain } from './domain';
import './library.css';

/* ------------------------------------------------------------------ types */

export interface LibraryItem {
  id: string;
  label: string;
  icon?: IconComponent;
  /** The card's domain: its hue dot, and the icon's tint. `neutral` for none. */
  hue: Domain;
  /** The Add list's group name ("Energy", "Move"). One group (or none) draws no group names. */
  group: string;
  /** What the card answers, one line (eight words at most). */
  description?: string;
  /** A thumbnail of the card, shown in the Add list. Decorative. */
  preview?: ReactNode;
  /** The sizes a card has (`tile`, `card`): more than one draws a size toggle. The first is the default. */
  sizes?: string[];
  /** Part of the default set (Reset puts exactly these back, in list order). */
  default?: boolean;
  /** Always shown and always first (the hero): a lock, no grip, no remove key. Never part of `selected`. */
  locked?: boolean;
  /** Why the card cannot be had now ("Needs a ring"). Null or absent: it can. */
  unavailable?: string | null;
  /** The card's current value, in stone ("7 h 56"). Hidden in quiet mode. */
  valueText?: string | null;
  /** The value is still being learnt: the row says "Calibrating" instead of a value (the Ring's signals). */
  calibrating?: boolean;
}

export interface LibrarySelection {
  id: string;
  /** One of the item's `sizes`; absent for a card with one size. */
  size?: string;
}

export interface LibraryCopy {
  /** "Showing" (before "6 of 29") */
  showing: string;
  /** The Add list's heading */
  add: string;
  /** No card is shown */
  empty: string;
  reset: string;
  resetDisabled: string;
  /** Why the add keys are disabled at `max`; `{max}` is replaced. */
  full: string;
  /** The heading of the shown list, in the foot-capacity layout ("Shown"). */
  shown: string;
  /** The search field's name and placeholder. */
  search: string;
  /** Nothing in the Add list matches the search. */
  noMatch: string;
  /** What a locked row says ("Always first"). */
  locked: string;
}

export const DEFAULT_LIBRARY_COPY: LibraryCopy = {
  showing: 'Showing',
  add: 'Add',
  empty: 'Nothing shown. The card shows the default set until you add one.',
  reset: 'Reset to default',
  resetDisabled: 'Already the default set.',
  full: 'The card holds {max}. Remove one first.',
  shown: 'Shown',
  search: 'Search cards',
  noMatch: 'No card matches.',
  locked: 'Always first',
};

export interface CardLibraryProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  items: LibraryItem[];
  /** In order, the hero excluded. Ids no item has are ignored (and dropped by the next change). */
  selected: LibrarySelection[];
  onChange(next: LibrarySelection[]): void;
  onReset(): void;
  /** The most that can be shown (locked rows count). The foot reads "Showing 6 of {max}"; default of the item count. */
  max?: number;
  quiet?: boolean;
  copy?: Partial<LibraryCopy>;
  /** What Reset puts back, when it is not simply the items flagged `default` in list order. */
  defaultSelected?: LibrarySelection[];
  /** Display words of a size id (default: the id with a capital: "Tile", "Card"). */
  sizeLabels?: Record<string, string>;
  /** Name of the adjustable dimension; Today calls it Width. */
  sizeNoun?: string;
  /** Short explanation of how the sizes respond to narrower screens. */
  sizeHelp?: string;
  /** Hide reorder and size controls when the page edits cards directly in its grid. */
  organize?: boolean;
  /** A key at the end of every row ("Add as widget"). */
  renderRowAction?: (item: LibraryItem) => ReactNode;
  /** @deprecated Accepted for older callers; desktop panels always overlay the page. */
  dockAtXl?: boolean;
  /** Where the panel opens: the shown list (default) or its Add section (the page's slim "Add a card" row). */
  startAt?: 'shown' | 'add';
  /**
   * `monitor`: the markup and class names `MonitorSheet` always had (`lmv-mon*`), so the Ring's overrides and the
   * viz.css rules keep working until it migrates; the capacity sits at the top and Reset in the body. Used by the
   * `MonitorSheet` wrapper only, and deleted with it.
   */
  variant?: 'default' | 'monitor';
  className?: string;
}

/* ------------------------------------------------------------ pure model */

/** `ids` with `id` moved to index `to` (clamped). */
export function moveId(ids: readonly string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const next = ids.filter((x) => x !== id);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, id);
  return next;
}

/** Remove `id`, remembering its index in `memory`. */
export function removeId(ids: readonly string[], id: string, memory: Map<string, number>): string[] {
  const i = ids.indexOf(id);
  if (i >= 0) memory.set(id, i);
  return ids.filter((x) => x !== id);
}

/** Add `id` back at its remembered place (else at the end); refused past `max`. */
export function addId(ids: readonly string[], id: string, memory: ReadonlyMap<string, number>, max = Infinity): string[] {
  if (ids.includes(id) || ids.length >= max) return [...ids];
  const at = memory.get(id);
  const next = [...ids];
  next.splice(at === undefined ? next.length : Math.min(at, next.length), 0, id);
  return next;
}

/** "12 of 26" */
export const monitorCapacity = (count: number, total: number): string => `${count} of ${total}`;

/** "Resting HR moved to position 3 of 12" */
export const movedText = (label: string, index: number, count: number): string => `${label} moved to position ${index + 1} of ${count}`;

/** The size a selection of `item` has: the chosen one, else the item's first. Undefined for a card with one size. */
export function sizeOf(item: Pick<LibraryItem, 'sizes'> | undefined, size?: string): string | undefined {
  const sizes = item?.sizes;
  if (!sizes || sizes.length < 2) return undefined;
  return size !== undefined && sizes.includes(size) ? size : sizes[0];
}

/** What Reset puts back: the items flagged `default` (the hero excluded), in list order, each at its first size. Pure. */
export function defaultSelection(items: readonly LibraryItem[]): LibrarySelection[] {
  return items
    .filter((i) => i.default && !i.locked)
    .map((i) => {
      const size = sizeOf(i);
      return size !== undefined ? { id: i.id, size } : { id: i.id };
    });
}

/** Whether two selections are the same list: same ids in the same order, each at the same size. Pure. */
export function sameSelection(a: readonly LibrarySelection[], b: readonly LibrarySelection[], byId: ReadonlyMap<string, Pick<LibraryItem, 'sizes'>>): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i]!.id && sizeOf(byId.get(x.id), x.size) === sizeOf(byId.get(x.id), b[i]!.size));
}

/** The Add list in groups, in the order each group first appears. Pure. */
export function groupItems<T extends { group: string }>(items: readonly T[]): Array<{ group: string; items: T[] }> {
  const out: Array<{ group: string; items: T[] }> = [];
  for (const it of items) {
    const g = out.find((x) => x.group === it.group);
    if (g) g.items.push(it);
    else out.push({ group: it.group, items: [it] });
  }
  return out;
}

/** The items whose label, description or group contains every word of `query` (case-insensitive). Pure. */
export function filterItems<T extends Pick<LibraryItem, 'label' | 'description' | 'group'>>(items: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...items];
  return items.filter((i) => {
    const hay = `${i.label} ${i.description ?? ''} ${i.group}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** More available cards than this draw a search field. */
export const SEARCH_ABOVE = 10;

const capital = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/* ---------------------------------------------------- the slide of a row */

/** A row slides to its new place in 160 ms (the shared FLIP of `@/app/motion`; rows carry `data-flip`; instant where motion cannot run). */
const SLIDE_MS = 160;

/* ------------------------------------------------------------- component */

interface Grab {
  id: string;
  origin: string[];
  draft: string[];
  pointer: boolean;
}

const EDGE = 56; // px from the list's scroll edge where a dragged row starts to scroll it
const SCROLL_MAX = 14; // px per frame at the very edge

export function CardLibrary({
  open,
  onOpenChange,
  title,
  items,
  selected,
  onChange,
  onReset,
  max,
  quiet = false,
  copy: copyIn,
  defaultSelected,
  sizeLabels,
  sizeNoun = 'Size',
  sizeHelp,
  organize = true,
  renderRowAction,
  dockAtXl,
  startAt = 'shown',
  variant = 'default',
  className,
}: CardLibraryProps) {
  const monitor = variant === 'monitor';
  /** The class family: today's `lmv-mon*` for the monitor wrapper, `lm-lib*` for everything new. */
  const K = monitor ? 'lmv-mon' : 'lm-lib';
  const copy: LibraryCopy = { ...DEFAULT_LIBRARY_COPY, ...copyIn };
  const hintId = useId();
  const memory = useRef(new Map<string, number>());
  const sizeMemory = useRef(new Map<string, string>());
  const grips = useRef(new Map<string, HTMLButtonElement | null>());
  const rows = useRef(new Map<string, HTMLLIElement | null>());
  const adds = useRef(new Map<string, HTMLButtonElement | null>());
  const listRef = useRef<HTMLUListElement>(null);
  const pointerY = useRef(0);
  const focusNext = useRef<{ kind: 'grip' | 'add'; id: string } | null>(null);
  const [grab, setGrab] = useState<Grab | null>(null);
  const grabNow = useLatest(grab);
  const [say, setSay] = useState('');
  const [query, setQuery] = useState('');
  const addRef = useRef<HTMLElement | null>(null);

  // "Add a card" opens the panel at its Add section
  useEffect(() => {
    if (open && startAt === 'add') addRef.current?.scrollIntoView?.({ block: 'start' });
  }, [open, startAt]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const lockedItems = items.filter((i) => i.locked);
  const sel = selected.filter((s) => byId.has(s.id) && !byId.get(s.id)!.locked);
  const ids = sel.map((s) => s.id);
  const chosenSize = new Map(sel.map((s) => [s.id, s.size]));
  const order = grab ? grab.draft : ids;
  const shown = order.map((id) => byId.get(id)).filter((i): i is LibraryItem => Boolean(i));
  const total = max ?? items.length;
  const count = lockedItems.length + ids.length;
  const full = max !== undefined && count >= max;
  const fullText = copy.full.replace('{max}', String(max ?? ''));
  const defaults = defaultSelected ?? defaultSelection(items);
  const isDefault = sameSelection(sel, defaults, byId);
  const labelOf = (id: string) => byId.get(id)?.label ?? id;
  /** The monitor wrapper has no hues: its markup stays what it always was. */
  const hueOf = (item: LibraryItem): Domain | undefined => (monitor ? undefined : item.hue);
  const sizeLabel = (s: string) => sizeLabels?.[s] ?? capital(s);
  const capText = monitorCapacity(count, total);

  const toSelection = (nextIds: readonly string[], size?: { id: string; size: string }): LibrarySelection[] =>
    nextIds.map((id) => {
      const s = size && size.id === id ? size.size : (chosenSize.get(id) ?? sizeMemory.current.get(id));
      const resolved = sizeOf(byId.get(id), s);
      return resolved !== undefined ? { id, size: resolved } : { id };
    });

  useFlip(listRef, order.join('\u0000'), { duration: SLIDE_MS });

  useEffect(() => {
    const f = focusNext.current;
    if (!f) return;
    focusNext.current = null;
    const el = f.kind === 'grip' ? grips.current.get(f.id) : adds.current.get(f.id);
    el?.focus({ preventScroll: false });
  });

  const commit = (draft: string[]) => {
    if (draft.join('\u0000') !== ids.join('\u0000')) onChange(toSelection(draft));
  };

  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (!grab) {
        setGrab({ id, origin: ids, draft: ids, pointer: false });
        setSay(`${labelOf(id)} picked up, position ${ids.indexOf(id) + 1} of ${ids.length}. Arrows move it, Space drops it, Escape cancels.`);
      } else {
        commit(grab.draft);
        setSay(`${labelOf(grab.id)} dropped at position ${grab.draft.indexOf(grab.id) + 1} of ${grab.draft.length}`);
        setGrab(null);
        focusNext.current = { kind: 'grip', id: grab.id };
      }
      return;
    }
    if (!grab || grab.id !== id) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setGrab(null);
      setSay(`Move cancelled. ${labelOf(id)} is back at position ${grab.origin.indexOf(id) + 1} of ${grab.origin.length}`);
      focusNext.current = { kind: 'grip', id };
      return;
    }
    const at = grab.draft.indexOf(id);
    const to = e.key === 'ArrowUp' ? at - 1 : e.key === 'ArrowDown' ? at + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? grab.draft.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const draft = moveId(grab.draft, id, to);
    setGrab({ ...grab, draft });
    setSay(movedText(labelOf(id), draft.indexOf(id), draft.length));
    focusNext.current = { kind: 'grip', id };
  };

  const indexAtY = (y: number, id: string, draft: readonly string[]): number => {
    let to = 0;
    for (const other of draft) {
      if (other === id) continue;
      const r = rows.current.get(other)?.getBoundingClientRect();
      if (r && y > r.top + r.height / 2) to++;
    }
    return to;
  };

  const dragTo = (y: number) => {
    const g = grabNow.current;
    if (!g?.pointer) return;
    const to = indexAtY(y, g.id, g.draft);
    if (g.draft.indexOf(g.id) === to) return;
    const draft = moveId(g.draft, g.id, to);
    setGrab({ ...g, draft });
    setSay(movedText(labelOf(g.id), to, draft.length));
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, id: string) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointerY.current = e.clientY;
    setGrab({ id, origin: ids, draft: ids, pointer: true });
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!grab?.pointer) return;
    pointerY.current = e.clientY;
    dragTo(e.clientY);
  };
  const onPointerUp = () => {
    if (!grab?.pointer) return;
    commit(grab.draft);
    setGrab(null);
  };
  const onPointerCancel = () => {
    if (grab?.pointer) setGrab(null);
  };

  // a dragged row near the edge of the list's scroll box scrolls it, and the row follows the pointer through the rows
  const dragging = grab?.pointer ?? false;
  useEffect(() => {
    if (!dragging) return;
    const list = listRef.current;
    const scroller = (list?.closest('.lm-panel__body') as HTMLElement | null) ?? (document.scrollingElement as HTMLElement | null);
    if (!scroller) return;
    let raf = 0;
    const tick = () => {
      const box = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
      const y = pointerY.current;
      let dy = 0;
      if (y < box.top + EDGE) dy = -Math.ceil(Math.min(1, (box.top + EDGE - y) / EDGE) * SCROLL_MAX);
      else if (y > box.bottom - EDGE) dy = Math.ceil(Math.min(1, (y - (box.bottom - EDGE)) / EDGE) * SCROLL_MAX);
      if (dy !== 0) {
        const before = scroller.scrollTop;
        scroller.scrollTop += dy;
        if (scroller.scrollTop !== before) dragTo(y);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const remove = (id: string) => {
    const next = removeId(ids, id, memory.current);
    const size = chosenSize.get(id);
    if (size !== undefined) sizeMemory.current.set(id, size);
    onChange(toSelection(next));
    setSay(`${labelOf(id)} removed. ${monitorCapacity(count - 1, total)}`);
    focusNext.current = { kind: 'add', id };
  };
  const add = (id: string) => {
    const item = byId.get(id);
    if (!item || item.unavailable) return;
    const next = addId(ids, id, memory.current, max === undefined ? undefined : max - lockedItems.length);
    if (next.length === ids.length) return;
    onChange(toSelection(next));
    setSay(`${labelOf(id)} added at position ${next.indexOf(id) + 1} of ${next.length}`);
    focusNext.current = { kind: 'grip', id };
  };
  const resize = (id: string, size: string) => {
    sizeMemory.current.set(id, size);
    onChange(toSelection(ids, { id, size }));
    setSay(`${labelOf(id)} is now ${sizeLabel(size).toLowerCase()} ${sizeNoun.toLowerCase()}`);
  };

  const valueOf = (item: LibraryItem) =>
    item.calibrating ? (
      <span className={`${K}__value`} data-calibrating="true">
        <Icon icon={Hourglass} size={12} />
        Calibrating
      </span>
    ) : quiet || !item.valueText ? null : (
      <span className={`${K}__value`}>{item.valueText}</span>
    );

  const iconOf = (item: LibraryItem, dot: boolean) =>
    monitor ? (
      item.icon ? (
        <Icon icon={item.icon} size={20} className={`${K}__icon`} />
      ) : (
        <span className={`${K}__icon`} />
      )
    ) : (
      <span className={`${K}__icon`} aria-hidden="true">
        {item.icon ? <Icon icon={item.icon} size={20} /> : null}
        {dot ? <i className={`${K}__dot`} /> : null}
      </span>
    );

  const extras = (item: LibraryItem, kind: 'shown' | 'add') => (
    <>
      {!monitor && item.description ? <span className={`${K}__desc`}>{item.description}</span> : null}
      {valueOf(item)}
      {item.unavailable ? (
        <MonoMeta className={`${K}__reason`} size="sm">
          {item.unavailable}
        </MonoMeta>
      ) : null}
      {kind === 'add' && item.preview ? (
        <span className={`${K}__preview`} aria-hidden="true">
          {item.preview}
        </span>
      ) : null}
    </>
  );

  /** A section heading: today's plain h3 text for the monitor wrapper, mono caps for the library. */
  const heading = (text: string): ReactNode => (monitor ? text : <MonoMeta tone="ink">{text}</MonoMeta>);

  const addable = items.filter((i) => !i.locked && !ids.includes(i.id));
  const searchable = !monitor && addable.length > SEARCH_ABOVE;
  const visible = searchable ? filterItems(addable, query) : addable;
  const groups = groupItems(visible);
  const showGroups = !monitor && groups.length > 1;

  const addRow = (item: LibraryItem) => {
    const reason = item.unavailable ? item.unavailable : full ? fullText : undefined;
    const key = (
      <IconKey
        ref={(el: HTMLButtonElement | null) => {
          adds.current.set(item.id, el);
        }}
        icon={CirclePlus}
        label={`Add ${item.label}`}
        className={`${K}__key`}
        tooltip={false}
        disabledReason={reason}
        onClick={() => add(item.id)}
      />
    );
    return (
      <li key={item.id} className={`${K}__row`} data-add="true" data-hue={hueOf(item)} data-unavailable={item.unavailable ? 'true' : undefined}>
        <span className={`${K}__grip`} aria-hidden="true" />
        {iconOf(item, true)}
        <span className={`${K}__text`}>
          <span className={`${K}__label`}>{item.label}</span>
          {extras(item, 'add')}
        </span>
        {monitor ? (
          key
        ) : (
          <span className={`${K}__trail`}>
            {renderRowAction?.(item)}
            {key}
          </span>
        )}
      </li>
    );
  };

  const resetKey = (
    <Key size="sm" variant="text" onClick={onReset} disabledReason={isDefault ? copy.resetDisabled : undefined}>
      {copy.reset}
    </Key>
  );

  const body = (
    <div className={cx(monitor && 'lmv', K)}>
      {monitor ? (
        /* (r068 O11) the count says what it counts */
        <p className={`${K}__cap`}>
          {copy.showing} <span className={`${K}__capnum`}>{capText}</span>
        </p>
      ) : null}
      {organize ? <p id={hintId} className="lm-sr">
        Press Space to pick up, the arrow keys to move, Space to drop, Escape to cancel.
      </p> : null}
      {monitor ? null : <h3 className={`${K}__head`}>{heading(copy.shown)}</h3>}
      {!monitor && sizeHelp ? <p id={`${hintId}-size`} className={`${K}__note`}>{sizeHelp}</p> : null}
      <ul ref={listRef} className={`${K}__list`} aria-label={`Shown, ${capText}`}>
        {lockedItems.map((item) => (
          <li key={item.id} className={`${K}__row`} data-locked="true" data-flip={item.id} data-hue={hueOf(item)}>
            <span className={`${K}__lock`} aria-hidden="true">
              <Icon icon={Lock} size={20} />
            </span>
            {iconOf(item, true)}
            <span className={`${K}__text`}>
              <span className={`${K}__label`}>{item.label}</span>
              {item.description ? <span className={`${K}__desc`}>{item.description}</span> : null}
              <MonoMeta className={`${K}__reason`} size="sm">
                {copy.locked}
              </MonoMeta>
            </span>
            <span className={`${K}__trail`} />
          </li>
        ))}
        {shown.map((item) => {
          const size = sizeOf(item, chosenSize.get(item.id));
          const key = (
            <IconKey icon={CircleMinus} label={`Remove ${item.label}`} className={`${K}__key`} tooltip={false} onClick={() => remove(item.id)} />
          );
          return (
            <li
              key={item.id}
              ref={(el) => {
                rows.current.set(item.id, el);
              }}
              className={`${K}__row`}
              aria-roledescription={organize ? 'sortable item' : undefined}
              data-grabbed={grab?.id === item.id || undefined}
              data-flip={item.id}
              data-hue={hueOf(item)}
              data-unavailable={item.unavailable ? 'true' : undefined}
            >
              {organize ? <button
                type="button"
                ref={(el) => {
                  grips.current.set(item.id, el);
                }}
                className={`${K}__grip`}
                aria-label={`Move ${item.label}, position ${order.indexOf(item.id) + 1} of ${order.length}`}
                aria-describedby={hintId}
                aria-pressed={grab?.id === item.id}
                onKeyDown={(e) => onGripKey(e, item.id)}
                onBlur={() => {
                  if (grab && !grab.pointer && grab.id === item.id && !focusNext.current) {
                    commit(grab.draft);
                    setGrab(null);
                  }
                }}
                onPointerDown={(e) => onPointerDown(e, item.id)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
              >
                <Icon icon={GripVertical} size={20} />
              </button> : <span className={`${K}__grip`} aria-hidden="true" />}
              {iconOf(item, true)}
              <span className={`${K}__text`}>
                <span className={`${K}__label`}>{item.label}</span>
                {extras(item, 'shown')}
                {organize && size !== undefined && item.sizes ? (
                  <KeyBank
                    size="sm"
                    fit
                    className={`${K}__sizes`}
                    label={`${sizeNoun} of ${item.label}`}
                    describedBy={sizeHelp ? `${hintId}-size` : undefined}
                    value={size}
                    onChange={(v) => resize(item.id, v)}
                    options={item.sizes.map((s) => ({ value: s, label: sizeLabel(s) }))}
                  />
                ) : null}
              </span>
              {monitor ? (
                key
              ) : (
                <span className={`${K}__trail`}>
                  {renderRowAction?.(item)}
                  {key}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {ids.length === 0 && lockedItems.length === 0 ? <p className={monitor ? 'lmv-note' : `${K}__note`}>{copy.empty}</p> : null}
      {addable.length ? (
        <section ref={addRef} className={`${K}__add`} aria-labelledby={`${hintId}-add`}>
          <h3 id={`${hintId}-add`} className={`${K}__head`}>
            {heading(copy.add)}
          </h3>
          {searchable ? (
            <div className={`${K}__search`}>
              <Icon icon={Search} size={16} className={`${K}__searchicon`} />
              <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label={copy.search} placeholder={copy.search} autoComplete="off" className={`${K}__searchfield`} />
            </div>
          ) : null}
          {visible.length === 0 ? <p className={`${K}__note`}>{copy.noMatch}</p> : null}
          {showGroups ? (
            groups.map((g, gi) => {
              const gid = `${hintId}-g${gi}`;
              return (
                <div key={g.group} className={`${K}__group`} data-hue={g.items[0]?.hue}>
                  <p id={gid} className={`${K}__groupname`}>
                    <i className={`${K}__dot`} aria-hidden="true" />
                    <MonoMeta size="sm">{g.group}</MonoMeta>
                  </p>
                  <ul className={`${K}__list`} aria-labelledby={gid}>
                    {g.items.map(addRow)}
                  </ul>
                </div>
              );
            })
          ) : visible.length ? (
            <ul className={`${K}__list`}>{visible.map(addRow)}</ul>
          ) : null}
        </section>
      ) : null}
      {monitor ? <div className={`${K}__foot`}>{resetKey}</div> : null}
      <span className="lm-sr" aria-live="polite">
        {say}
      </span>
    </div>
  );

  const foot = monitor ? undefined : (
    <div className="lm-lib__foot">
      <MonoMeta as="p" className="lm-lib__cap">
        {copy.showing} <span className="lm-lib__capnum">{capText}</span>
      </MonoMeta>
      {resetKey}
    </div>
  );

  return (
    <ResponsivePanel
      open={open}
      onClose={() => onOpenChange(false)}
      title={title}
      className={cx(monitor ? 'lmv-mon-panel' : 'lm-lib-panel', className)}
      footer={foot}
      detents={monitor ? undefined : ['half', 'full']}
      defaultDetent={monitor ? undefined : 'half'}
      dockAtXl={dockAtXl}
    >
      {body}
    </ResponsivePanel>
  );
}
