import { z } from 'zod';

export const ibpOutputSchema = z.object({
  targetSectors: z.array(z.string().min(1)),
  excludedSectors: z.array(z.string()),
  brandSize: z.array(z.string().min(1)),
  markets: z.array(z.string().min(1)),
  collaborationTypes: z.array(z.string().min(1)),
  summary: z.string().min(1),
  alertSignals: z.array(z.string()),
  desirableCriteria: z.array(z.string()),
});

export type IbpOutput = z.infer<typeof ibpOutputSchema>;

export function parseIbpOutput(raw: string): IbpOutput {
  const trimmed = raw.trim();
  const jsonMatch =
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i) ??
    trimmed.match(/(\{[\s\S]*\})/);

  const jsonText = jsonMatch ? jsonMatch[1].trim() : trimmed;
  const parsed: unknown = JSON.parse(jsonText);
  return ibpOutputSchema.parse(parsed);
}
