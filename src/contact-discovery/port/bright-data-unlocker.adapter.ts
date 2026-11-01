import { Injectable } from '@nestjs/common';

import { BrightDataSearchClient } from '../../integrations/brightdata';
import type {
  BrightDataUnlockerPort,
  UnlockerHtmlPortResult,
  UnlockerProviderFailureKind,
  UnlockerSearchPortResult,
  UnlockerSearchQuery,
} from './bright-data-unlocker.port';

function htmlFailureKind(
  outcome: UnlockerHtmlPortResult['outcome'],
): UnlockerProviderFailureKind | null {
  switch (outcome) {
    case 'empty_body':
      return 'empty_body';
    case 'http_error':
      return 'http';
    case 'timeout':
    case 'network_error':
      return 'transport';
    case 'unknown_error':
      return 'transport';
    case 'ok':
      return null;
  }
}

function searchFailureKind(
  outcome: UnlockerSearchPortResult['outcome'],
): UnlockerProviderFailureKind | null {
  switch (outcome) {
    case 'empty_body':
      return 'empty_body';
    case 'http_error':
      return 'http';
    case 'parse_error':
      return 'malformed';
    case 'network_error':
      return 'transport';
    case 'ok':
    case 'organic_empty':
      return null;
  }
}

/**
 * Thin adapter: maps `BrightDataSearchClient` into Contact Discovery port outcomes.
 * No retries beyond the client; no Brand Discovery imports.
 */
@Injectable()
export class BrightDataUnlockerAdapter implements BrightDataUnlockerPort {
  constructor(private readonly client: BrightDataSearchClient) {}

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  async fetchHtml(url: string): Promise<UnlockerHtmlPortResult> {
    const fetched = await this.client.fetchRawHtml(url);
    const outcome = fetched.outcome;
    return {
      outcome,
      html: outcome === 'ok' ? fetched.html : '',
      httpStatus: fetched.httpStatus,
      bodyLength: fetched.bodyLength,
      zone: fetched.zone,
      elapsedMs: fetched.elapsedMs,
      providerFailureKind: htmlFailureKind(outcome),
      ...(fetched.errorName ? { errorName: fetched.errorName } : {}),
      ...(fetched.errorMessage ? { errorMessage: fetched.errorMessage } : {}),
      ...(fetched.causeCode ? { causeCode: fetched.causeCode } : {}),
      ...(fetched.causeHostname ? { causeHostname: fetched.causeHostname } : {}),
    };
  }

  async search(query: UnlockerSearchQuery): Promise<UnlockerSearchPortResult> {
    const result = await this.client.search(query);
    const category = result.meta.resultCategory ?? 'empty_body';
    const outcome: UnlockerSearchPortResult['outcome'] =
      category === 'ok'
        ? 'ok'
        : category === 'organic_empty'
          ? 'organic_empty'
          : category === 'empty_body'
            ? 'empty_body'
            : category === 'parse_error'
              ? 'parse_error'
              : category === 'http_error'
                ? 'http_error'
                : 'network_error';

    return {
      outcome,
      items: result.items,
      httpStatus: result.meta.httpStatus,
      responseBytes: result.meta.responseBytes,
      zone: result.meta.zone,
      elapsedMs: result.meta.elapsedMs,
      query: result.meta.query,
      providerFailureKind: searchFailureKind(outcome),
      ...(result.meta.parseError
        ? { parseError: result.meta.parseError }
        : {}),
    };
  }
}
