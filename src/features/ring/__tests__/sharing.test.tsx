import { describe, expect, it } from 'vitest';
import { isRingSource as coreIsRingSource, POLICY_STREAMS } from '@/biometrics/core/policy';
import type { DeviceType, StreamPolicy } from '@/biometrics/core/types';
import type { CommandResult } from '@/commands/types';
import { createRingSharing, isRingSource, ringSharingState, type RingSourceLike } from '../sharingPolicy';

/* ------------------------------------------------------------------------------------------------ the store default */

const on = (stream: StreamPolicy['stream']): StreamPolicy => ({ stream, imported: true, scores: true, engine: true, coach: 'daily+series' });
const off = (stream: StreamPolicy['stream']): StreamPolicy => ({ stream, imported: true, scores: false, engine: false, coach: 'hidden' });

describe('ring sources and the switch state', () => {
  it('a ring source: a ble: channel or the Lumen source, the same test as the commands', () => {
    for (const sourceKey of ['ble:jstyle2301|j-style:2301#c3d94f2a', 'ble:jstyle2301/2301/serial:TEST0001', 'file:lumen_cloudevents|j-style:2301', 'file:lumen_cloudevents']) {
      expect(isRingSource({ sourceKey }), sourceKey).toBe(true);
      expect(isRingSource({ sourceKey }), sourceKey).toBe(coreIsRingSource({ sourceKey }));
    }
    // a ring imported through another app's file stays opt-in: the switch never changes it, so the page does not count it
    expect(isRingSource({ sourceKey: 'file:apple_health|app:health', deviceType: 'ring' })).toBe(false);
    expect(isRingSource({ sourceKey: 'file:apple_health|app:health' }, 'ring')).toBe(false);
    expect(isRingSource({ sourceKey: 'file:apple_health|app:health' }, 'watch')).toBe(false);
    expect(isRingSource({ sourceKey: 'manual' })).toBe(false);
  });

  it('a ring source without stored entries reads the ring default, not the device-on suggestion', () => {
    const bare: RingSourceLike = { sourceKey: 'ble:jstyle2301/2301/serial:TEST0001', policies: [] };
    expect(ringSharingState([bare], [])).toBe('on');
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
  function deps(results: Record<string, (input: unknown) => CommandResult>, sourceDocs = new Map<string, unknown>()) {
    const sources: Array<RingSourceLike & { deviceType?: DeviceType }> = [
      { sourceKey: 'ble:jstyle2301|j-style:2301#c3d94f2a', policies: [off('hr'), off('sleep_sessions')] },
      { sourceKey: 'file:lumen_cloudevents|j-style:2301', policies: [off('hr')] },
      // another app's ring import, its records marked as a ring: not counted (it stays opt-in)
      { sourceKey: 'file:apple_health|app:health', policies: [on('steps')], deviceType: 'ring' },
    ];
    const sent: Array<{ id: string; input: unknown }> = [];
    let n = 0;
    const ok = (): CommandResult => ({ ok: true, output: null, notices: [], changeSet: { id: `cs${++n}`, commandId: 'x', label: 'x', at: '', actor: { kind: 'user', id: 'me' }, docs: [] } as never });
    return {
      sent,
      deps: {
        index: () => ({ sources: () => sources, personPolicies: [], deviceTypes: new Map<string, DeviceType>([['file:apple_health|app:health', 'ring']]), sourceDocs, subscribe: () => () => {} }),
        send: async (id: string, input: unknown) => {
          sent.push({ id, input });
          return (results[id] ?? ok)(input);
        },
      },
    };
  }

  it('reads the state over ring sources only (the shared health-app import does not make it "some")', () => {
    const { deps: d } = deps({});
    expect(createRingSharing(d).state()).toBe('off');
  });

  it('sends bio.setRingSharing and undoes its change set', async () => {
    const { deps: d, sent } = deps({});
    const s = createRingSharing(d);
    await s.set(false);
    expect(sent).toEqual([{ id: 'bio.setRingSharing', input: { on: false } }]);
    await s.undo();
    expect(sent[1]).toEqual({ id: 'history.undo', input: { changeSetId: 'cs1' } });
  });

  it('a refusal is reported, not swallowed, and nothing else is sent', async () => {
    const { deps: d, sent } = deps({ 'bio.setRingSharing': () => ({ ok: false, error: { code: 'safety_blocked', message: 'Not now.' } }) });
    const s = createRingSharing(d);
    await expect(s.set(true)).rejects.toThrow('Not now.');
    expect(sent.map((x) => x.id)).toEqual(['bio.setRingSharing']);
    await s.undo();
    expect(sent).toHaveLength(1);
  });

  it('the migration notice: pending while its record says so; OK sends bio.dismissRingDefaultsNotice', () => {
    expect(createRingSharing(deps({}).deps).noticePending()).toBe(false);
    const { deps: d, sent } = deps({}, new Map<string, unknown>([['ringDefaults:me', { kind: 'ringDefaults', notice: 'show' }]]));
    const s = createRingSharing(d);
    expect(s.noticePending()).toBe(true);
    s.dismissNotice();
    expect(sent).toEqual([{ id: 'bio.dismissRingDefaultsNotice', input: {} }]);
  });
});
