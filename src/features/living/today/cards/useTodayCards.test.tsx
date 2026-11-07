import { act, fireEvent, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { freshState } from '@/commands/__tests__/harness';
import { useSettingsStore } from '@/state/settingsStore';
import { useTodayCards } from './useTodayCards';

const definitions = [{ id: 'steps', sizes: ['tile', 'card', 'wide'], defaultSize: 'tile' }] as const;
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

beforeEach(() => freshState({ cleared: true }));

describe('Today card editing session', () => {
  it('guards legacy library and mutation actions outside editing, and Done closes the library', () => {
    const { result } = renderHook(() => useTodayCards(definitions), { wrapper });
    act(() => {
      result.current.open('shown');
      result.current.change([{ id: 'steps', size: 'wide' }]);
      result.current.remove('steps');
      result.current.reset();
    });
    expect(result.current.library).toBeNull();
    expect(useSettingsStore.getState().todayCards).toBeNull();
    act(() => result.current.toggleEditing());
    act(() => result.current.open('add'));
    expect(result.current.library).toBe('add');
    act(() => result.current.toggleEditing());
    expect(result.current.editing).toBe(false);
    expect(result.current.library).toBeNull();
    act(() => result.current.open('shown'));
    expect(result.current.library).toBeNull();
  });

  it('Escape ends editing unless an inner control has consumed it', () => {
    const { result } = renderHook(() => useTodayCards(definitions), { wrapper });
    act(() => result.current.toggleEditing());
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    consumed.preventDefault();
    act(() => document.dispatchEvent(consumed));
    expect(result.current.editing).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(result.current.editing).toBe(false);
    expect(result.current.library).toBeNull();
  });

  it('a read-only preview cannot enter editing or open the library', () => {
    const { result } = renderHook(() => useTodayCards(definitions, false), { wrapper });
    act(() => result.current.toggleEditing());
    act(() => result.current.open('add'));
    expect(result.current.editing).toBe(false);
    expect(result.current.library).toBeNull();
  });
});
