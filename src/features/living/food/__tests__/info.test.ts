import { describe, expect, it } from 'vitest';
import { infoProblems } from '../../components/info';
import { INFO } from '../copy';

describe('Food: every (i) text', () => {
  it('is the right length, cites real evidence topics and stays plain', () => {
    expect(Object.entries(INFO).flatMap(([id, entry]) => infoProblems(entry, id))).toEqual([]);
  });

  it('has a title and a source line on every card that explains a number', () => {
    for (const [id, entry] of Object.entries(INFO)) expect(entry.title, id).toBeTruthy();
  });
});
