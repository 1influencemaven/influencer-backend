/**
 * Normalizes an Instagram handle or profile URL for deduplication.
 * Strips protocol/host/path noise, leading `@`, lowercases, and trims.
 */
export function normalizeInstagramHandle(input: string): string {
  let value = input.trim();

  value = value.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
  value = value.split(/[/?#]/)[0] ?? '';
  value = value.replace(/^@+/, '');
  value = value.trim().toLowerCase();

  return value;
}

export function isValidNormalizedInstagramHandle(normalized: string): boolean {
  if (!normalized) {
    return false;
  }

  // Instagram usernames: letters, digits, periods, underscores; 1–30 chars.
  return /^[a-z0-9._]{1,30}$/.test(normalized);
}
