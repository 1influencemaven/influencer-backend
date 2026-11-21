import { z } from 'zod';

export const brandSearchStrategySchema = z.object({
  queries: z.array(z.string().min(10).max(200)).min(1).max(8),
});

export type BrandSearchStrategyPlan = z.infer<typeof brandSearchStrategySchema>;

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const jsonMatch = trimmed.match(/(\{[\s\S]*\})/);
  return jsonMatch ? jsonMatch[1].trim() : trimmed;
}

export function parseBrandSearchStrategyPlan(
  raw: string,
): BrandSearchStrategyPlan {
  const jsonText = stripMarkdownFences(raw);
  const parsed: unknown = JSON.parse(jsonText);
  return brandSearchStrategySchema.parse(parsed);
}
