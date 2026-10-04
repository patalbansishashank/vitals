/**
 * <CoachComposer> (COMPONENTS §13.18): what you tell the Coach. Two shapes:
 *   full — prompt chips (≤ 3) above an auto-growing field (1–6 lines), photo key, send key; Enter sends, Shift+Enter
 *          is a new line; while the Coach works the send key becomes Stop (keyboard reachable).
 *   bar  — one line + photo + send (Today's log bar).
 * The attach key picks a photo (camera or library, no permission prompt) or a PDF report; a PDF is read on this device
 * (E20, markers_import), so it can be picked even when the model can't see photos. With `disabledReason` (no provider) the field stays usable; sending shows the reason and a link.
 */
import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { Camera, FileText, SendHorizontal, Square, X } from 'lucide-react';
import { IconKey, InlineWarning, Key, cx } from '@/components';
import { COMPOSER_COPY as K } from '../coach/copy';
import './coachComposer.css';

export interface CoachComposerMessage {
  text: string;
  photo?: File;
}

export interface CoachComposerProps {
  variant: 'full' | 'bar';
  onSend: (msg: CoachComposerMessage) => void;
  /** The Coach is replying: Enter does nothing and the send key becomes Stop. */
  busy?: boolean;
  onStop?: () => void;
  /** Why sending can't happen (no provider). The field stays; pressing send shows this with a link. */
  disabledReason?: string;
  /** Where the reason's link goes (default Settings). */
  disabledLink?: { to: string; label: string };
  /** Prompt chips (full only, at most 3). */
  chips?: readonly string[];
  /** Chip pressed (default: send its text). */
  onChip?: (chip: string) => void;
  /** The model can read photos (the photo key is hidden otherwise). */
  vision?: boolean;
  placeholder?: string;
  /** Accessible name of the field. */
  label?: string;
  autoFocus?: boolean;
  /** Initial text (e.g. a kept message); remount with a `key` to replace it. */
  defaultText?: string;
  className?: string;
}

function objectUrl(f: File): string | null {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : null;
  } catch {
    return null;
  }
}

const PDF = 'application/pdf';

/** A PDF by type, or by name when the system gives no type (it then gets the PDF type the Coach reads it by). */
function asPdf(f: File): File | null {
  if (f.type === PDF) return f;
  if (!f.type && /\.pdf$/i.test(f.name)) return new File([f], f.name, { type: PDF });
  return null;
}

function fieldSizingSupported(): boolean {
  try {
    return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');
  } catch {
    return false;
  }
}

export function CoachComposer({
  variant,
  onSend,
  busy = false,
  onStop,
  disabledReason,
  disabledLink = { to: '/settings/coach', label: K.openSettings },
  chips,
  onChip,
  vision = true,
  placeholder = K.placeholder,
  label = K.label,
  autoFocus,
  defaultText = '',
  className,
}: CoachComposerProps) {
  const [text, setText] = useState(defaultText);
  const [photo, setPhoto] = useState<{ file: File; url: string | null } | null>(null);
  const [notice, setNotice] = useState<'reason' | 'noVision' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const noticeId = `${id}-notice`;
  const shown = notice === 'reason' ? (disabledReason ? 'reason' : null) : notice;

  // release the staged thumbnail's object URL when it is replaced or the composer unmounts
  useEffect(() => {
    const url = photo?.url;
    return () => {
      if (url) URL.revokeObjectURL?.(url);
    };
  }, [photo]);

  const resetHeight = () => {
    if (areaRef.current) areaRef.current.style.height = '';
  };

  const submit = () => {
    if (busy) return;
    if (disabledReason) {
      setNotice('reason');
      return;
    }
    const t = text.trim();
    if (!t && !photo) return;
    onSend(photo ? { text: t, photo: photo.file } : { text: t });
    setText('');
    setPhoto(null);
    setNotice(null);
    resetHeight();
  };

  const chip = (c: string) => {
    if (onChip) return onChip(c);
    if (busy) return;
    if (disabledReason) {
      setNotice('reason');
      return;
    }
    onSend({ text: c });
  };

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    const pdf = asPdf(f);
    if (pdf) {
      setPhoto({ file: pdf, url: null });
      setNotice(null);
      return;
    }
    if (!vision) {
      setNotice('noVision');
      return;
    }
    setPhoto({ file: f, url: objectUrl(f) });
    setNotice(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'));
    if (f) {
      e.preventDefault();
      pick(f);
    }
  };

  const grow = (e: FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (fieldSizingSupported() || el.scrollHeight <= 0) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const describedBy = shown ? noticeId : undefined;
  const shownChips = variant === 'full' ? (chips ?? []).slice(0, 3) : [];

  return (
    <div className={cx('lv-composer', className)} data-variant={variant}>
      {shownChips.length ? (
        <div className="lv-composer__chips" role="group" aria-label={K.prompts}>
          {shownChips.map((c) => (
            <Key key={c} size="sm" className="lv-composer__chip" onClick={() => chip(c)}>
              {c}
            </Key>
          ))}
        </div>
      ) : null}
      {photo ? (
        <div className="lv-composer__staged">
          {photo.url ? <img src={photo.url} alt="" width={40} height={40} className="lv-composer__thumb" /> : null}
          <span className="lm-eng">{photo.file.type === PDF ? K.pdfAttached(photo.file.name) : K.photoAttached}</span>
          <IconKey size="sm" icon={X} label={photo.file.type === PDF ? K.removePdf : K.removePhoto} onClick={() => setPhoto(null)} />
        </div>
      ) : null}
      <div className="lv-composer__row">
        <label htmlFor={id} className="lm-sr">
          {label}
        </label>
        {variant === 'full' ? (
          <textarea
            id={id}
            ref={areaRef}
            className="lv-composer__field"
            rows={1}
            value={text}
            placeholder={placeholder}
            autoFocus={autoFocus}
            aria-describedby={describedBy}
            onChange={(e) => setText(e.target.value)}
            onInput={grow}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        ) : (
          <input
            id={id}
            type="text"
            className="lv-composer__field"
            value={text}
            placeholder={placeholder}
            autoFocus={autoFocus}
            enterKeyHint="send"
            autoComplete="off"
            aria-describedby={describedBy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        )}
        <input
          ref={fileRef}
          type="file"
          accept={vision ? `image/*,${PDF}` : PDF}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          data-testid="coach-photo-input"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <IconKey icon={vision ? Camera : FileText} label={vision ? K.photo : K.pdf} onClick={() => fileRef.current?.click()} />
        {busy && onStop ? (
          <Key icon={Square} aria-label={K.stopName} onClick={onStop}>
            {K.stop}
          </Key>
        ) : (
          <IconKey icon={SendHorizontal} label={K.send} variant="default" loading={busy} aria-describedby={describedBy} onClick={submit} />
        )}
      </div>
      <div id={noticeId} role="status" className="lv-composer__notice">
        {shown === 'reason' ? (
          <InlineWarning
            severity="info"
            action={
              <Link className="lm-link" to={disabledLink.to}>
                {disabledLink.label}
              </Link>
            }
          >
            {disabledReason}
          </InlineWarning>
        ) : shown === 'noVision' ? (
          <InlineWarning severity="info">{K.noVision}</InlineWarning>
        ) : null}
      </div>
    </div>
  );
}
