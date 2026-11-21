import { InfluencerDataOrigin } from '../../generated/prisma/enums';
import { INFLUENCER_FIELD_KEYS } from './influencer-field-keys';
import {
  buildProvenanceUpserts,
  canApplyExternalFieldUpdate,
} from './influencer-provenance';

describe('canApplyExternalFieldUpdate', () => {
  it('rejects omitted external values to preserve last known data', () => {
    expect(
      canApplyExternalFieldUpdate({
        origin: InfluencerDataOrigin.EXTERNAL,
        value: undefined,
      }),
    ).toBe(false);
  });

  it('never overwrites MANUAL fields with EXTERNAL data', () => {
    expect(
      canApplyExternalFieldUpdate({
        origin: InfluencerDataOrigin.MANUAL,
        value: 'new@example.com',
      }),
    ).toBe(false);
  });

  it('allows EXTERNAL overwrite when origin is EXTERNAL or LEGACY or missing', () => {
    expect(
      canApplyExternalFieldUpdate({
        origin: InfluencerDataOrigin.EXTERNAL,
        value: 1000,
      }),
    ).toBe(true);
    expect(
      canApplyExternalFieldUpdate({
        origin: InfluencerDataOrigin.LEGACY,
        value: 1000,
      }),
    ).toBe(true);
    expect(
      canApplyExternalFieldUpdate({
        origin: undefined,
        value: 1000,
      }),
    ).toBe(true);
  });
});

describe('buildProvenanceUpserts', () => {
  it('deduplicates field keys', () => {
    const rows = buildProvenanceUpserts({
      influencerId: 'inf-1',
      fieldKeys: [
        INFLUENCER_FIELD_KEYS.EMAIL,
        INFLUENCER_FIELD_KEYS.EMAIL,
        INFLUENCER_FIELD_KEYS.NICHES,
      ],
      origin: InfluencerDataOrigin.MANUAL,
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.fieldKey).sort()).toEqual(['email', 'niches']);
  });
});
