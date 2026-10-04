import { describe, expect, it } from 'vitest';
import { decimalsForStep, formatDay, formatNumber, formatRange, formatSigned, formatValue, MINUS, percentChange, THIN } from '../lib/format';
import { formatTick } from '../core/draw';

describe('number formatting', () => {
  it('uses a true minus sign and thin-space thousands', () => {
    expect(formatNumber(-0.4, 2)).toBe(`${MINUS}0.40`);
    expect(formatNumber(2540, 0)).toBe(`2${THIN}540`);
    expect(formatNumber(1234567.891, 1)).toBe(`1${THIN}234${THIN}567.9`);
    expect(formatNumber(999, 0)).toBe('999');
  });
  it('supports comma thousands for en-US', () => {
    expect(formatNumber(2540, 0, { thousands: ',' })).toBe('2,540');
  });
  it('does not print negative zero', () => {
    expect(formatNumber(-0.004, 2)).toBe('0.00');
  });
  it('renders NaN as an em dash', () => {
    expect(formatNumber(NaN, 1)).toBe('—');
  });
  it('signs changes, with ± for zero', () => {
    expect(formatSigned(1.23, 1)).toBe('+1.2');
    expect(formatSigned(-4.4, 1)).toBe(`${MINUS}4.4`);
    expect(formatSigned(0.01, 1)).toBe('±0.0');
  });
  it('appends units after a thin space and never prints "index"', () => {
    expect(formatValue(19.8, 1, 'kg')).toBe(`19.8${THIN}kg`);
    expect(formatValue(62, 0, 'index')).toBe('62');
  });
  it('writes ranges with an en dash, or "to" when negative', () => {
    expect(formatRange(18.6, 21, 1)).toBe('18.6–21.0');
    expect(formatRange(21, 18.6, 1)).toBe('18.6–21.0');
    expect(formatRange(-340, -60, 0)).toBe(`${MINUS}340 to ${MINUS}60`);
  });
  it('computes percent change against |start|', () => {
    expect(percentChange(24.1, 19.8)).toBeCloseTo(-17.84, 2);
    expect(percentChange(-100, -50)).toBeCloseTo(50, 6);
    expect(percentChange(0, 5)).toBeNaN();
  });
  it('derives tick decimals from the step', () => {
    expect(decimalsForStep(1)).toBe(0);
    expect(decimalsForStep(0.5)).toBe(1);
    expect(decimalsForStep(0.25)).toBe(1);
    expect(decimalsForStep(0.05)).toBe(2);
  });
  it('compacts thousands only in narrow tick columns', () => {
    expect(formatTick(2000, 1000, 32)).toBe('2k');
    expect(formatTick(-1500, 500, 32)).toBe(`${MINUS}1.5k`);
    expect(formatTick(2000, 1000, 44)).toBe(`2${THIN}000`);
  });
});

describe('dates', () => {
  it('labels days from an ISO start date (UTC, DST-safe)', () => {
    const time = { startDate: '2026-10-05' };
    expect(formatDay(time, 0)).toBe('Mon 5 Oct');
    expect(formatDay(time, 45, 'short')).toBe('19 Nov');
    expect(formatDay(time, 27.9)).toBe('Sun 1 Nov');
  });
  it('falls back to day numbers without a start date', () => {
    expect(formatDay({}, 45)).toBe('day 46');
  });
});
