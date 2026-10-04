import { useId, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { parsePairingLink, type ParsedPairingLink } from '@/net/server';
import { SERVER_COPY } from './copy';

/**
 * The 8-digit pairing code as two groups of 4 (design COMPONENTS §15.1, with the server's digits-only format). Typing the
 * 4th digit moves to the second group; Backspace in an empty second group returns to the first. Pasting a whole code
 * fills both groups; pasting a pairing link calls `onLink` (which also fills the address).
 */
export function PairingCodeField({
  value,
  onChange,
  onLink,
  error,
  help,
  autoFocus,
}: {
  value: string;
  onChange: (digits: string) => void;
  onLink?: (link: ParsedPairingLink) => void;
  error?: string | null;
  help?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const first = useRef<HTMLInputElement>(null);
  const second = useRef<HTMLInputElement>(null);
  const a = value.slice(0, 4);
  const b = value.slice(4, 8);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const digits = (s: string) => s.replace(/\D/g, '');
  const setFirst = (raw: string) => {
    const d = digits(raw);
    if (d.length > 4) {
      onChange(d.slice(0, 8));
      second.current?.focus();
      return;
    }
    onChange(d + b);
    if (d.length === 4) second.current?.focus();
  };
  const setSecond = (raw: string) => onChange((a.padEnd(4, '') + digits(raw)).slice(0, 8));

  const paste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    const link = parsePairingLink(text);
    if (link) {
      e.preventDefault();
      onChange(link.code);
      onLink?.(link);
      return;
    }
    const d = digits(text);
    if (d.length === 8) {
      e.preventDefault();
      onChange(d);
      second.current?.focus();
    }
  };
  const back = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && b === '') first.current?.focus();
  };

  const input = 'lm-input w-[7.5ch] min-w-0 text-center text-xl font-[500] tabular-nums tracking-[0.12em]';
  return (
    <div className="lm-field">
      <span id={`${id}-label`} className="lm-field__label">
        {SERVER_COPY.codeLabel}
      </span>
      <div role="group" aria-labelledby={`${id}-label`} className="flex items-center gap-2">
        <input
          ref={first}
          className={input}
          style={{ height: 48 }}
          aria-label={SERVER_COPY.codeFirst}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          inputMode="numeric"
          autoComplete="one-time-code"
          spellCheck={false}
          maxLength={9}
          value={a}
          autoFocus={autoFocus}
          onChange={(e) => setFirst(e.target.value)}
          onPaste={paste}
        />
        <span aria-hidden="true" className="text-ink-2">
          –
        </span>
        <input
          ref={second}
          className={input}
          style={{ height: 48 }}
          aria-label={SERVER_COPY.codeLast}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={4}
          value={b}
          onChange={(e) => setSecond(e.target.value)}
          onKeyDown={back}
          onPaste={paste}
        />
      </div>
      {help ? (
        <p id={helpId} className="lm-help m-0">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="lm-error m-0" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
