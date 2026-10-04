import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Toaster } from '@/components';
import { POLICY_STREAMS } from '@/biometrics/core/policy';
import type { DeviceType, StreamPolicy } from '@/biometrics/core/types';
import type { CommandResult } from '@/commands/types';
import { RingServiceProvider, type RingSharing } from '../data';
import { createFakeRingService, createFakeSharing, scenarioPlatform } from '../fixtures';
import { Sharing } from '../Sharing';
import { createRingSharing, isRingSource, ringSharingState, type RingSourceLike } from '../sharingPolicy';

function setup(sharing: RingSharing) {
  return render(
    <MemoryRouter>
      <RingServiceProvider service={createFakeRingService('connected')} platform={scenarioPlatform('connected')} sharing={sharing}>
        <Sharing />
      </RingServiceProvider>
      <Toaster />
    </MemoryRouter>,
  );
}

const LINE = 'Your ring data is used for your plan and scores, and the Coach and your AI tools can see it. Turn it off here or per signal in Settings › Devices.';

describe('Sharing (the master switch)', () => {
  it('on: the switch is on, the plain line under it', () => {
    setup(createFakeSharing('on'));
    expect(screen.getByRole('heading', { name: 'Sharing' })).toBeTruthy();
    const sw = screen.getByRole('switch', { name: 'Use my ring data in my plan and Coach' });
    expect((sw as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(LINE)).toBeTruthy();
    expect(sw.getAttribute('aria-describedby')).toBe(screen.getByText(LINE).id);
  });

  it('off, and toggling calls set with the undo toast', async () => {
    const fake = createFakeSharing('off');
    setup(fake);
    const sw = screen.getByRole('switch') as HTMLInputElement;
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    await waitFor(() => expect(fake.calls).toEqual([true]));
    await waitFor(() => expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true));
    expect(await screen.findByText('Your ring data is shared with your plan and Coach.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(fake.calls).toEqual([true, false]));
    await waitFor(() => expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false));
  });

  it('some: a mixed switch, "Some of it is shared." and the link to Settings › Devices; on turns everything on', async () => {
    const fake = createFakeSharing('some');
    setup(fake);
    const sw = screen.getByRole('switch') as HTMLInputElement;
    expect(sw.checked).toBe(false);
    expect(sw.closest('.lm-switch')!.classList.contains('rs-mixed')).toBe(true);
    expect(screen.getByText('Some of it is shared.', { exact: false })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose in Settings › Devices' }).getAttribute('href')).toBe('/settings#devices');
    expect(screen.queryByText(LINE)).toBeNull();
    fireEvent.click(sw);
    await waitFor(() => expect(fake.calls).toEqual([true]));
    // a mixed state cannot be restored with on/off: no Undo is offered by a sharing without its own undo
    expect(await screen.findByText('Your ring data is shared with your plan and Coach.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('the one-time notice shows above the switch until OK', async () => {
    const fake = createFakeSharing('on', true);
    setup(fake);
    expect(screen.getByText('Your ring data is now shared with your plan and Coach. You can turn that off here.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByText(/is now shared/)).toBeNull());
    expect(fake.noticePending()).toBe(false);
  });

  it('never shows a forbidden word', () => {
    setup(createFakeSharing('some', true));
    expect(document.body.textContent ?? '').not.toMatch(/password|passcode|credential|\bPIN\b|MQTT|\blease\b|GATT|handshake|\bbond\b/i);
  });
});

/* ------------------------------------------------------------------------------------------------ the store default */

const on = (stream: StreamPolicy['stream']): StreamPolicy => ({ stream, imported: true, scores: true, engine: true, coach: 'daily+series' });
const off = (stream: StreamPolicy['stream']): StreamPolicy => ({ stream, imported: true, scores: false, engine: false, coach: 'hidden' });

describe('ring sources and the switch state', () => {
  it('a ring source: device type ring, a ble: channel, or the Lumen source', () => {
    expect(isRingSource({ sourceKey: 'ble:jstyle2301|j-style:2301#c3d94f2a' })).toBe(true);
    expect(isRingSource({ sourceKey: 'file:lumen_cloudevents|j-style:2301' })).toBe(true);
    expect(isRingSource({ sourceKey: 'file:lumen_cloudevents' })).toBe(true);
    expect(isRingSource({ sourceKey: 'file:apple_health|app:health', deviceType: 'ring' })).toBe(true);
    expect(isRingSource({ sourceKey: 'file:apple_health|app:health' }, 'ring')).toBe(true);
    expect(isRingSource({ sourceKey: 'file:apple_health|app:health' }, 'watch')).toBe(false);
    expect(isRingSource({ sourceKey: 'manual' })).toBe(false);
  });

  it('on / off / some / none', () => {
    const src = (policies: StreamPolicy[]): RingSourceLike => ({ sourceKey: 'ble:x|j-style:2301#1', policies });
    expect(ringSharingState([], [])).toBeNull();
    // vendor scores never feed scores or the plan, so "on" for them is Coach-visible only
    expect(ringSharingState([src([on('hr'), on('sleep_sessions'), on('spo2'), on('vendor_scores')])], [])).toBe('on');
    expect(ringSharingState([src([off('hr'), off('sleep_sessions'), { ...off('steps'), imported: false }])], [])).toBe('off');
    expect(ringSharingState([src([on('hr'), off('sleep_sessions')])], [])).toBe('some');
    // the device-on suggestion (Coach hidden) is neither
    expect(ringSharingState([src([{ stream: 'hr', imported: true, scores: true, engine: true, coach: 'hidden' }])], [])).toBe('some');
    // a source with no stored entries reads every stream's effective policy (the person's choices)
    expect(ringSharingState([src([])], POLICY_STREAMS.map(off))).toBe('off');
  });
});

describe('createRingSharing', () => {
  function deps(results: Record<string, (input: unknown) => CommandResult>) {
    const sources: Array<RingSourceLike & { deviceType?: DeviceType }> = [
      { sourceKey: 'ble:jstyle2301|j-style:2301#c3d94f2a', policies: [on('hr'), off('sleep_sessions')] },
      { sourceKey: 'file:lumen_cloudevents|j-style:2301', policies: [off('hr')] },
      { sourceKey: 'file:apple_health|app:health', policies: [off('steps')] },
    ];
    const sent: Array<{ id: string; input: unknown }> = [];
    let n = 0;
    const ok = (): CommandResult => ({ ok: true, output: null, notices: [], changeSet: { id: `cs${++n}`, commandId: 'x', label: 'x', at: '', actor: { kind: 'user', id: 'me' }, docs: [] } as never });
    return {
      sent,
      deps: {
        index: () => ({ sources: () => sources, personPolicies: [], deviceTypes: new Map<string, DeviceType>(), subscribe: () => () => {} }),
        send: async (id: string, input: unknown) => {
          sent.push({ id, input });
          return (results[id] ?? ok)(input);
        },
      },
    };
  }

  it('reads the state over ring sources only', () => {
    const { deps: d } = deps({});
    expect(createRingSharing(d).state()).toBe('some');
  });

  it('sends bio.setRingSharing and undoes its change set', async () => {
    const { deps: d, sent } = deps({});
    const s = createRingSharing(d);
    await s.set(false);
    expect(sent).toEqual([{ id: 'bio.setRingSharing', input: { on: false } }]);
    await s.undo();
    expect(sent[1]).toEqual({ id: 'history.undo', input: { changeSetId: 'cs1' } });
  });

  it('falls back to bio.setPolicy per ring source and stream while the command is unknown', async () => {
    const { deps: d, sent } = deps({ 'bio.setRingSharing': () => ({ ok: false, error: { code: 'not_found', message: 'Unknown command "bio.setRingSharing".' } }) });
    const s = createRingSharing(d);
    await act(() => s.set(false));
    // only streams not already withheld change; imported stays (not in the patch); the non-ring source is untouched
    expect(sent.slice(1)).toEqual([
      { id: 'bio.setPolicy', input: { stream: 'hr', sourceKey: 'ble:jstyle2301|j-style:2301#c3d94f2a', policy: { scores: false, engine: false, coach: 'hidden' } } },
    ]);
    sent.length = 0;
    await s.set(true);
    expect(sent.slice(1).map((x) => (x.input as { stream: string; sourceKey: string }).sourceKey + ' ' + (x.input as { stream: string }).stream)).toEqual([
      'ble:jstyle2301|j-style:2301#c3d94f2a sleep_sessions',
      'file:lumen_cloudevents|j-style:2301 hr',
    ]);
    expect((sent[1]!.input as { policy: unknown }).policy).toEqual({ imported: true, scores: true, engine: true, coach: 'daily+series' });
    await s.undo();
    expect(sent.slice(3)).toEqual([
      { id: 'history.undo', input: { changeSetId: 'cs3' } },
      { id: 'history.undo', input: { changeSetId: 'cs2' } },
    ]);
  });

  it('a refusal is reported, not swallowed', async () => {
    const { deps: d } = deps({ 'bio.setRingSharing': () => ({ ok: false, error: { code: 'safety_blocked', message: 'Not now.' } }) });
    await expect(createRingSharing(d).set(true)).rejects.toThrow('Not now.');
  });

  it('the migration notice waits for the ring service', () => {
    const { deps: d } = deps({});
    expect(createRingSharing(d).noticePending()).toBe(false);
  });
});
