import { describe, expect, it } from 'vitest';
import { EVIDENCE_TOPICS } from '@/content/evidence';
import { INFO_WORDS, evidenceTopicTitle, infoProblems, infoSpec, infoWords, type InfoEntry } from '../info';

const WORDS = 'Every target comes from your plan for today and what you logged adds up from the foods you typed or the Coach read for you, with a likely range wherever a number is an estimate and not a measurement.';

const entry: InfoEntry = { title: 'Today’s targets', body: WORDS, source: { kind: 'logged', words: 'Your meals.' }, range: 'Usually within 5 %', terms: [{ term: 'Partial', text: 'Some food has no figure yet.' }], evidence: ['protein-muscle', 'fibre-hydration-substances'] };

describe('infoSpec: an (i) entry as the foundation’s InfoSpec', () => {
  it('passes the text, the source, the range and the terms through', () => {
    const spec = infoSpec(entry);
    expect(spec.title).toBe('Today’s targets');
    expect(spec.body).toBe(WORDS);
    expect(spec.source).toEqual({ kind: 'logged', words: 'Your meals.' });
    expect(spec.range).toBe('Usually within 5 %');
    expect(spec.terms).toEqual([{ term: 'Partial', text: 'Some food has no figure yet.' }]);
  });

  it('turns an evidence slug into a topic link titled from the topic itself', () => {
    const spec = infoSpec(entry);
    expect(spec.evidence).toEqual([
      { to: '/evidence/topics/protein-muscle', label: evidenceTopicTitle('protein-muscle') },
      { to: '/evidence/topics/fibre-hydration-substances', label: evidenceTopicTitle('fibre-hydration-substances') },
    ]);
    expect(evidenceTopicTitle('protein-muscle')).toBe(EVIDENCE_TOPICS.find((t) => t.slug === 'protein-muscle')!.title);
  });

  it('drops a slug that is not a topic instead of linking nowhere, and says so to a test', () => {
    const bad: InfoEntry = { ...entry, evidence: 'no-such-topic' };
    expect(infoSpec(bad).evidence).toBeUndefined();
    expect(infoProblems(bad, 'bad')).toContain('bad: no evidence topic "no-such-topic"');
  });

  it('leaves out what an entry does not have, and lets a page add the nodes', () => {
    const spec = infoSpec({ body: WORDS }, { footer: 'foot', range: 'node' });
    expect(Object.keys(spec).sort()).toEqual(['body', 'footer', 'range']);
    expect(spec.range).toBe('node');
  });

  it('keeps sections with their headings', () => {
    const spec = infoSpec({ body: [{ heading: 'Logged', body: 'It saves at once.' }, { body: 'You can undo it.' }] });
    expect(spec.body).toEqual([{ heading: 'Logged', body: 'It saves at once.' }, { body: 'You can undo it.' }]);
  });
});

describe('infoProblems: the guard a feature’s copy test runs', () => {
  it('passes a plain entry of the right length', () => {
    expect(infoWords(entry)).toBeGreaterThanOrEqual(INFO_WORDS.min);
    expect(infoProblems(entry, 'ok')).toEqual([]);
  });

  it('flags a text that is too short or too long', () => {
    expect(infoProblems({ body: 'Too short.' }, 'short')[0]).toMatch(/^short: 2 words/);
    expect(infoProblems({ body: Array(90).fill('word').join(' ') }, 'long')[0]).toMatch(/^long: 90 words/);
  });

  it('flags moralising, shouting and pointers at the build', () => {
    expect(infoProblems({ body: `${WORDS} Don’t cheat!` }, 'm')).toContain('m: moralising or shouting');
    expect(infoProblems({ body: `${WORDS} See AUDIT §1.2 or src/features/x.tsx.` }, 'p')).toContain('p: points at the build');
  });
});
