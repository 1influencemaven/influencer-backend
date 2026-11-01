import { z } from 'zod';

/**
 * Structured AI decision for one contact-research iteration.
 * Backend validates and executes tools — model never calls HTTP or credentials.
 */
export const contactResearchDecisionSchema = z.object({
  action: z.enum([
    'search_web',
    'fetch_page',
    'extract_emails',
    'finalize_research',
  ]),
  reason: z.string().min(1).max(500),
  query: z.string().min(3).max(200).optional(),
  url: z.string().url().optional(),
  finalize: z
    .object({
      outcome: z.enum(['RESULTS_FOUND', 'NO_MATCHES', 'PROVIDER_FAILURE']),
      summary: z.string().max(500).optional(),
    })
    .optional(),
});

export type ContactResearchDecision = z.infer<
  typeof contactResearchDecisionSchema
>;

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const jsonMatch = trimmed.match(/(\{[\s\S]*\})/);
  return jsonMatch ? jsonMatch[1].trim() : trimmed;
}

export function parseContactResearchDecision(
  raw: string,
): ContactResearchDecision {
  const jsonText = stripMarkdownFences(raw);
  const parsed: unknown = JSON.parse(jsonText);
  return contactResearchDecisionSchema.parse(parsed);
}
