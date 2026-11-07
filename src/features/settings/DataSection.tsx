import { useRef, useState, useSyncExternalStore } from 'react';
import { Download, Upload } from 'lucide-react';
import { InlineWarning, Key, MonoMeta, formatBytes, toast } from '@/components';
import {
  describeStored,
  LOCAL_STORAGE_QUOTA,
  parseImport,
  storageUsage,
  type ImportFailure,
  type ImportPreview,
} from '@/state/persistence';
import { useSettingsStore } from '@/state/settingsStore';
import { SettingsSection } from './sections';
import { SettingRow, SettingsGroup, SettingsItem } from './SettingRow';
import { NATIVE_HISTORY_SCOPE, PLANNING_BACKUP_SCOPE, privacyText } from './copy';
import { useServerPairing } from './server/hooks';
import { useSyncView } from '@/state/sync';
import { ImportDialog } from './ImportDialog';
import { ResetDialog } from './ResetDialog';
import { loadAllStores } from './stores';
import { dispatch } from '@/commands';
import { sendCommand } from '@/features/lib/sendCommand';
import { platformCaps } from '@/platform';
import { StorageCard } from './StorageCard';

const DAY = 86_400_000;

/** Whole days since an ISO time (null = never). Read at render; it only needs day precision. */
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / DAY);
}

/** Re-read what is stored whenever any store writes (cheap: a few keys); the reset dialog names it. */
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
let cache: { contents: string[]; used: number } = { contents: [], used: 0 };
function snapshot() {
  const contents = describeStored().map((d) => d.summary);
  // only the browser's small key store has a hard cap; the document store grows with the device
  const used = Math.min(1, storageUsage().bytes / LOCAL_STORAGE_QUOTA);
  const key = `${used.toFixed(2)}|${contents.join(',')}`;
  if (key !== cacheKey) {
    cacheKey = key;
    cache = { contents, used };
  }
  return cache;
}

function formatDate(d: Date): string {
  // newer ICU data spells September "Sept" in en-GB; the design writes three-letter months
  return d
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    .replace(/\bSept\b/, 'Sep');
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

/**
 * Settings › Your data (r068 S22): Backup (when the last export was, then Export and Import as two equal keys), Reset
 * (what it does, then its danger key: at the right on wider screens, full width on phones), and the privacy line (where
 * the data lives; moved here from Sync, r068 S23).
 */
export function DataSection() {
  const { contents, used } = useSyncExternalStore(subscribeStorage, snapshot, snapshot);
  const lastExportAt = useSettingsStore((s) => s.lastExportAt);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<{
    fileName: string;
    result: ImportPreview | ImportFailure;
  } | null>(null);
  const [reading, setReading] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const lastExport = lastExportAt ? new Date(lastExportAt) : null;
  const age = daysSince(lastExportAt);

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

  // the Android and desktop apps keep data on the device, not in a browser
  const caps = platformCaps();
  const app = caps.installedApp;
  const android = caps.platform === 'android';
  const synced = useSyncView().paired;
  const coachOnServer = useServerPairing() !== null;

  return (
    <SettingsSection id="data" title="Your data">
      <StorageCard privacy={privacyText(synced, coachOnServer)} />
      <SettingsGroup label="Backup" info={android ? { title: 'What is in a backup', body: PLANNING_BACKUP_SCOPE } : undefined}>
        {age !== null && age > 30 ? (
          <SettingsItem>
            <InlineWarning severity="caution">
              Last export was {age} days ago.{app ? null : ' Browsers can clear site data.'}
            </InlineWarning>
          </SettingsItem>
        ) : (
          <SettingRow label="Last export">
            {() => <MonoMeta>{lastExport ? formatDate(lastExport) : 'Never'}</MonoMeta>}
          </SettingRow>
        )}
        {used >= 0.8 ? (
          <SettingsItem>
            <meter
              className="settings-key-storage"
              min={0}
              max={1}
              value={used}
              aria-label="Key store usage"
            />
            <InlineWarning severity={used >= 0.95 ? 'danger' : 'caution'}>
              {used >= 0.95
                ? "Vitals can't save more here. Export, then remove old scenarios."
                : 'Storage is nearly full. Export, then remove old scenarios.'}
            </InlineWarning>
          </SettingsItem>
        ) : null}
        <SettingsItem>
          <div className="settings-keys" data-equal="">
            <Key icon={Download} onClick={onExport}>
              Export data
            </Key>
            <Key icon={Upload} loading={reading} onClick={() => fileRef.current?.click()}>
              Import a file
            </Key>
          </div>
        </SettingsItem>
      </SettingsGroup>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="lm-sr"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <SettingsGroup label="Reset">
        <SettingRow
          label="Reset planning data"
          help={`Clears plans, body profile, logs, preferences and cached readings ${app ? 'on this device' : 'in this browser'}. Server copies stay unchanged.${android ? ` ${NATIVE_HISTORY_SCOPE}` : ''}`}
          wide
        >
          {() => (
            <Key variant="danger" onClick={() => setResetOpen(true)}>
              Reset planning data
            </Key>
          )}
        </SettingRow>
      </SettingsGroup>
      <ImportDialog
        state={importState}
        onClose={() => setImportState(null)}
        onChooseAnother={() => fileRef.current?.click()}
      />
      <ResetDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        contents={contents}
        onExport={onExport}
      />
    </SettingsSection>
  );
}
