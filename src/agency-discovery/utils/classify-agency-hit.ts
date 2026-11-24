import type {
  AgencyDiscoveryCandidate,
  AgencyEvidenceRef,
  AgencyRelevanceStatus,
  AgencySerpHit,
  AgencyType,
} from '@influence-maven/ai-contracts';

import { normalizeAgencyDomain } from '../../lead-discovery/utils/agency-domain.util';

/** Hosts that are almost never a discrete agency organization. */
const DIRECTORY_OR_NOISE_HOSTS = new Set([
  'wikipedia.org',
  'en.wikipedia.org',
  'linkedin.com',
  'www.linkedin.com',
  'youtube.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'reddit.com',
  'quora.com',
  'medium.com',
  'forbes.com',
  'businessinsider.com',
  'clutch.co',
  'www.clutch.co',
  'g2.com',
  'www.g2.com',
  'sortlist.com',
  'designrush.com',
  'agencyfinder.com',
  'upcity.com',
]);

const LISTICLE_PATH =
  /\/(best|top)-[\w-]*(agenc|influencer|marketing)|\/list-of-|\/directory\b|\/agencies\b/i;

const DIRECTORY_TEXT =
  /\b(top\s+\d+|best\s+influencer\s+marketing\s+agencies|list\s+of\s+agencies|agency\s+directory|roundup|compared)\b/i;

/**
 * Listicle / guide titles: "Top Fashion Influencer Marketing Agencies for November",
 * "The Ultimate Guide to …", "How to Choose an Influencer Marketing Agency?",
 * "19 Brands That Work with …". An agency's own page names itself, not a plural.
 */
const LISTICLE_TITLE =
  /^\s*(top|best|the\s+(ultimate|best|top)|how|why|what|which|\d+\s)\b|\b(marketing|influencer|creator|fashion|beauty|pr|talent|boutique|digital|social\s+media)\s+(agencies|platforms|companies)\b|\b(guide|looking\s+for)\b/i;

const MARKETPLACE_TEXT =
  /\b(influencer\s+marketplace|creator\s+marketplace|self-?serve\s+platform|saas\s+platform\s+for\s+influencer|marketplace\s+for\s+brands\s+and\s+creators)\b/i;

const TALENT_TEXT =
  /\b(talent\s+agency|talent\s+management|talent\s+representation|exclusive\s+representation|represents?\s+(creators?|influencers?|talent)|creator\s+roster)\b/i;

const IMA_TEXT =
  /\b(influencer\s+marketing\s+agency|connects?\s+brands?\s+with\s+(creators?|influencers?)|creator\s+partnerships?\s+for\s+brands?|influencer\s+campaigns?\s+for\s+brands?|brand[- ]influencer\s+collaborations?\s+agency|manages?\s+influencer\s+(campaigns?|programs?)\s+for\s+brands?)\b/i;

const GENERAL_MARKETING_TEXT =
  /\b(digital\s+marketing\s+agency|full[- ]service\s+marketing|performance\s+marketing\s+agency|seo\s+agency|ppc\s+agency)\b/i;

export type ClassifyAgencyHitContext = {
  niches?: string[];
  markets?: string[];
  country?: string | null;
  fetchedAt?: string;
};

function compactName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Agency name from the SERP title, only when it actually names the site
 * ("Cure Media: Leading Agency…" -> "Cure Media"). Descriptive titles
 * ("Beauty & Skincare Influencer Marketing Agency") fall back to the domain label.
 */
export function titleToName(title: string, domain: string): string {
  const cleaned = title
    .split(/\s+[|\-–—·]\s+|:\s+/)[0]
    ?.replace(/\s+/g, ' ')
    .trim();
  const hostLabel = domain.split('.')[0] ?? domain;
  const label = compactName(hostLabel);
  if (cleaned && cleaned.length >= 2 && cleaned.length <= 120) {
    const compact = compactName(cleaned);
    const firstWord = compactName(cleaned.split(' ')[0] ?? '');
    const namesSite =
      compact.includes(label) ||
      (firstWord.length >= 3 && label.startsWith(firstWord));
    if (namesSite) return cleaned;
  }
  return hostLabel
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function websiteFromDomain(domain: string): string {
  return `https://${domain}`;
}

function blobOf(hit: AgencySerpHit): string {
  return `${hit.title}\n${hit.content ?? ''}\n${hit.url}`.toLowerCase();
}

function hostOf(domain: string): string {
  return domain.toLowerCase();
}

/**
 * Evidence-oriented heuristic classifier for a single SERP hit.
 * Never marks RELEVANT without IMA-style evidence phrases in title/snippet/url.
 */
export function classifyAgencySerpHit(
  hit: AgencySerpHit,
  context: ClassifyAgencyHitContext = {},
): AgencyDiscoveryCandidate | null {
  const domain = normalizeAgencyDomain(hit.url);
  if (!domain || !domain.includes('.')) {
    return null;
  }

  const blob = blobOf(hit);
  const host = hostOf(domain);
  const fetchedAt = context.fetchedAt ?? new Date().toISOString();

  let agencyType: AgencyType = 'OTHER';
  let relevanceStatus: AgencyRelevanceStatus = 'UNDER_REVIEW';
  let explanation =
    'Insufficient evidence to classify as an influencer marketing intermediary.';
  let sourceKind: AgencyEvidenceRef['sourceKind'] = 'serp';

  const isNoiseHost =
    DIRECTORY_OR_NOISE_HOSTS.has(host) ||
    [...DIRECTORY_OR_NOISE_HOSTS].some(
      (h) => host === h || host.endsWith(`.${h}`),
    );
  const isListicle =
    LISTICLE_PATH.test(hit.url) ||
    DIRECTORY_TEXT.test(blob) ||
    LISTICLE_TITLE.test(hit.title) ||
    isNoiseHost;

  if (isListicle) {
    agencyType = 'DIRECTORY';
    relevanceStatus = 'DISCARDED';
    explanation =
      'Result looks like a directory, listicle, or non-organization publisher — not a discrete agency.';
    sourceKind = 'directory';
  } else if (MARKETPLACE_TEXT.test(blob)) {
    agencyType = 'MARKETPLACE';
    relevanceStatus = 'NOT_RELEVANT';
    explanation =
      'Signals point to a marketplace/platform rather than an influencer marketing agency intermediating brands.';
  } else if (TALENT_TEXT.test(blob) && !IMA_TEXT.test(blob)) {
    agencyType = 'TALENT_REPRESENTATION';
    relevanceStatus = 'NOT_RELEVANT';
    explanation =
      'Signals point to talent representation/roster management, not brand↔influencer campaign brokerage.';
  } else if (IMA_TEXT.test(blob)) {
    agencyType = 'INFLUENCER_MARKETING_AGENCY';
    relevanceStatus = 'RELEVANT';
    explanation =
      'SERP evidence indicates an agency that connects brands with influencers or runs influencer campaigns for brands.';
  } else if (GENERAL_MARKETING_TEXT.test(blob)) {
    agencyType = 'GENERAL_MARKETING';
    relevanceStatus = 'NOT_RELEVANT';
    explanation =
      'Looks like a general marketing agency without clear brand↔influencer intermediary evidence.';
  } else if (/\bagency\b|\binfluencer\b|\bcreator\b/i.test(blob)) {
    agencyType = 'OTHER';
    relevanceStatus = 'UNDER_REVIEW';
    explanation =
      'Mentions agency/influencer terms but lacks explicit evidence of connecting brands with creators.';
  }

  const excerpt = (hit.content ?? hit.title)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  const evidence: AgencyEvidenceRef[] = [
    {
      url: hit.url,
      excerpt: excerpt || undefined,
      note: explanation.slice(0, 300),
      sourceKind,
      fetchedAt,
    },
  ];

  const niches = (context.niches ?? []).filter(Boolean).slice(0, 20);
  const markets = [
    ...(context.markets ?? []),
    ...(context.country ? [context.country] : []),
  ]
    .filter(Boolean)
    .slice(0, 20);

  const name = titleToName(hit.title, domain);

  return {
    agency: {
      name,
      domain,
      website: websiteFromDomain(domain),
      agencyType,
      description: excerpt.slice(0, 500) || undefined,
      ...(context.country ? { country: context.country } : {}),
    },
    association: {
      relevanceStatus,
      relevanceExplanation: explanation,
      niches,
      markets,
      evidenceUrls: [hit.url],
      evidence,
    },
  };
}

export function classifyAgencySerpHits(
  hits: AgencySerpHit[],
  context: ClassifyAgencyHitContext = {},
): AgencyDiscoveryCandidate[] {
  const out: AgencyDiscoveryCandidate[] = [];
  const seenDomains = new Set<string>();
  for (const hit of hits) {
    const candidate = classifyAgencySerpHit(hit, context);
    if (!candidate) continue;
    if (seenDomains.has(candidate.agency.domain)) continue;
    seenDomains.add(candidate.agency.domain);
    out.push(candidate);
  }
  return out;
}
