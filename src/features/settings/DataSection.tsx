import { useRef, useState, useSyncExternalStore } from 'react';
import { Download, Upload } from 'lucide-react';
import { Chip, InlineWarning, Key, Meter, formatBytes, toast } from '@/components';
import { describeStored, LOCAL_STORAGE_QUOTA, parseImport, storageUsage, type ImportFailure, type ImportPreview } from '@/state/persistence';
import { useSettingsStore } from '@/state/settingsStore';
import { SettingsSection } from './sections';
import { ImportDialog } from './ImportDialog';
import { ResetDialog } from './ResetDialog';
import { loadAllStores } from './stores';
import { dispatch } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import { useSyncView } from '@/state/sync';
import { DATA_LINE } from './copy';

const DAY = 86_400_000;

/** Whole days since an ISO time (null = never). Read at render; it only needs day precision. */
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / DAY);
}

/** Re-read storage figures whenever any store writes (cheap: a few keys). */
function subscribeStorage(cb: () => void) {
  const onStorage = () => cb();
  window.addEventListener('storage', onStorage);
  const unsub = useSettingsStore.subscribe(cb);
  const t = window.setInterval(cb, 4000);
  // store registrations (labels, summaries) arrive with their modules
  void loadAllStores().then(cb);
  return () => {
    window.removeEventListener('storage', onStorage);
    unsub();
    window.clearInterval(t);
  };
}
let cacheKey = '';
let cache: { bytes: number; keys: number; contents: string[] } = { bytes: 0, keys: 0, contents: [] };
function snapshot() {
  const u = storageUsage();
  const contents = describeStored().map((d) => d.summary);
  const key = `${u.bytes}|${u.keys}|${contents.join(',')}`;
  if (key !== cacheKey) {
    cacheKey = key;
    cache = { ...u, contents };
  }
  return cache;
}

function formatDate(d: Date): string {
  // newer ICU data spells September "Sept" in en-GB; the design writes three-letter months
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\bSept\b/, 'Sep');
}

/** Browser download of the export; falls back to opening the JSON where `download` is unsupported. */
function download(text: string, name: string): number {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  if ('download' in a) {
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.open(url, '_blank', 'noopener');
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return blob.size;
}

export function DataSection() {
  const usage = useSyncExternalStore(subscribeStorage, snapshot, snapshot);
  const lastExportAt = useSettingsStore((s) => s.lastExportAt);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<{ fileName: string; result: ImportPreview | ImportFailure } | null>(null);
  const [reading, setReading] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const lastExport = lastExportAt ? new Date(lastExportAt) : null;
  const age = daysSince(lastExportAt);
  const hasUserData = usage.contents.some((c) => c !== 'settings');

  const onExport = async () => {
    const r = await dispatch('data.export', {});
    if (!r.ok || !('output' in r)) return;
    const { fileName: name, text } = r.output;
    const size = download(text, name);
    void sendCommand('settings.update', { patch: { lastExportAt: new Date().toISOString() } });
    toast(`Exported ${name} · ${formatBytes(size)}`);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const text = await file.text();
      await loadAllStores(); // validate every store with its own rules before the preview
      setImportState({ fileName: file.name, result: parseImport(text) });
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const synced = useSyncView().paired;
  const contentsLine = usage.contents.length > 0 ? usage.contents.join(' · ') : 'Nothing saved yet.';
  const usedText = `${formatBytes(usage.bytes)} of ${Math.round(LOCAL_STORAGE_QUOTA / 1_000_000)} MB used`;

  return (
    <SettingsSection id="data" title="Your data">
      <div className="grid gap-4">
        <p className="m-0 text-sm leading-[1.5] text-ink">{synced ? DATA_LINE.synced : DATA_LINE.local}</p>
        <Meter
          label="Storage used"
          value={usage.bytes}
          max={LOCAL_STORAGE_QUOTA}
          valueText={usedText}
          advice={
            usage.bytes / LOCAL_STORAGE_QUOTA >= 0.95
              ? "Vitals can't save more. Export and remove scenarios."
              : 'Storage is nearly full. Export and delete old scenarios to make room.'
          }
        />
        <p className="m-0 text-xs text-ink-2">{contentsLine}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Key icon={Download} onClick={onExport}>
            Export data
          </Key>
          <Key icon={Upload} loading={reading} onClick={() => fileRef.current?.click()}>
            Import a file
          </Key>
          {lastExport === null && hasUserData ? (
            <Chip kind="status" severity="info">
              Not backed up yet
            </Chip>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="lm-sr"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>
        {age !== null && age > 30 ? (
          <InlineWarning severity="caution">Last export was {age} days ago. Browsers can clear site data.</InlineWarning>
        ) : (
          <p className="m-0 text-xs text-ink-2">last export: {lastExport ? formatDate(lastExport) : 'never'}</p>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Key variant="danger" onClick={() => setResetOpen(true)}>
            Reset everything
          </Key>
          <span className="text-xs text-ink-2">Deletes everything Vitals stored in this browser.</span>
        </div>
      </div>
      <ImportDialog state={importState} onClose={() => setImportState(null)} onChooseAnother={() => fileRef.current?.click()} />
      <ResetDialog open={resetOpen} onClose={() => setResetOpen(false)} contents={usage.contents} />
    </SettingsSection>
  );
}
