/**
 * "Chats on your server" (the Coach page's ⋯ while the Coach runs on the paired server): the temporary chats the server
 * still keeps, each with when it is deleted, Open and Delete. Read when the panel opens; nothing is kept here.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { InlineWarning, Key, ResponsivePanel } from '@/components';
import type { ServerChat, ServerCoachControls } from '../adapter';
import { COACH_COPY } from '../copy';

const S = COACH_COPY.server;
type Session = { active: boolean; controls: ServerCoachControls };
type PanelState = { session: Session; rows: ServerChat[] | null; error: string | null; busy: string | null };

/** "14:30" today, "Thu 14:30" on another day. */
export function whenText(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

export function ServerChatsPanel({ open, onClose, controls, now, onOpened }: { open: boolean; onClose: () => void; controls: ServerCoachControls; now: Date; onOpened: () => void }) {
  const [state, setState] = useState<PanelState | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const busyRef = useRef(false);
  const onOpenedRef = useRef(onOpened);

  useLayoutEffect(() => {
    onOpenedRef.current = onOpened;
  }, [onOpened]);

  useLayoutEffect(() => {
    sessionRef.current = null;
    busyRef.current = false;
    if (!open) return;
    const session = { active: true, controls };
    sessionRef.current = session;
    const isCurrent = () => session.active && sessionRef.current === session;
    void Promise.resolve().then(() => controls.list()).then(
      (list) => {
        if (!isCurrent()) return;
        setState({ session, rows: list, error: null, busy: null });
      },
      () => {
        if (isCurrent()) setState({ session, rows: null, error: S.listFailed, busy: null });
      },
    );
    return () => {
      session.active = false;
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [open, controls]);

  const visible = open && state?.session.active && state.session.controls === controls ? state : null;
  const rows = visible?.rows ?? null;
  const error = visible?.error ?? null;
  const busy = visible?.busy ?? null;
  const current = controls.current()?.id;
  const act = async (id: string, what: 'open' | 'delete') => {
    const session = sessionRef.current;
    if (!open || !session?.active || session.controls !== controls || busyRef.current) return;
    const isCurrent = () => session.active && sessionRef.current === session;
    busyRef.current = true;
    setState((old) => ({ session, rows: old?.session === session ? old.rows : null, error: null, busy: id }));
    try {
      const r = what === 'open' ? await session.controls.open(id) : await session.controls.remove(id);
      if (!isCurrent()) return;
      if (!r.ok) {
        setState((old) => old?.session === session ? { ...old, error: r.message ?? S.listFailed } : old);
      } else if (what === 'open') {
        onOpenedRef.current();
      } else {
        setState((old) => old?.session === session ? { ...old, rows: old.rows?.filter((x) => x.id !== id) ?? null } : old);
      }
    } catch {
      if (isCurrent()) setState((old) => old?.session === session ? { ...old, error: S.listFailed } : old);
    } finally {
      if (isCurrent()) {
        busyRef.current = false;
        setState((old) => old?.session === session ? { ...old, busy: null } : old);
      }
    }
  };

  return (
    <ResponsivePanel open={open} onClose={onClose} title={S.chats}>
      {error ? <InlineWarning severity="caution">{error}</InlineWarning> : null}
      {rows && rows.length === 0 ? <p className="lv-coach-fact">{S.none}</p> : null}
      {rows?.length ? (
        <ul className="lv-coach-chats">
          {rows.map((c) => {
            const title = c.title || S.untitled;
            const isOpen = c.id === current;
            return (
              <li key={c.id} className="lv-coach-chats__row">
                <span className="lv-coach-chats__title">{title}</span>
                <span className="lv-coach-note">{[c.createdAt ? S.started(whenText(c.createdAt, now)) : '', c.expiresAt ? S.until(whenText(c.expiresAt, now)) : ''].filter(Boolean).join(' · ')}</span>
                <span className="lv-coach-keys">
                  {isOpen ? (
                    <span className="lv-coach-note">{S.current}</span>
                  ) : (
                    <Key size="sm" variant="action" aria-label={S.openName(title)} loading={busy === c.id} disabled={busy !== null} onClick={() => void act(c.id, 'open')}>
                      {S.open}
                    </Key>
                  )}
                  <Key size="sm" variant="quiet" icon={Trash2} aria-label={S.deleteName(title)} loading={busy === c.id} disabled={busy !== null} onClick={() => void act(c.id, 'delete')}>
                    {S.delete}
                  </Key>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </ResponsivePanel>
  );
}
