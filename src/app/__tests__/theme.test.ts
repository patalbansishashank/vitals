import { act } from '@testing-library/react';
import { applyMotion, applyTheme, initTheme, resolveTheme, toggleTheme } from '@/app/theme';
import { useSettingsStore } from '@/state/settingsStore';

const root = () => document.documentElement;

describe('theme switching', () => {
  afterEach(() => {
    root().removeAttribute('data-theme');
    root().removeAttribute('data-motion');
  });

  it('writes data-theme for forced themes and removes it for system', () => {
    applyTheme('dark');
    expect(root()).toHaveAttribute('data-theme', 'dark');
    applyTheme('light');
    expect(root()).toHaveAttribute('data-theme', 'light');
    applyTheme('system');
    expect(root()).not.toHaveAttribute('data-theme');
  });

  it('resolves system to light where the OS preference is unknown', () => {
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('maps reduce-motion choices to data-motion', () => {
    applyMotion('on');
    expect(root()).toHaveAttribute('data-motion', 'reduce');
    applyMotion('off');
    expect(root()).toHaveAttribute('data-motion', 'full');
    applyMotion('system');
    expect(root()).not.toHaveAttribute('data-motion');
  });

  it('follows the settings store after initTheme, and the toggle flips the visible theme', () => {
    const stop = initTheme();
    act(() => useSettingsStore.getState().setTheme('dark'));
    expect(root()).toHaveAttribute('data-theme', 'dark');
    act(() => toggleTheme());
    expect(useSettingsStore.getState().theme).toBe('light');
    expect(root()).toHaveAttribute('data-theme', 'light');
    act(() => useSettingsStore.getState().set({ reduceMotion: 'on' }));
    expect(root()).toHaveAttribute('data-motion', 'reduce');
    act(() => useSettingsStore.getState().set({ theme: 'system', reduceMotion: 'system' }));
    expect(root()).not.toHaveAttribute('data-theme');
    stop();
  });
});
