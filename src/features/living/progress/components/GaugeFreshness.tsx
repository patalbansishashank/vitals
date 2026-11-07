import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { MonoMeta } from '@/components';
import type { GaugeRead } from '../data/gauge';

const Context = createContext<{ saved: Record<string, string>; report: (id: string, value: string | null) => void } | null>(null);

/** One page-level cue for the cached ring figures actually visible, including shared overnight baselines. */
export function GaugeFreshnessProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Record<string, string>>({});
  const report = useCallback((id: string, value: string | null) => {
    setSaved((previous) => {
      if (value === null && !(id in previous) || previous[id] === value) return previous;
      const next = { ...previous };
      if (value === null) delete next[id]; else next[id] = value;
      return next;
    });
  }, []);
  return <Context.Provider value={{ saved, report }}>{children}</Context.Provider>;
}

export function useReportGaugeFreshness(visible: boolean, ...queries: GaugeRead<unknown>[]): void {
  const context = useContext(Context);
  const report = context?.report;
  const id = useId();
  const saved = visible ? queries.filter((q) => q.status === 'ready' && q.cached) : [];
  const dates = saved.map((q) => q.status === 'ready' ? q.savedAt : null);
  const at = dates.length && dates.every((date): date is number => typeof date === 'number' && Number.isFinite(date)) ? Math.min(...dates) : null;
  const value = saved.length ? String(at ?? '') : null;
  useEffect(() => {
    report?.(id, value);
    return () => report?.(id, null);
  }, [report, id, value]);
}

export function GaugeFreshnessNotice() {
  const context = useContext(Context);
  const entries = Object.values(context?.saved ?? {});
  if (!entries.length) return null;
  const at = entries.every(Boolean) ? Math.min(...entries.map(Number)) : null;
  return <MonoMeta as="p" className="lv-prog__saved" role="status">
    Saved ring data{at === null ? null : <> · Last checked <time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</time></>}
  </MonoMeta>;
}
