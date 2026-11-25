import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  SALESHANDY_ERROR_CODES,
  SaleshandyApiException,
  toSaleshandyException,
} from './saleshandy.errors';

export const SALESHANDY_DEFAULT_BASE_URL = 'https://open-api.saleshandy.com/v1';
export const SALESHANDY_DEFAULT_TIMEOUT_MS = 60_000;

export type SaleshandyMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type SaleshandyRequestOptions = {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  timeoutMs?: number;
};

/** Raw response (no throwing): used by soft-fail callers such as enrichment. */
export type SaleshandyRawResponse = {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
};

/**
 * Single entry point to the Saleshandy Open API (HU-EA-000): base URL,
 * `x-api-key` (server-side only), timeouts, JSON parsing and standardized
 * errors. Request bodies are never logged (they can carry SMTP/IMAP passwords).
 */
@Injectable()
export class SaleshandyHttpService {
  private readonly logger = new Logger(SaleshandyHttpService.name);

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string {
    return this.config.get<string>('SALESHANDY_API_KEY')?.trim() ?? '';
  }

  private get baseUrl(): string {
    return (
      this.config.get<string>('SALESHANDY_BASE_URL')?.trim() ||
      SALESHANDY_DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
  }

  private get defaultTimeoutMs(): number {
    return (
      this.config.get<number>('SALESHANDY_TIMEOUT_MS') ??
      SALESHANDY_DEFAULT_TIMEOUT_MS
    );
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private buildUrl(path: string, query?: SaleshandyRequestOptions['query']) {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  /** Performs the call and returns status + parsed body without throwing on HTTP errors. */
  async raw(
    method: SaleshandyMethod,
    path: string,
    options: SaleshandyRequestOptions = {},
  ): Promise<SaleshandyRawResponse> {
    if (!this.isConfigured()) {
      throw new SaleshandyApiException(
        SALESHANDY_ERROR_CODES.NOT_CONFIGURED,
        'Saleshandy integration is not configured.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const hasBody = options.body !== undefined;
    let response: Response;
    try {
      response = await fetch(this.buildUrl(path, options.query), {
        method,
        headers: {
          'x-api-key': this.apiKey,
          Accept: 'application/json',
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        },
        body: hasBody ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs ?? this.defaultTimeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      this.logger.warn(
        JSON.stringify({
          event: 'saleshandy_request_failed',
          method,
          path,
          reason: timedOut ? 'timeout' : 'network',
        }),
      );
      throw new SaleshandyApiException(
        timedOut ? SALESHANDY_ERROR_CODES.TIMEOUT : SALESHANDY_ERROR_CODES.UNAVAILABLE,
        timedOut
          ? 'Saleshandy took too long to respond.'
          : 'Could not reach Saleshandy.',
        timedOut ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.BAD_GATEWAY,
      );
    }
    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = text ? JSON.parse(text) : null;
      json =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  }

  /**
   * Calls Saleshandy and returns `payload` (or the whole body when there is
   * none). Throws {@link SaleshandyApiException} on any failure.
   */
  async request<T = unknown>(
    method: SaleshandyMethod,
    path: string,
    options: SaleshandyRequestOptions = {},
  ): Promise<{ payload: T; message?: string }> {
    const { status, json, text } = await this.raw(method, path, options);
    if (status >= 400) {
      const error = toSaleshandyException(status, json ?? text);
      this.logger.warn(
        JSON.stringify({
          event: 'saleshandy_request_error',
          method,
          path,
          upstreamStatus: status,
          upstreamCode: error.upstreamCode,
          code: error.code,
        }),
      );
      throw error;
    }
    const message = typeof json?.message === 'string' ? json.message : undefined;
    const payload = (json && 'payload' in json ? json.payload : (json ?? text)) as T;
    return { payload, message };
  }

  /** HU-EA-000 CA-07: cheap authenticated probe (no credits spent). */
  async checkConnectivity(): Promise<{
    configured: boolean;
    connected: boolean;
    latencyMs?: number;
    credits?: number | null;
    errorCode?: string;
    message?: string;
  }> {
    if (!this.isConfigured()) {
      return {
        configured: false,
        connected: false,
        errorCode: SALESHANDY_ERROR_CODES.NOT_CONFIGURED,
      };
    }
    const started = Date.now();
    try {
      const { payload } = await this.request<{ totalCredits?: number }>(
        'GET',
        '/credits',
        { timeoutMs: 15_000 },
      );
      return {
        configured: true,
        connected: true,
        latencyMs: Date.now() - started,
        credits:
          typeof payload?.totalCredits === 'number' ? payload.totalCredits : null,
      };
    } catch (error) {
      const known = error instanceof SaleshandyApiException;
      return {
        configured: true,
        connected: false,
        latencyMs: Date.now() - started,
        errorCode: known ? error.code : SALESHANDY_ERROR_CODES.UNAVAILABLE,
        message: known ? error.message : 'Unexpected error',
      };
    }
  }
}
