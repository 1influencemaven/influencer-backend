import {
  agencyDiscoveryInputSchema,
  agencyDiscoveryOutputSchema,
  type AgencyDiscoveryInput,
  type AgencyDiscoveryOutput,
  type AgencySerpHit,
} from '@influence-maven/ai-contracts';

/**
 * Minimal host normalize (mirrors Nest agency-domain.util) — no Nest imports in worker.
 */
function normalizeDomain(websiteOrHost: string): string {
  const trimmed = websiteOrHost?.trim() ?? '';
  if (!trimmed) return '';
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    return new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      ?.split('?')[0]
      ?.trim() ?? '';
  }
}

// --- Classification heuristics (parity with Nest classify-agency-hit) ---

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
  'medium.com',
  'forbes.com',
  'clutch.co',
  'www.clutch.co',
  'g2.com',
  'sortlist.com',
  'designrush.com',
]);

const LISTICLE_PATH =
  /\/(best|top)-[\w-]*(agenc|influencer|marketing)|\/list-of-|\/directory\b|\/agencies\b/i;
const DIRECTORY_TEXT =
  /\b(top\s+\d+|best\s+influencer\s+marketing\s+agencies|list\s+of\s+agencies|agency\s+directory|roundup)\b/i;
const MARKETPLACE_TEXT =
  /\b(influencer\s+marketplace|creator\s+marketplace|self-?serve\s+platform|marketplace\s+for\s+brands\s+and\s+creators)\b/i;
const TALENT_TEXT =
  /\b(talent\s+agency|talent\s+management|talent\s+representation|exclusive\s+representation|represents?\s+(creators?|influencers?|talent)|creator\s+roster)\b/i;
const IMA_TEXT =
  /\b(influencer\s+marketing\s+agency|connects?\s+brands?\s+with\s+(creators?|influencers?)|creator\s+partnerships?\s+for\s+brands?|influencer\s+campaigns?\s+for\s+brands?|brand[- ]influencer\s+collaborations?\s+agency|manages?\s+influencer\s+(campaigns?|programs?)\s+for\s+brands?)\b/i;
const GENERAL_MARKETING_TEXT =
  /\b(digital\s+marketing\s+agency|full[- ]service\s+marketing|performance\s+marketing\s+agency|seo\s+agency|ppc\s+agency)\b/i;

function classifyHit(
  hit: AgencySerpHit,
  context: {
    niches: string[];
    markets: string[];
    country?: string | null;
    fetchedAt: string;
  },
): AgencyDiscoveryOutput['candidates'][number] | null {
  const domain = normalizeDomain(hit.url);
  if (!domain || !domain.includes('.')) return null;

  const blob = `${hit.title}\n${hit.content ?? ''}\n${hit.url}`.toLowerCase();
  const host = domain.toLowerCase();
  const isNoise =
    DIRECTORY_OR_NOISE_HOSTS.has(host) ||
    [...DIRECTORY_OR_NOISE_HOSTS].some(
      (h) => host === h || host.endsWith(`.${h}`),
    );
  const isListicle =
    LISTICLE_PATH.test(hit.url) || DIRECTORY_TEXT.test(blob) || isNoise;

  let agencyType: AgencyDiscoveryOutput['candidates'][number]['agency']['agencyType'] =
    'OTHER';
  let relevanceStatus: AgencyDiscoveryOutput['candidates'][number]['association']['relevanceStatus'] =
    'UNDER_REVIEW';
  let explanation =
    'Insufficient evidence to classify as an influencer marketing intermediary.';
  let sourceKind: 'serp' | 'directory' | 'website' | 'other' = 'serp';

  if (isListicle) {
    agencyType = 'DIRECTORY';
    relevanceStatus = 'DISCARDED';
    explanation =
      'Result looks like a directory, listicle, or non-organization publisher.';
    sourceKind = 'directory';
  } else if (MARKETPLACE_TEXT.test(blob)) {
    agencyType = 'MARKETPLACE';
    relevanceStatus = 'NOT_RELEVANT';
    explanation =
      'Signals point to a marketplace/platform, not an influencer marketing agency.';
  } else if (TALENT_TEXT.test(blob) && !IMA_TEXT.test(blob)) {
    agencyType = 'TALENT_REPRESENTATION';
    relevanceStatus = 'NOT_RELEVANT';
    explanation =
      'Signals point to talent representation, not brand↔influencer brokerage.';
  } else if (IMA_TEXT.test(blob)) {
    agencyType = 'INFLUENCER_MARKETING_AGENCY';
    relevanceStatus = 'RELEVANT';
    explanation =
      'SERP evidence indicates an agency that connects brands with influencers.';
  } else if (GENERAL_MARKETING_TEXT.test(blob)) {
    agencyType = 'GENERAL_MARKETING';
    relevanceStatus = 'NOT_RELEVANT';
    explanation =
      'General marketing agency without clear brand↔influencer intermediary evidence.';
  } else if (/\bagency\b|\binfluencer\b|\bcreator\b/i.test(blob)) {
    agencyType = 'OTHER';
    relevanceStatus = 'UNDER_REVIEW';
    explanation =
      'Mentions agency/influencer terms but lacks explicit intermediary evidence.';
  }

  const excerpt = (hit.content ?? hit.title).replace(/\s+/g, ' ').trim().slice(0, 500);
  const name =
    hit.title.split(/\s+[|\-–—]\s+/)[0]?.trim() ||
    domain.split('.')[0] ||
    domain;

  return {
    agency: {
      name: name.slice(0, 300),
      domain,
      website: `https://${domain}`,
      agencyType,
      description: excerpt || undefined,
      ...(context.country ? { country: context.country } : {}),
    },
    association: {
      relevanceStatus,
      relevanceExplanation: explanation,
      niches: context.niches.slice(0, 20),
      markets: context.markets.slice(0, 20),
      evidenceUrls: [hit.url],
      evidence: [
        {
          url: hit.url,
          excerpt: excerpt || undefined,
          note: explanation.slice(0, 300),
          sourceKind,
          fetchedAt: context.fetchedAt,
        },
      ],
    },
  };
}

export type RunDiscoverAgenciesResult =
  | { ok: true; output: AgencyDiscoveryOutput }
  | { ok: false; code: 'AI_INVALID_OUTPUT' | 'AI_INTERNAL_ERROR'; message: string };

/**
 * Mastra-side DISCOVER_AGENCIES classifier.
 * Expects Nest-provided `searchHits` (Nest owns SERP). Evidence heuristics only in 2C.2
 * (LLM refinement can be added later without changing contracts).
 */
export async function runDiscoverAgencies(
  input: AgencyDiscoveryInput,
): Promise<RunDiscoverAgenciesResult> {
  try {
    const parsed = agencyDiscoveryInputSchema.parse(input);
    const hits = parsed.searchHits ?? [];
    if (hits.length === 0) {
      const output = agencyDiscoveryOutputSchema.parse({
        operation: 'DISCOVER_AGENCIES',
        outcome: 'NO_MATCHES',
        candidates: [],
        summary: 'No searchHits provided for classification',
        searchMetadata: {
          schemaVersion: 1,
          searchHitsCount: 0,
          classifiedCount: 0,
          providerId: 'influencer-ai-discover-agencies',
          notes: 'classifier_requires_searchHits',
        },
      });
      return { ok: true, output };
    }

    const niches = [
      ...(parsed.niches ?? []),
      ...(parsed.niche ? [parsed.niche] : []),
      ...(parsed.subNiche ? [parsed.subNiche] : []),
      ...(parsed.ibpTargetSectors ?? []),
    ].filter((v): v is string => Boolean(v?.trim()));
    const markets = [
      ...(parsed.markets ?? []),
      ...(parsed.ibpMarkets ?? []),
      ...(parsed.country ? [parsed.country] : []),
    ].filter((v): v is string => Boolean(v?.trim()));

    const fetchedAt = new Date().toISOString();
    const seen = new Set<string>();
    const candidates: AgencyDiscoveryOutput['candidates'] = [];
    for (const hit of hits) {
      const c = classifyHit(hit, {
        niches,
        markets,
        country: parsed.country,
        fetchedAt,
      });
      if (!c || seen.has(c.agency.domain)) continue;
      seen.add(c.agency.domain);
      candidates.push(c);
    }

    const output = agencyDiscoveryOutputSchema.parse({
      operation: 'DISCOVER_AGENCIES',
      outcome: candidates.length > 0 ? 'RESULTS_FOUND' : 'NO_MATCHES',
      candidates,
      summary: `Classified ${candidates.length} agenc(y/ies) from ${hits.length} hit(s)`,
      searchMetadata: {
        schemaVersion: 1,
        searchHitsCount: hits.length,
        dedupedHitsCount: seen.size,
        classifiedCount: candidates.length,
        providerId: 'influencer-ai-discover-agencies',
      },
    });
    return { ok: true, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: 'AI_INTERNAL_ERROR',
      message: message.slice(0, 2000),
    };
  }
}
