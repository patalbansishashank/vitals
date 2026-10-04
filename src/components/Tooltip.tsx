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

type AnyProps = Record<string, unknown> & {
  ref?: Ref<HTMLElement>;
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
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
}

/**
 * Ink tooltip, 12/500 inverse text. Opens after 400 ms (instantly within 1 s of
 * another tooltip), on hover for fine pointers and on keyboard focus. Esc hides it.
 */
export function Tooltip({ content, children, placement = 'top', role = 'description', disabled = false }: TooltipProps) {
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
    if (open) lastClosedAt = performance.now();
    setOpen(false);
  }, [open]);

  useEffect(() => clearPending, []);

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
      hide();
    },
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
