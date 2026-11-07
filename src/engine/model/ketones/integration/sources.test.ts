// @vitest-environment node
/**
 * D2-03 (contract C3): ketone provenance in the COUPLED engine. intake → ketones → cellular runs for MCT, ketone ester,
 * ketone salt and a mixed day: the tagged sub-pools (hepatic dietary-MCT, ingested D-BHB, other hepatic) share the pool's
 * fractional clearance and sum to the total; a ketone drink raises total BHB without earning fasting-depth credit in the
 * cellular index; the tags never move total kinetics or energy; output masks never change the tagged state (C7).
 */
import { describe, expect, it } from 'vitest';
import { createSignalBus } from '../../../types/signals';
import type { EventSink } from '../../../types/module';
import { initKetones, ketoneSourceShares, ketoneSourceStatus, prepareKetones, stepKetones } from '../index';
import { makeContext } from '../testing/harness';
import { kitPerson, kitSchedule, neutral, program, runKit, type KitRun } from './engineKit';
import type { DayTemplate, Schedule } from '../../../types/schedule';

const MAN = kitPerson({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 78, bodyFatPct: 16 });
const DAYS = 4;
/** Supplement day (day 2): ester/salt at 06:00 (fasted) and/or 30 g MCT spread over the day's meals. */
function sched(opts: { ester?: number; salt?: number; mctG?: number; second?: number }): Schedule {
  const base = program('base', 100, neutral('male'));
  const subs: DayTemplate['substances'] = {
    exogenousKetones: [
      ...(opts.ester ? [{ clockH: 6, gBhb: opts.ester, form: 'ester' as const }] : []),
      ...(opts.salt ? [{ clockH: 6, gBhb: opts.salt, form: 'salt' as const }] : []),
      ...(opts.second ? [{ clockH: 7, gBhb: opts.second, form: 'ester' as const }] : []),
    ],
  };
  const macros = opts.mctG ? { ...neutral('male'), fatTypes: { mctG: opts.mctG } } : neutral('male');
  const supp = program('supp', 100, macros, subs.exogenousKetones!.length ? { substances: subs } : {});
  return kitSchedule(DAYS, [base, supp], (d) => (d === 2 ? 1 : 0));
}

const runs: Record<string, KitRun> = {
  base: runKit(MAN, sched({})),
  ester: runKit(MAN, sched({ ester: 25 })),
  salt: runKit(MAN, sched({ salt: 25 })),
  mct: runKit(MAN, sched({ mctG: 30 })),
  mixed: runKit(MAN, sched({ ester: 15, mctG: 30 })),
  repeated: runKit(MAN, sched({ ester: 12, second: 12 })),
};
const H = DAYS * 24;
/** Index points: float32 recording resolution near 25-40 (≈ 4·10⁻⁶) plus second-order fuel coupling; a credit would be points. */
const ASI_TOL = 1e-3;
const DAY2 = 48;

describe('tagged ketone pools in the coupled engine (D2-03)', () => {
  it('pools sum to the total and every source fraction stays in [0, 1], every hour of every run', () => {
    for (const [name, r] of Object.entries(runs)) {
      for (let h = 0; h < H; h++) {
        const p = r.probe;
        const sh = ketoneSourceShares(p.tkbEnd[h]!, p.tkbExoEnd[h]!, p.tkbMctEnd[h]!);
        for (const f of [sh.hepaticOther, sh.hepaticMct, sh.ingestedDBhb]) {
          expect(f, `${name} h${h}`).toBeGreaterThanOrEqual(0);
          expect(f, `${name} h${h}`).toBeLessThanOrEqual(1);
        }
        expect(sh.hepaticOther + sh.hepaticMct + sh.ingestedDBhb).toBeCloseTo(1, 12);
        expect(p.tkbExoEnd[h]! + p.tkbMctEnd[h]!).toBeLessThanOrEqual(p.tkbEnd[h]! + 1e-12);
      }
    }
  });

  it('origins follow the intake: drinks tag ingested D-BHB only, MCT tags hepatic MCT only, the mixed day both', () => {
    const peak = (x: Float64Array, a: number, b: number): number => Math.max(...Array.from(x.subarray(a, b)));
    const { base, ester, salt, mct, mixed } = runs;
    expect(peak(base!.probe.tkbExoEnd, 0, H)).toBe(0);
    expect(peak(base!.probe.tkbMctEnd, 0, H)).toBe(0);
    expect(peak(ester!.probe.tkbExoEnd, DAY2, DAY2 + 24)).toBeGreaterThan(0.5);
    expect(peak(ester!.probe.tkbMctEnd, 0, H)).toBe(0);
    expect(peak(mct!.probe.tkbMctEnd, DAY2, DAY2 + 24)).toBeGreaterThan(0);
    expect(peak(mct!.probe.tkbExoEnd, 0, H)).toBe(0);
    expect(peak(mixed!.probe.tkbExoEnd, DAY2, DAY2 + 24)).toBeGreaterThan(0);
    expect(peak(mixed!.probe.tkbMctEnd, DAY2, DAY2 + 24)).toBeGreaterThan(0);
    // formulation: a racemic salt delivers half the D-BHB of an equal ester mass (compile/intake), so its ingested pool is lower
    expect(peak(salt!.probe.tkbExoEnd, DAY2, DAY2 + 24)).toBeLessThan(peak(ester!.probe.tkbExoEnd, DAY2, DAY2 + 24));
    // the hepatic signal (deprecated name bhbEndo) excludes the ingested share and keeps the MCT share
    for (let h = DAY2; h < DAY2 + 24; h++) expect(ester!.probe.bhbEndo[h]!).toBeLessThanOrEqual(ester!.probe.bhb[h]! + 1e-12);
  });

  it('a ketone drink raises total BHB but earns no fasting-depth credit: the cellular index never rises above the no-drink run', () => {
    const asi = (r: KitRun, h: number): number => r.hour('autophagyIdx', h);
    for (const name of ['ester', 'salt', 'mct', 'mixed', 'repeated'] as const) {
      const r = runs[name]!;
      let maxBhbGain = 0;
      for (let h = DAY2; h < DAY2 + 24; h++) {
        maxBhbGain = Math.max(maxBhbGain, r.probe.bhb[h]! - runs.base!.probe.bhb[h]!);
        // other non-ketone exposures (protein, carbohydrate, energy, timing) are the same and the ketone channel has weight 0;
        // what remains is the indirect fuel coupling (ketones spare liver glycogen) at float32 recording resolution
        expect(asi(r, h) - asi(runs.base!, h), `${name} h${h}`).toBeLessThanOrEqual(ASI_TOL);
      }
      expect(maxBhbGain, name).toBeGreaterThan(name === 'mct' ? 0.02 : 0.1); // fed MCT 30 g/d: ≈ +0.05 mM
    }
  });

  it('repeated/overlapping doses keep the source accounting and acute kinetics (second dose raises the ingested pool)', () => {
    const r = runs.repeated!;
    const at6 = r.probe.tkbExoEnd[DAY2 + 6]!;
    const at7 = r.probe.tkbExoEnd[DAY2 + 7]!;
    expect(at6).toBeGreaterThan(0);
    expect(at7).toBeGreaterThan(at6 * 0.8);
    expect(r.probe.tkbExoMean[DAY2 + 7]!).toBeGreaterThan(0);
    // the ingested pool decays back to zero within the day (shared clearance), the total stays ≥ the tagged parts
    expect(r.probe.tkbExoEnd[DAY2 + 23]!).toBeLessThan(0.05 * Math.max(at6, at7));
  });

  it('output masks never change the tagged state or energy (record full vs daily)', () => {
    const full = runs.mixed!;
    const daily = runKit(MAN, sched({ ester: 15, mctG: 30 }), { record: 'daily' });
    for (let h = 0; h < H; h++) {
      expect(daily.probe.tkbExoEnd[h]).toBe(full.probe.tkbExoEnd[h]);
      expect(daily.probe.tkbMctEnd[h]).toBe(full.probe.tkbMctEnd[h]);
      expect(daily.probe.tkbEnd[h]).toBe(full.probe.tkbEnd[h]);
      expect(daily.probe.teeKcalH[h]).toBe(full.probe.teeKcalH[h]);
      expect(daily.probe.ketoneLossKcalH[h]).toBe(full.probe.ketoneLossKcalH[h]);
    }
    for (let d = 0; d < DAYS; d++) expect(daily.day('fatMass', d)).toBe(full.day('fatMass', d));
  });
});

describe('tags are bookkeeping only (no kinetics or energy change; unknown stays unknown)', () => {
  /** One module, hand-built inputs; `preTag` sets the MCT tag of the starting pool. */
  function hour(preTagFrac: number) {
    const ctx = makeContext({ habitualProteinG: 90, habitualCarbG: 300 }, 75, 60, { emit: () => {} } as EventSink);
    const k = prepareKetones(ctx);
    const bus = createSignalBus();
    bus.tissueMassKg = 75;
    bus.ffmActKg = 60;
    bus.tdeeEstKcalD = 2500;
    bus.kcalEaten24 = 600;
    bus.carbAbs24G = 20;
    bus.liverGlycogenG = 30;
    bus.insulinRefRel = 0.5;
    bus.raMctGH = 6;
    bus.exoKetoneMmolH = 60;
    const s = initKetones(k, ctx, bus);
    s.tkb = 1.2;
    s.tkbMct = preTagFrac * 1.2;
    stepKetones(s, k, bus, 0, 0, 10, 0, null);
    return { s, bus };
  }
  it('the same inputs give the same total pool, BHB, hepatic BHB and urinary ketone energy whatever the starting tag split', () => {
    const a = hour(0);
    const b = hour(0.5);
    expect(b.s.tkb).toBe(a.s.tkb);
    expect(b.bus.bhbMmolL).toBe(a.bus.bhbMmolL);
    expect(b.bus.ketoneLossKcalH).toBe(a.bus.ketoneLossKcalH);
    expect(b.bus.brainKetoneShare).toBe(a.bus.brainKetoneShare);
    expect(b.s.tkbMct).toBeGreaterThan(a.s.tkbMct);
    // hepatic BHB excludes the ingested tag only; the MCT split inside the hepatic part does not change it
    expect(b.bus.bhbEndoMmolL).toBe(a.bus.bhbEndoMmolL);
  });
  it('unknown formulation or MCT dose keeps the source status Unknown; a mixed pool reads Mixed', () => {
    // A1-064: a displayed ingested/MCT share needs explicit knowledge of the formulation and the MCT dose
    expect(ketoneSourceStatus({ hepaticOther: 0.5, hepaticMct: 0.2, ingestedDBhb: 0.3 })).toBe('unknown');
    expect(ketoneSourceStatus({ hepaticOther: 0.5, hepaticMct: 0.2, ingestedDBhb: 0.3 }, { ingestedFormulation: true, mctDose: true })).toBe('mixed');
    expect(ketoneSourceStatus({ hepaticOther: 0.5, hepaticMct: 0.2, ingestedDBhb: 0.3 }, { ingestedFormulation: false })).toBe('unknown');
    expect(ketoneSourceStatus({ hepaticOther: 0.7, hepaticMct: 0.3, ingestedDBhb: 0 }, { mctDose: false })).toBe('unknown');
    expect(ketoneSourceStatus({ hepaticOther: 1, hepaticMct: 0, ingestedDBhb: 0 })).toBe('hepatic');
    // a non-positive total pool is all "other hepatic": never a confident ingested or MCT share
    expect(ketoneSourceShares(0, 0.3, 0.3)).toEqual({ hepaticOther: 1, hepaticMct: 0, ingestedDBhb: 0 });
  });
});
