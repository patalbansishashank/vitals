/**
 * Typed confirmation for destructive acts (living-mode.md §7.2, plan-ladder.md §6.7): end a plan, replace the active
 * plan. Only the person can complete it — the Coach's "confirm" cards open this dialog and never carry the action.
 * The confirm key stays disabled (with its reason) until the word is typed.
 */
import { useId, useRef, useState } from 'react';
import { Dialog, Field, Key, TextInput } from '@/components';

export interface TypedConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Consequence first: "It ends today. Your logs and versions are kept…". */
  body: string;
  /** The word to type ("end", "replace"). */
  word: string;
  /** "Type end to confirm." */
  instruction: string;
  /** The verb on the key ("End plan", "Replace plan"). */
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: (typed: string) => void | Promise<void>;
}

export function TypedConfirmDialog({ open, onClose, title, body, word, instruction, confirmLabel, cancelLabel = 'Cancel', onConfirm }: TypedConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyId = useId();
  const matches = typed.trim().toLowerCase() === word.toLowerCase();
  const close = () => {
    setTyped('');
    onClose();
  };
  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    try {
      await onConfirm(typed.trim());
      setTyped('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      role="alertdialog"
      initialFocus={inputRef}
      footer={
        <>
          <Key onClick={close}>{cancelLabel}</Key>
          <Key variant="danger" onClick={() => void confirm()} disabledReason={matches ? undefined : instruction} loading={busy}>
            {confirmLabel}
          </Key>
        </>
      }
    >
      <p id={bodyId} className="lv-confirm__body">
        {body}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <Field label={instruction}>
          <TextInput ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={bodyId} />
        </Field>
      </form>
    </Dialog>
  );
}
