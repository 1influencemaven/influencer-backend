import type {
  AgencyContactPeeReuseTrace,
  ContactResearchPageSnapshot,
  ContactResearchPeeReuseTrace,
} from '@influence-maven/ai-contracts';

import { normalizeUrlKey } from '../brightdata/normalize-url-key';

export function emptyPeeReuseTrace(
  snapshotsReceivedFrom2A = 0,
): ContactResearchPeeReuseTrace {
  return {
    snapshotsReceivedFrom2A,
    peePagesReused: 0,
    peePagesFetchedUnlocker: 0,
    peePagesRejected: 0,
    unlockerCallsAvoided: 0,
  };
}

/** Agency emails→people PEE bridge (2C.4.6). Naming avoids brand "2A". */
export function emptyAgencyPeeReuseTrace(
  snapshotsReceivedFromEmailsPass = 0,
): AgencyContactPeeReuseTrace {
  return {
    snapshotsReceivedFromEmailsPass,
    peePagesReused: 0,
    peePagesFetchedUnlocker: 0,
    peePagesRejected: 0,
    unlockerCallsAvoided: 0,
  };
}

export function isAllowedBrandPageDomain(
  url: string,
  brandDomain: string,
): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const allowed = brandDomain.toLowerCase().replace(/^www\./, '');
    return host === allowed || host.endsWith(`.${allowed}`);
  } catch {
    return false;
  }
}

/**
 * Index RF-04.3 snapshots that are valid for the given PEE candidate set.
 * Rejects wrong domain, empty content, or URLs that are not PEE candidates.
 *
 * RF-04.3.1 (M1): never trust `normalizedUrl` as an independent index key.
 * Always derive the key from `normalizeUrlKey(snapshot.url)`; if
 * `normalizedUrl` is present it must match exactly or the snapshot is rejected.
 */
export function indexUsablePeeSnapshots(params: {
  snapshots: ContactResearchPageSnapshot[];
  peeCandidateUrls: string[];
  brandDomain: string;
}): {
  byKey: Map<string, ContactResearchPageSnapshot>;
  rejected: number;
} {
  const peeKeys = new Set(
    params.peeCandidateUrls.map((u) => normalizeUrlKey(u)),
  );
  const byKey = new Map<string, ContactResearchPageSnapshot>();
  let rejected = 0;

  for (const snap of params.snapshots) {
    if (!snap.url?.trim()) {
      rejected += 1;
      continue;
    }

    let key: string;
    try {
      key = normalizeUrlKey(snap.url);
    } catch {
      rejected += 1;
      continue;
    }
    if (!key) {
      rejected += 1;
      continue;
    }

    // RF-04.3.1: declared normalizedUrl must match key derived from url.
    const declared = snap.normalizedUrl?.trim();
    if (declared && declared !== key) {
      rejected += 1;
      continue;
    }

    if (!isAllowedBrandPageDomain(snap.url, params.brandDomain)) {
      rejected += 1;
      continue;
    }
    if (!peeKeys.has(key)) {
      rejected += 1;
      continue;
    }
    if (typeof snap.content !== 'string' || snap.content.length === 0) {
      rejected += 1;
      continue;
    }
    if (byKey.has(key)) {
      // Deterministic: keep first; extra duplicate counts as rejected.
      rejected += 1;
      continue;
    }
    byKey.set(key, snap);
  }

  return { byKey, rejected };
}

/**
 * HTML to feed extractEmailsFromHtml. Re-injects mailtoEmails lost to truncation.
 */
export function htmlFromPeeSnapshot(snap: ContactResearchPageSnapshot): string {
  let html = snap.content;
  const mailtos = snap.mailtoEmails ?? [];
  if (mailtos.length === 0) return html;
  const lower = html.toLowerCase();
  const missing = mailtos.filter((e) => !lower.includes(e.toLowerCase()));
  if (missing.length === 0) return html;
  html +=
    '\n' +
    missing
      .map((e) => `<a href="mailto:${e}">${e}</a>`)
      .join('\n');
  return html;
}
