import { useEffect, useId, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { Checkbox, InlineWarning, Key, toast } from '@/components';
import type { PairingCode } from '@/sync/types';
import { SYNC_COPY } from './copy';
import { QrCode } from './QrCode';

export const AUTO_HIDE_MS = 60_000;

/**
 * The pairing secret, shown like a password: 24 numbered words, the QR code and a copy key. Hides itself after a
 * minute. Right after setting up sync, it can't be closed until the user confirms the words are saved.
 */
export function PairingCodePanel({ code, requireAck, onHide }: { code: PairingCode; requireAck: boolean; onHide: (acknowledged: boolean) => void }) {
  const [saved, setSaved] = useState(false);
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const hideRef = useRef(onHide);
  const savedRef = useRef(saved);
  useEffect(() => {
    hideRef.current = onHide;
    savedRef.current = saved;
  });

  useEffect(() => {
    ref.current?.focus({ preventScroll: false });
    const t = window.setTimeout(() => hideRef.current(savedRef.current), AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [code]);

  const copy = () => {
    void navigator.clipboard
      ?.writeText(code.uri)
      .then(() => toast(SYNC_COPY.copied))
      .catch(() => undefined);
  };

  return (
    <div ref={ref} tabIndex={-1} role="region" aria-labelledby={titleId} className="grid gap-3 rounded-md border border-line p-3 outline-none">
      <h3 id={titleId} className="lm-eng m-0">
        pairing code
      </h3>
      <InlineWarning severity="caution">{SYNC_COPY.codeWarning}</InlineWarning>
      <div className="flex flex-wrap items-start gap-4">
        <ol aria-label="The 24 words" className="m-0 grid flex-[1_1_16rem] list-none grid-cols-2 gap-x-4 gap-y-1 p-0 font-mono text-sm sm:grid-cols-3">
          {code.words.map((w, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-5 text-right tabular-nums text-ink-2" aria-hidden="true">
                {i + 1}
              </span>
              <span>{w}</span>
            </li>
          ))}
        </ol>
        <QrCode text={code.uri} label="QR code of the pairing code" className="w-40 shrink-0 rounded-sm" />
      </div>
      <p className="m-0 text-xs leading-[1.45] text-ink-2">
        {SYNC_COPY.codeLoss} {SYNC_COPY.codeAutoHide}
      </p>
      {requireAck ? <Checkbox checked={saved} onChange={setSaved} label={SYNC_COPY.savedWords} /> : null}
      <div className="flex flex-wrap gap-2">
        <Key size="sm" icon={Copy} onClick={copy}>
          {SYNC_COPY.copyCode}
        </Key>
        <Key size="sm" disabledReason={requireAck && !saved ? SYNC_COPY.savedWordsNeeded : undefined} onClick={() => onHide(saved)}>
          {SYNC_COPY.hideCode}
        </Key>
      </div>
    </div>
  );
}
