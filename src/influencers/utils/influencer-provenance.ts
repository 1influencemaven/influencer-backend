import { InfluencerDataOrigin } from '../../generated/prisma/enums';
import type { InfluencerFieldKey } from './influencer-field-keys';

export type FieldProvenanceRecord = {
  fieldKey: string;
  origin: InfluencerDataOrigin;
};

export type ExternalFieldCandidate<T> = {
  fieldKey: InfluencerFieldKey;
  /** `undefined` means the external source omitted the field — keep last value. */
  value: T | null | undefined;
};

/**
 * Decides whether an EXTERNAL update may write a field.
 * - MANUAL fields are never overwritten by EXTERNAL.
 * - Omitted EXTERNAL values (`undefined`) never clear existing data.
 * - `null` EXTERNAL is treated as explicit empty only when origin is not MANUAL
 *   (callers should prefer omit over null for "unknown").
 */
export function canApplyExternalFieldUpdate(params: {
  origin: InfluencerDataOrigin | undefined;
  value: unknown;
}): boolean {
  if (params.value === undefined) {
    return false;
  }

  if (params.origin === InfluencerDataOrigin.MANUAL) {
    return false;
  }

  return true;
}

export function buildProvenanceUpserts(params: {
  influencerId: string;
  fieldKeys: InfluencerFieldKey[];
  origin: InfluencerDataOrigin;
  source?: string;
  fetchedAt?: Date;
}): Array<{
  influencerId: string;
  fieldKey: string;
  origin: InfluencerDataOrigin;
  source: string | null;
  fetchedAt: Date | null;
}> {
  const uniqueKeys = [...new Set(params.fieldKeys)];

  return uniqueKeys.map((fieldKey) => ({
    influencerId: params.influencerId,
    fieldKey,
    origin: params.origin,
    source: params.source ?? null,
    fetchedAt: params.fetchedAt ?? null,
  }));
}

export function originByFieldKey(
  records: FieldProvenanceRecord[],
): Map<string, InfluencerDataOrigin> {
  return new Map(records.map((row) => [row.fieldKey, row.origin]));
}
