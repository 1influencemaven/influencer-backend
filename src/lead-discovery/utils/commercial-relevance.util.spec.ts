import { CommercialRelevance } from '../../generated/prisma/enums';

import {
  classifyCommercialRelevance,
  normalizeBusinessEmail,
} from './commercial-relevance.util';

describe('classifyCommercialRelevance', () => {
  it('classifies HIGH partnership-style local-parts', () => {
    expect(classifyCommercialRelevance('partnerships@brand.com')).toBe(
      CommercialRelevance.HIGH,
    );
    expect(classifyCommercialRelevance('Influencer@Brand.COM')).toBe(
      CommercialRelevance.HIGH,
    );
    expect(classifyCommercialRelevance('creator@x.io')).toBe(
      CommercialRelevance.HIGH,
    );
    expect(classifyCommercialRelevance('collab@x.io')).toBe(
      CommercialRelevance.HIGH,
    );
    expect(classifyCommercialRelevance('affiliate@x.io')).toBe(
      CommercialRelevance.HIGH,
    );
    expect(classifyCommercialRelevance('press@x.io')).toBe(
      CommercialRelevance.HIGH,
    );
    expect(classifyCommercialRelevance('marketing@x.io')).toBe(
      CommercialRelevance.HIGH,
    );
  });

  it('classifies LOW support/noreply local-parts', () => {
    expect(classifyCommercialRelevance('support@brand.com')).toBe(
      CommercialRelevance.LOW,
    );
    expect(classifyCommercialRelevance('noreply@brand.com')).toBe(
      CommercialRelevance.LOW,
    );
    expect(classifyCommercialRelevance('no-reply@brand.com')).toBe(
      CommercialRelevance.LOW,
    );
    expect(classifyCommercialRelevance('donotreply@brand.com')).toBe(
      CommercialRelevance.LOW,
    );
    expect(classifyCommercialRelevance('do-not-reply@brand.com')).toBe(
      CommercialRelevance.LOW,
    );
  });

  it('classifies commercial brand inboxes as HIGH', () => {
    expect(classifyCommercialRelevance('info@brand.com')).toBe(
      CommercialRelevance.HIGH,
    );
    expect(classifyCommercialRelevance('hello@brand.com')).toBe(
      CommercialRelevance.HIGH,
    );
    expect(classifyCommercialRelevance('contact@brand.com')).toBe(
      CommercialRelevance.HIGH,
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

  it('does not treat HIGH as incompatible with isGeneric semantics', () => {
    // Domain invariant documented in ADR-0016: partnerships@ may be
    // isGeneric=true AND commercialRelevance=HIGH.
    expect(classifyCommercialRelevance('partnerships@brand.com')).toBe(
      CommercialRelevance.HIGH,
    );
  });
});

describe('normalizeBusinessEmail', () => {
  it('lowercases and trims for BrandBusinessContact identity', () => {
    expect(normalizeBusinessEmail('  PARTNERSHIPS@Brand.COM ')).toBe(
      'partnerships@brand.com',
    );
  });
});
