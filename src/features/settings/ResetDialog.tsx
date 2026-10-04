import { useRef, useState } from 'react';
import { Dialog, Field, Key, TextInput } from '@/components';
import { dispatch, mintConfirmation } from '@/commands';

export interface ResetDialogProps {
  open: boolean;
  onClose: () => void;
  /** Summaries of what will be deleted ("3 scenarios", "settings"). */
  contents: string[];
  /** Where to go afterwards (full reload so no in-memory store writes the data back). */
  redirectTo?: string;
}

const WORD = 'reset';

/** "your body, 6 planner goals (8 weeks) and 1 scenario": store summaries as one readable phrase. */
export function listPhrase(items: readonly string[]): string {
  const parts = items.map((t) => t.replace(/ · (.+)$/, ' ($1)'));
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "Reset everything?" — typed confirmation, then wipe localStorage + IndexedDB and reload. */
export function ResetDialog({ open, onClose, contents, redirectTo = '/' }: ResetDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = typed.trim().toLowerCase() === WORD;
  const what = contents.length > 0 ? listPhrase(contents) : 'your settings';

  const close = () => {
    setTyped('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      role="alertdialog"
      title="Reset everything?"
      initialFocus={inputRef}
      footer={
        <>
          <Key onClick={close}>Cancel</Key>
          <Key
            variant="danger"
            loading={busy}
            disabledReason={matches ? undefined : `Type “${WORD}” to confirm.`}
            onClick={async () => {
              setBusy(true);
              await dispatch('data.eraseAll', {}, { confirmation: mintConfirmation('data.eraseAll', {}) });
              window.location.assign(redirectTo);
            }}
          >
            Delete everything
          </Key>
        </>
      }
    >
      <p className="m-0">
        This deletes {what} from this device. It can't be undone. Export first if you might want them back.
      </p>
      <Field label={`type ${WORD} to confirm`} help="Vitals then starts again from the beginning.">
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
