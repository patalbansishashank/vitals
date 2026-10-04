import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAndroidDownloads, parseDataUrl } from '../androidDownloads';
import { resetAndroidShellForTests } from '../androidShell';
import { flush, installFakeCapacitor, removeFakeCapacitor } from './androidFake';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

// jsdom has no blob URLs: a store that behaves like the browser's (revoke forgets the blob)
const store = new Map<string, Blob>();
let seq = 0;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const nativeClick = HTMLAnchorElement.prototype.click;

let uninstall: () => void = () => {};
beforeEach(() => {
  resetAndroidShellForTests();
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const url = `blob:${location.origin}/${++seq}`;
    store.set(url, obj as Blob);
    return url;
  };
  URL.revokeObjectURL = (url: string) => void store.delete(url);
});
afterEach(() => {
  uninstall();
  uninstall = () => {};
  removeFakeCapacitor();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  store.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** The exports' pattern (DataTable.downloadText, prescription.downloadFile, DataSection): click, remove, revoke. */
function saveLikeTheApp(text: string, name: string, type: string, attach: boolean) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  if (attach) document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url); // right after the click
}

describe('installAndroidDownloads on Android', () => {
  it('saves a detached blob link through saveFile once, even when revoked right after the click', async () => {
    const fake = installFakeCapacitor();
    uninstall = installAndroidDownloads();
    saveLikeTheApp('date,kg\n2026-10-01,82.4\n', 'vitals-projection.csv', 'text/csv;charset=utf-8', false);
    await vi.waitFor(() => expect(fake.plugin.saveFile).toHaveBeenCalledTimes(1));
    await flush();
    expect(fake.plugin.saveFile).toHaveBeenCalledTimes(1);
    expect(fake.plugin.saveFile).toHaveBeenCalledWith({
      name: 'vitals-projection.csv',
      mime: 'text/csv',
      dataBase64: b64('date,kg\n2026-10-01,82.4\n'),
    });
  });

  it('saves an attached blob link and keeps the bytes of a binary file', async () => {
    const fake = installFakeCapacitor();
    uninstall = installAndroidDownloads();
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chart.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    await vi.waitFor(() => expect(fake.plugin.saveFile).toHaveBeenCalledTimes(1));
    expect(fake.plugin.saveFile).toHaveBeenCalledWith({ name: 'chart.png', mime: 'image/png', dataBase64: Buffer.from(bytes).toString('base64') });
  });

  it('saves data: links (percent-encoded and base64)', async () => {
    const fake = installFakeCapacitor();
    uninstall = installAndroidDownloads();
    const a = document.createElement('a');
    a.href = 'data:text/plain;charset=utf-8,Gr%C3%BC%C3%9Fe%20100%25';
    a.download = 'note.txt';
    a.click();
    const c = document.createElement('a');
    c.href = `data:application/json;base64,${b64('{"a":1}')}`;
    c.setAttribute('download', '');
    c.click();
    await vi.waitFor(() => expect(fake.plugin.saveFile).toHaveBeenCalledTimes(2));
    expect(fake.plugin.saveFile.mock.calls.map((c) => c[0])).toEqual([
      { name: 'note.txt', mime: 'text/plain', dataBase64: b64('Grüße 100%') },
      { name: 'vitals-export', mime: 'application/json', dataBase64: b64('{"a":1}') },
    ]);
  });

  it('catches a tap on a download link in the page and prevents the default', async () => {
    const fake = installFakeCapacitor();
    uninstall = installAndroidDownloads();
    const url = URL.createObjectURL(new Blob(['{}'], { type: 'application/json' }));
    document.body.innerHTML = `<a id="x" download="vitals-2026-10-04.json" href="${url}"><span>Export</span></a>`;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('span')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(fake.plugin.saveFile).toHaveBeenCalledTimes(1));
    expect(fake.plugin.saveFile).toHaveBeenCalledWith({ name: 'vitals-2026-10-04.json', mime: 'application/json', dataBase64: b64('{}') });
  });

  it('leaves other links alone', async () => {
    const fake = installFakeCapacitor();
    uninstall = installAndroidDownloads();
    const a = document.createElement('a');
    a.href = '#settings';
    const clicked = vi.fn();
    a.addEventListener('click', clicked);
    document.body.appendChild(a);
    a.click();
    const plain = document.createElement('a');
    plain.href = URL.createObjectURL(new Blob(['x']));
    plain.addEventListener('click', (e) => {
      clicked();
      e.preventDefault(); // jsdom would try to navigate
    });
    plain.click(); // a blob link without `download` is a navigation, not a save
    await flush();
    expect(clicked).toHaveBeenCalledTimes(2);
    expect(fake.plugin.saveFile).not.toHaveBeenCalled();
  });

  it('is idempotent and uninstalls cleanly', async () => {
    const fake = installFakeCapacitor();
    const first = installAndroidDownloads();
    const patched = HTMLAnchorElement.prototype.click;
    expect(installAndroidDownloads()).toBe(first);
    expect(HTMLAnchorElement.prototype.click).toBe(patched);
    saveLikeTheApp('a', 'a.txt', 'text/plain', true);
    await vi.waitFor(() => expect(fake.plugin.saveFile).toHaveBeenCalledTimes(1));
    first();
    expect(HTMLAnchorElement.prototype.click).toBe(nativeClick);
    expect(URL.createObjectURL).not.toBe(patched);
    expect(store.size).toBe(0);
  });

  it('warns without the content when the save fails', async () => {
    const fake = installFakeCapacitor();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.plugin.saveFile.mockRejectedValue(new Error('no space'));
    uninstall = installAndroidDownloads();
    saveLikeTheApp('secret-ish weight 82.4', 'w.csv', 'text/csv', false);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(String(warn.mock.calls[0]![0])).not.toMatch(/82\.4|w\.csv/);
  });
});

describe('installAndroidDownloads: edge cases', () => {
  it('saves a tap that also calls click() on the same link once (the page handler and the capture listener)', async () => {
    const fake = installFakeCapacitor();
    uninstall = installAndroidDownloads();
    const url = URL.createObjectURL(new Blob(['x'], { type: 'text/plain' }));
    document.body.innerHTML = `<a id="x" download="x.txt" href="${url}">x</a>`;
    const a = document.getElementById('x') as HTMLAnchorElement;
    const bubbled = vi.fn();
    document.addEventListener('click', bubbled);
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    a.click(); // does not dispatch an event: still one save per call, never two for one
    await vi.waitFor(() => expect(fake.plugin.saveFile).toHaveBeenCalledTimes(2));
    await flush();
    expect(fake.plugin.saveFile).toHaveBeenCalledTimes(2);
    expect(bubbled).toHaveBeenCalledTimes(1);
    document.removeEventListener('click', bubbled);
  });

  it('leaves a data: link without a download attribute alone', async () => {
    const fake = installFakeCapacitor();
    uninstall = installAndroidDownloads();
    document.body.innerHTML = '<a id="d" href="data:text/plain,hi">d</a>';
    let preventedByUs = true;
    const after = (e: Event) => {
      preventedByUs = e.defaultPrevented;
      e.preventDefault(); // jsdom would try to navigate
    };
    document.addEventListener('click', after, true); // runs after the install's capture listener
    document.getElementById('d')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.removeEventListener('click', after, true);
    expect(preventedByUs).toBe(false);
    await flush();
    expect(fake.plugin.saveFile).not.toHaveBeenCalled();
  });

  it('encodes a large blob without overflowing the stack', async () => {
    const fake = installFakeCapacitor();
    uninstall = installAndroidDownloads();
    const bytes = new Uint8Array(3 * 1024 * 1024 + 5);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'big.zip';
    a.click();
    await vi.waitFor(() => expect(fake.plugin.saveFile).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(fake.plugin.saveFile.mock.calls[0]![0].dataBase64).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('does not keep the blob behind every URL for ever', async () => {
    const fake = installFakeCapacitor();
    uninstall = installAndroidDownloads();
    const first = URL.createObjectURL(new Blob(['first']));
    for (let i = 0; i < 40; i++) URL.createObjectURL(new Blob([String(i)]));
    const last = URL.createObjectURL(new Blob(['last']));
    fake.fetchMock.mockImplementation(async (url: string) => ({ blob: async () => store.get(url)! }) as never);
    for (const [href, name] of [[first, 'first.txt'], [last, 'last.txt']] as const) {
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      a.click();
    }
    await vi.waitFor(() => expect(fake.plugin.saveFile).toHaveBeenCalledTimes(2));
    expect(fake.plugin.saveFile.mock.calls.map((c) => c[0].dataBase64).sort()).toEqual([b64('first'), b64('last')].sort());
    // the old one came through fetch (it fell out of the memory), the new one from the remembered blob
    expect(fake.fetchMock.mock.calls.map((c) => c[0])).toEqual([first]);
  });

  it('leaves no own click property on the anchor prototype after uninstall', () => {
    installFakeCapacitor();
    const had = Object.prototype.hasOwnProperty.call(HTMLAnchorElement.prototype, 'click');
    const off = installAndroidDownloads();
    expect(Object.prototype.hasOwnProperty.call(HTMLAnchorElement.prototype, 'click')).toBe(true);
    off();
    expect(Object.prototype.hasOwnProperty.call(HTMLAnchorElement.prototype, 'click')).toBe(had);
  });
});

describe('installAndroidDownloads on the web', () => {
  it('does nothing without the Android bridge', () => {
    const create = URL.createObjectURL;
    uninstall = installAndroidDownloads();
    expect(HTMLAnchorElement.prototype.click).toBe(nativeClick);
    expect(URL.createObjectURL).toBe(create);
  });

  it('does nothing when Capacitor is not Android', async () => {
    const fake = installFakeCapacitor({ platform: 'web' });
    uninstall = installAndroidDownloads();
    expect(HTMLAnchorElement.prototype.click).toBe(nativeClick);
    const a = document.createElement('a');
    a.href = 'data:text/plain,x';
    a.download = 'x.txt';
    a.addEventListener('click', (e) => e.preventDefault());
    a.click();
    await flush();
    expect(fake.plugin.saveFile).not.toHaveBeenCalled();
  });
});

describe('parseDataUrl', () => {
  it('reads the type and the payload', () => {
    expect(parseDataUrl('data:,hi')).toEqual({ mime: 'text/plain', base64: b64('hi') });
    expect(parseDataUrl('data:image/png;base64,iVBO%3D')).toEqual({ mime: 'image/png', base64: 'iVBO=' });
    expect(parseDataUrl('data:text/csv,%FF')).toEqual({ mime: 'text/csv', base64: '/w==' });
    expect(parseDataUrl('blob:x')).toBeNull();
    expect(parseDataUrl('data:text/plain,a%23b#frag')).toEqual({ mime: 'text/plain', base64: b64('a#b') });
    expect(parseDataUrl('data:text/plain;base64,aGk=#frag')).toEqual({ mime: 'text/plain', base64: 'aGk=' });
  });
});
