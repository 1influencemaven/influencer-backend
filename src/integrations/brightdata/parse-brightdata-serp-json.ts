import type { SearchResultItem } from './search.types';
import { domainFromUrl } from './url-domain.util';

const BLOCKED_HOST_RE =
  /(^|\.)google\.|(^|\.)googleapis\.com$|(^|\.)gstatic\.com$|(^|\.)youtube\.com$|(^|\.)youtu\.be$/i;

function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOST_RE.test(hostname.toLowerCase());
}

export type ParseBrightDataSerpJsonResult =
  | {
      kind: 'brd_json';
      items: SearchResultItem[];
    }
  | {
      kind: 'not_brd_json';
    };

type OrganicRow = {
  link?: unknown;
  url?: unknown;
  title?: unknown;
  description?: unknown;
  snippet?: unknown;
  rank?: unknown;
  global_rank?: unknown;
};

/**
 * Bright Data SERP parsed JSON (`brd_json=1` on the Google URL).
 * Shape: `{ general, input, organic: [{ link, title, description, rank, ... }] }`
 */
export function parseBrightDataSerpJson(
  body: string,
  options?: { maxResults?: number },
): ParseBrightDataSerpJsonResult {
  const maxResults = options?.maxResults ?? 10;
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { kind: 'not_brd_json' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { kind: 'not_brd_json' };
  }

  const organic = extractOrganicArray(parsed);
  if (organic === null) {
    return { kind: 'not_brd_json' };
  }

  const items: SearchResultItem[] = [];
  const seen = new Set<string>();

  for (const row of organic) {
    if (items.length >= maxResults) break;
    if (!row || typeof row !== 'object') continue;
    const organicRow = row as OrganicRow;
    const rawUrl =
      typeof organicRow.link === 'string'
        ? organicRow.link
        : typeof organicRow.url === 'string'
          ? organicRow.url
          : '';
    const url = rawUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    let domain: string;
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
      if (isBlockedHost(hostname)) continue;
      domain = domainFromUrl(url);
    } catch {
      continue;
    }
    if (!domain) continue;

    const title =
      typeof organicRow.title === 'string' && organicRow.title.trim()
        ? organicRow.title.trim()
        : domain;
    const snippet =
      typeof organicRow.description === 'string'
        ? organicRow.description.trim()
        : typeof organicRow.snippet === 'string'
          ? organicRow.snippet.trim()
          : '';
    const rank =
      typeof organicRow.rank === 'number'
        ? organicRow.rank
        : typeof organicRow.global_rank === 'number'
          ? organicRow.global_rank
          : items.length + 1;

    items.push({
      title,
      url,
      snippet,
      position: rank,
      domain,
    });
  }

  return { kind: 'brd_json', items };
}

function extractOrganicArray(parsed: unknown): unknown[] | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;

  if (Array.isArray(root.organic)) {
    return root.organic;
  }

  // format=json sometimes wraps: { status_code, headers, body: { organic } | string }
  if (root.body && typeof root.body === 'object' && !Array.isArray(root.body)) {
    const bodyObj = root.body as Record<string, unknown>;
    if (Array.isArray(bodyObj.organic)) {
      return bodyObj.organic;
    }
  }

  if (typeof root.body === 'string') {
    try {
      const nested = JSON.parse(root.body) as unknown;
      return extractOrganicArray(nested);
    } catch {
      return null;
    }
  }

  return null;
}
