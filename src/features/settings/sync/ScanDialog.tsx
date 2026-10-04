import { useEffect, useRef, useState } from 'react';
import { Dialog, InlineWarning, Key } from '@/components';
import { SYNC_COPY } from './copy';
import { ScanError, startQrScan, type ScanErrorCode } from './scanQr';

const ERROR_TEXT: Record<ScanErrorCode, string> = {
  denied: SYNC_COPY.cameraDenied,
  'no-camera': SYNC_COPY.noCamera,
  unsupported: SYNC_COPY.scanUnsupported,
  failed: SYNC_COPY.scanFailed,
};

/** Camera dialog for the pairing QR code (lazy chunk: only loaded when "Scan code" is pressed). */
export default function ScanDialog({ open, onClose, onResult, title = SYNC_COPY.scanTitle, help = SYNC_COPY.scanHelp }: { open: boolean; onClose: () => void; onResult: (text: string) => void; title?: string; help?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<ScanErrorCode | null>(null);
  const resultRef = useRef(onResult);
  useEffect(() => {
    resultRef.current = onResult;
  });

  useEffect(() => {
    if (!open) return;
    const video = videoRef.current;
    if (!video) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    setError(null);
    startQrScan(video, (text) => resultRef.current(text))
      .then((s) => {
        if (cancelled) s();
        else stop = s;
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ScanError ? e.code : 'failed');
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title={title} footer={<Key onClick={onClose}>Cancel</Key>}>
      <p className="m-0 text-sm text-ink-2">{help}</p>
      <video ref={videoRef} className="mt-3 aspect-square w-full rounded-md bg-ink object-cover" muted playsInline aria-label="Camera preview" />
      {error ? (
        <InlineWarning severity="danger" alert className="mt-3">
          {ERROR_TEXT[error]}
        </InlineWarning>
      ) : null}
    </Dialog>
  );
}
