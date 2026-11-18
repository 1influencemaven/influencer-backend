import { CommercialRelevance } from '../../generated/prisma/enums';

import {
  classifyCommercialRelevance,
  commercialCoverageTier,
  commercialCoverageTierFromRelevance,
  normalizeBusinessEmail,
} from './commercial-relevance.util';

describe('classifyCommercialRelevance (RF-02)', () => {
  it('classifies HIGH partnership/creators local-parts (cases 1-2)', () => {
    expect(classifyCommercialRelevance('partnerships@brand.com')).toBe(
      CommercialRelevance.HIGH,
    );
    expect(classifyCommercialRelevance('Influencer@Brand.COM')).toBe(
      CommercialRelevance.HIGH,
    );
    expect(classifyCommercialRelevance('creator@x.io')).toBe(
      CommercialRelevance.HIGH,
    );
    expect(classifyCommercialRelevance('creators@brand.com')).toBe(
      CommercialRelevance.HIGH,
    );
    expect(classifyCommercialRelevance('collab@x.io')).toBe(
      CommercialRelevance.HIGH,
    );
  });

  it('classifies MEDIUM marketing/press/affiliate as NEUTRAL (cases 3-5)', () => {
    expect(classifyCommercialRelevance('marketing@brand.com')).toBe(
      CommercialRelevance.NEUTRAL,
    );
    expect(classifyCommercialRelevance('press@brand.com')).toBe(
      CommercialRelevance.NEUTRAL,
    );
    expect(classifyCommercialRelevance('affiliate@brand.com')).toBe(
      CommercialRelevance.NEUTRAL,
    );
    expect(commercialCoverageTier('marketing@brand.com')).toBe('MEDIUM');
    expect(commercialCoverageTier('press@brand.com')).toBe('MEDIUM');
    expect(commercialCoverageTier('affiliate@brand.com')).toBe('MEDIUM');
  });

  it('classifies GENERAL info/contact as UNKNOWN (case 6)', () => {
    expect(classifyCommercialRelevance('info@brand.com')).toBe(
      CommercialRelevance.UNKNOWN,
    );
    expect(classifyCommercialRelevance('hello@brand.com')).toBe(
      CommercialRelevance.UNKNOWN,
    );
    expect(classifyCommercialRelevance('contact@brand.com')).toBe(
      CommercialRelevance.UNKNOWN,
    );
    expect(commercialCoverageTier('info@brand.com')).toBe('GENERAL');
  });

  it('classifies LOW support (case 7)', () => {
    expect(classifyCommercialRelevance('support@brand.com')).toBe(
      CommercialRelevance.LOW,
    );
    expect(classifyCommercialRelevance('help@brand.com')).toBe(
      CommercialRelevance.LOW,
    );
    expect(classifyCommercialRelevance('noreply@brand.com')).toBe(
      CommercialRelevance.LOW,
    );
  });

  it('returns UNKNOWN when not confidently classifiable', () => {
    expect(classifyCommercialRelevance('john.smith@brand.com')).toBe(
      CommercialRelevance.UNKNOWN,
    );
    expect(classifyCommercialRelevance('not-an-email')).toBe(
      CommercialRelevance.UNKNOWN,
    );
  });

  it('RF-02.1: person-like UNKNOWN is OTHER, not GENERAL', () => {
    expect(commercialCoverageTier('john.smith@brand.com')).toBe('OTHER');
    expect(
      commercialCoverageTierFromRelevance(
        CommercialRelevance.UNKNOWN,
        'alex@brand.com',
      ),
    ).toBe('OTHER');
    expect(
      commercialCoverageTierFromRelevance(
        CommercialRelevance.UNKNOWN,
        'info@brand.com',
      ),
    ).toBe('GENERAL');
    expect(
      commercialCoverageTierFromRelevance(
        CommercialRelevance.HIGH,
        'partnerships@brand.com',
      ),
    ).toBe('HIGH');
  });
});

describe('normalizeBusinessEmail', () => {
  it('lowercases and trims for BrandBusinessContact identity', () => {
    expect(normalizeBusinessEmail('  PARTNERSHIPS@Brand.COM ')).toBe(
      'partnerships@brand.com',
    );
  });
});
