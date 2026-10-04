import { Dialog, Key } from '@/components';
import { SYNC_COPY } from './copy';

/**
 * "This device already has data. Merge it, or replace it with the synced data?" Asked before any join that would bring
 * synced data onto a device that already holds some: joining by code or words (Settings › Sync) and joining with the key
 * a paired home server hands over (Settings › Server).
 */
export function ExistingDataDialog({ summary, onChoose }: { summary: string | null; onChoose: (choice: 'merge' | 'replace') => void }) {
  return (
    <Dialog
      open={summary !== null}
      onClose={() => undefined}
      dismissible={false}
      role="alertdialog"
      title={SYNC_COPY.existingTitle}
      footer={
        <>
          <Key variant="danger" onClick={() => onChoose('replace')}>
            {SYNC_COPY.replace}
          </Key>
          <Key variant="solid" onClick={() => onChoose('merge')}>
            {SYNC_COPY.merge}
          </Key>
        </>
      }
    >
      {summary ? <p className="m-0 text-sm text-ink-2">{summary}</p> : null}
      <p className="m-0">{SYNC_COPY.existingBody}</p>
    </Dialog>
  );
}
