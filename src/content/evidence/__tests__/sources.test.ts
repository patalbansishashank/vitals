import { describe, expect, it } from 'vitest';
import { MODULES } from '@/engine/core/moduleRegistry';
import { SERIES } from '@/engine/types/metrics';
import { EVIDENCE_TOPICS } from '../index';
import { EVIDENCE_TOPIC_SLUGS } from '../schema';
import {
  TOPIC_SHORT_NAME,
  legacySourceToRefs,
  paramSource,
  paramSourceLabel,
  sourceRefLabel,
  sourceRefsLabel,
  topicDisplayName,
} from '../sources';

describe('topic slugs', () => {
  it('EVIDENCE_TOPIC_SLUGS lists exactly the registered topics, in order', () => {
    expect([...EVIDENCE_TOPIC_SLUGS]).toEqual(EVIDENCE_TOPICS.map((e) => e.slug));
  });

  it('every topic has a short name, and short names are unique', () => {
    const names = EVIDENCE_TOPIC_SLUGS.map((s) => TOPIC_SHORT_NAME[s]);
    for (const n of names) expect(n.trim().length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it('falls back to the title for a slug the registry does not know', () => {
    expect(topicDisplayName('safety-limits', 'whatever')).toBe('Safety limits');
    expect(topicDisplayName('test-fuel', 'Test fuel and water')).toBe('Test fuel and water');
  });
});

describe('source references render as topic name and reference numbers', () => {
  it('renders a topic alone, one reference and several references', () => {
    expect(sourceRefLabel({ topic: 'safety-limits' })).toBe('Safety limits');
    expect(sourceRefLabel({ topic: 'safety-limits', refs: [6] })).toBe('Safety limits › reference 6');
    expect(sourceRefLabel({ topic: 'safety-limits', refs: [6, 7] })).toBe('Safety limits › references 6, 7');
    expect(sourceRefsLabel([{ topic: 'safety-limits', refs: [6, 7] }, { topic: 'energy-expenditure' }])).toBe(
      'Safety limits › references 6, 7; Energy expenditure',
    );
  });

  it('never prints the maintainers’ pointer', () => {
    expect(sourceRefLabel({ topic: 'safety-limits', refs: [6], legacy: '17 §3 [6]' })).not.toMatch(/§|17/);
  });
});

describe('legacySourceToRefs (maintainers’ pointers → structured references)', () => {
  it('reads the research-file number and the [n] marks', () => {
    expect(legacySourceToRefs('17 §3 [6][7]')).toEqual([
      { topic: 'safety-limits', refs: [6, 7], legacy: '17 §3 [6][7]' },
    ]);
    expect(legacySourceToRefs('17 §3 [6][7][38]')[0]?.refs).toEqual([6, 7, 38]);
  });

  it('merges repeated topics, keeps order and drops parts that name no topic', () => {
    expect(legacySourceToRefs('13 §4.1-4.6, 04 §4.1, 15 §4.7, 13 §4.2').map((r) => r.topic)).toEqual([
      'transitions-periodisation',
      'carbohydrate-glycogen-insulin',
      'fibre-hydration-substances',
    ]);
    expect(legacySourceToRefs('schedule')).toEqual([]);
    expect(legacySourceToRefs('R-MAINT (DayInput.maintenanceKcal)')).toEqual([]);
    expect(legacySourceToRefs('18 §4.2')).toEqual([]);
    expect(legacySourceToRefs('R6 §2')).toEqual([]); // planner algorithms, not an evidence topic // the Planner's algorithms are not an evidence topic
    expect(legacySourceToRefs('14 M7; 03 §4.19; 09 §4.9').map((r) => r.topic)).toEqual([
      'body-composition-estimation',
      'protein-muscle',
      'resistance-training',
    ]);
  });
});

describe('after-launch research pointers', () => {
  it('map to the topic each note was written up in', () => {
    expect(legacySourceToRefs('R1 §3.2; 02 §4.6').map((r) => r.topic)).toEqual([
      'daily-activity-maintenance',
      'energy-expenditure',
    ]);
    expect(legacySourceToRefs('R11 §3.1-3.2').map((r) => r.topic)).toEqual(['tracking-replanning']);
    expect(legacySourceToRefs('R5 §2.3').map((r) => r.topic)).toEqual(['evidence-policy']);
  });
});

describe('metric catalogue sources', () => {
  it('every metric carries structured sources that agree with its maintainers’ pointer', () => {
    for (const d of SERIES) {
      expect(
        d.sources.map((s) => s.topic),
        d.id,
      ).toEqual(legacySourceToRefs(d.src).map((s) => s.topic));
      for (const s of d.sources) expect(EVIDENCE_TOPIC_SLUGS, `${d.id} -> ${s.topic}`).toContain(s.topic);
    }
  });
});

describe('parameter sources', () => {
  it('lifts topics and studies out of the free-text fields', () => {
    const p = paramSource({
      source:
        'Nedeltcheva 2010 PMID 20921542 (control arm 7 h 25 min actual sleep); 12 §4.2 D_sleep reference 7.0 h',
      dossier: '16 §4.1.1',
    });
    expect(p.topics.map((t) => t.topic)).toEqual(['sleep-sex-age']);
    expect(p.studies).toEqual([{ label: 'Nedeltcheva 2010', pmid: '20921542' }]);
  });

  it('renders topic names then studies, or says the number is a modelling choice', () => {
    expect(
      paramSourceLabel({
        source: 'Dulloo 2018 PMID 29559726; Müller 2015 PMID 26399868',
        dossier: '11 §4.12 FFM_def',
      }),
    ).toBe('Energy surplus › Dulloo 2018; Müller 2015');
    expect(paramSourceLabel({ source: 'PROPOSED cap of fD (≥ 135 min)', dossier: 'MODEL_SPEC §1.9' })).toBe(
      'Vitals model choice',
    );
  });

  it('every parameter in the engine renders to a non-empty line', () => {
    for (const m of MODULES)
      for (const p of m.params) expect(paramSourceLabel(p).length, p.id).toBeGreaterThan(0);
  });
});
