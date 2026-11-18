import type { ScoredBrand } from '@influence-maven/ai-contracts';

import { normalizeDomain } from './brand-domain.util';
import { isSecondaryContentUrl } from './brand-serp-hit-filter.util';

/**
 * Nest-owned commercial entity classification for Brand Discovery SCORE output.
 * Independent of the numeric score — high score cannot override ineligibility.
 */
export type BrandCommercialEntityType =
  | 'product_brand'
  | 'service_company'
  | 'agency'
  | 'tech_platform'
  | 'marketplace'
  | 'directory'
  | 'publisher'
  | 'venture_capital'
  | 'accelerator'
  | 'unknown';

export type BrandCommercialEligibility = {
  entityType: BrandCommercialEntityType;
  commercialEligible: boolean;
  reason: string;
};

export type BrandCommercialEligibilityDiscard = {
  brand: ScoredBrand;
  eligibility: BrandCommercialEligibility;
};

const UGC_MARKETPLACE_HOST_PATTERN =
  /(^|\.)(ofertasugc|ugcagent|theugc|ugc\b|creatormarketplace)/i;

const PARTNERSHIP_SAAS_HOSTS = new Set([
  'impact.com',
  'impactradius.com',
  'partnerstack.com',
  'awardwallet.com',
]);

/** Explicit non-advertiser hosts from real Diana validation (VC / accelerator / directory). */
const VENTURE_CAPITAL_HOSTS = new Set(['500.co']);

const ACCELERATOR_HOSTS = new Set(['ycombinator.com']);

const STARTUP_DIRECTORY_HOSTS = new Set(['f6s.com']);

const DIRECTORY_HOST_PATTERN =
  /(crunchbase|theorg|craft\.co|owler|clutch\.co|g2\.com|capterra|f6s\.com)/i;

const MARKETPLACE_NAME_PATTERN =
  /\b(ugc\s+(marketplace|platform|agency|community|latam)|creator\s+marketplace)\b/i;

const PUBLISHER_FIT_PATTERN =
  /\b(insights?|case\s+studies|listicle|roundup|top\s+dtc|blog\s+post|educational\s+guide|how[- ]to\s+create)\b/i;

const VC_FIT_OR_SECTOR_PATTERN =
  /\b(venture\s+capital|vc\s+firm|early[- ]stage\s+venture|seed\s+fund|startup\s+portfolio|portfolio\s+compan(y|ies)|backed\s+by\s+(a\s+)?(vc|venture))\b/i;

const ACCELERATOR_FIT_PATTERN =
  /\b(accelerator|incubator|batch\s+program|yc\s+batch)\b/i;

function evidenceLooksSecondary(urls: string[]): boolean {
  return urls.some((u) => isSecondaryContentUrl(u));
}

function onlySecondaryEvidence(urls: string[]): boolean {
  if (urls.length === 0) {
    return false;
  }
  return urls.every((u) => isSecondaryContentUrl(u));
}

/**
 * Deterministic commercial eligibility for a scored brand + its evidence URLs.
 * Prefer rejecting publisher/marketplace false positives over keeping them.
 */
export function assessBrandCommercialEligibility(
  brand: ScoredBrand,
): BrandCommercialEligibility {
  const domain = normalizeDomain(brand.website) || '';
  const evidence = brand.evidenceUrls ?? [];
  const name = brand.name ?? '';
  const sector = brand.sector ?? '';
  const fit = brand.fitReason ?? '';
  const blob = `${name} ${sector} ${fit}`.toLowerCase();

  if (VENTURE_CAPITAL_HOSTS.has(domain) || VC_FIT_OR_SECTOR_PATTERN.test(blob)) {
    return {
      entityType: 'venture_capital',
      commercialEligible: false,
      reason: 'venture_capital_not_advertiser_brand',
    };
  }

  if (ACCELERATOR_HOSTS.has(domain) || ACCELERATOR_FIT_PATTERN.test(blob)) {
    return {
      entityType: 'accelerator',
      commercialEligible: false,
      reason: 'accelerator_not_advertiser_brand',
    };
  }

  if (
    STARTUP_DIRECTORY_HOSTS.has(domain) ||
    DIRECTORY_HOST_PATTERN.test(domain)
  ) {
    return {
      entityType: 'directory',
      commercialEligible: false,
      reason: 'directory_host',
    };
  }

  if (
    UGC_MARKETPLACE_HOST_PATTERN.test(domain) ||
    MARKETPLACE_NAME_PATTERN.test(name) ||
    /^ugc\b/i.test(name.trim())
  ) {
    return {
      entityType: 'marketplace',
      commercialEligible: false,
      reason: 'ugc_marketplace_not_advertiser_brand',
    };
  }

  if (
    PARTNERSHIP_SAAS_HOSTS.has(domain) &&
    (evidenceLooksSecondary(evidence) ||
      PUBLISHER_FIT_PATTERN.test(fit) ||
      /ambassador|affiliate|partnership\s+platform/i.test(blob))
  ) {
    return {
      entityType: 'tech_platform',
      commercialEligible: false,
      reason: 'partnership_saas_without_product_opportunity',
    };
  }

  if (onlySecondaryEvidence(evidence)) {
    return {
      entityType: 'publisher',
      commercialEligible: false,
      reason: 'only_secondary_content_evidence',
    };
  }

  if (PUBLISHER_FIT_PATTERN.test(fit) && evidenceLooksSecondary(evidence)) {
    return {
      entityType: 'publisher',
      commercialEligible: false,
      reason: 'publisher_fit_reason_with_secondary_evidence',
    };
  }

  // Claimed brand domain differs from secondary-only SERP publisher evidence.
  if (
    evidence.length > 0 &&
    evidenceLooksSecondary(evidence) &&
    evidence.every((url) => {
      const evidenceDomain = normalizeDomain(url);
      return Boolean(evidenceDomain) && evidenceDomain !== domain;
    })
  ) {
    return {
      entityType: 'publisher',
      commercialEligible: false,
      reason: 'claimed_domain_only_supported_by_third_party_secondary_evidence',
    };
  }

  if (/\b(agency|agencia)\b/i.test(blob) && /influencer|ugc|creator/i.test(blob)) {
    return {
      entityType: 'agency',
      commercialEligible: true,
      reason: 'creator_agency_possible_opportunity',
    };
  }

  if (/\b(saas|platform|software)\b/i.test(blob)) {
    return {
      entityType: 'tech_platform',
      commercialEligible: true,
      reason: 'tech_platform_possible_when_product_aligned',
    };
  }

  if (/\b(service|services|consulting|education|coaching)\b/i.test(blob)) {
    return {
      entityType: 'service_company',
      commercialEligible: true,
      reason: 'service_company',
    };
  }

  return {
    entityType: 'product_brand',
    commercialEligible: true,
    reason: 'assumed_product_or_service_brand',
  };
}

/**
 * Split SCORE brands into commercially eligible vs discarded.
 * Eligibility is independent of numeric score.
 */
export function filterBrandsByCommercialEligibility(
  brands: readonly ScoredBrand[],
): {
  eligible: ScoredBrand[];
  discarded: BrandCommercialEligibilityDiscard[];
} {
  const eligible: ScoredBrand[] = [];
  const discarded: BrandCommercialEligibilityDiscard[] = [];

  for (const brand of brands) {
    const eligibility = assessBrandCommercialEligibility(brand);
    if (eligibility.commercialEligible) {
      eligible.push(brand);
    } else {
      discarded.push({ brand, eligibility });
    }
  }

  return { eligible, discarded };
}
