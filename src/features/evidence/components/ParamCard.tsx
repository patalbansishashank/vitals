import { GradeBadge } from '@/components';
import { findParam } from '@/content/evidence/params';
import { paramEvidence } from '@/content/evidence/paramEvidence';
import type { Mechanism } from '@/content/evidence/schema';
import { paramSourceLabel } from '@/content/evidence/sources';
import type { ParamDef } from '@/engine/types/params';

const fmt = (x: number): string => {
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1000) return Math.round(x).toLocaleString('en-GB');
  return Number(x.toPrecision(3)).toString();
};

/** Dimensionless units read as nothing extra; "1 (fraction of body mass)" reads as "fraction of body mass". */
const unitText = (u: string): string => {
  if (u === '1' || u === '-') return '';
  const dimensionless = /^1 \((.+)\)$/.exec(u);
  return ` ${dimensionless ? dimensionless[1] : u}`;
};

const STATUS_WORDS: Record<NonNullable<ParamDef['status']>, string> = {
  verified: 'checked against the source',
  'proposed-fit': 'proposed fit',
  unverified: 'unverified',
};

/**
 * One model parameter as a card: its value, plausible range, grade and sources as before, plus the two evidence labels
 * (mechanism, certainty) and how far the certainty widens the parameter's uncertainty band.
 */
export function ParamCard({ def, documentedBy = [] }: { def: ParamDef; documentedBy?: readonly Mechanism[] }) {
  const ev = paramEvidence(def, documentedBy);
  const u = unitText(def.unit);
  const fixed = def.low === def.high;
  const inf = ev.inflation;
  return (
    <article className="ev-pcard" aria-label={def.label ?? def.id}>
      <header className="ev-pcard__head">
        <h4 className="ev-pcard__t">{def.label ?? def.id}</h4>
        <GradeBadge grade={def.grade} />
      </header>
      <p className="ev-pcard__v">
        <span className="ev-pcard__num">
          {fmt(def.value)}
          {u}
        </span>
        {fixed ? (
          <span className="ev-pcard__range"> fixed value</span>
        ) : (
          <span className="ev-pcard__range">
            {' '}
            plausible range {fmt(def.low)}–{fmt(def.high)}
            {u}
          </span>
        )}
      </p>
      <dl className="ev-pcard__dl">
        <dt>Mechanism</dt>
        <dd>{ev.mechanism ? `known, modelled: ${ev.mechanism.pathway}` : 'not described in the library yet'}</dd>
        <dt>Certainty</dt>
        <dd>Grade {ev.certainty}</dd>
        <dt>Uncertainty</dt>
        <dd>
          {inf.k === null
            ? `a fixed value; grade ${def.grade} gives it a band of ${fmt(inf.low)}–${fmt(inf.high)}${u}`
            : inf.k > 1.0005
              ? `band widened ×${inf.k.toFixed(2)} for grade ${def.grade}, to ${fmt(inf.low)}–${fmt(inf.high)}${u}`
              : `band kept as published (already wider than the grade ${def.grade} floor)`}
        </dd>
        <dt>Sources</dt>
        <dd>{paramSourceLabel(def)}</dd>
        {def.status ? (
          <>
            <dt>Status</dt>
            <dd>{STATUS_WORDS[def.status]}</dd>
          </>
        ) : null}
      </dl>
    </article>
  );
}

/** Cards for a mechanism's `relatedParamIds` (unknown ids are skipped; a content test keeps the list valid). */
export function ParamCards({ mechanism }: { mechanism: Mechanism }) {
  const defs = (mechanism.relatedParamIds ?? []).map(findParam).filter((d): d is ParamDef => Boolean(d));
  if (!defs.length) return null;
  return (
    <div className="ev-pcards">
      {defs.map((d) => (
        <ParamCard key={d.id} def={d} documentedBy={[mechanism]} />
      ))}
    </div>
  );
}
