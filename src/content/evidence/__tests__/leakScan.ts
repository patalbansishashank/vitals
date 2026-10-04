/**
 * Shared by the no-internal-references guard tests: the forbidden patterns and the helpers that walk exported copy and
 * content objects. Follow-up tests for the safety rules and planner explanations should import from here too.
 */
/** The patterns, with the name used in failure messages. `dossiers` (plural) is included on purpose. */
export const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bdossiers?\b/i, 'dossier'],
  [/§/, 'section sign'],
  [/\bR-[A-Z]{2,}/, 'ruling id (R-XXX)'],
  [/\bWP\d/, 'work-package id (WP#)'],
  [/MODEL_SPEC/, 'spec name (MODEL_SPEC)'],
  [/REVIEW:/, 'review marker (REVIEW:)'],
  [/\b(orchestrator|integrator|integration pass)\b/i, 'build-process wording'],
];

/** First forbidden pattern a text matches, as "name: …context…", else null. */
export function leak(text: string): string | null {
  for (const [re, name] of FORBIDDEN) {
    const m = re.exec(text);
    if (m) {
      const at = m.index;
      return `${name}: …${text.slice(Math.max(0, at - 30), at + 50).replace(/\s+/g, ' ')}…`;
    }
  }
  return null;
}

export const report = (hits: string[]): string =>
  `${hits.length} leak(s):\n${hits.slice(0, 40).join('\n')}${hits.length > 40 ? '\n…' : ''}`;

/** Collect every string reachable from a value, with its path; functions are called with probe arguments. */
export function strings(
  value: unknown,
  path: string,
  out: Array<[string, string]>,
  skipKeys: ReadonlySet<string> = new Set(),
  depth = 0,
): void {
  if (depth > 12 || value === null || value === undefined) return;
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value))
    value.forEach((v, i) => strings(v, `${path}[${i}]`, out, skipKeys, depth + 1));
  else if (typeof value === 'function') {
    for (const args of [[], [1], ['a'], [1, 2], ['female', 3], ['x', 1, 2], [{}]]) {
      try {
        strings(
          (value as (...a: unknown[]) => unknown)(...args),
          `${path}(${args.map(String).join(',')})`,
          out,
          skipKeys,
          depth + 1,
        );
      } catch {
        /* wrong probe for this function */
      }
    }
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!skipKeys.has(k)) strings(v, `${path}.${k}`, out, skipKeys, depth + 1);
    }
  }
}

export function scan(rows: Array<[string, string]>): string[] {
  const hits: string[] = [];
  for (const [path, text] of rows) {
    const l = leak(text);
    if (l) hits.push(`${path}  ${l}`);
  }
  return hits;
}
