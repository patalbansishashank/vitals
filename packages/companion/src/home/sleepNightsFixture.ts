/**
 * (r071) The owner's own nights as the home server stored them (`sleep/timeline` records of the ring, read-only copies of
 * the live `lumen.db` on 2026-10-30), for the tests of the whole-night rule (`sleepNights.test.ts`). Each night is the
 * ring's records in the order of their start: `at` is where a record starts (the ring stamps it at any second), `received`
 * when the server received it, `stages` its minutes as runs ("W16 L34": 16 awake minutes, then 34 light; D deep, R REM).
 *
 *  - 2026-10-30, 10-19, 10-11 and 10-02: a night the ring recorded in two parts with the person up for 63 to 104 minutes
 *    between them (heart rate 73 to 100 bpm in the break, a few steps counted): the server showed the longer part as the
 *    night and the other as a nap.
 *  - 2026-10-24: a night with a 41 minute hole between records (under the hour): one night all along.
 *  - 2026-10-03: a night and a real afternoon nap, hours apart.
 */

export interface NightPiece {
  at: string;
  received: string;
  stages: string;
}

const STAGE: Record<string, string> = { W: 'awake', L: 'light', D: 'deep', R: 'rem', '?': 'unknown' };

/** A record's runs ("W16 L34 D8") as one stage name per minute. */
export function expandStages(runs: string): string[] {
  return runs.split(' ').flatMap((r) => Array.from({ length: Number(r.slice(1)) }, () => STAGE[r[0]!]!));
}

/** The owner's nights by waking date (Asia/Kolkata). */
export const OWNER_NIGHTS: Record<string, NightPiece[]> = {
  // 2026-10-30: the owner reported it: 22:11-02:04, up for 69 min, 03:13-06:30
  '2026-10-30': [
    { at: '2026-10-29T16:41:01.000Z', received: '2026-10-29T20:04:41.952Z', stages: 'W16 L34 D8 L1 D9 L1 D11 L2 R1 L1 R1 L1 R1 L1 R11 L4 R5 L1 R1 L1 R2 L7' },
    { at: '2026-10-29T18:41:02.000Z', received: '2026-10-29T20:04:41.931Z', stages: 'L7 D1 L1 D20 L16 R13 L1 R4 L1 R12 L1' },
    { at: '2026-10-29T20:08:02.000Z', received: '2026-10-30T01:05:41.717Z', stages: 'W1 L14 W1 L10' },
    { at: '2026-10-29T21:43:00.000Z', received: '2026-10-30T01:05:41.702Z', stages: 'W1 L22 D23 L11 R6 L1 R3 L1 R5 L1 R2 L1 R6 L1 R3 L2' },
    { at: '2026-10-29T23:18:02.000Z', received: '2026-10-30T01:05:41.688Z', stages: 'W1 L18 D20 L2 D5 L30 R11 L1 R4 L1 R5 L1 R1 W1 L1' },
  ],
  // 2026-10-19: a 63 min break at 03:04
  '2026-10-19': [
    { at: '2026-10-18T16:31:35.882Z', received: '2026-10-27T23:18:53.773Z', stages: 'W26 L30 D1' },
    { at: '2026-10-18T17:15:35.882Z', received: '2026-10-27T23:18:53.574Z', stages: 'W3 L20 D15 L1 D5' },
    { at: '2026-10-18T17:46:35.882Z', received: '2026-10-27T23:18:53.561Z', stages: 'W3 L16 D23 L4 W1' },
    { at: '2026-10-18T18:38:35.882Z', received: '2026-10-27T23:18:53.549Z', stages: 'W8 L12 D10' },
    { at: '2026-10-18T18:55:35.882Z', received: '2026-10-27T23:18:53.536Z', stages: 'W3 L19 D13 L1 D5 L1 D3 L3' },
    { at: '2026-10-18T19:50:35.882Z', received: '2026-10-27T23:18:53.523Z', stages: 'W16 L4 D16 L1 D1' },
    { at: '2026-10-18T20:15:35.882Z', received: '2026-10-27T23:18:53.504Z', stages: 'W3 L19 D21 L1' },
    { at: '2026-10-18T20:46:35.882Z', received: '2026-10-27T23:18:53.490Z', stages: 'W3 L13 D19 L12' },
    { at: '2026-10-18T22:36:40.882Z', received: '2026-10-27T23:18:53.477Z', stages: 'W23 D13 L14 R8 L1 R3' },
    { at: '2026-10-18T23:46:35.882Z', received: '2026-10-27T23:18:53.465Z', stages: 'W1 L22 D1 L1 D1 L1 D2 L2 D1' },
    { at: '2026-10-19T00:22:35.882Z', received: '2026-10-27T23:18:53.451Z', stages: 'W1 L19 D2 L4' },
    { at: '2026-10-19T00:56:35.882Z', received: '2026-10-27T23:18:53.439Z', stages: 'W1 L16 D1 L3 D6' },
  ],
  // 2026-10-11: a 67 min break at 03:03
  '2026-10-11': [
    { at: '2026-10-10T16:22:40.882Z', received: '2026-10-27T23:18:54.481Z', stages: 'W32 L20 D1 L1 D1 L1 D3 L1 D13 L1 D4 L1 D1 L1 R2 L2 R7 L2 R11 L4' },
    { at: '2026-10-10T18:16:37.882Z', received: '2026-10-27T23:18:54.460Z', stages: 'W1 L13 D1 L3 D5 L2 D1 L1 D1 L1 D2 L2 D2 L2 D4 L2 D2 L1 D8 L26 R1 L1 R1 L2 R7 L1 R2 L1 R1 L2 R1 L1 R3 L1 R2 L1 R3 L9' },
    { at: '2026-10-10T20:16:39.882Z', received: '2026-10-27T23:18:54.439Z', stages: 'L11 D1 L1 D1 L1 D3 L1 D7 L1 D10 L14 R4 L2 R8 L1 R1 L3 R1 L2 R3' },
    { at: '2026-10-10T22:39:37.882Z', received: '2026-10-27T23:18:54.415Z', stages: 'W40 D6 L22 R6 L1 R2 L1 R2 L1 R2 L6 R1 L1 R3 L1' },
    { at: '2026-10-11T00:23:40.882Z', received: '2026-10-27T23:18:54.390Z', stages: 'W1 L17 D23 L15 R3 W1 R1 L3 R4 L3 R2 L1 R1 L1 R1 L5 R1 L1 R1 L32' },
  ],
  // 2026-10-02: a 104 min break at 05:36, the second part ends at 10:24
  '2026-10-02': [
    { at: '2026-10-01T19:04:37.882Z', received: '2026-10-27T23:18:55.420Z', stages: 'W52 L20 R14 L1 R4 L2 R10 L17' },
    { at: '2026-10-01T21:04:39.882Z', received: '2026-10-27T23:18:55.409Z', stages: 'L4 W2' },
    { at: '2026-10-01T21:17:37.882Z', received: '2026-10-27T23:18:55.398Z', stages: 'W1 L19 D1 L2 D5 L2 D3 L2 D8 L1 D3 L3 D5 L17 R31 L17' },
    { at: '2026-10-01T23:17:37.882Z', received: '2026-10-27T23:18:55.386Z', stages: 'L3 D1 L1 D7 L1 D3 L1 D5 L1 D10 L15' },
    { at: '2026-10-02T01:49:37.882Z', received: '2026-10-27T23:18:55.374Z', stages: 'W51 L10 R25 L33 W1' },
    { at: '2026-10-02T04:01:38.882Z', received: '2026-10-27T23:18:55.363Z', stages: 'W1 L23' },
    { at: '2026-10-02T04:38:39.882Z', received: '2026-10-27T23:18:55.346Z', stages: 'W12 L3' },
  ],
  // 2026-10-24: a 41 min hole: one night all along
  '2026-10-24': [
    { at: '2026-10-23T17:22:35.882Z', received: '2026-10-27T23:18:45.074Z', stages: 'W37 D6 L37 R3' },
    { at: '2026-10-23T18:45:35.882Z', received: '2026-10-27T23:18:45.060Z', stages: 'W3 L13 D9 L2 D15 L14' },
    { at: '2026-10-23T19:28:35.882Z', received: '2026-10-27T23:18:45.046Z', stages: 'W3 L19 D24' },
    { at: '2026-10-23T20:01:35.882Z', received: '2026-10-27T23:18:45.031Z', stages: 'W3 L17 D14 L1 D8' },
    { at: '2026-10-23T20:31:35.882Z', received: '2026-10-27T23:18:45.018Z', stages: 'W3 L17 D15 L1 D3 L1 D9 L1 D3 L16' },
    { at: '2026-10-23T21:43:35.882Z', received: '2026-10-27T23:18:45.010Z', stages: 'W3 L19 D1 L1 D22' },
    { at: '2026-10-23T23:10:35.882Z', received: '2026-10-27T23:18:45.004Z', stages: 'W13 L11 D9 L1 D1 L1 D4' },
    { at: '2026-10-23T23:57:35.882Z', received: '2026-10-27T23:18:44.998Z', stages: 'W13 L11 D18' },
    { at: '2026-10-24T00:26:35.882Z', received: '2026-10-27T23:18:44.984Z', stages: 'W3 L20 D11 L1 D4 L1 D3 L2 D4 L2 W1 L2' },
  ],
  // 2026-10-03: a night and an afternoon nap at 12:18
  '2026-10-03': [
    { at: '2026-10-02T18:27:37.882Z', received: '2026-10-27T23:18:55.332Z', stages: 'W3 L20 D8 L2 D4 L1 D2 L1 D9 L1 D1 L6 R14 L1 R1 L1 R12 L20 D13' },
    { at: '2026-10-02T20:27:37.882Z', received: '2026-10-27T23:18:55.318Z', stages: 'D2 L3 D2 L3 D8 L2 W2 L1 D1 L2 D3 L26 R31 L24 D1 L1 D8' },
    { at: '2026-10-02T22:27:37.882Z', received: '2026-10-27T23:18:55.305Z', stages: 'D5 L1 D1 L1 D11 L1 D1 L21 R8 L1 R2 L2 R11 L31 D1 L1 D9 L1 D9 L1 D1' },
    { at: '2026-10-03T00:27:36.882Z', received: '2026-10-27T23:18:55.290Z', stages: 'D6 L15 R6' },
    { at: '2026-10-03T00:40:00.000Z', received: '2026-10-23T15:43:03.095Z', stages: 'L15 R6' },
    { at: '2026-10-03T06:47:37.882Z', received: '2026-10-27T23:18:55.273Z', stages: 'W8 L59 R14 L2 R1 L1 R4 L31' },
    { at: '2026-10-03T08:48:35.882Z', received: '2026-10-27T23:18:55.239Z', stages: 'W1 L3' },
  ],
};
