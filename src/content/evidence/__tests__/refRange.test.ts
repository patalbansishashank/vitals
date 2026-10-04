// @vitest-environment node
/**
 * Every structured evidence pointer a screen renders ("Safety limits › references 6, 7") names a topic that exists and
 * reference numbers that are on that topic's page: metrics, safety rules and model parameters.
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '@/engine/model/safety/rules';
import { SERIES } from '@/engine/types/metrics';
import { EVIDENCE_TOPICS } from '../index';
import { ALL_PARAMS } from '../params';
import type { SourceRef } from '../schema';
import { paramSource } from '../sources';

describe('evidence pointers resolve', () => {
  it('every topic and reference number a pointer names is on the topic page', async () => {
    const count = new Map<string, number>();
    for (const e of EVIDENCE_TOPICS) {
      const mod = (await e.load()) as Record<string, unknown>;
      const topic = Object.values(mod).find((v): v is { references: unknown[] } => !!v && typeof v === 'object' && 'references' in v);
      count.set(e.slug, topic?.references.length ?? 0);
    }
    expect([...count.values()].filter((n) => n === 0)).toEqual([]);
    const bad: string[] = [];
    const check = (where: string, refs: readonly SourceRef[]): void => {
      for (const r of refs) {
        const n = count.get(r.topic);
        if (n === undefined) bad.push(`${where}: unknown topic ${r.topic}`);
        for (const k of r.refs ?? []) if (!(Number.isInteger(k) && k >= 1 && k <= (n ?? 0))) bad.push(`${where}: ${r.topic} reference ${k} of ${n}`);
      }
    };
    for (const s of SERIES) check(`metric ${s.id}`, s.sources);
    for (const r of RULES) check(`rule ${r.id}`, r.sources);
    for (const p of ALL_PARAMS) check(`param ${p.id}`, paramSource(p).topics);
    expect(bad).toEqual([]);
  });
});
