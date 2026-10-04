/**
 * The only place the onboarding UI reads the clock. Pure logic (safetyRules.ts) and the safety store take
 * ISO strings from here, so tests can pin time with `vi.setSystemTime`.
 */
export function nowIso(): string {
  return new Date().toISOString();
}
