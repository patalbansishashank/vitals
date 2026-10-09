import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Key } from './Key';

export interface ToastOptions {
  /** Single optional action, e.g. { label: 'Undo', onClick }. */
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss after ms (default 5000). Paused while hovered or focused. */
  duration?: number;
  /** Replace an existing toast with the same id instead of stacking. */
  id?: string;
}

interface ToastItem {
  id: string;
  message: ReactNode;
  action?: ToastOptions['action'];
  duration: number;
}

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let seq = 0;
const emit = () => listeners.forEach((l) => l());

/**
 * Confirm a background completion or an undoable action
 * ("Week 3 copied to weeks 4–6 · Undo"). Never for errors that need action —
 * those are Notices. Returns the toast id.
 */
export function toast(message: ReactNode, options: ToastOptions = {}): string {
  const id = options.id ?? `t${++seq}`;
  const item: ToastItem = { id, message, action: options.action, duration: options.duration ?? 5000 };
  items = [...items.filter((t) => t.id !== id), item].slice(-3);
  emit();
  return id;
}

export function dismissToast(id: string): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** A new screen opens: confirmations from the last one go (the app shell calls this on every route change). */
export function dismissAllToasts(): void {
  if (!items.length) return;
  items = [];
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const snapshot = () => items;

/** Mount once (the app shell does). Bottom-centre above the tab bar on mobile, bottom-left on desktop. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <div className="lm-toaster" role="region" aria-label="Notifications">
      <div role="status" aria-live="polite" aria-atomic="false" style={{ display: 'contents' }}>
        {list.map((t) => (
          <ToastView key={t.id} item={t} />
        ))}
      </div>
    </div>
  );
}

function ToastView({ item }: { item: ToastItem }) {
  const remaining = useRef(item.duration);
  const started = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const start = () => {
    started.current = performance.now();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => dismissToast(item.id), remaining.current);
  };
  const pause = () => {
    window.clearTimeout(timer.current);
    remaining.current = Math.max(800, remaining.current - (performance.now() - started.current));
  };

  useEffect(() => {
    start();
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="lm-toast" onPointerEnter={pause} onPointerLeave={start} onFocus={pause} onBlur={start}>
      <span className="lm-toast__msg">{item.message}</span>
      {item.action ? (
        <Key
          variant="quiet"
          size="sm"
          onClick={() => {
            item.action?.onClick();
            dismissToast(item.id);
          }}
        >
          {item.action.label}
        </Key>
      ) : null}
    </div>
  );
}
