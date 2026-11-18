/**
 * RF-04.2: safe intra-run URL identity for Contact Research dedupe.
 *
 * Preserves:
 * - protocol (http ≠ https)
 * - pathname case (CaseSensitive ≠ casesensitive)
 * - query string (do not strip functional params)
 *
 * Normalizes:
 * - hostname to lowercase
 * - trailing slash (except root "/")
 * - fragment removed (not part of Unlocker page identity in this flow)
 */
export function normalizeUrlKey(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : '';
    let path = parsed.pathname || '/';
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    return `${protocol}//${host}${port}${path}${parsed.search}`;
  } catch {
    // Malformed: strip fragment + trailing slash only; do not lowercase path.
    return trimmed.replace(/#.*$/, '').replace(/\/$/, '') || trimmed;
  }
}
