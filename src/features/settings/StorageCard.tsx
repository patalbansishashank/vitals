import { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import {
  CardFoot,
  ChartTwin,
  HeroNumber,
  MonoMeta,
  StackBar,
  formatBytes,
  stackTwin,
  type ShareBarRow,
} from '@/components';
import { dispatch } from '@/commands';
import { getDocumentStore } from '@/state/runtime';
import { SettingsCard } from './SettingRow';
import { STORAGE_LABEL } from './copy';

export interface StorageUsage {
  engine: string;
  collections: Record<string, { docs: number; bytes: number }>;
  bootCacheBytes: number;
  totalBytes: number;
}

const TONES = [
  'var(--lm-signal)',
  'var(--lm-ink)',
  'var(--lm-ink-2)',
  'var(--lm-ink-3)',
  'color-mix(in oklab, var(--lm-ink) 65%, var(--lm-face))',
  'color-mix(in oklab, var(--lm-ink) 45%, var(--lm-face))',
];

/** The five largest collections and the rest, including the boot cache. Shares always describe the reported total. */
export function storageRows(usage: StorageUsage): ShareBarRow[] {
  const collections = Object.entries(usage.collections)
    .filter(([, v]) => v.bytes > 0)
    .sort(([a, av], [b, bv]) => bv.bytes - av.bytes || a.localeCompare(b));
  const largest = collections
    .slice(0, 5)
    .map(([id, v]) => ({ id, label: STORAGE_LABEL[id] ?? 'Other records', bytes: v.bytes }));
  const other = Math.max(0, usage.totalBytes - largest.reduce((n, v) => n + v.bytes, 0));
  if (other > 0) largest.push({ id: 'other', label: 'Other and app cache', bytes: other });
  return largest.map((v, i) => ({
    id: v.id,
    label: v.label,
    valueText: formatBytes(v.bytes),
    share: usage.totalBytes > 0 ? v.bytes / usage.totalBytes : 0,
    hue: TONES[i]!,
  }));
}

export function StorageCard({ privacy }: { privacy: string }) {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let generation = 0;
    const read = async () => {
      const current = ++generation;
      try {
        const r = await dispatch('data.usage', {});
        if (!alive || current !== generation) return;
        if (r.ok && 'output' in r) {
          setUsage(r.output);
          setFailed(false);
        } else setFailed(true);
      } catch {
        if (alive && current === generation) setFailed(true);
      }
    };
    void read();
    const refresh = () => void read();
    const unsubscribe = getDocumentStore().subscribe(refresh);
    window.addEventListener('storage', refresh);
    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener('storage', refresh);
    };
  }, []);
  const rows = usage ? storageRows(usage) : [];
  const total = usage?.totalBytes ?? 0;
  const divisor = total >= 1_000_000 ? 1_000_000 : total >= 1000 ? 1000 : 1;
  const unit = divisor === 1_000_000 ? 'MB' : divisor === 1000 ? 'kB' : 'B';
  const engine = usage?.engine === 'idb' ? 'IndexedDB' : usage?.engine;
  return (
    <SettingsCard
      icon={Database}
      title="Storage"
      className="settings-storage"
      info={{
        title: 'Where your data lives',
        body: `${privacy} The bar shows what each kind of record takes here.`,
        range: 'Only the small key store has a hard limit (5 MB); the main store grows with your device.',
        source: { kind: 'engine', words: 'Storage measured on this device, including the app cache.' },
        twin: usage ? (
          <ChartTwin data={stackTwin({ label: 'Storage on this device', rows, total: formatBytes(total) })} />
        ) : undefined,
      }}
      foot={
        <CardFoot
          state={{ word: failed ? 'Could not measure' : usage ? 'On this device' : 'Measuring' }}
          right={engine}
        />
      }
    >
      <HeroNumber
        value={usage ? total / divisor : null}
        decimals={divisor > 1 ? 1 : 0}
        unit={usage ? unit : undefined}
        size="num"
        label={
          usage
            ? `Storage on this device: ${formatBytes(total)}`
            : failed
              ? 'Storage could not be measured'
              : 'Measuring storage'
        }
      />
      {usage ? (
        rows.length ? (
          <StackBar label="Storage on this device" rows={rows} total={formatBytes(total)} />
        ) : (
          <MonoMeta>No stored records yet</MonoMeta>
        )
      ) : null}
    </SettingsCard>
  );
}
