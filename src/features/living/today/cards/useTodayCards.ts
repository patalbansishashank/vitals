import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { toast, useReducedMotion, type LibrarySelection } from '@/components';
import { useSettingsStore } from '@/state/settingsStore';
import { resolveTodayCards, storeTodayCards, type CardDefinition } from './todayCardsModel';

export function useTodayCards(definitions: readonly CardDefinition[], enabled = true) {
  const routeKey = useLocation().key;
  const stored = useSettingsStore((s) => s.todayCards);
  const selected = resolveTodayCards(stored, definitions);
  const [session, setSession] = useState({
    routeKey,
    enabled,
    editing: false,
    library: null as 'shown' | 'add' | null,
  });
  if (session.routeKey !== routeKey || session.enabled !== enabled) {
    setSession({ routeKey, enabled, editing: false, library: null });
  }
  // A date/route change disables the grid in the same render, before gesture cleanup effects run.
  const editing = enabled && session.routeKey === routeKey && session.editing;
  const library = editing ? session.library : null;
  const addedId = useRef<string | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    addedId.current = null;
    return () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
    };
  }, [routeKey, enabled]);
  useEffect(() => {
    if (!editing) return;
    const finish = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      addedId.current = null;
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
      setSession({ routeKey, enabled, editing: false, library: null });
      if (document.activeElement?.closest('.lm-cardgrid')) {
        document.querySelector<HTMLButtonElement>('.lm-ctx__more')?.focus();
      }
    };
    document.addEventListener('keydown', finish);
    return () => document.removeEventListener('keydown', finish);
  }, [editing, routeKey, enabled]);
  const write = (next: string[] | null, message: string) => {
    const before = stored;
    useSettingsStore.getState().set({ todayCards: next });
    toast(message, {
      action: { label: 'Undo', onClick: () => useSettingsStore.getState().set({ todayCards: before }) },
    });
  };
  const change = (next: LibrarySelection[]) => {
    if (!editing) return;
    const added = next.find((s) => !selected.some((x) => x.id === s.id));
    write(
      storeTodayCards(next, definitions),
      added ? 'Card added' : next.length < selected.length ? 'Card removed' : 'Cards updated',
    );
    if (added) addedId.current = added.id;
  };
  const close = () => {
    setSession((current) => ({ ...current, library: null }));
    const id = addedId.current;
    addedId.current = null;
    if (id)
      scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = null;
        document
          .querySelector(`[data-id="${id}"]`)
          ?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
      });
  };
  return {
    selected,
    library,
    editing,
    toggleEditing: () => {
      addedId.current = null;
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
      setSession({ routeKey, enabled, editing: enabled && !editing, library: null });
    },
    resize: (id: string, size: string) => {
      if (!selected.some((choice) => choice.id === id)) return;
      change(selected.map((choice) => choice.id === id ? { ...choice, size } : choice));
    },
    reorderVisible: (visibleIds: string[]) => {
      const visible = new Set(visibleIds);
      const expected = selected.filter((choice) => visible.has(choice.id)).map((choice) => choice.id);
      if (visibleIds.length !== expected.length || visibleIds.some((id) => !expected.includes(id))) return;
      const reordered = [...visibleIds];
      change(selected.map((choice) => {
        if (!visible.has(choice.id)) return choice;
        const nextId = reordered.shift();
        return selected.find((item) => item.id === nextId)!;
      }));
    },
    open: (at: 'shown' | 'add' = 'shown') => {
      if (editing) setSession({ routeKey, enabled, editing: true, library: at });
    },
    close,
    change,
    remove: (id: string) => change(selected.filter((s) => s.id !== id)),
    reset: () => {
      if (editing) write(null, 'Default cards restored');
    },
  };
}
