// @vitest-environment node
/**
 * Body measures that are not numbers (a damaged or imported profile) must not switch the safety gates off (review V1b):
 * an age that is not a number fails the adults-only gate; a height, weight or body fat that is not a number makes the
 * request invalid instead of planning with the BMI and body-fat caps silently off.
 */
import { describe, expect, it } from 'vitest';
import { compileRequest } from '../context';
import { runLadderPlanner } from '../ladderPlanner';
import { PERSON, baseRequest } from './replan.fixtures';

const withBody = (body: Partial<typeof PERSON.body>) => baseRequest({ profile: { ...PERSON, body: { ...PERSON.body, ...body } } });

describe('safety gates with body measures that are not numbers', () => {
  it('the valid profile compiles without problems', () => {
    const ctx = compileRequest(baseRequest());
    expect(ctx.caps.blocked).toBeNull();
    expect(ctx.problems).toEqual([]);
  });
  it('an age that is not a number is blocked like a minor', async () => {
    expect(compileRequest(withBody({ ageYears: NaN })).caps.blocked).toMatch(/adults only/);
    const r = await runLadderPlanner(withBody({ ageYears: NaN }), { ideal: false });
    expect(r.status).toBe('blocked');
  });
  it.each([
    ['height', { heightCm: NaN }],
    ['weight', { weightKg: NaN }],
    ['weight (infinite)', { weightKg: Infinity }],
    ['body fat', { knownBodyFatPct: NaN }],
  ])('a %s that is not a number makes the request invalid', async (_n, body) => {
    expect(compileRequest(withBody(body)).problems.join(' ')).toMatch(/must be numbers/);
    expect((await runLadderPlanner(withBody(body), { ideal: false })).status).toBe('invalid');
  });
});
