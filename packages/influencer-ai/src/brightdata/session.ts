export type FoundEmailRecord = {
  email: string;
  sourceUrl: string;
  evidenceSnippet?: string;
};

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
  pages: string[] = [];
  /** url → html */
  pageHtml = new Map<string, string>();
  emails = new Map<string, FoundEmailRecord>();
  lastError?: string;

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
    };
  }

  listEmails(): FoundEmailRecord[] {
    return [...this.emails.values()];
  }
}
