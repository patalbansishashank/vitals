import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { Portal } from './lib/portal';
import { useAnchoredPosition, type Placement } from './lib/position';

let lastClosedAt = 0;
// One tooltip opens at a time, so a single module-level pending timer is enough.
let pendingTimer: number | undefined;
function clearPending() {
  window.clearTimeout(pendingTimer);
  pendingTimer = undefined;
}
const OPEN_DELAY = 400;
const WARM_WINDOW = 1000;
/** A touch held this long shows the tip (long-press); the tip then stays this long after the finger lifts. */
const LONG_PRESS = 500;
const PRESS_HOLD = 1800;
/** A finger that moves further than this is scrolling, not pressing. */
const PRESS_SLOP = 10;
/**
 * Long-press and press-opened tips: one finger and one tip at a time, so (as with the hover timer) module-level state is
 * enough — the hold timer, where the finger went down, whether the hold showed the tip (its release is then not a
 * press), the timer that hides a tip a press opened, and which tooltip owns them.
 */
const press = { timer: undefined as number | undefined, x: 0, y: 0, fired: false, hideTimer: undefined as number | undefined, owner: '' };
function cancelPress() {
  window.clearTimeout(press.timer);
  press.timer = undefined;
}

type AnyProps = Record<string, unknown> & {
  ref?: Ref<HTMLElement>;
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove?: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel?: (e: PointerEvent<HTMLElement>) => void;
  onClickCapture?: (e: MouseEvent<HTMLElement>) => void;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  'aria-describedby'?: string;
};

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as { current: T | null }).current = value;
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

export interface TooltipProps {
  /** Short supplementary text. Never essential information (COMPONENTS §9). */
  content: ReactNode;
  /** One focusable element (Key, IconKey, GradeBadge button…). */
  children: ReactElement;
  placement?: Placement;
  /**
   * `description` (default) links the tip via aria-describedby. `label` is for
   * icon keys whose aria-label already says the same text — no duplicate announcement.
   */
  role?: 'description' | 'label';
  disabled?: boolean;
  /**
   * Touch: holding the element for 500 ms shows the tip (the press then does not activate the element), and it stays
   * 1.8 s after the finger lifts. For icon-only controls whose name is only in the tip (the header's status icons).
   */
  longPress?: boolean;
  /** A press (click, tap, Enter) toggles the tip: for an icon whose only job is to say what it means. */
  showOnPress?: boolean;
}

/**
 * Tooltip: elevated surface, 0.5 px hairline, 12/18 ink text. Opens after 400 ms
 * (instantly within 1 s of another tooltip), on hover for fine pointers and on
 * keyboard focus; with `longPress`, also on a held touch. Esc hides it.
 */
export function Tooltip({ content, children, placement = 'top', role = 'description', disabled = false, longPress = false, showOnPress = false }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const anchorRef = useMemo(() => ({ current: anchorEl }), [anchorEl]);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const childRef = isValidElement(children) ? (children.props as AnyProps).ref : undefined;
  const mergedRef = useCallback(
    (node: HTMLElement | null) => {
      setAnchorEl(node);
      setRef(childRef, node);
    },
    [childRef],
  );
  const style = useAnchoredPosition(anchorRef, tipRef, open, placement, 6);

  const show = useCallback(() => {
    if (disabled) return;
    clearPending();
    const warm = performance.now() - lastClosedAt < WARM_WINDOW;
    if (warm) setOpen(true);
    else pendingTimer = window.setTimeout(() => setOpen(true), OPEN_DELAY);
  }, [disabled]);

  const hide = useCallback(() => {
    clearPending();
    if (press.owner === id) {
      window.clearTimeout(press.hideTimer);
      press.hideTimer = undefined;
    }
    if (open) lastClosedAt = performance.now();
    setOpen(false);
  }, [open, id]);

  /** Show now, for a press (long-press or `showOnPress`), and hide on its own after a while. */
  const showFromPress = useCallback(() => {
    if (disabled) return;
    clearPending();
    window.clearTimeout(press.hideTimer);
    press.owner = id;
    setOpen(true);
    press.hideTimer = window.setTimeout(() => {
      press.hideTimer = undefined;
      lastClosedAt = performance.now();
      setOpen(false);
    }, PRESS_HOLD);
  }, [disabled, id]);
  /** This tip is open from a press (its own timer closes it). */
  const pressOpen = useCallback(() => open && press.owner === id && press.hideTimer !== undefined, [open, id]);

  // long-press (touch): a hold shows the tip; moving (a scroll), lifting or cancelling before then is an ordinary touch
  const pressDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      press.fired = false;
      if (e.pointerType !== 'touch' || disabled) return;
      cancelPress();
      press.owner = id;
      press.x = e.clientX;
      press.y = e.clientY;
      press.timer = window.setTimeout(() => {
        press.timer = undefined;
        press.fired = true;
        showFromPress();
      }, LONG_PRESS);
    },
    [disabled, id, showFromPress],
  );
  const pressMove = useCallback((e: PointerEvent<HTMLElement>) => {
    if (press.timer !== undefined && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP) cancelPress();
  }, []);
  /** The hold showed the tip, so this release is not a press: true when the click was swallowed. */
  const swallowClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (!press.fired || press.owner !== id) return false;
      press.fired = false;
      e.preventDefault();
      e.stopPropagation();
      return true;
    },
    [id],
  );
  /** No callout or context menu over a held key. */
  const pressMenu = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (press.owner === id && (press.timer !== undefined || press.fired)) e.preventDefault();
    },
    [id],
  );
  const pressLeave = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      cancelPress();
      // a lifted finger "leaves" too: a tip a press opened stays until its own timer
      if (e.pointerType === 'touch' && pressOpen()) return;
      hide();
    },
    [pressOpen, hide],
  );
  /** `showOnPress`: a second press closes a tip a press opened; a tip hover opened just stays. */
  const togglePress = useCallback(() => (pressOpen() ? hide() : showFromPress()), [pressOpen, hide, showFromPress]);

  useEffect(
    () => () => {
      clearPending();
      if (press.owner !== id) return;
      cancelPress();
      window.clearTimeout(press.hideTimer);
      press.hideTimer = undefined;
    },
    [id],
  );

  if (!isValidElement(children)) return children;
  const child = children as ReactElement<AnyProps>;
  const p = child.props;

  const cloned = cloneElement(child, {
    ref: mergedRef,
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      p.onPointerEnter?.(e);
      if (e.pointerType !== 'touch') show();
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      p.onPointerLeave?.(e);
      pressLeave(e);
    },
    ...(longPress
      ? {
          onPointerDown: (e: PointerEvent<HTMLElement>) => {
            p.onPointerDown?.(e);
            pressDown(e);
          },
          onPointerMove: (e: PointerEvent<HTMLElement>) => {
            p.onPointerMove?.(e);
            pressMove(e);
          },
          onPointerUp: (e: PointerEvent<HTMLElement>) => {
            p.onPointerUp?.(e);
            cancelPress();
          },
          onPointerCancel: (e: PointerEvent<HTMLElement>) => {
            p.onPointerCancel?.(e);
            cancelPress();
          },
          onClickCapture: (e: MouseEvent<HTMLElement>) => {
            if (!swallowClick(e)) p.onClickCapture?.(e);
          },
          onContextMenu: (e: MouseEvent<HTMLElement>) => {
            p.onContextMenu?.(e);
            pressMenu(e);
          },
        }
      : null),
    ...(showOnPress
      ? {
          onClick: (e: MouseEvent<HTMLElement>) => {
            p.onClick?.(e);
            togglePress();
          },
        }
      : null),
    onFocus: (e: FocusEvent<HTMLElement>) => {
      p.onFocus?.(e);
      if (isFocusVisible(e.currentTarget)) show();
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      p.onBlur?.(e);
      hide();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      p.onKeyDown?.(e);
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        hide();
      }
    },
    'aria-describedby':
      role === 'description' && !disabled ? [p['aria-describedby'], id].filter(Boolean).join(' ') : p['aria-describedby'],
  });

  return (
    <>
      {cloned}
      {role === 'description' && !open && !disabled ? (
        <span id={id} className="lm-sr">
          {content}
        </span>
      ) : null}
      {open ? (
        <Portal>
          <div ref={tipRef} id={role === 'description' ? id : undefined} role="tooltip" className="lm-tooltip" style={style}>
            {content}
          </div>
        </Portal>
      ) : null}
    </>
  );
}
