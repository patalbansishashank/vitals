/** (social-time) The pure social-time model: minutes, the band placement and words, the provisional merge and app rows. */
import { describe, expect, it } from 'vitest';
import type { GaugeSocialTimeDay } from '../types';
import type { EngineSocial } from '../social/socialEngine';
import {
  displaySocialDay,
  isProvisional,
  socialAppRows,
  socialBands,
  socialMinutes,
  socialPlacement,
  socialScaleMax,
  socialWord,
} from '../social/socialModel';

const WORDS = { within: 'Within your budget', nearing: 'Near your budget', over: 'Over your budget' };

const day = (over: Partial<GaugeSocialTimeDay> = {}): GaugeSocialTimeDay => ({
  date: '2026-11-16',
  totalSeconds: 1800,
  perApp: { instagram: 1200, youtube: 600 },
  targetMinMinutes: 30,
  targetMaxMinutes: 45,
  ...over,
});

const engine = (over: Partial<EngineSocial> = {}): EngineSocial => ({
  usageAccess: true,
  today: { date: '2026-11-16', totalSeconds: 600, perApp: { reddit: 600 } },
  targetMinMinutes: 30,
  targetMaxMinutes: 45,
  enabledApps: ['instagram', 'youtube'],
  ...over,
});

describe('socialModel', () => {
  it('rounds seconds to whole minutes', () => {
    expect(socialMinutes(0)).toBe(0);
    expect(socialMinutes(29)).toBe(0);
    expect(socialMinutes(1980)).toBe(33);
  });

  it('places the day calm at or below the low edge, warming to the high edge, over past it', () => {
    expect(socialPlacement(20, 30, 45)).toBe('within');
    expect(socialPlacement(30, 30, 45)).toBe('within');
    expect(socialPlacement(40, 30, 45)).toBe('nearing');
    expect(socialPlacement(45, 30, 45)).toBe('nearing');
    expect(socialPlacement(60, 30, 45)).toBe('over');
    expect(socialWord(60, 30, 45, WORDS)).toBe('Over your budget');
  });

  it('bands name within/near/over, and the scale leaves headroom above the target', () => {
    const bands = socialBands(30, 45, WORDS);
    expect(bands.map((b) => b.word)).toEqual(['Within your budget', 'Near your budget', 'Over your budget']);
    expect(socialScaleMax(10, 45)).toBe(60);
    expect(socialScaleMax(120, 45)).toBe(120);
  });

  it('prefers the server day, falls back to today’s local total (provisional)', () => {
    expect(displaySocialDay('2026-11-16', day(), engine(), true)).toEqual(day());
    const prov = displaySocialDay('2026-11-16', null, engine(), true);
    expect(prov?.totalSeconds).toBe(600);
    expect(prov?.perApp).toEqual({ reddit: 600 });
    expect(isProvisional(null, true, engine())).toBe(true);
    expect(isProvisional(day(), true, engine())).toBe(false);
    // not today, no server day: nothing
    expect(displaySocialDay('2026-11-15', null, engine(), false)).toBeNull();
  });

  it('splits by app, most time first, labelled, with shares summing to the day', () => {
    const rows = socialAppRows(day({ perApp: { youtube: 600, instagram: 1200 } }));
    expect(rows.map((r) => r.label)).toEqual(['Instagram', 'YouTube']);
    expect(rows[0]!.valueText).toBe('20 min');
    expect(Math.round(rows.reduce((a, r) => a + r.share, 0) * 100) / 100).toBe(1);
  });
});
