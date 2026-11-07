import { useState } from 'react';
import { GradeBadge, HeroNumber, InfoKey, InfoPanel, MonoMeta, RangeScale } from '@/components';
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
export function ParamCard({
  def,
  documentedBy = [],
}: {
  def: ParamDef;
  documentedBy?: readonly Mechanism[];
}) {
  const [open, setOpen] = useState(false);
  const ev = paramEvidence(def, documentedBy);
  const u = unitText(def.unit);
  const fixed = def.low === def.high;
  const inf = ev.inflation;
  const uncertainty =
    inf.k === null
      ? `A fixed value; grade ${def.grade} gives it a band of ${fmt(inf.low)}–${fmt(inf.high)}${u}.`
      : inf.k > 1.0005
        ? `Band widened ×${inf.k.toFixed(2)} for grade ${def.grade}, to ${fmt(inf.low)}–${fmt(inf.high)}${u}.`
        : `Band kept as published (already wider than the grade ${def.grade} floor).`;
  const decimals = Math.min(10, Math.max(0, 2 - Math.floor(Math.log10(Math.abs(def.value) || 1))));
  return (
    <article className="ev-pcard lm-material" aria-label={def.label ?? def.id}>
      <header className="ev-pcard__head">
        <h4 className="ev-pcard__t">{def.label ?? def.id}</h4>
        <GradeBadge grade={def.grade} />
        <InfoKey label={`About ${def.label ?? def.id}`} onClick={() => setOpen(true)} expanded={open} />
      </header>
      <HeroNumber
        value={def.value}
        format={fmt}
        unit={u.trim()}
        size="num"
        range={fixed ? 'Fixed value' : `Published ${fmt(def.low)}–${fmt(def.high)}${u}`}
        label={`${fmt(def.value)}${u}; ${fixed ? 'fixed value' : `plausible range ${fmt(def.low)}–${fmt(def.high)}${u}`}`}
      />
      <RangeScale
        label={`${def.label ?? def.id}: grade-widened band`}
        value={def.value}
        min={inf.low}
        max={inf.high}
        usual={fixed ? undefined : [def.low, def.high]}
        unit={u.trim()}
        decimals={decimals}
        endLabels={[fmt(inf.low), fmt(inf.high)]}
      />
      <MonoMeta className="ev-pcard__foot">
        {paramSourceLabel(def)}
        {def.status ? ` · ${STATUS_WORDS[def.status]}` : ''}
      </MonoMeta>
      <InfoPanel
        title="How the band is set"
        open={open}
        onClose={() => setOpen(false)}
        body="The plausible range is what the source published. A lower grade widens it: a fixed value graded D gets a wider band around it. The scale shows the value, the published range and the widened band."
        source={{ kind: 'engine', words: paramSourceLabel(def) }}
        range={uncertainty}
        terms={[
          {
            term: 'Mechanism',
            text: ev.mechanism
              ? `Known, modelled: ${ev.mechanism.pathway}`
              : 'Not described in the library yet',
          },
          { term: 'Certainty', text: `Grade ${ev.certainty}` },
        ]}
      />
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
