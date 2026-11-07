/** (r070) The move card's step logic: which step, from the engine's state alone. */
import { describe, expect, it } from 'vitest';
import { movePlan } from '../moveSteps';
import { baseState } from './fakeEngine';

const passive = (pending: number | null, installed = true) =>
  baseState({ mode: 'passive', gauge: { installed, pendingUploads: pending } });

describe('move steps', () => {
  it('shows nothing without the engine or before its first answer', () => {
    expect(movePlan(null, true).show).toBe(false);
    expect(
      movePlan(baseState({ mode: 'passive', gauge: { installed: true, pendingUploads: 0 } }), false).show,
    ).toBe(false);
  });

  it('step 1 while Gauge is installed: waits for its queue, then allows the uninstall', () => {
    const waiting = movePlan(passive(12));
    expect(waiting.step).toBe('uninstall');
    expect(waiting.uninstall).toEqual({ waiting: 12, ready: false });
    expect(movePlan(passive(1)).uninstall.ready).toBe(false);
    const done = movePlan(passive(0));
    expect(done.step).toBe('uninstall');
    expect(done.uninstall).toEqual({ waiting: 0, ready: true });
    // Gauge has not said what it holds: not safe to assume it is empty
    expect(movePlan(passive(null)).uninstall).toEqual({ waiting: null, ready: false });
    expect(done.steps.map((s) => s.state)).toEqual(['current', 'todo', 'todo']);
    expect(done.moving).toBe(true);
  });

  it('step 2 once Gauge is gone and the engine has not taken over (needsTakeover, or passive with no Gauge)', () => {
    for (const mode of ['needsTakeover', 'passive'] as const) {
      const p = movePlan(baseState({ mode, gauge: { installed: false, pendingUploads: null } }));
      expect(p.step).toBe('takeOver');
      expect(p.steps.map((s) => s.state)).toEqual(['done', 'current', 'todo']);
    }
    // needsTakeover with Gauge still installed is still step 1: Gauge must go first
    expect(
      movePlan(baseState({ mode: 'needsTakeover', gauge: { installed: true, pendingUploads: 0 } })).step,
    ).toBe('uninstall');
  });

  it('step 3 after the take-over, for as long as something the ring needs is missing', () => {
    const s = baseState({
      permissions: {
        ...baseState().permissions,
        bluetooth: 'denied',
        healthConnect: 'partial',
        batteryUnrestricted: false,
      },
    });
    const p = movePlan(s);
    expect(p.show).toBe(true);
    expect(p.step).toBe('permissions');
    expect(p.moving).toBe(false);
    expect(p.steps.map((x) => x.state)).toEqual(['done', 'done', 'current']);
    expect(p.items.map((i) => [i.key, i.ok])).toEqual([
      ['bluetooth', false],
      ['healthConnect', false],
      ['activityRecognition', true],
      ['notifications', true],
      ['shortVideoAccessibility', true],
      ['batteryUnrestricted', false],
    ]);
  });

  it('is gone when everything is done', () => {
    expect(movePlan(baseState()).show).toBe(false);
  });

  it('the short-video accessibility row is optional until the limit is on', () => {
    const off = baseState({
      shortVideo: { enabled: false, dailyLimit: null, today: { instagram: 0, youtube: 0 } },
      permissions: { ...baseState().permissions, shortVideoAccessibility: false },
    });
    expect(movePlan(off).show).toBe(false);
    const on = baseState({ permissions: { ...baseState().permissions, shortVideoAccessibility: false } });
    const p = movePlan(on);
    expect(p.show).toBe(true);
    expect(p.items.find((i) => i.key === 'shortVideoAccessibility')).toMatchObject({
      ok: false,
      optional: false,
    });
    // while moving it is listed and marked optional, but never blocks the take-over step
    const moving = movePlan({ ...off, mode: 'passive', gauge: { installed: true, pendingUploads: 0 } });
    expect(moving.items.find((i) => i.key === 'shortVideoAccessibility')?.optional).toBe(true);
  });
});
