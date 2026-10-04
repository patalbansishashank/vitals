import type { EvidenceTopic, Mechanism, Reference } from '@/content/evidence/schema';
import { sourceAnchor } from '../links';

export interface NumberedReference {
  n: number;
  ref: Reference;
}

/**
 * Sources of one article, numbered in the order they are cited: the mechanism's own
 * list first, then any extra ones its key numbers cite. Ids that do not resolve are
 * skipped (the content test guards against them).
 */
export function numberReferences(mechanism: Mechanism, topic: EvidenceTopic): NumberedReference[] {
  const byId = new Map(topic.references.map((r) => [r.id, r]));
  const order: string[] = [];
  const push = (id: string) => {
    if (!order.includes(id) && byId.has(id)) order.push(id);
  };
  mechanism.referenceIds.forEach(push);
  for (const k of mechanism.keyNumbers) k.referenceIds?.forEach(push);
  return order.map((id, i) => ({ n: i + 1, ref: byId.get(id)! }));
}

/** Topic page: the dossier's reference list, numbered as authored. Duplicate ids keep the first. */
export function numberTopicReferences(topic: EvidenceTopic): NumberedReference[] {
  const seen = new Set<string>();
  const out: NumberedReference[] = [];
  for (const ref of topic.references) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push({ n: out.length + 1, ref });
  }
  return out;
}

export interface ExternalLink {
  kind: 'pubmed' | 'doi' | 'fulltext' | 'web';
  label: string;
  href: string;
}

const safeHttp = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
};

/** PubMed, DOI and any other distinct URL for a reference (http(s) only). */
export function referenceLinks(ref: Reference): ExternalLink[] {
  const out: ExternalLink[] = [];
  if (ref.pmid && /^\d+$/.test(ref.pmid))
    out.push({
      kind: 'pubmed',
      label: `PubMed ${ref.pmid}`,
      href: `https://pubmed.ncbi.nlm.nih.gov/${ref.pmid}/`,
    });
  if (ref.doi) {
    const doi = ref.doi.replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, '');
    out.push({
      kind: 'doi',
      label: `doi:${doi}`,
      href: `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`,
    });
  }
  if (ref.url) {
    const href = safeHttp(ref.url);
    if (href) {
      const host = new URL(href).hostname.replace(/^www\./, '');
      const dupPubmed = host === 'pubmed.ncbi.nlm.nih.gov' && out.some((l) => l.kind === 'pubmed');
      const dupDoi = (host === 'doi.org' || host === 'dx.doi.org') && out.some((l) => l.kind === 'doi');
      if (!dupPubmed && !dupDoi) {
        if (host === 'pmc.ncbi.nlm.nih.gov' || host === 'ncbi.nlm.nih.gov')
          out.push({ kind: 'fulltext', label: 'Full text (PMC)', href });
        else out.push({ kind: 'web', label: host, href });
      }
    }
  }
  return out;
}

/** Study-type tags, only when the title itself says so (the schema has no study-type field). */
export function studyTags(ref: Reference): string[] {
  const t = ref.title;
  const tags: string[] = [];
  if (/meta-?analy/i.test(t)) tags.push('meta-analysis');
  else if (/systematic review/i.test(t)) tags.push('systematic review');
  if (/randomi[sz]ed/i.test(t) || /\bRCT\b/.test(t)) tags.push('randomised trial');
  if (/\b(rats?|mice|mouse|murine|rodents?|monkeys?|primates?|pigs?|dogs?|canine|porcine)\b/i.test(t))
    tags.push('animal');
  if (/\bin vitro\b|\bcell culture\b/i.test(t)) tags.push('in vitro');
  return tags;
}

export type VerificationFlag = 'abstract' | 'unverified';

/** Only sources the dossier could not fully check carry a flag. */
export function verificationFlag(ref: Reference): VerificationFlag | null {
  return ref.verification === 'abstract' || ref.verification === 'unverified' ? ref.verification : null;
}

export const VERIFICATION_TEXT: Record<VerificationFlag, { short: string; long: string }> = {
  abstract: {
    short: 'checked at abstract level only',
    long: 'The research team could confirm this source from its abstract, not the full paper.',
  },
  unverified: {
    short: 'unverified',
    long: 'The research team could not confirm this citation. Treat numbers that rest on it with care.',
  },
};

/** APA-like plain-text citation for the copy key. */
export function formatCitation(ref: Reference): string {
  const authors = ref.authors.trim().replace(/[.;,]+$/, '');
  const title = ref.title.trim().replace(/[.]+$/, '');
  const journal = ref.journal.trim().replace(/[.;,]+$/, '');
  const link = ref.doi
    ? ` https://doi.org/${ref.doi}`
    : ref.pmid
      ? ` https://pubmed.ncbi.nlm.nih.gov/${ref.pmid}/`
      : ref.url
        ? ` ${ref.url}`
        : '';
  return `${authors} (${ref.year}). ${title}. ${journal}.${link}`;
}

/** Count sources by verification state. */
export function verificationSummary(refs: readonly NumberedReference[]): Record<VerificationFlag, number> {
  const out: Record<VerificationFlag, number> = { abstract: 0, unverified: 0 };
  for (const { ref } of refs) {
    const f = verificationFlag(ref);
    if (f) out[f] += 1;
  }
  return out;
}

/**
 * A topic-page hash from engine data ("ref-6": the sixth numbered source) → the id of that source's entry; any other hash
 * is returned unchanged. Out-of-range numbers fall back to the sources section.
 */
export function resolveTopicHash(hash: string, topic: EvidenceTopic): string {
  const m = /^ref-(\d+)$/.exec(hash);
  if (!m) return hash;
  const ref = numberTopicReferences(topic)[Number(m[1]) - 1];
  return ref ? sourceAnchor(ref.ref.id) : 'citations';
}
