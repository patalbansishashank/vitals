/**
 * Unrolled module dispatch for the hourly hooks (docs/MODEL_SPEC.md §0.3 performance). A plain `for` loop over 16
 * different modules makes its call site megamorphic (≈ 10-20 ns per call); here every module index has its own call
 * site, which stays monomorphic for a given module list. GENERATED — keep MAX_UNROLLED ≥ the module count.
 */
import type { AnyEngineModule, MetricFrame, StepClock } from '../types/module';
import type { DayInput, HourInput } from '../types/inputs';
import type { SignalBus } from '../types/signals';

export const MAX_UNROLLED = 20;

type M = readonly AnyEngineModule[];
type O = object[];

export function stepHourAll(n: number, m: M, s: O, k: O, bus: SignalBus, h: HourInput, d: DayInput, c: StepClock): void {
  if (n <= 0) return;
  m[0]!.stepHour(s[0]!, k[0]!, bus, h, d, c);
  if (n <= 1) return;
  m[1]!.stepHour(s[1]!, k[1]!, bus, h, d, c);
  if (n <= 2) return;
  m[2]!.stepHour(s[2]!, k[2]!, bus, h, d, c);
  if (n <= 3) return;
  m[3]!.stepHour(s[3]!, k[3]!, bus, h, d, c);
  if (n <= 4) return;
  m[4]!.stepHour(s[4]!, k[4]!, bus, h, d, c);
  if (n <= 5) return;
  m[5]!.stepHour(s[5]!, k[5]!, bus, h, d, c);
  if (n <= 6) return;
  m[6]!.stepHour(s[6]!, k[6]!, bus, h, d, c);
  if (n <= 7) return;
  m[7]!.stepHour(s[7]!, k[7]!, bus, h, d, c);
  if (n <= 8) return;
  m[8]!.stepHour(s[8]!, k[8]!, bus, h, d, c);
  if (n <= 9) return;
  m[9]!.stepHour(s[9]!, k[9]!, bus, h, d, c);
  if (n <= 10) return;
  m[10]!.stepHour(s[10]!, k[10]!, bus, h, d, c);
  if (n <= 11) return;
  m[11]!.stepHour(s[11]!, k[11]!, bus, h, d, c);
  if (n <= 12) return;
  m[12]!.stepHour(s[12]!, k[12]!, bus, h, d, c);
  if (n <= 13) return;
  m[13]!.stepHour(s[13]!, k[13]!, bus, h, d, c);
  if (n <= 14) return;
  m[14]!.stepHour(s[14]!, k[14]!, bus, h, d, c);
  if (n <= 15) return;
  m[15]!.stepHour(s[15]!, k[15]!, bus, h, d, c);
  if (n <= 16) return;
  m[16]!.stepHour(s[16]!, k[16]!, bus, h, d, c);
  if (n <= 17) return;
  m[17]!.stepHour(s[17]!, k[17]!, bus, h, d, c);
  if (n <= 18) return;
  m[18]!.stepHour(s[18]!, k[18]!, bus, h, d, c);
  if (n <= 19) return;
  m[19]!.stepHour(s[19]!, k[19]!, bus, h, d, c);
}

export function recordHourAll(n: number, m: M, s: O, k: O, bus: SignalBus, out: MetricFrame): void {
  if (n <= 0) return;
  m[0]!.recordHour(s[0]!, k[0]!, bus, out);
  if (n <= 1) return;
  m[1]!.recordHour(s[1]!, k[1]!, bus, out);
  if (n <= 2) return;
  m[2]!.recordHour(s[2]!, k[2]!, bus, out);
  if (n <= 3) return;
  m[3]!.recordHour(s[3]!, k[3]!, bus, out);
  if (n <= 4) return;
  m[4]!.recordHour(s[4]!, k[4]!, bus, out);
  if (n <= 5) return;
  m[5]!.recordHour(s[5]!, k[5]!, bus, out);
  if (n <= 6) return;
  m[6]!.recordHour(s[6]!, k[6]!, bus, out);
  if (n <= 7) return;
  m[7]!.recordHour(s[7]!, k[7]!, bus, out);
  if (n <= 8) return;
  m[8]!.recordHour(s[8]!, k[8]!, bus, out);
  if (n <= 9) return;
  m[9]!.recordHour(s[9]!, k[9]!, bus, out);
  if (n <= 10) return;
  m[10]!.recordHour(s[10]!, k[10]!, bus, out);
  if (n <= 11) return;
  m[11]!.recordHour(s[11]!, k[11]!, bus, out);
  if (n <= 12) return;
  m[12]!.recordHour(s[12]!, k[12]!, bus, out);
  if (n <= 13) return;
  m[13]!.recordHour(s[13]!, k[13]!, bus, out);
  if (n <= 14) return;
  m[14]!.recordHour(s[14]!, k[14]!, bus, out);
  if (n <= 15) return;
  m[15]!.recordHour(s[15]!, k[15]!, bus, out);
  if (n <= 16) return;
  m[16]!.recordHour(s[16]!, k[16]!, bus, out);
  if (n <= 17) return;
  m[17]!.recordHour(s[17]!, k[17]!, bus, out);
  if (n <= 18) return;
  m[18]!.recordHour(s[18]!, k[18]!, bus, out);
  if (n <= 19) return;
  m[19]!.recordHour(s[19]!, k[19]!, bus, out);
}
