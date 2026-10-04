/**
 * Camera QR scanning for the pairing code. Native `BarcodeDetector` where it reads QR codes (Chromium Android, macOS);
 * otherwise `qr-scanner`, loaded on demand. Its decoder runs in a worker created from a blob: URL, which the CSP
 * allows (`worker-src 'self' blob:`), and it needs no eval.
 */
import type QrScannerClass from 'qr-scanner';

export type ScanErrorCode = 'denied' | 'no-camera' | 'unsupported' | 'failed';
export class ScanError extends Error {
  constructor(public readonly code: ScanErrorCode, message: string = code) {
    super(message);
  }
}

interface Detector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
interface DetectorCtor {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
}

function toScanError(e: unknown): ScanError {
  if (e instanceof ScanError) return e;
  const name = (e as { name?: string })?.name ?? '';
  const text = String((e as { message?: string })?.message ?? e);
  if (name === 'NotAllowedError' || name === 'SecurityError' || /permission|denied/i.test(text)) return new ScanError('denied', text);
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || /camera not found/i.test(text)) return new ScanError('no-camera', text);
  return new ScanError('failed', text);
}

async function nativeDetector(): Promise<Detector | null> {
  const Ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? [];
    return formats.includes('qr_code') ? new Ctor({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

/**
 * Starts the camera into `video` and calls `onResult` with the first decoded text. Resolves with a stop function once
 * the camera runs; rejects with a `ScanError` (permission denied, no camera, no scanner).
 */
export async function startQrScan(video: HTMLVideoElement, onResult: (text: string) => void): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new ScanError('unsupported');
  const detector = await nativeDetector();
  if (detector) {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (e) {
      throw toScanError(e);
    }
    let stopped = false;
    let timer = 0;
    const stop = () => {
      stopped = true;
      window.clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    const tick = async () => {
      if (stopped) return;
      try {
        const found = video.readyState >= 2 ? await detector.detect(video) : [];
        if (!stopped && found[0]?.rawValue) {
          stop();
          onResult(found[0].rawValue);
          return;
        }
      } catch {
        // a frame that cannot be read; try the next one
      }
      timer = window.setTimeout(() => void tick(), 200);
    };
    void tick();
    return stop;
  }

  let QrScanner: typeof QrScannerClass;
  try {
    QrScanner = (await import('qr-scanner')).default;
  } catch {
    throw new ScanError('unsupported');
  }
  let done = false;
  const scanner = new QrScanner(
    video,
    (result) => {
      if (done) return;
      done = true;
      scanner.stop();
      onResult(result.data);
    },
    { returnDetailedScanResult: true, preferredCamera: 'environment', maxScansPerSecond: 5 },
  );
  const stop = () => {
    done = true;
    scanner.stop();
    scanner.destroy();
  };
  try {
    await scanner.start();
  } catch (e) {
    stop();
    throw toScanError(e);
  }
  return stop;
}
