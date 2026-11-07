/**
 * r068 B1: "Steps by source" read Ring "No reading" beside "10 621 steps · includes ring steps not placed in time" on a day
 * the ring counted nearly every step. The server now places the ring's minutes (packages/companion
 * `r068StepsByRing.test.ts`); here the panel's side, with the day's real shape: ring minutes all day, a phone counter span
 * (a coarse unit the fusion did not place), the ring's day total 84 above its steps by hour, the headline "at least".
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshState } from '@/commands/__tests__/harness';
import type { GaugeTimeline } from '@/net/gauge';
import { CORRECT_WORDS, StepsCorrections, StepsSourceChart, countedFrom } from '../StepsSourceChart';
import { laneTotal, stepsHours, type StepsHour } from '../model';

vi.mock('@/state/gaugeImport', () => ({ runGaugeImport: vi.fn(async () => ({ ran: false, reason: 'off' })) }));

const DATE = '2026-10-28';
const START = Date.parse(`${DATE}T00:00:00+05:30`);
const N = 1440;
const at = (hh: number, mm = 0) => hh * 60 + mm;
const iso = (i: number) => new Date(START + i * 60_000).toISOString();
const num = (s: string) => new RegExp(s.replace(/ /g, '[,\\s\\u00a0\\u202f]?'));

/** The day: the ring's walk 12:58–13:44 (~100 a minute) and scattered morning minutes; a phone counter span 06:16–08:05 (9). */
function day(): Pick<GaugeTimeline, 'date' | 'start' | 'minutes' | 'steps'> {
  const ring: Array<number | null> = Array(N).fill(null);
  const phone: Array<number | null> = Array(N).fill(null);
  const selected: Array<number | null> = Array(N).fill(null);
  const source: Array<string | null> = Array(N).fill(null);
  const support: Array<'minute' | 'coarse' | null> = Array(N).fill(null);
  for (let i = at(5); i < at(12); i += 7) ring[i] = 12;
  for (let i = at(12, 58); i < at(13, 44); i++) ring[i] = 100;
  for (let i = 0; i < N; i++) if (ring[i] !== null) [selected[i], source[i], support[i]] = [ring[i]!, 'ring', 'minute'];
  for (let i = at(6, 16); i < at(8, 5); i++) if (selected[i] === null) [source[i], support[i]] = ['phone', 'coarse'];
  phone[at(13, 55)] = 20;
  selected[at(13, 55)] = 20;
  source[at(13, 55)] = 'phone';
  support[at(13, 55)] = 'minute';
  return {
    date: DATE, start: iso(0), minutes: N,
    steps: {
      selected, source, ring, phone, support,
      coarse: [
        { start: iso(at(12, 57)), end: iso(at(13, 55)), steps: 4600, lineage: 'ring', source: 'ring:x', support: 'minute', selectionReason: 'preference', placed: true, parts: [] },
        { start: iso(at(6, 16)), end: iso(at(8, 5)), steps: 9, lineage: 'phone', source: 'phone:counter', support: 'counterSpan', selectionReason: 'preference', placed: false, parts: [{ at: iso(at(8, 5)) , steps: 9 }] },
      ],
      ringCoarse: [],
      phoneCoarse: [{ start: iso(at(6, 16)), end: iso(at(8, 5)), steps: 9, support: 'counterSpan' }],
    },
  };
}

describe('r068 B1: steps by hour', () => {
  it('each lane holds its source\'s steps; a coarse count sits whole in the hour it ended; counted adds up to located', () => {
    const t = day();
    const hours = stepsHours(t);
    const ringByHour = laneTotal(hours, 'ring')!;
    expect(ringByHour).toBe(46 * 100 + Math.ceil((at(12) - at(5)) / 7) * 12);
    expect(hours[13]!.ring).toBe(44 * 100);
    // the phone's counter span (9) is in the 08:00 hour of the phone lane and of the counted lane, never spread
    expect(hours[8]).toMatchObject({ phone: 9, selected: 9 + hours[8]!.ring! });
    expect(hours[6]!.phone).toBeNull();
    expect(hours[7]!.selected).toBe(laneTotal([hours[7]!], 'ring'));
    const located = ringByHour + 20 + 9;
    expect(laneTotal(hours, 'selected')).toBe(located);
  });

  it('an older server (no ringCoarse / parts) still reads as before', () => {
    const t = day();
    const old = { ...t, steps: { ...t.steps, coarse: [], ringCoarse: undefined, phoneCoarse: undefined } } as unknown as GaugeTimeline;
    expect(laneTotal(stepsHours(old), 'phone')).toBe(20);
  });
});

describe('r068 B1: the panel', () => {
  beforeEach(() => {
    freshState({ cleared: true });
  });

  it('the ring lane shows its steps; the figures name counted, the ring\'s day total (by hour + with no time) and what the day shows', () => {
    const hours = stepsHours(day());
    const ringByHour = laneTotal(hours, 'ring')!;
    const located = laneTotal(hours, 'selected')!;
    const ringDay = ringByHour + 84;
    const { container } = render(<StepsSourceChart hours={hours} located={located} headline={ringDay} headlinePolicy="atLeast" residual={84} ringDailyTotal={ringDay} quiet={false} />);
    const ringLane = container.querySelector('[data-lane="ring"]')!;
    expect(ringLane.textContent).not.toMatch(/No reading/);
    expect(ringLane.querySelector('.lv-schart__sum')!.textContent).toMatch(num(ringByHour.toLocaleString('en-US').replace(',', ' ')));
    const sums = container.querySelector('.lv-schart__sumlist') as HTMLElement;
    const row = (label: string) => within(sums).getByText(label).closest('div')!;
    expect(row('Counted by hour').textContent).toMatch(num(located.toLocaleString('en-US').replace(',', ' ')));
    expect(row("Ring's day total").textContent).toMatch(/by hour \+ 84 with no time/);
    expect(row('Day shows').textContent).toMatch(num(`at least ${ringDay.toLocaleString('en-US').replace(',', ' ')}`));
    expect(screen.queryByText(/includes ring steps not placed in time/)).toBeNull();
  });

  it('a ring with a day total but no step by hour reads that total, never "No reading", on screen and in words', () => {
    const t = day();
    const none = { ...t, steps: { ...t.steps, ring: Array(N).fill(null) } };
    const { container } = render(<StepsSourceChart hours={stepsHours(none)} located={29} headline={10_705} headlinePolicy="atLeast" residual={10_705} ringDailyTotal={10_705} quiet={false} />);
    const ringLane = container.querySelector('[data-lane="ring"]')!;
    expect(ringLane.textContent).toMatch(num('10 705 · total only'));
    expect(ringLane.textContent).not.toMatch(/No reading/);
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(num('ring 10 705'));
  });

  it('quiet: words only', () => {
    const { container } = render(<StepsSourceChart hours={stepsHours(day())} located={4800} headline={4900} headlinePolicy="atLeast" residual={84} ringDailyTotal={4900} quiet />);
    expect(container.textContent).not.toMatch(/\d/);
  });
});

describe('r068 B1: correct the count', () => {
  beforeEach(() => {
    freshState({ cleared: true });
  });
  const HOUR = 3_600_000;
  const dayStart = Math.floor((Date.now() - 30 * HOUR) / HOUR) * HOUR;
  const hoursFrom = (from: 'ring' | 'phone'): StepsHour[] => Array.from({ length: 24 }, (_, i) => ({ start: dayStart + i * HOUR, ring: 100, phone: 10, selected: from === 'ring' ? 100 : 10, from, disagree: true }));

  it('says what counts now and starts on the other source', () => {
    expect(countedFrom(hoursFrom('ring'))).toBe('ring');
    render(<StepsCorrections hours={hoursFrom('ring')} nowMs={Date.now()} quiet={false} />);
    expect(screen.getByText(/Counted now mostly from the ring; the phone fills gaps\./)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Phone' })).toBeChecked();
  });

  it('a day the phone counted starts on the ring', () => {
    render(<StepsCorrections hours={hoursFrom('phone')} nowMs={Date.now()} quiet={false} />);
    expect(screen.getByText(new RegExp(`Counted now mostly from the phone; the ring fills gaps\\. ${CORRECT_WORDS.help}`))).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Ring' })).toBeChecked();
  });
});

/**
 * r068 walk: the server now counts a walking bout by the phone when the phone clearly out-counted the ring over it (the
 * ring missed minutes): the owner's evening walk 17:53–18:33, phone ~96 a minute, the ring's zeros and a ten-minute hole.
 * The panel reads it by lineage, whatever the reason (`boutCount`): those hours come from the phone, and the day says so.
 */
describe('r068 walk: a phone-counted bout', () => {
  beforeEach(() => {
    freshState({ cleared: true });
  });

  function walkDay(): Pick<GaugeTimeline, 'date' | 'start' | 'minutes' | 'steps'> {
    const ring: Array<number | null> = Array(N).fill(null);
    const phone: Array<number | null> = Array(N).fill(null);
    const selected: Array<number | null> = Array(N).fill(null);
    const source: Array<string | null> = Array(N).fill(null);
    const support: Array<'minute' | 'coarse' | null> = Array(N).fill(null);
    for (let i = at(17, 15); i < at(17, 25); i++) [ring[i], phone[i], selected[i], source[i], support[i]] = [17, 12, 17, 'ring', 'minute'];
    for (let i = at(17, 53); i < at(18, 33); i++) {
      phone[i] = 96;
      ring[i] = i >= at(17, 58) && i < at(18, 8) ? null : i % 3 === 0 ? 0 : 60;
      [selected[i], source[i], support[i]] = [96, 'phone:counter', 'minute'];
    }
    return { date: DATE, start: iso(0), minutes: N, steps: { selected, source, ring, phone, support, coarse: [], ringCoarse: [], phoneCoarse: [] } };
  }

  it('the bout\'s hours come from the phone, the 17:00 hour from both; the panel says both count and offers the phone', () => {
    const hours = stepsHours(walkDay());
    expect(hours[17]).toMatchObject({ from: 'both', selected: 170 + 7 * 96, phone: 120 + 7 * 96 });
    expect(hours[18]).toMatchObject({ from: 'phone', selected: 33 * 96, disagree: true });
    expect(laneTotal(hours, 'selected')).toBe(170 + 40 * 96);
    // a mixed hour counts half to each source: the phone's ~90 % share of the day falls just short of 'phone'
    expect(countedFrom(hours)).toBe('both');
    expect(countedFrom(hours.slice(18))).toBe('phone');
    render(<StepsCorrections hours={hours} nowMs={START + 24 * 3_600_000} quiet={false} />);
    expect(screen.getByText(new RegExp(`Counted now from the ring and the phone\\. ${CORRECT_WORDS.help}`))).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Phone' })).toBeChecked();
  });
});
