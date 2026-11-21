/**
 * High-confidence SERP HTML diagnosis when organic extraction yields 0 items.
 * AI-004.5.1.1 — avoid labeling every non-organic HTML as organic_empty.
 *
 * Synthetic fixtures only; not equivalent to validation against live serp_api HTML.
 */

export type SerpHtmlEmptyDiagnosis =
  | 'organic_empty'
  | 'consent_page'
  | 'soft_block'
  | 'unknown_html';

/**
 * Consent / cookie interstitial signals (require strong markers to avoid FP).
 */
export function looksLikeGoogleConsentPage(html: string): boolean {
  if (!html) return false;
  const lower = html.toLowerCase();

  if (lower.includes('consent.google.com')) {
    return true;
  }
  if (/before you continue to google/i.test(html)) {
    return true;
  }
  // Classic Google consent Accept-all control + cookie copy
  if (/id\s*=\s*["']L2AGLb["']/i.test(html) && /cookie/i.test(html)) {
    return true;
  }
  if (
    /aria-label\s*=\s*["']Accept all["']/i.test(html) &&
    /Reject all/i.test(html) &&
    /cookie/i.test(html)
  ) {
    return true;
  }
  return false;
}

/**
 * CAPTCHA / unusual-traffic soft block (high confidence only).
 */
export function looksLikeSerpSoftBlock(html: string): boolean {
  if (!html) return false;

  if (/\/sorry\/index/i.test(html) || /google\.com\/sorry/i.test(html)) {
    return true;
  }
  if (/unusual traffic from your computer network/i.test(html)) {
    return true;
  }
  if (
    /Our systems have detected unusual traffic/i.test(html) ||
    /detected unusual traffic/i.test(html)
  ) {
    return true;
  }
  // reCAPTCHA challenge framing + sorry/captcha context
  if (
    /recaptcha/i.test(html) &&
    (/captcha/i.test(html) ||
      /sorry/i.test(html) ||
      /unusual traffic/i.test(html))
  ) {
    return true;
  }
  return false;
}

/**
 * Markers that the document resembles a Google results page (even if empty).
 */
export function looksLikeGoogleSerpStructure(html: string): boolean {
  if (!html) return false;

  if (/\bid\s*=\s*["']rso["']/i.test(html)) return true;
  if (/\bid\s*=\s*["']search["']/i.test(html)) return true;
  if (/\bid\s*=\s*["']result-stats["']/i.test(html)) return true;
  if (/data-sokoban-container/i.test(html)) return true;
  if (/No results found for this query/i.test(html)) return true;
  if (/did not match any documents/i.test(html)) return true;
  // Compact result card class used in many Google SERP variants
  if (
    /class\s*=\s*["'][^"']*\bg\b[^"']*["']/i.test(html) &&
    /\/url\?q=/i.test(html)
  ) {
    return true;
  }
  return false;
}

/**
 * Classify HTML that produced zero organic items after parseGoogleSerpHtml.
 * Order: consent → soft_block → organic_empty (structure) → unknown_html.
 */
export function classifySerpHtmlWithoutOrganics(
  html: string,
): SerpHtmlEmptyDiagnosis {
  if (looksLikeGoogleConsentPage(html)) {
    return 'consent_page';
  }
  if (looksLikeSerpSoftBlock(html)) {
    return 'soft_block';
  }
  if (looksLikeGoogleSerpStructure(html)) {
    return 'organic_empty';
  }
  return 'unknown_html';
}
