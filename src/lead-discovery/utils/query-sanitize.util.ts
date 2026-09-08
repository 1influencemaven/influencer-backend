const MAX_QUERY_FRAGMENT_LENGTH = 80;

export function sanitizeQueryFragment(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_FRAGMENT_LENGTH);
}
