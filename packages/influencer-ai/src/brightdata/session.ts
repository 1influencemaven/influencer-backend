import { normalizeUrlKey } from './normalize-url-key';

export type FoundEmailRecord = {
  email: string;
  sourceUrl: string;
  evidenceSnippet?: string;
};

/** RF-04.2: page origin / reuse counters for one FIND_BRAND_EMAILS session. */
export type PageOriginCounts = {
  seedPagesAttempted: number;
  seedPagesDownloaded: number;
  serpSeedPagesAttempted: number;
  serpSeedPagesDownloaded: number;
  llmPagesAttempted: number;
  llmPagesDownloaded: number;
  llmPagesReused: number;
  duplicateUrlSkips: number;
};

export function emptyPageOriginCounts(): PageOriginCounts {
  return {
    seedPagesAttempted: 0,
    seedPagesDownloaded: 0,
    serpSeedPagesAttempted: 0,
    serpSeedPagesDownloaded: 0,
    llmPagesAttempted: 0,
    llmPagesDownloaded: 0,
    llmPagesReused: 0,
    duplicateUrlSkips: 0,
  };
}

/**
 * Shared mutable state for one CONTACT_RESEARCH FIND_BRAND_EMAILS run.
 * Tools read/write this; the runner reads the final emails + trace.
 */
export class ContactResearchToolSession {
  readonly brandName: string;
  readonly website: string;
  readonly domain: string;
  readonly allowedHost: string;
  readonly maxSerpQueries: number;
  readonly maxPages: number;

  serpCalls = 0;
  pageCalls = 0;
  queries: string[] = [];
  /** Original URLs attempted/opened (evidence / trace order). */
  pages: string[] = [];
  /**
   * Successful HTML keyed by {@link normalizeUrlKey}.
   * Prefer {@link getPageHtml} / {@link setPageHtml}.
   */
  pageHtml = new Map<string, string>();
  /**
   * RF-04.3: ISO-8601 download time per normalizeUrlKey (set on first successful store).
   */
  pageFetchedAt = new Map<string, string>();
  /**
   * RF-04.3: first original URL used for each normalizeUrlKey (evidence / snapshot url).
   */
  pageOriginalUrl = new Map<string, string>();
  emails = new Map<string, FoundEmailRecord>();
  lastError?: string;
  pageOriginCounts: PageOriginCounts = emptyPageOriginCounts();

  constructor(params: {
    brandName: string;
    website: string;
    domain: string;
    maxSerpQueries: number;
    maxPages: number;
  }) {
    this.brandName = params.brandName;
    this.website = params.website;
    this.domain = params.domain.toLowerCase().replace(/^www\./, '');
    this.allowedHost = this.domain;
    this.maxSerpQueries = params.maxSerpQueries;
    this.maxPages = params.maxPages;
  }

  getPageHtml(url: string): string | undefined {
    return this.pageHtml.get(normalizeUrlKey(url));
  }

  /**
   * Store successful page HTML. `fetchedAt` defaults to now (download moment);
   * only the first store for a key keeps fetchedAt / originalUrl.
   */
  setPageHtml(url: string, html: string, fetchedAt?: string): void {
    const key = normalizeUrlKey(url);
    const isFirst = !this.pageHtml.has(key);
    this.pageHtml.set(key, html);
    if (isFirst || !this.pageFetchedAt.has(key)) {
      this.pageFetchedAt.set(key, fetchedAt ?? new Date().toISOString());
    }
    if (isFirst || !this.pageOriginalUrl.has(key)) {
      this.pageOriginalUrl.set(key, url);
    }
  }

  hasUsablePageHtml(url: string): boolean {
    const html = this.getPageHtml(url);
    return typeof html === 'string' && html.length > 0;
  }

  getPageFetchedAt(url: string): string | undefined {
    return this.pageFetchedAt.get(normalizeUrlKey(url));
  }

  getPageOriginalUrl(url: string): string | undefined {
    return this.pageOriginalUrl.get(normalizeUrlKey(url));
  }

  isAllowedUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      return host === this.allowedHost || host.endsWith(`.${this.allowedHost}`);
    } catch {
      return false;
    }
  }

  toTrace() {
    return {
      queries: [...this.queries],
      pages: [...this.pages],
      serpCalls: this.serpCalls,
      pageCalls: this.pageCalls,
      pageOriginCounts: { ...this.pageOriginCounts },
    };
  }

  listEmails(): FoundEmailRecord[] {
    return [...this.emails.values()];
  }
}
