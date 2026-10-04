// @vitest-environment node
/**
 * The evidence behind each safety warning: structured `SourceRef`s (Evidence topic + source positions), what a screen
 * renders as "Safety limits › references 6, 7". The maintainers' research-note pointer rides along in `legacy` and is
 * never shown. These tests keep the two in step and make sure every reference lands on a source the topic page lists.
 */
import { describe, expect, it } from 'vitest';
import { EVIDENCE_TOPICS } from '@/content/evidence';
import { EVIDENCE_TOPIC_SLUGS } from '@/content/evidence/schema';
import {
  legacySourceToRefs,
  sourceRefLabel,
  sourceRefsLabel,
  topicRefPosition,
} from '@/content/evidence/sources';
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { resolveProfile } from '../../core/resolveProfile';
import type { DayTemplate, PersonProfile, Schedule } from '../../types';
import { RULES } from './rules';

const loadTopic = async (slug: string) => {
  const entry = EVIDENCE_TOPICS.find((e) => e.slug === slug);
  if (!entry) throw new Error(`no topic ${slug}`);
  return (await entry.load()).default;
};

describe('safety rule sources', () => {
  it('every rule names its evidence by topic, with the maintainers’ pointer kept in `legacy`', () => {
    expect(RULES.length).toBe(82);
    for (const r of RULES) {
      expect(r.sources.length, r.id).toBeGreaterThan(0);
      for (const s of r.sources) {
        expect(EVIDENCE_TOPIC_SLUGS, `${r.id} topic`).toContain(s.topic);
        expect(s.legacy, `${r.id} legacy`).toBeTruthy();
      }
    }
  });

  it('agrees with the conversion of the maintainers’ pointer (same topics; same positions where it carries [n] marks)', () => {
    for (const r of RULES) {
      for (const s of r.sources) {
        const converted = legacySourceToRefs(s.legacy!).find((c) => c.topic === s.topic);
        expect(converted, `${r.id}: ${s.legacy}`).toBeDefined();
        if (/\[\d+\]/.test(s.legacy!))
          expect(s.refs ?? [], `${r.id}: ${s.legacy}`).toEqual(converted!.refs ?? []);
      }
    }
  });

  it('points only at sources the topic page lists', async () => {
    const topics = new Map<string, number>();
    for (const r of RULES)
      for (const s of r.sources) {
        if (!topics.has(s.topic)) topics.set(s.topic, (await loadTopic(s.topic)).references.length);
        for (const n of s.refs ?? []) {
          expect(
            Number.isInteger(n) && n >= 1 && n <= topics.get(s.topic)!,
            `${r.id} ${s.topic} ref ${n}`,
          ).toBe(true);
        }
      }
    expect(topics.get('safety-limits')).toBe(99);
  });

  it('maps the research note’s numbers above 80 to the page’s positions, matched by source', async () => {
    const t = await loadTopic('safety-limits');
    const idAt = (n: number | undefined) => (n === undefined ? undefined : t.references[n - 1]?.id);
    expect(idAt(topicRefPosition('safety-limits', 6))).toBe(t.references[5]!.id); // unchanged below 81
    expect(idAt(topicRefPosition('safety-limits', 80))).toBe('mond2008');
    expect(topicRefPosition('safety-limits', 81)).toBeUndefined(); // helplines are not on the page
    expect(idAt(topicRefPosition('safety-limits', 85))).toBe('bredin2013');
    expect(idAt(topicRefPosition('safety-limits', 87))).toBe('riebe2015');
    expect(idAt(topicRefPosition('safety-limits', 96))).toBe('kreider2017');
    expect(idAt(topicRefPosition('safety-limits', 98))).toBe('ccsa2023');
    expect(idAt(topicRefPosition('safety-limits', 99))).toBe('whoeurope2023');
    expect(topicRefPosition('safety-limits', 100)).toBeUndefined();
    expect(idAt(topicRefPosition('safety-limits', 101))).toBe('iom2009');
    expect(idAt(topicRefPosition('safety-limits', 102))).toBe('lovelady2000');
    expect(topicRefPosition('safety-limits', 110)).toBeUndefined(); // regulatory and communication sources
    expect(idAt(topicRefPosition('safety-limits', 112))).toBe('pavlidou2023');
    expect(idAt(topicRefPosition('safety-limits', 114))).toBe('marinescu2024');
    expect(topicRefPosition('transitions-periodisation', 73)).toBe(73); // other topics are not renumbered
  });

  it('studies named in the engine-specific rules resolve to the source on the topic page', async () => {
    const byRule = (id: string) => RULES.find((r) => r.id === id)!.sources[0]!;
    const alpert = byRule('W-13-ALPERT');
    expect((await loadTopic(alpert.topic)).references[alpert.refs![0]! - 1]!.id).toBe('alpert2005');
    const keto = byRule('W-05-KETO-FED');
    expect(
      (await loadTopic(keto.topic)).references.filter((_, i) => keto.refs!.includes(i + 1)).map((r) => r.id),
    ).toEqual(['kitabchi2009', 'umpierrez2024']);
  });

  it('renders as topic name and source numbers, never as the research-note pointer', () => {
    const w = (id: string) => RULES.find((r) => r.id === id)!;
    expect(sourceRefsLabel(w('W-E01').sources)).toBe('Safety limits › references 6, 7');
    expect(sourceRefsLabel(w('W-E02').sources)).toBe('Safety limits › references 6, 7, 38');
    expect(sourceRefLabel(w('W-U01').sources[0]!)).toBe('Safety limits'); // its sources are not on the page: the topic as a whole
    for (const r of RULES) expect(sourceRefsLabel(r.sources), r.id).not.toMatch(/§|\d\d \d|\[\d/);
  });
});

describe('simulated warnings carry their sources', () => {
  const rp = resolveProfile({
    schemaVersion: 1,
    body: { sex: 'male', ageYears: 34, heightCm: 178, weightKg: 88 },
    habits: { sessionsPerWeek: 0 },
    startDate: '2026-10-05',
  } as PersonProfile);
  const deficit: DayTemplate = {
    id: 'deficit',
    label: 'deficit',
    energy: { kind: 'pctMaintenance', pct: 45 },
    macros: {
      protein: { unit: 'pctEnergy', value: 30 },
      carbs: { unit: 'pctEnergy', value: 45 },
      fat: { unit: 'remainder' },
    },
    meals: { count: 3, window: { startH: 8, lengthH: 11 } },
  };

  it('a 45 % deficit raises W-E04 with its topic and source numbers, and the pointer only in `src`', () => {
    const s: Schedule = {
      schemaVersion: 1,
      startDate: '2026-10-05',
      horizonDays: 28,
      programs: [deficit],
      days: Array.from({ length: 28 }, () => ({ program: 0 })),
      events: [],
    };
    const { warnings } = runEngine(rp, compileSchedule(s, rp), { record: 'daily', collectWarnings: true });
    const w = warnings.find((x) => x.id === 'W-E04')!;
    expect(w).toBeDefined();
    expect(w.sources).toEqual(RULES.find((r) => r.id === 'W-E04')!.sources);
    expect(sourceRefsLabel(w.sources!)).toBe('Safety limits › references 54, 4');
    expect(w.src).toBe('17 §3 [54][4]');
    expect(warnings.length).toBeGreaterThan(1);
    for (const x of warnings) expect(x.sources?.length, x.id).toBeGreaterThan(0);
  });
});
