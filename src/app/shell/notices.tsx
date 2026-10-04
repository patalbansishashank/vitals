import { useEffect, type ReactNode } from 'react';
import { create } from 'zustand';
import { Notice, type Severity } from '@/components/Notice';

export interface GlobalNoticeSpec {
  id: string;
  severity: Severity;
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  /** Info/ok notices can be dismissed by the user. */
  dismissible?: boolean;
  collapsible?: boolean;
}

interface NoticeState {
  notices: GlobalNoticeSpec[];
  show: (n: GlobalNoticeSpec) => void;
  dismiss: (id: string) => void;
}

const ORDER: Record<Severity, number> = { danger: 0, caution: 1, info: 2, ok: 3 };

export const useNoticeStore = create<NoticeState>()((set) => ({
  notices: [],
  show: (n) => set((s) => ({ notices: [...s.notices.filter((x) => x.id !== n.id), n].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]) })),
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((x) => x.id !== id) })),
}));

/** Show an app-wide notice under the context bar (e.g. "This browser isn't saving data"). */
export const showNotice = (n: GlobalNoticeSpec): void => useNoticeStore.getState().show(n);
export const dismissNotice = (id: string): void => useNoticeStore.getState().dismiss(id);

/**
 * Declarative form: the notice shows while this component is mounted.
 *   {stale && <GlobalNotice id="stale" severity="info" title="Schedule changed since this run" />}
 */
export function GlobalNotice(props: GlobalNoticeSpec) {
  const { id, severity, title, body, actions, dismissible, collapsible } = props;
  useEffect(() => {
    showNotice({ id, severity, title, body, actions, dismissible, collapsible });
  }, [id, severity, title, body, actions, dismissible, collapsible]);
  useEffect(() => () => dismissNotice(id), [id]);
  return null;
}

/** The region the shell renders under the context bar. */
export function NoticesRegion() {
  const notices = useNoticeStore((s) => s.notices);
  if (notices.length === 0) return null;
  return (
    <div className="lm-notices" aria-label="Notices" role="region">
      {notices.map((n) => (
        <Notice
          key={n.id}
          severity={n.severity}
          title={n.title}
          actions={n.actions}
          collapsible={n.collapsible}
          onDismiss={n.dismissible ? () => dismissNotice(n.id) : undefined}
          announce
        >
          {n.body}
        </Notice>
      ))}
    </div>
  );
}
