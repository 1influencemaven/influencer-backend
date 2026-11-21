import { z } from 'zod';

export const scoredBrandSchema = z.object({
  name: z.string().min(1),
  website: z.string().min(1),
  sector: z.string().optional(),
  market: z.string().optional(),
  brandSize: z.string().optional(),
  score: z.number().min(0).max(100),
  fitReason: z.string().min(1),
  evidenceUrls: z.array(z.string()).default([]),
});

export const brandDiscoveryOutputSchema = z.object({
  brands: z.array(scoredBrandSchema),
});

export type BrandDiscoveryOutput = z.infer<typeof brandDiscoveryOutputSchema>;
export type ScoredBrand = z.infer<typeof scoredBrandSchema>;

export function parseBrandDiscoveryOutput(raw: string): BrandDiscoveryOutput {
  const trimmed = raw.trim();
  const jsonMatch =
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i) ??
    trimmed.match(/(\{[\s\S]*\})/);

  const jsonText = jsonMatch ? jsonMatch[1].trim() : trimmed;
  const parsed: unknown = JSON.parse(jsonText);
  return brandDiscoveryOutputSchema.parse(parsed);
}
