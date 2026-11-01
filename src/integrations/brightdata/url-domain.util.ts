/** Hostname without leading www — shared by Bright Data Search mapping. */
export function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
