import { describe, expect, it } from 'vitest';
import { chronotype, circularMeanH, computeSri, isFreeWakeDate, type Epoch, sleepDebtStep, sleepDefs } from '../sleep';
import { addDays } from '../util';
import { at, dates, mkDay, mkInput, mkSleep, rng } from '../__fixtures__/physio';

const def = (id: string) => sleepDefs.find((d) => d.scoreId === id)!;
const D = '2026-09-20';

describe('night metrics', () => {
  const staged = mkSleep(D, {
    stages: [
      { start: at(addDays(D, -1), '23:00'), end: at(addDays(D, -1), '23:20'), stage: 'awake' },
      { start: at(addDays(D, -1), '23:20'), end: at(D, '02:00'), stage: 'light' },
      { start: at(D, '02:00'), end: at(D, '02:30'), stage: 'awake' },
      { start: at(D, '02:30'), end: at(D, '06:50'), stage: 'deep' },
      { start: at(D, '06:50'), end: at(D, '07:00'), stage: 'awake' },
    ],
  });
  const inp = mkInput(D, { days: [mkDay(D, staged)] });

  it('TST, SE_spt and WASO from stages (worked)', () => {
    expect(def('sleep.tst').compute(inp).value).toBe(160 + 260);
    expect(def('sleep.se_spt').compute(inp).value).toBeCloseTo(420 / 480, 12);
    expect(def('sleep.waso').compute(inp).value).toBe(30);
    expect(def('sleep.tst').compute(inp).band).toEqual({ lo: 390, hi: 450, level: 0.95 });
  });

  it('midpoint = onset + TST/2 in local clock time', () => {
    // onset 23:20, TST 420 min → 02:50
    expect(def('sleep.midpoint').compute(inp).value).toBeCloseTo(2 + 50 / 60, 10);
    const tz = mkInput(D, { days: [mkDay(D, mkSleep(D, { offsetS: 7200, asleepMin: 480 }))] });
    expect(def('sleep.midpoint').compute(tz).value).toBeCloseTo(3, 10);
  });

  it('coverage gate: unknown minutes withhold SE and WASO but not TST', () => {
    const s = mkSleep(D, { asleepMin: 400 }); // no awake info → 83 % named
    const i = mkInput(D, { days: [mkDay(D, s)] });
    expect(def('sleep.se_spt').compute(i).status).toBe('withheld');
    expect(def('sleep.waso').compute(i).status).toBe('withheld');
    expect(def('sleep.tst').compute(i).value).toBe(400);
  });

  it('no session → withheld', () => {
    expect(def('sleep.tst').compute(mkInput(D, { days: [mkDay(D)] })).status).toBe('withheld');
  });
});

describe('social jet lag and MSF_sc', () => {
  it('Roenneberg worked example', () => {
    const c = chronotype(
      [{ mid: 5, tstH: 9 }, { mid: 5, tstH: 9 }, { mid: 5, tstH: 9 }],
      Array(5).fill({ mid: 3, tstH: 7 }),
    );
    expect(c.sjl).toBeCloseTo(2, 10);
    expect(c.msfSc).toBeCloseTo(5 - 0.5 * (9 - (5 * 7 + 2 * 9) / 7), 10);
    expect(circularMeanH([23, 1])).toBeCloseTo(0, 10);
  });

  it('free days default to weekend wake dates; gate ≥3 free + ≥5 work in 14 d', () => {
    expect(isFreeWakeDate('2026-09-19')).toBe(true); // Saturday
    expect(isFreeWakeDate('2026-09-21')).toBe(false);
    const days = dates('2026-09-07', 14).map((d) =>
      mkDay(d, isFreeWakeDate(d) ? mkSleep(d, { start: '01:00', startSameDay: true, end: '10:00', asleepMin: 540, awakeMin: 0 }) : mkSleep(d, { start: '23:30', end: '06:30', asleepMin: 420, awakeMin: 0 })),
    );
    const r = def('sleep.sjl').compute(mkInput('2026-09-20', { days }));
    expect(r.status).toBe('ok');
    expect(r.value).toBeCloseTo(2.5, 10); // 05:30 vs 03:00
    expect(def('sleep.msf_sc').compute(mkInput('2026-09-20', { days })).value).toBeCloseTo(5.5 - 0.5 * (9 - (35 + 18) / 7), 10);
    expect(def('sleep.sjl').compute(mkInput('2026-09-20', { days: days.filter((d) => !isFreeWakeDate(d.localDate) || d.localDate > '2026-09-14') })).status).toBe('withheld');
  });
});

describe('Sleep Regularity Index', () => {
  const day = (onset: number, offset: number): Epoch[] => Array.from({ length: 1440 }, (_, j) => (j >= onset && j < offset ? 1 : 0));

  it('perfectly regular = 100, inverted = −100, random ≈ 0', () => {
    expect(computeSri(Array(7).fill(day(0, 420))).sri).toBe(100);
    expect(computeSri([0, 1, 2, 3, 4, 5, 6].map((i) => (i % 2 ? day(0, 720) : day(720, 1440)))).sri).toBe(-100);
    const r = rng(11);
    const rand = Array.from({ length: 14 }, () => Array.from({ length: 1440 }, () => (r() < 0.5 ? 1 : 0) as Epoch));
    expect(Math.abs(computeSri(rand).sri!)).toBeLessThan(3);
  });

  it('worked: one day shifted by 60 min', () => {
    // 7 days, day 4 sleeps 60 min later: 2 of 6 pairs differ in 120 epochs each.
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => (i === 3 ? day(60, 480) : day(0, 420)));
    expect(computeSri(days).sri).toBeCloseTo(-100 + (200 * (6 * 1440 - 240)) / (6 * 1440), 10);
  });

  it('skips unknown epochs and invalid pairs', () => {
    const half: Epoch[] = day(0, 420).map((x, j) => (j < 720 ? null : x));
    const r = computeSri([day(0, 420), half, day(0, 420), day(0, 420)]);
    expect(r.validPairs).toBe(1);
    expect(r.sri).toBe(100);
  });

  it('score from sleep records: regular schedule = 100; gate ≥5 valid pairs', () => {
    const days = dates('2026-09-06', 15).map((d) => mkDay(d, mkSleep(d)));
    const r = def('sleep.sri').compute(mkInput(D, { days }));
    expect(r.status).toBe('ok');
    expect(r.value).toBe(100);
    expect(r.state).toBe('above_p75');
    expect(def('sleep.sri').compute(mkInput(D, { days: days.slice(-4) })).status).toBe('withheld');
  });
});

describe('sleep.debt (dossier 16 §4.1.1)', () => {
  it('reproduces the dossier worked example for dS (5 h × 7 nights)', () => {
    let s = { dF: 0, dS: 0 };
    const dS: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = sleepDebtStep(s, 5);
      s = { dF: r.dF, dS: r.dS };
      dS.push(Math.round(r.dS * 100) / 100);
    }
    expect(dS).toEqual([0.71, 1.22, 1.58, 1.84, 2.03, 2.16, 2.26]);
    expect(s.dF).toBeCloseTo(2.5 * (1 - Math.exp(-7)), 10);
  });

  it('score: dF > 1.5 h → elevated; need from profile; missing nights hold', () => {
    const days = dates('2026-09-14', 7).map((d) => mkDay(d, mkSleep(d, { start: '01:00', startSameDay: true, end: '06:00' })));
    const r = def('sleep.debt').compute(mkInput(D, { days }));
    expect(r.state).toBe('elevated');
    expect(r.value).toBeCloseTo(2.5 * (1 - Math.exp(-7)), 10);
    const r8 = def('sleep.debt').compute(mkInput(D, { days, profile: { sleepNeedH: 8 } }));
    expect(r8.value).toBeCloseTo(3 * (1 - Math.exp(-7)), 10);
    const gap = def('sleep.debt').compute(mkInput(D, { days: days.filter((_, i) => i !== 3) }));
    expect(gap.detail?.missing_nights).toBe(1);
    expect(def('sleep.debt').compute(mkInput(D, { days: [] })).status).toBe('withheld');
    const ok = def('sleep.debt').compute(mkInput(D, { days: dates('2026-09-14', 7).map((d) => mkDay(d, mkSleep(d))) }));
    expect(ok.value).toBe(0);
    expect(ok.state).toBe('ok');
  });

  it('is deterministic', () => {
    const i = () => mkInput(D, { days: dates('2026-09-06', 15).map((d) => mkDay(d, mkSleep(d))) });
    for (const d of sleepDefs) expect(d.compute(i())).toEqual(d.compute(i()));
  });
});
