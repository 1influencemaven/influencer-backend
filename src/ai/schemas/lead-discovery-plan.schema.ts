import { z } from 'zod';

export const leadDiscoveryPlanSchema = z.object({
  scraperIds: z.array(z.string().min(3)).min(1).max(3),
  priorityRoles: z.array(z.string().min(2)).min(1).max(12),
  notes: z.string().optional(),
  /** Legacy field from older prompts; ignored by search layer */
  tavilyQueries: z.array(z.string()).optional(),
});

export type LeadDiscoveryPlan = z.infer<typeof leadDiscoveryPlanSchema>;

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function parseLeadDiscoveryPlan(raw: string): LeadDiscoveryPlan {
  const jsonText = stripMarkdownFences(raw);
  const parsed: unknown = JSON.parse(jsonText);
  return leadDiscoveryPlanSchema.parse(parsed);
}
