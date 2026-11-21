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

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

function isPlausibleEmail(email: string): boolean {
  const lower = email.toLowerCase();
  if (BLOCKED_SUFFIXES.some((s) => lower.endsWith(s))) return false;
  if (lower.includes('example.com') || lower.includes('sentry.io')) return false;
  const local = lower.split('@')[0] ?? '';
  if (BLOCKED_LOCAL_PARTS.has(local)) return false;
  // Reject version-like locals from asset filenames (ecom-swiper@11.css already blocked)
  if (/^\d/.test(local)) return false;
  return true;
}

export function extractEmailsFromHtml(html: string): string[] {
  // Scan raw HTML (mailto: hrefs) and visible text after stripping tags.
  const text = stripTags(html);
  const found = [...(html.match(EMAIL_RE) ?? []), ...(text.match(EMAIL_RE) ?? [])];
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
