import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { CircleCheck } from 'lucide-react';
import { Icon, type IconComponent } from './icons/Icon';
import { Key } from './Key';

export interface ToastOptions {
  /** Single optional action, e.g. { label: 'Undo', onClick }. */
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss after ms (default 5000). Paused while hovered or focused. */
  duration?: number;
  /** Replace an existing toast with the same id instead of stacking. */
  id?: string;
  /** The leading status icon (default: a gold check, "done"); null for none. */
  icon?: IconComponent | null;
}

interface ToastItem {
  id: string;
  message: ReactNode;
  action?: ToastOptions['action'];
  duration: number;
  icon: IconComponent | null;
}

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let seq = 0;
const emit = () => listeners.forEach((l) => l());

/**
 * Snackbar: confirm the person's own action or a background completion
 * ("Meal logged · Undo"). One at a time (a new one replaces the last), at most
 * one action, auto-dismiss. Never for errors that need action — those are
 * Notices. Returns the toast id.
 */
export function toast(message: ReactNode, options: ToastOptions = {}): string {
  const id = options.id ?? `t${++seq}`;
  const item: ToastItem = { id, message, action: options.action, duration: options.duration ?? 5000, icon: options.icon === undefined ? CircleCheck : options.icon };
  items = [item];
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

/**
 * Mount once (the app shell does). Phones: full width in the gutters, 12 px above the dock (reads `--lm-dock-h`, the
 * dock's full height including the safe area; falls back to 80 px + safe area). Desktop: at the bottom right of the
 * content column, 24 px in, as desktop apps place their notifications (r068 S14).
 */
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
      {item.icon ? <Icon icon={item.icon} size={20} className="lm-toast__icon" /> : null}
      <span className="lm-toast__msg">{item.message}</span>
      {item.action ? (
        <Key
          variant="text"
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
