const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const BLOCKED_SUFFIXES = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.css',
  '.js',
  '.mjs',
  '.map',
  '.woff',
  '.woff2',
];

const BLOCKED_LOCAL_PARTS = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'mailer-daemon',
  'postmaster',
]);

/**
 * Template / form-placeholder domains (e.g. `abc@domain.com`, `you@yourcompany.com`).
 * They appear literally on pages but are never real contacts.
 */
const PLACEHOLDER_DOMAIN_RE =
  /^(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|sentry\.io|wixpress\.com)$|^(?:domain\.(?:com|net|org)|your[a-z-]*\.[a-z]{2,}|my(?:domain|company|website|site|email)\.com|email\.com|emailaddress\.com|test\.(?:com|net|org)|sample\.com|website\.com|company\.com)$/;

function decodeJsUnicodeEscapes(html: string): string {
  return html.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

function isPlausibleEmail(email: string): boolean {
  const lower = email.toLowerCase();
  if (BLOCKED_SUFFIXES.some((s) => lower.endsWith(s))) return false;
  const [local = '', domain = ''] = lower.split('@');
  if (PLACEHOLDER_DOMAIN_RE.test(domain)) return false;
  if (BLOCKED_LOCAL_PARTS.has(local)) return false;
  // Reject version-like locals from asset filenames (ecom-swiper@11.css already blocked)
  if (/^\d/.test(local)) return false;
  return true;
}

export function extractEmailsFromHtml(html: string): string[] {
  // Inline JSON/JS escapes (`\u003e`, `\u0040`) otherwise glue "u003e" onto the
  // local part (`\u003ecare@brand.com` -> `u003ecare@brand.com`).
  const decoded = decodeJsUnicodeEscapes(html);
  // Scan raw HTML (mailto: hrefs) and visible text after stripping tags.
  const text = stripTags(decoded);
  const found = [
    ...(decoded.match(EMAIL_RE) ?? []),
    ...(text.match(EMAIL_RE) ?? []),
  ];
  const unique = [...new Set(found.map((e) => e.toLowerCase()))];
  return unique.filter(isPlausibleEmail);
}

export function evidenceSnippetAroundEmail(
  html: string,
  email: string,
  radius = 80,
): string {
  const text = stripTags(html).replace(/\s+/g, ' ');
  const idx = text.toLowerCase().indexOf(email.toLowerCase());
  if (idx < 0) return email;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + email.length + radius);
  return text.slice(start, end).trim().slice(0, 500);
}
