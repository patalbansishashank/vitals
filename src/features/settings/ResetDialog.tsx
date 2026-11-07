import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Dialog, Field, InlineWarning, Key, TextInput } from '@/components';
import { dispatch, mintConfirmation } from '@/commands';
import { platformCaps } from '@/platform';
import { NATIVE_HISTORY_SCOPE } from './copy';

export interface ResetDialogProps {
  open: boolean;
  onClose: () => void;
  /** Summaries of what will be deleted ("3 scenarios", "settings"). */
  contents: string[];
  /** Where to go afterwards (full reload so no in-memory store writes the data back). */
  redirectTo?: string;
  /** Export from inside the dialog (r068 S9): the copy says "Export first", so the dialog offers it. */
  onExport?: () => void | Promise<void>;
}

const WORD = 'reset';

/** "your body, 6 planner goals (8 weeks) and 1 scenario": store summaries as one readable phrase. */
export function listPhrase(items: readonly string[]): string {
  const parts = items.map((t) => t.replace(/ · (.+)$/, ' ($1)'));
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Reset the planning-data store, with native acquisition history explicitly outside this boundary. */
export function ResetDialog({ open, onClose, contents, redirectTo = '/', onExport }: ResetDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = typed.trim().toLowerCase() === WORD;
  const what = contents.length > 0 ? listPhrase(contents) : 'your settings';

  const close = () => {
    setTyped('');
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      role="alertdialog"
      title="Reset planning data?"
      initialFocus={inputRef}
      footer={
        <>
          <Key onClick={close}>Cancel</Key>
          <Key
            variant="danger"
            loading={busy}
            disabledReason={matches ? undefined : `Type “${WORD}” to confirm.`}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError(null);
              try {
                const result = await dispatch('data.eraseAll', {}, { confirmation: mintConfirmation('data.eraseAll', {}) });
                if (!result.ok) {
                  setError(result.error.message);
                  return;
                }
                window.location.assign(redirectTo);
              } catch {
                setError('Could not reset this device. Try again.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete planning data
          </Key>
        </>
      }
    >
      <p className="m-0">
        This deletes {what} from this device. Server copies stay unchanged. It can't be undone. Export first if you might want them back.
      </p>
      {platformCaps().platform === 'android' ? <p className="m-0">{NATIVE_HISTORY_SCOPE}</p> : null}
      {error ? <InlineWarning severity="danger" alert>{error}</InlineWarning> : null}
      {onExport ? (
        <div>
          <Key size="sm" icon={Download} onClick={() => void onExport()}>
            Export data first
          </Key>
        </div>
      ) : null}
      <Field label={`Type ${WORD} to confirm`} help="Vitals restarts with an empty planning profile.">
        <TextInput
          ref={inputRef}
          value={typed}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches) e.preventDefault();
          }}
        />
      </Field>
    </Dialog>
  );
}
