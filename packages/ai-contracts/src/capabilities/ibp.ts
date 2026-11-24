import { z } from 'zod';

import {
  instagramResearchEvidenceSchema,
  talentInterpretationOutputLlmCaptureSchema,
  talentInterpretationOutputSchema,
} from './talent-profile-interpretation';

export const ibpGenerationInputSchema = z.object({
  influencer: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    niche: z.string().nullable().optional(),
    platforms: z.array(z.string()).optional(),
    audienceSize: z.number().nullable().optional(),
    audienceLocation: z.string().nullable().optional(),
    /** Primary audience language (explicit field; also kept in notes for older runs). */
    audienceLanguage: z.string().nullable().optional(),
    /** Engagement rate in percent when known. */
    engagementRate: z.number().nullable().optional(),
    contentStyle: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
  /** Manual Talent Manager niches (PASO 1). Not inferred from hashtags. */
  manualNiches: z.array(z.string().min(1).max(100)).optional(),
  /**
   * Sanitized Instagram research snapshot when available.
   * Null/omit = legacy talent without research (compatible path).
   */
  instagramResearchEvidence: instagramResearchEvidenceSchema
    .nullable()
    .optional(),
});

export type IbpGenerationInput = z.infer<typeof ibpGenerationInputSchema>;

/**
 * IBP commercial criteria (Brand Discovery snapshot) + talent interpretation
 * from the same Mastra run. Existing IBP fields keep their meaning.
 */
export const ibpGenerationOutputSchema = z.object({
  targetSectors: z.array(z.string()),
  excludedSectors: z.array(z.string()),
  brandSize: z.array(z.string()),
  markets: z.array(z.string()),
  collaborationTypes: z.array(z.string()),
  summary: z.string(),
  alertSignals: z.array(z.string()),
  desirableCriteria: z.array(z.string()),
  /** HU-TM-004 block; required for new agent runs. */
  talentInterpretation: talentInterpretationOutputSchema,
});

export type IbpGenerationOutput = z.infer<typeof ibpGenerationOutputSchema>;

/**
 * Lenient capture schema for Mastra structuredOutput (no HU-TM-004 superRefine).
 * Worker must normalize + parse with ibpGenerationOutputSchema before success.
 */
export const ibpGenerationOutputLlmCaptureSchema = z.object({
  targetSectors: z.array(z.string()),
  excludedSectors: z.array(z.string()),
  brandSize: z.array(z.string()),
  markets: z.array(z.string()),
  collaborationTypes: z.array(z.string()),
  summary: z.string(),
  alertSignals: z.array(z.string()),
  desirableCriteria: z.array(z.string()),
  talentInterpretation: talentInterpretationOutputLlmCaptureSchema,
});

export type IbpGenerationOutputLlmCapture = z.infer<
  typeof ibpGenerationOutputLlmCaptureSchema
>;

/** IBP criteria snapshot sent into Brand Discovery plan/score (unchanged shape). */
export const ibpCriteriaSnapshotSchema = z.object({
  targetSectors: z.array(z.string()),
  excludedSectors: z.array(z.string()),
  brandSize: z.array(z.string()),
  markets: z.array(z.string()),
  collaborationTypes: z.array(z.string()),
  summary: z.string(),
  alertSignals: z.array(z.string()),
  desirableCriteria: z.array(z.string()),
});

export type IbpCriteriaSnapshot = z.infer<typeof ibpCriteriaSnapshotSchema>;
