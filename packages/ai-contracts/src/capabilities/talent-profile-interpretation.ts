import { z } from 'zod';

/** Independent from AI_CONTRACT_VERSION ("1.0") and Prisma evidence version (1). */
export const TALENT_INTERPRETATION_OUTPUT_VERSION = '1.0' as const;

export const confidenceSchema = z.enum(['low', 'medium', 'high']);
export type Confidence = z.infer<typeof confidenceSchema>;

/**
 * Mirrors Influencer.instagramResearchEvidence.normalized.
 * Scalars nullable; arrays always present. No invented defaults.
 */
export const instagramNormalizedProfileSchema = z.object({
  account: z.string().nullable(),
  displayName: z.string().nullable(),
  biography: z.string().nullable(),
  followers: z.number().int().nonnegative().nullable(),
  following: z.number().int().nonnegative().nullable(),
  postsCount: z.number().int().nonnegative().nullable(),
  isPrivate: z.boolean().nullable(),
  isVerified: z.boolean().nullable(),
  emailAddress: z.string().nullable(),
  profileImageUrl: z.string().nullable(),
  profileUrl: z.string().nullable(),
  externalUrls: z.array(z.string()),
  bioHashtags: z.array(z.string()),
  postHashtags: z.array(z.string()),
});
export type InstagramNormalizedProfile = z.infer<
  typeof instagramNormalizedProfileSchema
>;

/** Mirrors sanitized InstagramResearchEvidence (version literal 1). */
export const instagramResearchEvidenceSchema = z.object({
  version: z.literal(1),
  source: z.string().min(1),
  fetchedAt: z.string().datetime(),
  handleNormalized: z.string().min(1),
  profileUrl: z.string().min(1),
  normalized: instagramNormalizedProfileSchema,
});
export type InstagramResearchEvidenceContract = z.infer<
  typeof instagramResearchEvidenceSchema
>;

/** Citation into input evidence only (Nest validates path + value). */
export const evidenceRefSchema = z.object({
  fieldPath: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  note: z.string().max(500).optional(),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

/**
 * Lenient evidence ref for Mastra capture: local LLMs often put arrays/objects
 * in `value`. Worker coerces before strict evidenceRefSchema parse.
 */
export const evidenceRefLlmCaptureSchema = z.object({
  fieldPath: z.string().min(1),
  value: z.unknown(),
  // Local LLMs emit `null` for omitted optional text; the worker strips it
  // before the strict evidenceRefSchema parse.
  note: z.string().max(500).nullish(),
});

export const profileSummarySchema = z.object({
  text: z.string().min(1).max(2000),
  confidence: confidenceSchema,
  evidence: z.array(evidenceRefSchema).min(1),
});
export type ProfileSummary = z.infer<typeof profileSummarySchema>;

const profileSummaryLlmCaptureSchema = z.object({
  text: z.string().min(1).max(2000),
  confidence: confidenceSchema,
  evidence: z.array(evidenceRefLlmCaptureSchema).min(1),
});

/** Free-text niche or content category, always evidence-backed. */
export const classificationItemSchema = z.object({
  label: z.string().min(1).max(100),
  rationale: z.string().min(1).max(1000),
  confidence: confidenceSchema,
  evidence: z.array(evidenceRefSchema).min(1),
});
export type ClassificationItem = z.infer<typeof classificationItemSchema>;

const classificationItemLlmCaptureSchema = z.object({
  label: z.string().min(1).max(100),
  rationale: z.string().min(1).max(1000),
  confidence: confidenceSchema,
  evidence: z.array(evidenceRefLlmCaptureSchema).min(1),
});

export const commercialSignalTypeSchema = z.enum([
  'brand_reference',
  'product_reference',
  'sponsorship_disclosure',
  'affiliate_or_discount',
  'business_contact',
  'commercial_intent',
]);
export type CommercialSignalType = z.infer<typeof commercialSignalTypeSchema>;

export const commercialSignalSchema = z.object({
  type: commercialSignalTypeSchema,
  label: z.string().min(1).max(200),
  rationale: z.string().min(1).max(1000),
  confidence: confidenceSchema,
  evidence: z.array(evidenceRefSchema).min(1),
  /** Required for brand_reference: mention ≠ sponsorship (Nest enforces). */
  disclaimer: z.string().max(500).optional(),
});
export type CommercialSignal = z.infer<typeof commercialSignalSchema>;

const commercialSignalLlmCaptureSchema = z.object({
  type: commercialSignalTypeSchema,
  label: z.string().min(1).max(200),
  rationale: z.string().min(1).max(1000),
  confidence: confidenceSchema,
  evidence: z.array(evidenceRefLlmCaptureSchema).min(1),
  disclaimer: z.string().max(500).nullish(),
});

/**
 * Shape-only talent interpretation (strict evidence value types, no superRefine).
 */
export const talentInterpretationOutputBaseSchema = z.object({
  outputVersion: z.literal(TALENT_INTERPRETATION_OUTPUT_VERSION),
  insufficientEvidence: z.boolean(),
  summary: profileSummarySchema.nullable(),
  niches: z.array(classificationItemSchema),
  contentCategories: z.array(classificationItemSchema),
  commercialSignals: z.array(commercialSignalSchema),
  limitations: z.array(z.string().min(1)),
});

/**
 * Mastra structuredOutput capture: allows non-scalar evidence.value; worker
 * coerces + applies HU-TM-004 before ibpGenerationOutputSchema.parse.
 */
export const talentInterpretationOutputLlmCaptureSchema = z.object({
  outputVersion: z.literal(TALENT_INTERPRETATION_OUTPUT_VERSION),
  insufficientEvidence: z.boolean(),
  summary: profileSummaryLlmCaptureSchema.nullable(),
  niches: z.array(classificationItemLlmCaptureSchema),
  contentCategories: z.array(classificationItemLlmCaptureSchema),
  commercialSignals: z.array(commercialSignalLlmCaptureSchema),
  limitations: z.array(z.string().min(1)),
});

/**
 * Talent interpretation block (HU-TM-004). Produced in the same IBP agent run.
 * No execution metadata — Nest attaches that separately.
 */
export const talentInterpretationOutputSchema =
  talentInterpretationOutputBaseSchema.superRefine((data, ctx) => {
    if (data.insufficientEvidence) {
      if (data.summary !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['summary'],
          message: 'summary must be null when insufficientEvidence is true',
        });
      }
      if (data.niches.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['niches'],
          message: 'niches must be empty when insufficientEvidence is true',
        });
      }
      if (data.contentCategories.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['contentCategories'],
          message:
            'contentCategories must be empty when insufficientEvidence is true',
        });
      }
      if (data.commercialSignals.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['commercialSignals'],
          message:
            'commercialSignals must be empty when insufficientEvidence is true',
        });
      }
      if (data.limitations.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['limitations'],
          message:
            'limitations must explain insufficiency when insufficientEvidence is true',
        });
      }
      return;
    }

    if (data.summary === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['summary'],
        message: 'summary is required when insufficientEvidence is false',
      });
    }

    const hasCollection =
      data.niches.length > 0 ||
      data.contentCategories.length > 0 ||
      data.commercialSignals.length > 0;
    if (!hasCollection) {
      ctx.addIssue({
        code: 'custom',
        message:
          'at least one of niches, contentCategories, commercialSignals must be non-empty when insufficientEvidence is false',
      });
    }

    for (const [index, signal] of data.commercialSignals.entries()) {
      if (signal.type === 'brand_reference' && !signal.disclaimer?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['commercialSignals', index, 'disclaimer'],
          message:
            'brand_reference requires disclaimer (mention is not sponsorship)',
        });
      }
    }
  });
export type TalentInterpretationOutput = z.infer<
  typeof talentInterpretationOutputSchema
>;
