/**
 * D8-03: the validation page states each set of checks' role as one status — Verified (software checks under the
 * model), Development (checked against the sources the model was built from), Independently tested (held-out studies) —
 * and never presents one as another.
 */
import { describe, expect, it } from 'vitest';
import { VALIDATION_ROLE } from './ValidationSections';

describe('validation roles (D8-03)', () => {
  it('uses the shared role words', () => {
    expect(VALIDATION_ROLE.verification).toMatch(/^Verified · /);
    expect(VALIDATION_ROLE.development).toMatch(/^Development · /);
    expect(VALIDATION_ROLE.independent(3)).toBe('Independently tested · 3 held-out studies');
    expect(VALIDATION_ROLE.independent(1)).toBe('Independently tested · 1 held-out study');
  });

  it('verification and development checks never claim prediction accuracy for people', () => {
    expect(VALIDATION_ROLE.verification).toMatch(/not a test of predictions/);
    expect(VALIDATION_ROLE.development).toMatch(/not an independent test/);
  });
});
