import { act } from '@testing-library/react';
import { applyMotion, applyTheme, initTheme, resolveTheme, THEME_COLOR } from '@/app/theme';
import { useSettingsStore } from '@/state/settingsStore';

const root = () => document.documentElement;
const themeColors = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];

describe('dark-only theme', () => {
  afterEach(() => {
    root().removeAttribute('data-theme');
    root().removeAttribute('data-motion');
    root().style.colorScheme = '';
    themeColors().forEach((m) => m.remove());
    window.history.replaceState(null, '', '/');
  });

  it('pins data-theme="dark" and color-scheme dark whatever the choice', () => {
    for (const choice of ['light', 'dark', 'system'] as const) {
      applyTheme(choice);
      expect(root()).toHaveAttribute('data-theme', 'dark');
      expect(root().style.colorScheme).toBe('dark');
    }
  });

  it('ignores a ?theme=light query', () => {
    window.history.replaceState(null, '', '/?theme=light');
    applyTheme('system');
    expect(root()).toHaveAttribute('data-theme', 'dark');
  });

  it('resolves every choice to dark', () => {
    expect(resolveTheme('system')).toBe('dark');
    expect(resolveTheme('light')).toBe('dark');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('leaves exactly one theme-color meta, #090909, with no media query', () => {
    for (const media of ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']) {
      const m = document.createElement('meta');
      m.name = 'theme-color';
      m.content = '#dde0e3';
      m.media = media;
      document.head.appendChild(m);
    }
    applyTheme();
    expect(themeColors()).toHaveLength(1);
    expect(themeColors()[0]!.content).toBe(THEME_COLOR);
    expect(THEME_COLOR).toBe('#090909');
    expect(themeColors()[0]!.hasAttribute('media')).toBe(false);
  });

  it('maps reduce-motion choices to data-motion', () => {
    applyMotion('on');
    expect(root()).toHaveAttribute('data-motion', 'reduce');
    applyMotion('off');
    expect(root()).toHaveAttribute('data-motion', 'full');
    applyMotion('system');
    expect(root()).not.toHaveAttribute('data-motion');
  });

  it('after initTheme the stored theme changes nothing and the motion setting still applies (there is no toggle)', () => {
    const stop = initTheme();
    expect(root()).toHaveAttribute('data-theme', 'dark');
    act(() => useSettingsStore.getState().setTheme('light'));
    expect(root()).toHaveAttribute('data-theme', 'dark');
    act(() => useSettingsStore.getState().set({ reduceMotion: 'on' }));
    expect(root()).toHaveAttribute('data-motion', 'reduce');
    act(() => useSettingsStore.getState().set({ theme: 'system', reduceMotion: 'system' }));
    expect(root()).toHaveAttribute('data-theme', 'dark');
    expect(root()).not.toHaveAttribute('data-motion');
    stop();
  });
});
