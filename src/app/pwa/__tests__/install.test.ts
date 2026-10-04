import { vi } from 'vitest';
import {
  detectInstallPlatform,
  getInstallState,
  initialInstallState,
  installReducer,
  requestInstall,
  resetInstall,
  startInstallDetection,
  type BeforeInstallPromptEvent,
  type InstallState,
} from '../install';

const chromium: InstallState = { phase: 'manual', platform: 'chromium', standalone: false };

describe('installReducer', () => {
  it('walks promptable → prompting → installed on an accepted prompt', () => {
    let s = installReducer(chromium, { type: 'prompt-available' });
    expect(s.phase).toBe('promptable');
    s = installReducer(s, { type: 'prompt-requested' });
    expect(s.phase).toBe('prompting');
    s = installReducer(s, { type: 'prompt-accepted' });
    expect(s.phase).toBe('installed');
  });

  it('falls back to instructions (declined) when the dialog is dismissed, and offers the prompt again if the browser re-fires it', () => {
    let s = installReducer(installReducer(chromium, { type: 'prompt-available' }), { type: 'prompt-requested' });
    s = installReducer(s, { type: 'prompt-dismissed' });
    expect(s.phase).toBe('declined');
    expect(installReducer(s, { type: 'prompt-available' }).phase).toBe('promptable');
  });

  it('ignores out-of-order events', () => {
    expect(installReducer(chromium, { type: 'prompt-requested' })).toBe(chromium);
    expect(installReducer(chromium, { type: 'prompt-accepted' })).toBe(chromium);
    expect(installReducer(chromium, { type: 'prompt-dismissed' })).toBe(chromium);
    const installed = installReducer(chromium, { type: 'installed' });
    expect(installReducer(installed, { type: 'prompt-available' })).toBe(installed); // an installed app is never offered itself
  });

  it('tracks the display mode: standalone means installed; leaving it brings the instructions back', () => {
    const inApp = installReducer(chromium, { type: 'display-mode', standalone: true });
    expect(inApp).toMatchObject({ phase: 'installed', standalone: true });
    expect(installReducer(inApp, { type: 'display-mode', standalone: false })).toMatchObject({ phase: 'manual', standalone: false });
    // a window that was never standalone is untouched by a browser-mode report
    expect(installReducer(chromium, { type: 'display-mode', standalone: false })).toBe(chromium);
    // "just installed" (appinstalled) stays installed in a plain tab
    expect(installReducer(chromium, { type: 'installed' })).toMatchObject({ phase: 'installed', standalone: false });
  });

  it('starts installed when launched standalone, otherwise with instructions', () => {
    expect(initialInstallState({ platform: 'safari-ios', standalone: true }).phase).toBe('installed');
    expect(initialInstallState({ platform: 'firefox', standalone: false }).phase).toBe('manual');
  });
});

describe('detectInstallPlatform', () => {
  const ua = {
    chrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    androidChrome: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
    iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15',
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  };

  it('picks the instructions that fit the browser', () => {
    expect(detectInstallPlatform({ userAgent: ua.chrome })).toBe('chromium');
    expect(detectInstallPlatform({ userAgent: ua.edge })).toBe('chromium');
    expect(detectInstallPlatform({ userAgent: ua.androidChrome })).toBe('chromium');
    expect(detectInstallPlatform({ userAgent: ua.firefox })).toBe('firefox');
    expect(detectInstallPlatform({ userAgent: ua.macSafari, maxTouchPoints: 0 })).toBe('safari-mac');
    expect(detectInstallPlatform({ userAgent: 'curl/8' })).toBe('other');
  });

  it('sends every iOS browser, and iPadOS (which reports a Mac), to the Share-sheet steps', () => {
    expect(detectInstallPlatform({ userAgent: ua.iphoneSafari })).toBe('safari-ios');
    expect(detectInstallPlatform({ userAgent: ua.iphoneChrome })).toBe('safari-ios');
    expect(detectInstallPlatform({ userAgent: ua.iphoneFirefox })).toBe('safari-ios');
    expect(detectInstallPlatform({ userAgent: ua.macSafari, maxTouchPoints: 5 })).toBe('safari-ios');
  });
});

/** A Chromium `beforeinstallprompt` event whose dialog resolves with `outcome`. */
function promptEvent(outcome: 'accepted' | 'dismissed') {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent;
  const prompt = vi.fn(() => Promise.resolve());
  Object.assign(e, { prompt, userChoice: Promise.resolve({ outcome }) });
  return { e, prompt };
}

describe('install detection (browser events)', () => {
  let stop: () => void;
  beforeEach(() => {
    resetInstall({ platform: 'chromium', standalone: false });
    stop = startInstallDetection(window);
  });
  afterEach(() => stop());

  it('holds beforeinstallprompt (no mini-infobar) and installs on request', async () => {
    const { e, prompt } = promptEvent('accepted');
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(getInstallState().phase).toBe('promptable');

    const done = requestInstall();
    expect(getInstallState().phase).toBe('prompting');
    await done;
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(getInstallState().phase).toBe('installed');
  });

  it('shows the instructions again after a dismissed dialog, and uses a prompt only once', async () => {
    const first = promptEvent('dismissed');
    window.dispatchEvent(first.e);
    await requestInstall();
    expect(getInstallState().phase).toBe('declined');
    await requestInstall(); // nothing held any more
    expect(first.prompt).toHaveBeenCalledTimes(1);

    const second = promptEvent('accepted');
    window.dispatchEvent(second.e); // the browser offers it again later
    expect(getInstallState().phase).toBe('promptable');
  });

  it('treats a throwing prompt() as a dismissal', async () => {
    const { e } = promptEvent('accepted');
    Object.assign(e, { prompt: () => Promise.reject(new Error('InvalidStateError')) });
    window.dispatchEvent(e);
    await requestInstall();
    expect(getInstallState().phase).toBe('declined');
  });

  it('becomes installed on appinstalled, even without having asked', () => {
    window.dispatchEvent(promptEvent('accepted').e);
    window.dispatchEvent(new Event('appinstalled'));
    expect(getInstallState()).toMatchObject({ phase: 'installed', standalone: false });
  });

  it('is idempotent and stops listening when told to', () => {
    expect(startInstallDetection(window)).toBe(stop);
    stop();
    window.dispatchEvent(promptEvent('accepted').e);
    expect(getInstallState().phase).toBe('manual');
  });
});
