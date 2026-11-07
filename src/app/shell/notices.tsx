import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { create } from 'zustand';
import { Notice, type Severity } from '@/components/Notice';
import { useAgentActive } from '@/agents/activity';

/** "An agent is using Vitals" + Stop (SUITE_SPEC §7.3): its own chunk (it loads the command registry). */
const AgentActivityIndicator = lazy(() => import('@/features/settings/agents/AgentActivityIndicator').then((m) => ({ default: m.AgentActivityIndicator })));

/**
 * An app-level state that needs the person's attention (SPEC §4 "Notices"): storage blocked, an update ready, a sync or
 * safety problem. Never a plan event (those are the header's status capsule), never feedback on the person's own action
 * (a toast), never a page's explanation.
 */
export interface GlobalNoticeSpec {
  id: string;
  severity: Severity;
  /** One line: the state ("Update available"). */
  title: ReactNode;
  /** Optional second line, only when it says how to fix it. */
  body?: ReactNode;
  /** At most one key (`<Key size="sm">Reload</Key>`). */
  actions?: ReactNode;
  /** Info/ok notices can be dismissed by the user. */
  dismissible?: boolean;
  collapsible?: boolean;
  /** Tie-break within a severity: lower shows first (default 10). */
  priority?: number;
  /** Defaults true; a transfer can announce phase text separately from frequently changing progress. */
  announce?: boolean;
}

interface NoticeState {
  /** Every live notice, most important first; the banner shows only the first. */
  notices: GlobalNoticeSpec[];
  show: (n: GlobalNoticeSpec) => void;
  dismiss: (id: string) => void;
}

const ORDER: Record<Severity, number> = { danger: 0, caution: 1, info: 2, ok: 3 };
const rank = (n: GlobalNoticeSpec) => ORDER[n.severity] * 1000 + (n.priority ?? 10);
export const ANDROID_UPDATE_NOTICE_ID = 'android-update';

export const useNoticeStore = create<NoticeState>()((set) => ({
  notices: [],
  show: (n) => set((s) => ({ notices: [...s.notices.filter((x) => x.id !== n.id), n].sort((a, b) => rank(a) - rank(b)) })),
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((x) => x.id !== id) })),
}));

/** Raise an app-wide notice (e.g. "This browser isn't saving data"). Only the most important one is on screen at a time. */
export const showNotice = (n: GlobalNoticeSpec): void => useNoticeStore.getState().show(n);
export const dismissNotice = (id: string): void => useNoticeStore.getState().dismiss(id);

/**
 * Declarative form: the notice is live while this component is mounted.
 *   {blocked && <GlobalNotice id="sync-blocked" severity="caution" title="Sync blocked" />}
 */
export function GlobalNotice(props: GlobalNoticeSpec) {
  const { id, severity, title, body, actions, dismissible, collapsible, priority, announce } = props;
  useEffect(() => {
    showNotice({ id, severity, title, body, actions, dismissible, collapsible, priority, announce });
  }, [id, severity, title, body, actions, dismissible, collapsible, priority, announce]);
  useEffect(() => () => dismissNotice(id), [id]);
  return null;
}

/**
 * The one banner slot, directly under the header (SPEC §4): at most one banner — danger first, then a waiting Android
 * update alongside any active agent Stop key, then an agent at work, then the most important of the rest.
 */
export function NoticesRegion() {
  const top = useNoticeStore((s) => s.notices[0]);
  const agent = useAgentActive();
  const showAgent = agent && (!top || top.severity !== 'danger');
  const pinnedUpdate = top?.id === ANDROID_UPDATE_NOTICE_ID;
  const agentUpdate = pinnedUpdate && top ? { title: top.title, body: top.body, actions: top.actions } : undefined;
  const regionRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!pinnedUpdate || !regionRef.current) return;
    const region = regionRef.current;
    const root = document.documentElement;
    const measure = () => {
      const height = `${Math.ceil(region.getBoundingClientRect().height)}px`;
      if (root.style.getPropertyValue('--lm-update-notice-h') !== height) root.style.setProperty('--lm-update-notice-h', height);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return () => root.style.removeProperty('--lm-update-notice-h');
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--lm-update-notice-h');
    };
  }, [pinnedUpdate]);
  if (!top && !agent) return null;
  return (
    <div ref={regionRef} className="lm-notices" data-android-update={pinnedUpdate || undefined} aria-label="Notices" role="region">
      {showAgent ? (
        <Suspense fallback={null}>
          <AgentActivityIndicator className="lm-banner lm-banner--agent" update={agentUpdate} />
        </Suspense>
      ) : top ? (
        <Notice
          key={top.id}
          className="lm-banner"
          severity={top.severity}
          title={top.title}
          actions={top.actions}
          collapsible={top.collapsible}
          onDismiss={top.dismissible ? () => dismissNotice(top.id) : undefined}
          announce={top.announce ?? true}
        >
          {top.body}
        </Notice>
      ) : null}
    </div>
  );
}
