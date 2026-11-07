import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type MouseEventHandler,
  type Ref,
} from 'react';
import { Link } from 'react-router';
import { Icon, type IconComponent } from './icons/Icon';
import { cx } from './lib/cx';
import { Tooltip } from './Tooltip';

/** The attention dot's colour: `signal` (gold, default) · `danger` (rose: something stopped, e.g. sync). */
export type StatusTone = 'signal' | 'danger';

export interface StatusCapsuleProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'type' | 'className' | 'aria-label' | 'title'> {
  /** A Lucide line icon (`ClipboardCheck`, `Inbox`, `CirclePause`, `UserRound`, `ShieldCheck`…), drawn 22 px in stone. */
  icon: IconComponent;
  /**
   * The full meaning, sentence case, no full stop ("Weekly check-in ready", "2 changes waiting"): the accessible name,
   * the tooltip (hover, keyboard focus, long-press), and the item's words when the header moves it into the ⋯.
   */
  label: string;
  /** The state wants the person (a check-in due, changes waiting): a small gold dot at the icon's top right. */
  attention?: boolean;
  /** The dot breathes (1.1 s): only for real, ongoing activity (a search running, a sync in flight). Shows the dot. */
  pulse?: boolean;
  /** The dot's colour (`danger` for something that stopped). */
  tone?: StatusTone;
  /** Route to open: a router link instead of a button. */
  to?: string;
  /**
   * What its ⋯ item does when the header has moved it there (more than two statuses): by default the same as a press.
   * Give one when the press needs the icon on screen (a popover anchored to it).
   */
  onMenuSelect?: () => void;
  className?: string;
}

/* ---- the header's status slot ------------------------------------------------------------------------------------
   The top bar shows at most two status icons (SPEC §9). Every StatusCapsule inside a slot registers itself (its words,
   whether it wants attention, its element for the order on screen); the slot ranks them — the ones that want attention
   first, then their order in the bar — and tells the ones past the limit to hide. The bar lists those in its ⋯. */

/** One registered status, as the slot sees it. */
export interface StatusSlotEntry {
  id: string;
  label: string;
  attention: boolean;
  el: HTMLElement;
  /** What its ⋯ item does (null: it has no action, so the ⋯ shows its words as a heading). */
  select: (() => void) | null;
}

interface StatusSlotApi {
  set(entry: StatusSlotEntry): void;
  remove(id: string): void;
}

interface StatusSlotValue {
  api: StatusSlotApi;
  /** The ids past the limit: hidden here, listed in the ⋯. */
  overflow: ReadonlySet<string>;
}

const StatusSlotContext = createContext<StatusSlotValue | null>(null);

/** The provider of a header's status slot (`useStatusSlot(...).Provider`). */
export const StatusSlotProvider = StatusSlotContext.Provider;

const same = (a: readonly StatusSlotEntry[], b: readonly StatusSlotEntry[]) =>
  a.length === b.length &&
  a.every((e, i) => {
    const o = b[i];
    return !!o && e.id === o.id && e.label === o.label && e.attention === o.attention && e.el === o.el;
  });

const NO_OVERFLOW: ReadonlySet<string> = new Set();

/**
 * A status slot that shows at most `limit` StatusCapsules: put `value` on a `<StatusSlotProvider>` around them, and list
 * `overflow` (the ranked rest, already hidden) wherever they go instead (the header's ⋯).
 */
export function useStatusSlot(limit: number): { value: StatusSlotValue; overflow: readonly StatusSlotEntry[] } {
  const entries = useRef(new Map<string, StatusSlotEntry>());
  const [ranked, setRanked] = useState<readonly StatusSlotEntry[]>([]);
  const rank = useCallback(() => {
    const list = [...entries.current.values()].filter((e) => e.el.isConnected);
    list.sort((a, b) => Number(b.attention) - Number(a.attention) || (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    setRanked((prev) => (same(prev, list) ? prev : list));
  }, []);
  const api = useMemo<StatusSlotApi>(
    () => ({
      set(entry) {
        entries.current.set(entry.id, entry);
        rank();
      },
      remove(id) {
        if (entries.current.delete(id)) rank();
      },
    }),
    [rank],
  );
  const overflow = useMemo(() => ranked.slice(Math.max(0, limit)), [ranked, limit]);
  const overflowIds = useMemo(() => (overflow.length ? new Set(overflow.map((e) => e.id)) : NO_OVERFLOW), [overflow]);
  const value = useMemo(() => ({ api, overflow: overflowIds }), [api, overflowIds]);
  return { value, overflow };
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as { current: T | null }).current = value;
}

/**
 * Status icon (SPEC §9; the header's status, formerly a text capsule): a 48 px round target holding one 22 px line
 * icon in stone, with a small gold dot at its top right while the state wants attention. It has no visible words: its
 * `label` is the accessible name and the tooltip (hover, keyboard focus, long-press on touch). With `onClick` it is a
 * button (it opens the relevant sheet; pass `aria-haspopup` / `aria-expanded` as needed), with `to` a link; with
 * neither, a press shows the tooltip. In the top bar at most two show: the rest move into the ⋯ (`useStatusSlot`).
 */
export function StatusCapsule({ icon, label, attention = false, pulse = false, tone = 'signal', to, onMenuSelect, className, onClick, ref, ...rest }: StatusCapsuleProps) {
  const slot = useContext(StatusSlotContext);
  const id = useId();
  const [el, setEl] = useState<HTMLElement | null>(null);
  const mergedRef = useCallback(
    (node: HTMLElement | null) => {
      setEl(node);
      setRef(ref as Ref<HTMLElement> | undefined, node);
    },
    [ref],
  );
  // the ⋯ item runs the latest action (a press on the hidden element runs its click handler or follows its link)
  const action = useRef<(() => void) | null>(null);
  const hasAction = !!(onMenuSelect || onClick || to !== undefined);
  useLayoutEffect(() => {
    action.current = onMenuSelect ?? (hasAction ? () => el?.click() : null);
  });
  const api = slot?.api;
  useLayoutEffect(() => {
    if (!api || !el) return;
    api.set({ id, label, attention, el, select: hasAction ? () => action.current?.() : null });
  }, [api, id, label, attention, el, hasAction]);
  useLayoutEffect(() => {
    if (!api) return;
    return () => api.remove(id);
  }, [api, id]);

  const hidden = !!slot?.overflow.has(id);
  const dot = attention || pulse;
  const data = { 'data-attention': attention ? 'true' : undefined, 'data-tone': dot ? tone : undefined } as const;
  const inner = (
    <>
      <Icon icon={icon} size={22} />
      {dot ? <span className="lm-status-icon__dot" data-pulse={pulse ? 'true' : undefined} aria-hidden="true" /> : null}
    </>
  );
  const cls = cx('lm-status-icon', className);
  const node =
    to !== undefined ? (
      <Link
        to={to}
        ref={mergedRef}
        className={cls}
        {...data}
        id={rest.id}
        aria-label={label}
        aria-describedby={rest['aria-describedby']}
        hidden={hidden || undefined}
        onClick={onClick as unknown as MouseEventHandler<HTMLAnchorElement> | undefined}
      >
        {inner}
      </Link>
    ) : (
      <button type="button" ref={mergedRef} className={cls} {...data} aria-label={label} hidden={hidden || undefined} onClick={onClick} {...rest}>
        {inner}
      </button>
    );
  return (
    <Tooltip content={label} role="label" placement="bottom" longPress showOnPress={!hasAction}>
      {node}
    </Tooltip>
  );
}
