// @vitest-environment node
/**
 * Guard for the public snapshot: every file publish-public.sh would ship (the scanned tree minus exclude.txt) must be
 * free of private names: tailnet names, tailnet addresses, e-mail addresses, private host names, and the owner's own
 * values. Documentation keeps to the reserved examples (`*.example.ts.net`, 100.64.0.1, fd7a:115c:a1e0::1, …).
 *
 * The owner's own values (real name, tailnet name, person id) never sit in this file: they are read from the
 * git-ignored qa/local.config.json (`neverPublic`, `ownerPersonId`; path override `VITALS_QA_CONFIG`). Without that
 * file only the general checks run; publish-public.sh refuses to publish without it. Failures name the kind of hit and
 * the files, never the hit.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { excludeMatcher, listPaths, publishExcluded, readText, REPO } from './scan';

const HANDLE = 'patalbansishashank'; // the GitHub handle, public by design (URLs, the no-reply commit identity)

// The one file that documents the IFCT 2017 dataset licence quotes its contact address (it is excluded, under plan/).
const IFCT_LICENCE = ['plan/01-after-launch/research/R4-food-recipes-supplements.md'];
const IFCT_MAIL = `ifct2017@${String.fromCharCode(103, 109, 97, 105, 108)}.com`;

const CGNAT_EXAMPLES = new Set(['100.64.0.0', '100.64.0.1', '100.64.0.2']);
const ULA_EXAMPLES = new Set(['fd7a:115c:a1e0::', 'fd7a:115c:a1e0::1']); // `fd7a:115c:a1e0::/48` and the example address
const MAIL_DOMAINS = new Set(['users.noreply.github.com', 'noreply.github.com', 'anthropic.com']);
const HOST = 'vitals.creative.desi';

/** The owner's own values, from the git-ignored local config. */
interface PrivateValues {
  /** Words that must appear in no public file: the owner's names, the tailnet name. Whole words, any case. */
  words: string[];
  /** The owner's person id on the server. */
  personId: string | null;
}

function privateValues(): PrivateValues {
  // Set by publish-public.sh: there the owner's checks are required, never silently skipped.
  const required = Boolean(process.env.VITALS_QA_CONFIG);
  const p = process.env.VITALS_QA_CONFIG || join(REPO, 'qa/local.config.json');
  if (!existsSync(p)) {
    if (required) throw new Error('VITALS_QA_CONFIG points at a missing file');
    return { words: [], personId: null };
  }
  const cfg = JSON.parse(readFileSync(p, 'utf8')) as { neverPublic?: unknown; ownerPersonId?: unknown };
  const words = Array.isArray(cfg.neverPublic) ? cfg.neverPublic.filter((w): w is string => typeof w === 'string' && w.length >= 3) : [];
  const id = typeof cfg.ownerPersonId === 'string' && /^[0-9a-f]{16}$/i.test(cfg.ownerPersonId) && !/^0+$/.test(cfg.ownerPersonId) ? cfg.ownerPersonId : null;
  if (required && !words.length) throw new Error('VITALS_QA_CONFIG has no neverPublic words');
  return { words: words.map((w) => w.toLowerCase()), personId: id?.toLowerCase() ?? null };
}

const mailAllowed = (f: string, address: string) => {
  const [local, domain] = [address.slice(0, address.lastIndexOf('@')).toLowerCase(), address.slice(address.lastIndexOf('@') + 1).toLowerCase()];
  if (local === 'noreply' || local === 'no-reply' || MAIL_DOMAINS.has(domain)) return true;
  if (domain.startsWith('example.') || domain.includes('.example.') || domain.endsWith('.invalid') || domain.endsWith('.test')) return true;
  return IFCT_LICENCE.includes(f) && address.toLowerCase() === IFCT_MAIL;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Each kind of private value, as a test on one file's text. */
function kinds(own: PrivateValues): Record<string, (text: string, f: string) => boolean> {
  const words = own.words.map((w) => new RegExp(`(^|[^a-z0-9])${escape(w)}($|[^a-z0-9])`, 'i'));
  return {
    // A tailnet's MagicDNS name is `tail` + 6 hex digits, with or without `.ts.net`.
    'tailnet name': (t) => /\btail[0-9a-f]{5,}\.ts\.net\b/i.test(t) || /\btail[0-9a-f]{6}\b/i.test(t),
    'tailnet IPv4 (100.64.0.0/10)': (t) => (t.match(/\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g) ?? []).some((a) => !CGNAT_EXAMPLES.has(a)),
    'tailnet IPv6 (fd7a:115c:a1e0::/48)': (t) => (t.match(/fd7a:115c:a1e0:[0-9a-f:]+/gi) ?? []).some((a) => !ULA_EXAMPLES.has(a.toLowerCase())),
    'e-mail address': (t, f) => f !== 'pnpm-lock.yaml' && (t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).some((a) => !mailAllowed(f, a)),
    'private host name': (t) => (t.match(/\b[a-z0-9.-]+\.creative\.desi\b/gi) ?? []).some((h) => h.toLowerCase() !== HOST),
    "the owner's own words (name, tailnet)": (t) => {
      if (!words.length) return false;
      const s = t.replace(new RegExp(HANDLE, 'gi'), '');
      return words.some((re) => re.test(s));
    },
    'person id': (t) => own.personId !== null && t.toLowerCase().includes(own.personId),
  };
}

/** `kind: file, file` for every kind with hits, in kinds() order. */
function scan(files: string[], read: (f: string) => string | null, own: PrivateValues): string[] {
  const tests = kinds(own);
  const hits = new Map<string, string[]>(Object.keys(tests).map((k) => [k, []]));
  for (const f of files) {
    const text = read(f);
    if (text === null) continue;
    for (const [kind, test] of Object.entries(tests)) if (test(text, f)) hits.get(kind)!.push(f);
  }
  return [...hits].filter(([, fs]) => fs.length).map(([k, fs]) => `${k}: ${fs.join(', ')}`);
}

describe('private names in the public snapshot', () => {
  it('reads exclude.txt the way publish-public.sh applies it', () => {
    const ex = excludeMatcher('# note\n\nplan/\nqa/findings-*.md\ndocs/HANDOFF.md\n');
    expect(['plan/04-next/PLAN.md', 'qa/findings-q3.md', 'docs/HANDOFF.md'].every(ex)).toBe(true);
    expect(['planner/x.ts', 'qa/findings-q3.md.bak', 'qa/sub/findings-q3.md', 'docs/HANDOFF.mdx', 'docs/x/HANDOFF.md'].some(ex)).toBe(false);
  });

  it('allows the reserved examples and flags the rest', () => {
    // Made-up owner values: the real ones live only in the git-ignored local config.
    const own: PrivateValues = { words: ['zorblat', 'quuxley'], personId: '0123456789abcdef' };
    const ok = [
      'vpn.example.ts.net tail1234 tail0 tail.ts.net tailwind 100.64.0.0/10 100.64.0.1 100.64.0.2 fd7a:115c:a1e0::/48 fd7a:115c:a1e0::1',
      'a@example.com b@x.example.org c@x.invalid d@x.test noreply@anthropic.com 1+x@users.noreply.github.com no-reply@x.org',
      `https://${HOST}/ @scope/pkg@1.2.3 github.com/${HANDLE} 100.63.1.1 100.128.0.1 zorblatty unquuxley 0123456789abcde`,
    ];
    expect(scan(ok.map((_, i) => `f${i}`), (f) => ok[Number(f.slice(1))]!, own)).toEqual([]);
    // Split in the source so this file stays clean under its own scan.
    const bad = [
      ['x.tail', 'abcdef.ts.net'],
      ['tail', 'c0ffee'],
      ['100.', '100.9.9'],
      ['fd7a:115c:', 'a1e0::9'],
      ['a@', 'b.com'],
      ['server.', HOST],
      ['Zorblat'],
      ['/home/', 'zorblat', '/x'],
      ['QUUXLEY'],
      ['0123456789', 'ABCDEF'],
    ].map((p) => p.join(''));
    expect(bad.map((t) => scan(['f'], () => t, own).map((l) => l.replace(/: f$/, '')))).toEqual([
      ['tailnet name'],
      ['tailnet name'],
      ['tailnet IPv4 (100.64.0.0/10)'],
      ['tailnet IPv6 (fd7a:115c:a1e0::/48)'],
      ['e-mail address'],
      ['private host name'],
      ["the owner's own words (name, tailnet)"],
      ["the owner's own words (name, tailnet)"],
      ["the owner's own words (name, tailnet)"],
      ['person id'],
    ]);
  });

  it('appear in no public file', () => {
    const excluded = publishExcluded();
    const own = privateValues();
    expect(scan(listPaths().filter((f) => !excluded(f)), readText, own), 'use the reserved examples (docs keep to *.example.*)').toEqual([]);
  }, 60_000);
});
