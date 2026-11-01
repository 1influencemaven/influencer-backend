import { CommercialRelevance } from '../../generated/prisma/enums';
import {
  isAllowedBrandBusinessContactEmailDomain,
  labelFromEmailLocalPart,
} from '../../lead-discovery/utils/brand-business-contact-domain.util';

import {
  classifyCommercialRelevance,
  normalizeBusinessEmail,
} from '../../lead-discovery/utils/commercial-relevance.util';
import { isGenericEmail } from '../../lead-discovery/utils/generic-email.util';
import { isMaskedOrIncompleteEmail } from '../../lead-discovery/utils/literal-email-extract.util';

import type {
  BbcAcceptedEmailCandidate,
  BbcClassifyDedupeResult,
  BbcDiscardReason,
  BbcEmailEvidence,
  BbcRawEmailObservation,
} from './bbc-email-candidate';

function bump(
  counts: Partial<Record<BbcDiscardReason, number>>,
  reason: BbcDiscardReason,
): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function isStructurallyUsableEmail(email: string): boolean {
  const normalized = normalizeBusinessEmail(email);
  if (!normalized.includes('@')) {
    return false;
  }
  if (isMaskedOrIncompleteEmail(normalized)) {
    return false;
  }
  const [local, domain] = normalized.split('@');
  if (!local || !domain || !domain.includes('.')) {
    return false;
  }
  return true;
}

/**
 * Classify + dedupe BBC observations (ADR-0018 policy):
 * - discard LOW commercialRelevance
 * - discard external non–free-mail domains
 * - keep HIGH + UNKNOWN (incl. free-mail with evidence)
 * - merge evidences for the same emailNormalized
 */
export function classifyAndDedupeBbcEmails(args: {
  observations: BbcRawEmailObservation[];
  brandDomain: string;
  now?: Date;
}): BbcClassifyDedupeResult {
  const discoveredAt = (args.now ?? new Date()).toISOString();
  const discardCountsByReason: Partial<Record<BbcDiscardReason, number>> = {};
  const byEmail = new Map<string, BbcAcceptedEmailCandidate>();

  for (const observation of args.observations) {
    if (!isStructurallyUsableEmail(observation.email)) {
      bump(discardCountsByReason, 'invalid_email');
      continue;
    }

    const emailNormalized = normalizeBusinessEmail(observation.email);

    if (
      !isAllowedBrandBusinessContactEmailDomain(
        emailNormalized,
        args.brandDomain,
      )
    ) {
      bump(discardCountsByReason, 'external_domain');
      continue;
    }

    const commercialRelevance = classifyCommercialRelevance(emailNormalized);
    if (commercialRelevance === CommercialRelevance.LOW) {
      bump(discardCountsByReason, 'low_relevance');
      continue;
    }

    const evidence: BbcEmailEvidence = {
      sourceUrl: observation.sourceUrl,
      evidenceSnippet: observation.evidenceSnippet.slice(0, 240),
      discoveredAt,
    };

    const existing = byEmail.get(emailNormalized);
    if (existing) {
      bump(discardCountsByReason, 'duplicate');
      const seen = new Set(
        existing.evidences.map((e) => `${e.sourceUrl}|${e.evidenceSnippet}`),
      );
      const key = `${evidence.sourceUrl}|${evidence.evidenceSnippet}`;
      if (!seen.has(key)) {
        existing.evidences.push(evidence);
      }
      continue;
    }

    byEmail.set(emailNormalized, {
      email: emailNormalized,
      emailNormalized,
      label: labelFromEmailLocalPart(emailNormalized),
      isGeneric: isGenericEmail(emailNormalized),
      commercialRelevance,
      evidences: [evidence],
    });
  }

  return {
    accepted: Array.from(byEmail.values()),
    discardCountsByReason,
  };
}
