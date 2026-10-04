/**
 * MODULE fasting — owner of the zero-intake regime (water-only and modified fasts) and refeeding memory.
 * Spec: docs/MODEL_SPEC.md §1.4 (rulings R-FAST, R-FAST-AT) · Dossier: 20 §4.0-4.12, §4B (owner; supersedes 03 §4.13 and
 * 07 N/BHB in fasts); 07 §4.2/§4.15 fasting clock (tFast counted from the last intake event, 20 §2).
 * Owned files: src/engine/model/fasting/** only.
 *
 * Per hour (MODEL_SPEC §1.4 algorithm, 20 §4B.1 split across modules):
 *  1. rolling 24-h intake sums from HourInput → overlay criteria (water-only / modified / planned span);
 *  2. fastRmrMult = (1 + A_SNS)·(1 − φ_AT·s_AT) — energy applies it to its mass-based RMR and holds AT_R;
 *  3. protein-sparing state S_N (BHB-driven) and the fasting N model → fastProtOxGH; labile pool D_lab;
 *  4. labile-pool repletion on adequate refeeding → fastRepletionGH;
 *  5. refeeding oedema after fasts > 3 d → fastOedemaL.
 * Relaxations are exact per hour (§0.1); rates use hour-mean states and mid-hour fasting time.
 */
import { defineModule } from '../../core/moduleKit';
import { FASTING_PARAMS } from './params';
import {
  fastingConstants,
  fastingHook,
  fastingInitialState,
  type FastingConstants,
  type FastingState,
} from './model';

export { FASTING_PARAMS } from './params';
export * from './model';

export const fastingModule = defineModule<FastingState, FastingConstants>({
  id: 'fasting',
  specSection: '§1.4',
  dossiers: '20 §4.0-4.12, §4B; 07 §4.2, §4.15 (clock)',
  params: FASTING_PARAMS,
  // carbAbs24G / kcalEaten24 are declared readers in SIGNAL_DEFS; the criteria use this module's own rolling sums of
  // *ingested* intake (the same quantities, plus protein which has no signal), so they are not read in stepHour.
  reads: [
    'bhbMmolL',
    'bhbEndoMmolL',
    'maintenanceKcalD',
    'tdeeEstKcalD',
    'fatMassKg',
    'ffmActKg',
    'carbAbs24G',
    'kcalEaten24',
  ],
  writes: ['fastActive', 'fastHoursH', 'fastRmrMult', 'fastProtOxGH', 'fastRepletionGH', 'fastOedemaL'],
  records: [],
  prepare: (ctx) =>
    fastingConstants(ctx.params, {
      ffm0Kg: ctx.profile.ffm0Kg,
      nHours: ctx.nDays * 24,
      fastSpans: ctx.schedule.fastSpans,
      events: ctx.events,
      checks: ctx.checks,
    }),
  init: (_k, ctx, bus) => {
    bus.fastActive = 0;
    bus.fastHoursH = 0;
    bus.fastRmrMult = 1;
    bus.fastProtOxGH = 0;
    bus.fastRepletionGH = 0;
    bus.fastOedemaL = 0;
    return fastingInitialState(ctx.profile);
  },
  stepHour: fastingHook,
});
