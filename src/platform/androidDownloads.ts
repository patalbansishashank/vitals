/*
 * Saving files in the Android app (SUITE_SPEC §15.7 "export through the system share sheet"), owned by L-ANDROID.
 *
 * Every export in Vitals saves the web way: an `<a download href="blob:…">` clicked from code, often detached or
 * removed right after, with the blob URL revoked soon after (Settings › Your data, chart CSV and PNG, the planner's
 * CSV / text / JSON). A WebView ignores those links. On Android this module catches them without touching their code:
 * `HTMLAnchorElement.prototype.click` (detached anchors never reach a document listener) and a capture-phase click
 * listener (anchors a person taps), for anchors with a `download` attribute and a `blob:` or `data:` href. The content
 * is read at click time, base64-encoded and handed to `VitalsShell.saveFile`, which opens the share sheet.
 *
 * Blob URLs: `URL.createObjectURL` is wrapped to remember the Blob behind each URL, so a revoke right after the click
 * does not matter; a URL made before install falls back to `fetch` (a blob URL is resolved when fetch is called).
 */
import { onAndroid, saveFile } from './androidShell';

const SAVE_HREF = /^(blob|data):/i;
const noop = () => {};
/** Blob URLs remembered at once (see `installAndroidDownloads`). */
const MAX_REMEMBERED = 32;

function saveAnchor(el: unknown): el is HTMLAnchorElement {
  return el instanceof HTMLAnchorElement && el.hasAttribute('download') && SAVE_HREF.test(el.href);
}

/** A file name safe for `cache/exports/<name>`. */
function fileName(a: HTMLAnchorElement): string {
  const raw = (a.getAttribute('download') ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- control characters are not allowed in a file name
  const name = raw.replace(/[\u0000-\u001f:*?"<>|]/g, '_').trim();
  return name && name !== '.' && name !== '..' ? name : 'vitals-export';
}

const MIME_BY_EXT: Record<string, string> = {
  csv: 'text/csv',
  json: 'application/json',
  txt: 'text/plain',
  png: 'image/png',
  pdf: 'application/pdf',
  zip: 'application/zip',
};
/** The bare type (no `;charset=…`: Android matches share targets on the type alone). */
function cleanMime(type: string | undefined, name: string): string {
  const bare = (type ?? '').split(';')[0]!.trim().toLowerCase();
  if (bare) return bare;
  return MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** `data:[type][;base64],payload` → its type and the payload as base64 (percent-escapes are bytes, as in the URL spec). */
export function parseDataUrl(href: string): { mime: string; base64: string } | null {
  const comma = href.indexOf(',');
  if (!/^data:/i.test(href) || comma < 0) return null;
  const meta = href.slice(5, comma);
  const hash = href.indexOf('#', comma);
  const body = href.slice(comma + 1, hash < 0 ? undefined : hash); // a fragment is not part of the data
  const isBase64 = /;\s*base64\s*$/i.test(meta);
  const mime = meta.replace(/;\s*base64\s*$/i, '');
  if (isBase64) return { mime, base64: body.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\s+/g, '') };
  const out: number[] = [];
  const enc = new TextEncoder();
  for (let i = 0; i < body.length; ) {
    if (body[i] === '%' && /^[0-9a-f]{2}$/i.test(body.slice(i + 1, i + 3))) {
      out.push(parseInt(body.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      const ch = String.fromCodePoint(body.codePointAt(i)!);
      out.push(...enc.encode(ch));
      i += ch.length;
    }
  }
  return { mime: mime || 'text/plain', base64: bytesToBase64(Uint8Array.from(out)) };
}

interface Installed {
  uninstall: () => void;
}
let installed: Installed | null = null;

/**
 * On Android, route every `download` link save to the share sheet. Idempotent; returns the uninstall function (tests).
 * Does nothing on the web.
 */
export function installAndroidDownloads(): () => void {
  if (installed) return installed.uninstall;
  if (!onAndroid() || typeof document === 'undefined') return noop;

  // Insertion-ordered and capped: a URL that is never revoked (an image) must not keep its blob here for ever. One
  // that falls out is still read through `fetch` at click time.
  const blobs = new Map<string, Blob>();
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  if (typeof origCreate === 'function') {
    URL.createObjectURL = function createObjectURL(obj: Blob | MediaSource): string {
      const url = origCreate.call(URL, obj);
      if (obj instanceof Blob) {
        blobs.set(url, obj);
        if (blobs.size > MAX_REMEMBERED) blobs.delete(blobs.keys().next().value!);
      }
      return url;
    };
  }
  if (typeof origRevoke === 'function') {
    URL.revokeObjectURL = function revokeObjectURL(url: string): void {
      blobs.delete(url);
      origRevoke.call(URL, url);
    };
  }

  /** Read the anchor's content now (synchronously where it matters) and save it. */
  const save = (a: HTMLAnchorElement): void => {
    const href = a.href;
    const name = fileName(a);
    let content: Promise<{ mime: string; base64: string }>;
    if (/^data:/i.test(href)) {
      const d = parseDataUrl(href);
      if (!d) return;
      content = Promise.resolve({ mime: cleanMime(d.mime, name), base64: d.base64 });
    } else {
      const known = blobs.get(href);
      // a blob URL made before install: fetch resolves it at call time, before any revoke (same page, not the network)
      // eslint-disable-next-line no-restricted-properties -- reads this page's blob: URL, not network access
      const blob = known ? Promise.resolve(known) : globalThis.fetch(href).then((r) => r.blob());
      content = blob.then(async (b) => ({ mime: cleanMime(b.type, name), base64: bytesToBase64(new Uint8Array(await b.arrayBuffer())) }));
    }
    void content
      .then(({ mime, base64 }) => saveFile({ name, mime, dataBase64: base64 }))
      .catch(() => console.warn('Vitals: could not save the file.'));
  };

  const proto = HTMLAnchorElement.prototype;
  const ownClick = Object.prototype.hasOwnProperty.call(proto, 'click'); // `click` normally lives on HTMLElement
  const origClick = proto.click;
  const click = function click(this: HTMLAnchorElement): void {
    if (saveAnchor(this)) return save(this);
    origClick.call(this);
  };
  proto.click = click;

  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    const a = e.target instanceof Element ? e.target.closest('a') : null;
    if (!saveAnchor(a)) return;
    e.preventDefault();
    save(a);
  };
  document.addEventListener('click', onClick, true);

  const uninstall = () => {
    if (installed?.uninstall !== uninstall) return;
    installed = null;
    document.removeEventListener('click', onClick, true);
    if (proto.click === click) {
      if (ownClick) proto.click = origClick;
      else delete (proto as { click?: unknown }).click;
    }
    if (typeof origCreate === 'function') URL.createObjectURL = origCreate;
    if (typeof origRevoke === 'function') URL.revokeObjectURL = origRevoke;
    blobs.clear();
  };
  installed = { uninstall };
  return uninstall;
}
