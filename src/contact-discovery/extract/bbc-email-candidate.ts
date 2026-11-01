import { CommercialRelevance } from '../../generated/prisma/enums';

export type BbcEmailEvidence = {
  sourceUrl: string;
  evidenceSnippet: string;
  discoveredAt: string;
};

export type BbcRawEmailObservation = {
  email: string;
  sourceUrl: string;
  evidenceSnippet: string;
};

export type BbcAcceptedEmailCandidate = {
  email: string;
  emailNormalized: string;
  label: string | null;
  isGeneric: boolean;
  commercialRelevance: CommercialRelevance;
  evidences: BbcEmailEvidence[];
};

export type BbcDiscardReason =
  | 'invalid_email'
  | 'external_domain'
  | 'low_relevance'
  | 'duplicate';

export type BbcClassifyDedupeResult = {
  accepted: BbcAcceptedEmailCandidate[];
  discardCountsByReason: Partial<Record<BbcDiscardReason, number>>;
};
