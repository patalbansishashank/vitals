/** Small shared pieces of the Ring screens: values with units, status words, the empty states, unit preferences. */
import { useMemo, type ReactNode } from 'react';
import { Chip, EmptyStage, KeyLink, Skeleton, cx, type StateTone } from '@/components';
import { paths } from '@/app/paths';
import { useServerPairing } from '@/features/settings/server/hooks';
import { useSettingsStore } from '@/state/settingsStore';
import { gauge } from '../api';
import { RING_COPY as C } from '../copy';
import { useAvailability } from '../data';
import { hasGaugeData } from '../model';
import type { Status, UnitPrefs } from '../model';
import type { GaugeQuery } from '../useGauge';
import { wordsOnly } from '../quiet';

/** A value with its unit inline, smaller and in stone ("62 bpm"). */
export function Val({
  value,
  unit,
  className,
}: {
  value: ReactNode;
  unit?: string | null;
  className?: string;
}) {
  return (
    <span className={cx('lm-num rg-val', className)}>
      {value}
      {unit ? <span className="lm-unit">{unit}</span> : null}
    </span>
  );
}

/**
 * A reading's status as a card foot's state word (`CardFoot state`): the word and a tone (caution and danger keep their
 * mark; ok and info are neutral). In quiet mode only a word that carries no figure survives, else null. Pure.
 */
export function footState(
  status: Status | null | undefined,
  quiet = false,
): { word: string; tone?: StateTone } | undefined {
  if (!status) return undefined;
  const word = quiet ? wordsOnly(status.word) : status.word;
  if (!word) return undefined;
  const tone: StateTone =
    status.severity === 'danger' ? 'danger' : status.severity === 'caution' ? 'caution' : 'neutral';
  return { word, tone };
}

/** A status word as a status chip (a dot in the severity colour and the word: never colour alone). */
export function StatusWord({ status }: { status: Status | null }) {
  if (!status) return null;
  return (
    <Chip kind="status" severity={status.severity} className="rg-status">
      {status.word}
    </Chip>
  );
}

export function useUnitPrefs(): UnitPrefs {
  const units = useSettingsStore((s) => s.units);
  return useMemo(() => ({ units }), [units]);
}

/**
 * What a Ring screen shows instead of its cards: loading (skeleton lines), not connected to a server (one action:
 * Settings › Sync), or connected but Gauge has sent nothing.
 */
export function GaugeUnavailable({
  titleAs = 'h2',
  reachable = false,
}: {
  titleAs?: 'h2' | 'h3';
  /** The server answered (with no Gauge data). */ reachable?: boolean;
}) {
  const paired = useServerPairing() !== null || reachable;
  const problem = gauge().status().problem;
  if (paired && problem && problem !== 'not_paired' && C.problem[problem]) {
    const p = C.problem[problem];
    return (
      <EmptyStage
        title={p.title}
        titleAs={titleAs}
        className="rg-empty"
        action={
          problem === 'unauthorized' ? (
            <KeyLink to={paths.settings('sync')} variant="action" size="sm">
              {C.notPaired.action}
            </KeyLink>
          ) : undefined
        }
      >
        {p.body}
      </EmptyStage>
    );
  }
  return paired ? (
    <EmptyStage title={C.noGauge.title} titleAs={titleAs} className="rg-empty">
      {C.noGauge.body}
    </EmptyStage>
  ) : (
    <EmptyStage
      title={C.notPaired.title}
      titleAs={titleAs}
      className="rg-empty"
      action={
        <KeyLink to={paths.settings('sync')} variant="action" size="sm">
          {C.notPaired.action}
        </KeyLink>
      }
    >
      {C.notPaired.body}
    </EmptyStage>
  );
}

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rg-loading" aria-busy="true" aria-label={C.loading}>
      <Skeleton lines={lines} />
    </div>
  );
}

/** Render a query: loading lines, nothing (unavailable: the page shows the one empty state), or the content. */
export function WhenReady<T>({
  q,
  children,
  lines,
}: {
  q: GaugeQuery<T>;
  children: (data: T) => ReactNode;
  lines?: number;
}) {
  if (q.status === 'loading') return <Loading lines={lines} />;
  if (q.status === 'unavailable') return null;
  return <>{children(q.data)}</>;
}

/**
 * A label · value grid inside a card (no nested cards). (r068) `sub` is the fact line under a value ("at 17:46",
 * "10 min ago", "28 nights"): plain words, never a tag.
 */
export function Facts({
  items,
  className,
}: {
  items: ReadonlyArray<{ label: ReactNode; value: ReactNode; id?: string; sub?: ReactNode }>;
  className?: string;
}) {
  return (
    <dl className={cx('rg-facts', className)}>
      {items.map((it, i) => (
        <div key={it.id ?? i} className="rg-facts__item">
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
          {it.sub ? <dd className="rg-facts__sub">{it.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** The availability gate every Ring page shares (and `/sleep`): loading, the one empty state, or the page. */
export function RingGate({ children }: { children: ReactNode }) {
  const a = useAvailability();
  if (a.status === 'loading') return <Loading lines={4} />;
  if (a.status === 'unavailable') return <GaugeUnavailable />;
  if (!hasGaugeData(a.data)) return <GaugeUnavailable reachable />;
  return <>{children}</>;
}
