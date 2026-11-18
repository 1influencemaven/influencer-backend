import type { ContactResearchPageSnapshot } from '@influence-maven/ai-contracts';

import { normalizeUrlKey } from '../brightdata/normalize-url-key';
import type { ContactResearchToolSession } from '../brightdata/session';

/** RF-04.3: max snapshots emitted from FIND_BRAND_EMAILS. */
export const CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX = 4;

/** RF-04.3: max characters per snapshot content. */
export const CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX_CHARS = 20_000;

/**
 * RF-04.3: max UTF-8 bytes across all snapshot `content` fields in one payload.
 * Caps payload size below 4 × 20k when pages are large.
 */
export const CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX_TOTAL_BYTES = 64_000;

const MAILTO_RE = /mailto:([^\s"'<>?]+)/gi;

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Extract unique mailto: addresses from raw HTML (before truncation). */
export function extractMailtoEmailsFromHtml(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  MAILTO_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MAILTO_RE.exec(html)) !== null) {
    const raw = (match[1] ?? '').trim();
    if (!raw) continue;
    let email: string;
    try {
      email = decodeURIComponent(raw.split('?')[0] ?? raw)
        .trim()
        .toLowerCase();
    } catch {
      continue;
    }
    if (!looksLikeEmail(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
    if (out.length >= 50) break;
  }
  return out;
}

function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/**
 * Build capped RF-04.3 page snapshots from a completed 2A session.
 * Only successful pages with non-empty HTML; deterministic omission when caps hit.
 */
export function buildContactResearchPageSnapshots(
  session: ContactResearchToolSession,
  options?: {
    maxPages?: number;
    maxChars?: number;
    maxTotalBytes?: number;
  },
): ContactResearchPageSnapshot[] {
  const maxPages = options?.maxPages ?? CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX;
  const maxChars =
    options?.maxChars ?? CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX_CHARS;
  const maxTotalBytes =
    options?.maxTotalBytes ?? CONTACT_RESEARCH_PAGE_SNAPSHOT_MAX_TOTAL_BYTES;

  const orderedKeys: string[] = [];
  const seenKeys = new Set<string>();

  for (const url of session.pages) {
    const key = normalizeUrlKey(url);
    if (seenKeys.has(key)) continue;
    if (!session.hasUsablePageHtml(url)) continue;
    seenKeys.add(key);
    orderedKeys.push(key);
  }

  for (const key of session.pageHtml.keys()) {
    if (seenKeys.has(key)) continue;
    const html = session.pageHtml.get(key);
    if (typeof html !== 'string' || html.length === 0) continue;
    seenKeys.add(key);
    orderedKeys.push(key);
  }

  const snapshots: ContactResearchPageSnapshot[] = [];
  let totalBytes = 0;

  for (const key of orderedKeys) {
    if (snapshots.length >= maxPages) break;

    const html = session.pageHtml.get(key);
    if (typeof html !== 'string' || html.length === 0) continue;

    const originalUrl =
      session.pageOriginalUrl.get(key) ??
      session.pages.find((u) => normalizeUrlKey(u) === key) ??
      key;
    const fetchedAt =
      session.pageFetchedAt.get(key) ?? new Date().toISOString();

    const mailtoEmails = extractMailtoEmailsFromHtml(html);
    const truncated = html.length > maxChars;
    let content = truncated ? html.slice(0, maxChars) : html;
    const contentBytes = utf8Bytes(content);

    if (totalBytes + contentBytes > maxTotalBytes) {
      const remaining = maxTotalBytes - totalBytes;
      if (remaining <= 0) break;
      // Deterministic: shrink this page to remaining budget or skip if tiny.
      if (remaining < 64) break;
      let cut = content;
      while (utf8Bytes(cut) > remaining && cut.length > 0) {
        cut = cut.slice(0, Math.max(0, cut.length - 256));
      }
      if (cut.length === 0) break;
      content = cut;
      snapshots.push({
        url: originalUrl,
        normalizedUrl: key,
        fetchedAt,
        content,
        contentType: 'text/html',
        truncated: true,
        ...(mailtoEmails.length > 0 ? { mailtoEmails } : {}),
      });
      totalBytes += utf8Bytes(content);
      break;
    }

    snapshots.push({
      url: originalUrl,
      normalizedUrl: key,
      fetchedAt,
      content,
      contentType: 'text/html',
      truncated,
      ...(mailtoEmails.length > 0 ? { mailtoEmails } : {}),
    });
    totalBytes += contentBytes;
  }

  return snapshots;
}
