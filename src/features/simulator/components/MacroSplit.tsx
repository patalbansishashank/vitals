/**
 * <MacroSplit> — the macro-split editor (COMPONENTS §3). Linked tuning scales hold the day's energy constant: moving
 * one macro redistributes the difference across the unlocked others by energy share; a hatched end-zone shows where
 * the unlocked macros run out ("Unlock another macro to go further"). Each macro is entered in g, g/kg, g/kg lean
 * mass or % energy, or takes the rest. The triangle (≥ 768 px) edits the same state as a ternary plot of P/C/F energy.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { IconKey, KeyBank, ScaleSlider, cx, formatNumber, type ScaleZone } from '@/components';
import type { MacroSpec } from '@/engine';
import {
  availableKcal,
  changeUnit,
  energyShares,
  gramsFromShares,
  gramsToUnit,
  KCAL_PER_G,
  MACRO_KEYS,
  redistribute,
  remainderKey,
  unitToGrams,
  UNIT_LABEL,
  writeMacros,
  type ExplicitUnit,
  type MacroGrams,
  type MacroKey,
  type MacroRefs,
  type MacroUnit,
} from '../lib/macros';

export interface MacroSplitProps {
  macros: MacroSpec;
  grams: MacroGrams;
  refs: MacroRefs;
  onChange: (m: MacroSpec, key: string) => void;
  onCommit: () => void;
  /** Show the ternary triangle instead of the scales. */
  view?: 'scales' | 'triangle';
  /** Preset shares drawn as ticks inside the triangle. */
  presetMarks?: ReadonlyArray<{ label: string; shares: MacroGrams }>;
  proteinFloorGPerKg?: number;
  /** Energy display unit (Settings; default kcal). */
  energyUnit?: 'kcal' | 'kJ';
}

const NAME: Record<MacroKey, string> = { protein: 'protein', carbs: 'net carbs', fat: 'fat' };
const COLOR: Record<MacroKey, string> = {
  protein: 'var(--lm-macro-protein)',
  carbs: 'var(--lm-macro-carbs)',
  fat: 'var(--lm-macro-fat)',
};
const UNITS: Record<MacroKey, MacroUnit[]> = {
  protein: ['gPerKgBw', 'gPerKgFfm', 'g', 'pctEnergy'],
  carbs: ['g', 'pctEnergy', 'gPerKgBw', 'remainder'],
  fat: ['remainder', 'g', 'pctEnergy'],
};
const STEP: Record<ExplicitUnit, number> = { g: 1, gPerKgBw: 0.05, gPerKgFfm: 0.05, pctEnergy: 0.5 };

function scaleFor(
  key: MacroKey,
  unit: ExplicitUnit,
  refs: MacroRefs,
): { max: number; step: number; major: number; minor: number } {
  const gMax = availableKcal(refs) / KCAL_PER_G[key];
  const max = Math.max(STEP[unit] * 10, gramsToUnit(key, gMax, unit, refs));
  const nice =
    unit === 'pctEnergy' ? 20 : unit === 'g' ? (max > 400 ? 100 : max > 150 ? 50 : 20) : max > 6 ? 2 : 1;
  const top = Math.ceil(max / nice) * nice;
  return { max: top, step: STEP[unit], major: nice, minor: nice / 5 };
}

export function MacroSplit({
  macros,
  grams,
  refs,
  onChange,
  onCommit,
  view = 'scales',
  presetMarks = [],
  proteinFloorGPerKg = 1.2,
  energyUnit = 'kcal',
}: MacroSplitProps) {
  const [locked, setLocked] = useState<Set<MacroKey>>(new Set());
  const rem = remainderKey(macros);
  const total = 4 * grams.protein + 4 * grams.carbs + 9 * grams.fat + 2 * refs.fibreG + 7 * refs.alcoholG;

  const move = (key: MacroKey, g: number) => {
    const r = redistribute(grams, key, g, locked, refs);
    onChange(writeMacros(macros, r.grams, refs), `macros:${key}`);
  };

  return (
    <div className="sim-macros">
      {view === 'triangle' ? (
        <MacroTriangle
          grams={grams}
          refs={refs}
          marks={presetMarks}
          proteinFloorGPerKg={proteinFloorGPerKg}
          onChange={(g) => onChange(writeMacros(macros, g, refs), 'macros:triangle')}
          onCommit={onCommit}
        />
      ) : (
        MACRO_KEYS.map((key) => {
          const unitRaw = macros[key].unit;
          const isRest = key === rem;
          const unit: ExplicitUnit = isRest || unitRaw === 'remainder' ? 'g' : (unitRaw as ExplicitUnit);
          const sc = scaleFor(key, unit, refs);
          const value = gramsToUnit(key, grams[key], unit, refs);
          const others = MACRO_KEYS.filter((k) => k !== key && !locked.has(k));
          const capG =
            Math.min(
              availableKcal(refs),
              KCAL_PER_G[key] * grams[key] + others.reduce((a, k) => a + KCAL_PER_G[k] * grams[k], 0),
            ) / KCAL_PER_G[key];
          const capU = gramsToUnit(key, capG, unit, refs);
          const zones: ScaleZone[] = [];
          if (capU < sc.max - sc.step)
            zones.push({
              from: capU,
              to: sc.max,
              tone: 'caution',
              label: 'Unlock another macro to go further',
            });
          let reference: { value: number; label: string } | undefined;
          if (key === 'protein') {
            const floor = gramsToUnit('protein', 1.6 * refs.bodyMassKg, unit, refs);
            reference = { value: floor, label: 'muscle-retention floor' };
            const lo = gramsToUnit('protein', 0.8 * refs.bodyMassKg, unit, refs);
            const hi = gramsToUnit('protein', 1.2 * refs.bodyMassKg, unit, refs);
            zones.unshift({
              from: lo,
              to: hi,
              tone: 'caution',
              label: 'low for keeping muscle in a deficit',
            });
          } else if (key === 'carbs') {
            reference = { value: gramsToUnit('carbs', 50, unit, refs), label: 'ketosis likely below' };
          }
          const kcal = KCAL_PER_G[key] * grams[key];
          const pctE = total > 0 ? (100 * kcal) / total : 0;
          const dec = unit === 'g' ? 0 : unit === 'pctEnergy' ? 1 : 2;
          return (
            <div key={key} className="sim-macro" data-rest={isRest || undefined}>
              <ScaleSlider
                size="sm"
                label={
                  <span className="sim-macro__label">
                    <i className="sim-swatch" style={{ background: COLOR[key] }} aria-hidden="true" />
                    {NAME[key]}
                    {isRest ? <span className="sim-macro__rest"> · takes the rest</span> : null}
                  </span>
                }
                value={Math.min(value, sc.max)}
                min={0}
                max={sc.max}
                step={sc.step}
                majorStep={sc.major}
                minorStep={sc.minor}
                labels={false}
                zones={zones}
                reference={reference}
                format={(v) => formatNumber(v, dec)}
                unit={UNIT_LABEL[unit]}
                valueText={(v) =>
                  `${NAME[key]} ${formatNumber(v, dec)} ${UNIT_LABEL[unit]}, ${Math.round(grams[key])} grams`
                }
                onChange={(v) => move(key, unitToGrams(key, v, unit, refs))}
                onCommit={onCommit}
                locked={locked.has(key)}
                lockedReason={`${NAME[key]} is locked`}
              />
              <div className="sim-macro__foot">
                <span className="sim-macro__grams">
                  {Math.round(grams[key])} g ·{' '}
                  {energyUnit === 'kJ' ? formatNumber(Math.round((kcal * 4.184) / 10) * 10, 0) : formatNumber(kcal, 0)}{' '}
                  {energyUnit} · {Math.round(pctE)} %
                </span>
                <KeyBank
                  size="sm"
                  label={`${NAME[key]} unit`}
                  options={UNITS[key].map((u) => ({ value: u, label: UNIT_LABEL[u] }))}
                  value={isRest ? 'remainder' : (unitRaw as MacroUnit)}
                  onChange={(u) => {
                    onChange(changeUnit(macros, key, u, grams, refs), `unit:${key}`);
                    onCommit();
                  }}
                />
                <IconKey
                  size="sm"
                  variant="quiet"
                  icon={locked.has(key) ? Lock : LockOpen}
                  label={locked.has(key) ? `Unlock ${NAME[key]}` : `Lock ${NAME[key]}`}
                  pressed={locked.has(key)}
                  onClick={() =>
                    setLocked((s) => {
                      const n = new Set(s);
                      if (n.has(key)) n.delete(key);
                      else n.add(key);
                      return n;
                    })
                  }
                />
              </div>
            </div>
          );
        })
      )}
      <MacroBar grams={grams} fibreG={refs.fibreG} alcoholG={refs.alcoholG} energyKcal={refs.energyKcal} energyUnit={energyUnit} />
    </div>
  );
}

/** 10 px macro bar + legend with grams and % energy (spec §6 Day editor · Macros). */
export function MacroBar({
  grams,
  fibreG,
  alcoholG,
  energyKcal,
  energyUnit = 'kcal',
}: {
  grams: MacroGrams;
  fibreG: number;
  alcoholG: number;
  energyKcal: number;
  /** Energy display unit (Settings; default kcal). */
  energyUnit?: 'kcal' | 'kJ';
}) {
  const parts = [
    { k: 'protein', g: grams.protein, kcal: 4 * grams.protein, c: 'var(--lm-macro-protein)', n: 'protein' },
    { k: 'carbs', g: grams.carbs, kcal: 4 * grams.carbs, c: 'var(--lm-macro-carbs)', n: 'net carbs' },
    { k: 'fibre', g: fibreG, kcal: 2 * fibreG, c: 'var(--lm-macro-fibre)', n: 'fibre' },
    { k: 'fat', g: grams.fat, kcal: 9 * grams.fat, c: 'var(--lm-macro-fat)', n: 'fat' },
    { k: 'alcohol', g: alcoholG, kcal: 7 * alcoholG, c: 'var(--lm-macro-alcohol)', n: 'alcohol' },
  ].filter((p) => p.g > 0.05);
  const total = parts.reduce((a, p) => a + p.kcal, 0) || 1;
  return (
    <div className="sim-macrobar">
      <div className="sim-macrobar__bar" aria-hidden="true">
        {parts.map((p) => (
          <i key={p.k} style={{ flexGrow: p.kcal, background: p.c }} />
        ))}
      </div>
      <p className="sim-macrobar__legend">
        {parts.map((p) => (
          <span key={p.k}>
            <i className="sim-swatch" style={{ background: p.c }} aria-hidden="true" />
            {p.n} {Math.round(p.g)} g · {Math.round((100 * p.kcal) / total)} %
          </span>
        ))}
        <span className="sim-macrobar__total">
          {energyUnit === 'kJ' ? formatNumber(Math.round((energyKcal * 4.184) / 10) * 10, 0) : formatNumber(energyKcal, 0)}{' '}
          {energyUnit}
        </span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- triangle

const T = 232;
const PAD = 22;
const SIDE = T - 2 * PAD;
const H = (SIDE * Math.sqrt(3)) / 2;
const VP: [number, number] = [T / 2, PAD];
const VC: [number, number] = [PAD, PAD + H];
const VF: [number, number] = [T - PAD, PAD + H];

function toXY(s: MacroGrams): [number, number] {
  return [
    s.protein * VP[0] + s.carbs * VC[0] + s.fat * VF[0],
    s.protein * VP[1] + s.carbs * VC[1] + s.fat * VF[1],
  ];
}

/** Barycentric coordinates of a point (clamped into the triangle). */
export function fromXY(x: number, y: number): MacroGrams {
  const det = (VC[1] - VF[1]) * (VP[0] - VF[0]) + (VF[0] - VC[0]) * (VP[1] - VF[1]);
  let p = ((VC[1] - VF[1]) * (x - VF[0]) + (VF[0] - VC[0]) * (y - VF[1])) / det;
  let c = ((VF[1] - VP[1]) * (x - VF[0]) + (VP[0] - VF[0]) * (y - VF[1])) / det;
  p = Math.max(0, p);
  c = Math.max(0, c);
  let f = Math.max(0, 1 - p - c);
  const t = p + c + f;
  p /= t;
  c /= t;
  f /= t;
  return { protein: p, carbs: c, fat: f };
}

function MacroTriangle({
  grams,
  refs,
  marks,
  proteinFloorGPerKg,
  onChange,
  onCommit,
}: {
  grams: MacroGrams;
  refs: MacroRefs;
  marks: ReadonlyArray<{ label: string; shares: MacroGrams }>;
  proteinFloorGPerKg: number;
  onChange: (g: MacroGrams) => void;
  onCommit: () => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const id = useId();
  const shares = energyShares(grams);
  const [px, py] = toXY(shares);
  const avail = availableKcal(refs);
  const floorShare = avail > 0 ? Math.min(1, (4 * proteinFloorGPerKg * refs.bodyMassKg) / avail) : 1;
  const safe = shares.protein >= floorShare - 1e-9;

  const set = (s: MacroGrams) => {
    // snap within 3 % of a preset tick
    for (const m of marks) {
      if (Math.abs(m.shares.protein - s.protein) < 0.03 && Math.abs(m.shares.carbs - s.carbs) < 0.03) {
        s = m.shares;
        break;
      }
    }
    onChange(gramsFromShares(s, refs));
  };
  const at = (e: PointerEvent<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const k = r.width / T || 1;
    return fromXY((e.clientX - r.left) / k, (e.clientY - r.top) / k);
  };
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    const d = {
      ArrowUp: ['protein', 0.01],
      ArrowDown: ['protein', -0.01],
      ArrowRight: ['carbs', 0.01],
      ArrowLeft: ['carbs', -0.01],
    }[e.key] as [MacroKey, number] | undefined;
    if (!d) return;
    e.preventDefault();
    const s = { ...shares };
    const room = s.fat;
    const dv = Math.max(-s[d[0]], Math.min(room, d[1]));
    s[d[0]] += dv;
    s.fat -= dv;
    onChange(gramsFromShares(s, refs));
    onCommit();
  };

  // safe-zone polygon: protein share ≥ floor (a band parallel to the carbs–fat side, towards the protein corner)
  const a = toXY({ protein: floorShare, carbs: 1 - floorShare, fat: 0 });
  const b = toXY({ protein: floorShare, carbs: 0, fat: 1 - floorShare });
  const grid = useMemo(() => {
    const out: Array<[number, number, number, number]> = [];
    for (let k = 1; k < 10; k++) {
      const t = k / 10;
      const p1 = toXY({ protein: t, carbs: 1 - t, fat: 0 });
      const p2 = toXY({ protein: t, carbs: 0, fat: 1 - t });
      const c1 = toXY({ carbs: t, protein: 1 - t, fat: 0 });
      const c2 = toXY({ carbs: t, protein: 0, fat: 1 - t });
      const f1 = toXY({ fat: t, protein: 1 - t, carbs: 0 });
      const f2 = toXY({ fat: t, protein: 0, carbs: 1 - t });
      out.push([...p1, ...p2], [...c1, ...c2], [...f1, ...f2]);
    }
    return out;
  }, []);

  return (
    <div className="sim-tri">
      <svg
        ref={ref}
        width={T}
        height={PAD + H + PAD}
        viewBox={`0 0 ${T} ${PAD + H + PAD}`}
        className="sim-tri__svg"
        onPointerDown={(e) => {
          dragging.current = e.pointerId;
          try {
            ref.current?.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          set(at(e));
        }}
        onPointerMove={(e) => {
          if (dragging.current === e.pointerId) set(at(e));
        }}
        onPointerUp={(e) => {
          if (dragging.current === e.pointerId) {
            dragging.current = null;
            onCommit();
          }
        }}
      >
        <polygon points={`${VP} ${VC} ${VF}`} className="sim-tri__face" />
        <polygon points={`${VP} ${a} ${b}`} className="sim-tri__safe" />
        {grid.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="sim-tri__grid" />
        ))}
        <polygon points={`${VP} ${VC} ${VF}`} className="sim-tri__edge" />
        <text x={VP[0]} y={VP[1] - 8} textAnchor="middle" className="sim-tri__corner">
          protein
        </text>
        <text x={VC[0]} y={VC[1] + 16} textAnchor="start" className="sim-tri__corner">
          carbs
        </text>
        <text x={VF[0]} y={VF[1] + 16} textAnchor="end" className="sim-tri__corner">
          fat
        </text>
        {marks.map((m) => {
          const [x, y] = toXY(m.shares);
          return (
            <g key={m.label} className="sim-tri__mark">
              <line x1={x - 3} y1={y} x2={x + 3} y2={y} />
              <line x1={x} y1={y - 3} x2={x} y2={y + 3} />
              <title>{m.label}</title>
            </g>
          );
        })}
        <g
          role="slider"
          tabIndex={0}
          aria-labelledby={id}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(shares.protein * 100)}
          aria-valuetext={`protein ${Math.round(shares.protein * 100)} percent, carbs ${Math.round(shares.carbs * 100)} percent, fat ${Math.round(shares.fat * 100)} percent of energy`}
          onKeyDown={onKey}
          className={cx('sim-tri__puck', !safe && 'is-caution')}
        >
          <circle cx={px} cy={py} r={11} className="sim-tri__focus" />
          <circle cx={px} cy={py} r={8} className="sim-tri__cap" />
          <circle cx={px} cy={py} r={2} className="sim-tri__dot" />
        </g>
      </svg>
      <p id={id} className="sim-tri__caption">
        energy split · ↑↓ protein · ←→ carbs · fat takes the rest
        {safe ? '' : ` · protein below ${formatNumber(proteinFloorGPerKg, 1)} g/kg`}
      </p>
    </div>
  );
}
