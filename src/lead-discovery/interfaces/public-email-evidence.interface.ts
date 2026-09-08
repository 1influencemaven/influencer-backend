export type PublicEmailSourceType = 'public-web';

export type PublicEmailEvidence = {
  sourceUrl: string;
  sourceType: PublicEmailSourceType;
  evidenceSnippet: string;
  discoveredAt: string;
};

export type PublicEmailCandidate = {
  email: string;
  isGeneric: boolean;
  /** Company context only — not person attribution. */
  companyName?: string;
  personName?: string;
  profileUrl?: string;
  evidences: PublicEmailEvidence[];
};

export type PublicEmailPageFetchResult = {
  url: string;
  httpStatus: number;
  latencyMs: number;
  emptyBody: boolean;
  emailCount: number;
  error?: string;
};

export type PublicEmailDiscoveryRunSummary = {
  companyName?: string;
  website?: string;
  pagesAttempted: number;
  pagesSucceeded: number;
  emailsFound: number;
  genericEmailsFound: number;
  nonGenericEmailsFound: number;
  errors: number;
  pageResults: PublicEmailPageFetchResult[];
};

export type ProfilePublicEmailInput = {
  personName: string;
  profileUrl: string;
  companyName?: string;
  companyLinkedInUrl?: string;
  companyWebsite?: string;
};

export type PublicEmailDiscoveryResult = {
  candidates: PublicEmailCandidate[];
  summary: PublicEmailDiscoveryRunSummary;
};
