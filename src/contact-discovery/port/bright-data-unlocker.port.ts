import type { SearchQuery, SearchResultItem } from '../../integrations/brightdata';

/**
 * Isolated Unlocker port for Contact Discovery BBC v1 (ADR-0020).
 * Implementations must not call Brand Discovery domain services.
 */

export type UnlockerProviderFailureKind =
  | 'transport'
  | 'http'
  | 'empty_body'
  | 'malformed';

export type UnlockerHtmlOutcome =
  | 'ok'
  | 'empty_body'
  | 'http_error'
  | 'timeout'
  | 'network_error'
  | 'unknown_error';

export type UnlockerHtmlPortResult = {
  outcome: UnlockerHtmlOutcome;
  /** Present when outcome === 'ok'. */
  html: string;
  httpStatus: number;
  bodyLength: number;
  zone: string;
  elapsedMs: number;
  providerFailureKind: UnlockerProviderFailureKind | null;
  errorName?: string;
  errorMessage?: string;
  causeCode?: string;
  causeHostname?: string;
};

export type UnlockerSearchOutcome =
  | 'ok'
  | 'organic_empty'
  | 'empty_body'
  | 'parse_error'
  | 'http_error'
  | 'network_error';

export type UnlockerSearchPortResult = {
  outcome: UnlockerSearchOutcome;
  items: SearchResultItem[];
  httpStatus: number;
  responseBytes: number;
  zone?: string;
  elapsedMs: number;
  query: string;
  providerFailureKind: UnlockerProviderFailureKind | null;
  parseError?: string;
};

export type UnlockerSearchQuery = SearchQuery;

export interface BrightDataUnlockerPort {
  isConfigured(): boolean;
  fetchHtml(url: string): Promise<UnlockerHtmlPortResult>;
  search(query: UnlockerSearchQuery): Promise<UnlockerSearchPortResult>;
}

export const BRIGHT_DATA_UNLOCKER_PORT = Symbol('BRIGHT_DATA_UNLOCKER_PORT');
