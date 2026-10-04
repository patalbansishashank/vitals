import { useState } from 'react';
import { Dialog, InlineWarning, Key, RadioGroup, toast } from '@/components';
import type { ImportFailure, ImportMode, ImportPreview } from '@/state/persistence';
import { dispatch, mintConfirmation } from '@/commands';

export interface ImportDialogProps {
  state: { fileName: string; result: ImportPreview | ImportFailure } | null;
  onClose: () => void;
  onChooseAnother: () => void;
}

/** What a device holds right after "Reset everything" or on first run: nothing the person made. */
const STARTER_KEYS: ReadonlySet<string> = new Set([
  'vitals.settings',
  'vitals.scenarios',
  'vitals.simulations',
  'vitals.results',
  'vitals.ui.lastRoute',
  'vitals.migratedToStore',
  'vitals.device',
]);

/** True when nothing on this device is the person's own data, so "Merge" would only duplicate the starter scenario. */
export function holdsNoUserData(entries: ReadonlyArray<{ key: string; exists: boolean }>): boolean {
  return !entries.some((e) => e.exists && !STARTER_KEYS.has(e.key));
}

function formatDate(d: Date): string {
  // newer ICU data spells September "Sept" in en-GB; the design writes three-letter months
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\bSept\b/, 'Sep');
}

/**
 * Import preview (settings-data.md §6): everything is validated before this
 * opens and nothing is written until "Import".
 */
export function ImportDialog({ state, onClose, onChooseAnother }: ImportDialogProps) {
  // until the person chooses, a device with no data of its own replaces (nothing to keep, and Merge would duplicate the starter scenario)
  const [chosen, setMode] = useState<ImportMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = state !== null;
  const result = state?.result;
  const mode: ImportMode = chosen ?? (result?.ok && holdsNoUserData(result.entries) ? 'replace' : 'merge');

  const close = () => {
    setError(null);
    setMode(null);
    onClose();
  };

  if (!state || !result) return <Dialog open={false} onClose={close} title="" />;

  if (!result.ok) {
    return (
      <Dialog
        open={open}
        onClose={close}
        title={`Can't import ${state.fileName}`}
        footer={
          <>
            <Key onClick={close}>Cancel</Key>
            <Key
              variant="solid"
              onClick={() => {
                close();
                onChooseAnother();
              }}
            >
              Choose another file
            </Key>
          </>
        }
      >
        <InlineWarning severity="danger" alert>
          {result.message}
        </InlineWarning>
      </Dialog>
    );
  }

  // the remembered screen is rewritten on every visit, so it is never worth a conflict line
  const conflicts = result.entries.filter((e) => e.exists && e.key !== 'vitals.ui.lastRoute');
  const damaged = result.damaged;
  const meta = [
    result.exportedAt ? `Exported ${formatDate(result.exportedAt)}` : 'Export date unknown',
    result.appVersion ? `from Vitals ${result.appVersion}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const input = { file: result.data as unknown as Record<string, unknown>, mode };
      const r = await dispatch('data.import', input, { confirmation: mintConfirmation('data.import', input) });
      if (!r.ok) throw new Error(r.error.message);
      if (!('output' in r)) return;
      const out = r.output;
      const n = out.written.length;
      toast(
        n === 0
          ? 'Nothing new to import — your current data was kept.'
          : `Imported ${n} ${n === 1 ? 'item' : 'items'}${out.kept.length ? ` · kept ${out.kept.length} already on this device` : ''}.`,
      );
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import failed. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Import ${state.fileName}?`}
      size="wide"
      footer={
        <>
          <Key onClick={close}>Cancel</Key>
          <Key variant="solid" loading={busy} onClick={() => void run()}>
            {damaged.length > 0 ? 'Import the rest' : 'Import'}
          </Key>
        </>
      }
    >
      <p className="m-0 text-ink">
        {meta} · {result.entries.map((e) => e.summary).join(' · ')}
      </p>
      {conflicts.length > 0 ? (
        <p className="m-0 text-sm">Already on this device: {conflicts.map((c) => c.summary).join(', ')}.</p>
      ) : null}
      {result.entries.some((e) => e.key === 'vitals.safety') ? (
        <p className="m-0 text-sm">
          {mode === 'merge' && result.entries.some((e) => e.key === 'vitals.safety' && e.exists)
            ? 'Merging keeps the safety answers on this device.'
            : 'Imported safety answers apply after you check them. For the eating questions the file holds only their outcome, not your answers; the outcome is kept.'}
        </p>
      ) : null}
      {damaged.length > 0 ? (
        <InlineWarning severity="danger" alert>
          Part of this file couldn't be read ({damaged.map((d) => `${d.label} ${d.reason}`).join('; ')}). Import the rest?
        </InlineWarning>
      ) : null}
      <RadioGroup<ImportMode>
        label="how to import"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'merge', label: 'Merge', help: 'Keep everything. Imported items get “(imported)” if names clash; this device keeps its settings.' },
          { value: 'replace', label: 'Replace everything', help: 'Your current data is removed first.' },
        ]}
      />
      {error ? (
        <InlineWarning severity="danger" alert>
          {error}
        </InlineWarning>
      ) : null}
    </Dialog>
  );
}
