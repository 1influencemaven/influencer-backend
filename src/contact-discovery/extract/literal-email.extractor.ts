import { extractLiteralEmailsFromText } from '../../lead-discovery/utils/literal-email-extract.util';

import type { BbcRawEmailObservation } from './bbc-email-candidate';

/**
 * Extract literal emails from HTML or SERP snippet text.
 * Never invents addresses — only regex matches present in the text.
 */
export function extractLiteralEmailObservations(args: {
  text: string;
  sourceUrl: string;
}): BbcRawEmailObservation[] {
  const matches = extractLiteralEmailsFromText(args.text);
  return matches.map((match) => ({
    email: match.email,
    sourceUrl: args.sourceUrl,
    evidenceSnippet: match.evidenceSnippet,
  }));
}
