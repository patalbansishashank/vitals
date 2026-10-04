/**
 * Hand-offs from a screen to a `bio.*` command (tier H, no React). A web page can only read a file the person picked or
 * open a Bluetooth device inside a click, so the screen does that part and stages the result here; the command then
 * takes it once by reference (the `bio` port, `ctx.ports.bio`):
 *
 *   const fileRef = stageFile(file);                        // <input type="file"> change handler
 *   await dispatch('bio.import', { fileRef });
 *
 *   const link = await requestDevice(driver);               // inside the click (user gesture)
 *   const linkRef = stageBleLink(link, driver.id);
 *   await dispatch('bio.deviceConnect', { driver: driver.id, linkRef });
 *
 * Staged items expire after 10 minutes. A ring's handshake (V0789's passcode included) is built into its driver, so
 * nothing secret is staged here.
 */
import type { BleLink } from '../core/ble/types';

const TTL_MS = 10 * 60 * 1000;

export interface StagedFile {
  blob: Blob;
  name: string;
}
export interface StagedLink {
  link: BleLink;
  driver: string;
}

const files = new Map<string, { at: number; item: StagedFile }>();
const links = new Map<string, { at: number; item: StagedLink }>();
let seq = 0;

function sweep(now: number): void {
  for (const [k, v] of files) if (now - v.at > TTL_MS) files.delete(k);
  for (const [k, v] of links) {
    if (now - v.at > TTL_MS) {
      links.delete(k);
      void v.item.link.disconnect().catch(() => undefined);
    }
  }
}

const ref = (kind: string): string => `${kind}:${Date.now().toString(36)}${(++seq).toString(36)}`;

/** Stage a picked file; returns the `fileRef` for `bio.import`. */
export function stageFile(blob: Blob, name?: string): string {
  const now = Date.now();
  sweep(now);
  const r = ref('file');
  files.set(r, { at: now, item: { blob, name: name ?? (blob as Partial<File>).name ?? 'file' } });
  return r;
}

/** Take a staged file (once). */
export function takeFile(fileRef: string): StagedFile | undefined {
  sweep(Date.now());
  const e = files.get(fileRef);
  files.delete(fileRef);
  return e?.item;
}

/** Stage an open Bluetooth link; returns the `linkRef` for `bio.deviceConnect` / `bio.deviceSync`. */
export function stageBleLink(link: BleLink, driver: string): string {
  const now = Date.now();
  sweep(now);
  const r = ref('link');
  links.set(r, { at: now, item: { link, driver } });
  return r;
}

/** Take a staged link (once). */
export function takeBleLink(linkRef: string): StagedLink | undefined {
  sweep(Date.now());
  const e = links.get(linkRef);
  links.delete(linkRef);
  return e?.item;
}

/** Tests: forget everything staged. */
export function clearStaged(): void {
  files.clear();
  links.clear();
}
