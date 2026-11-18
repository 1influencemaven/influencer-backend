import { canAttributeEmailToPerson } from './contact-email-attribution.util';

describe('canAttributeEmailToPerson (RF-01 / RF-01.1)', () => {
  it('allows non-generic LinkedIn profile-sourced addresses (regression 4)', () => {
    expect(
      canAttributeEmailToPerson({
        email: 'alex@brand.com',
        personName: 'Alex Partner',
        sourceKind: 'linkedin',
        evidenceSnippet: 'dataset field: alex@brand.com',
      }),
    ).toBe(true);
  });

  it('RF-01.1: info@ + linkedin is not person-attributed (regression 1)', () => {
    expect(
      canAttributeEmailToPerson({
        email: 'info@brand.com',
        personName: 'Alex Partner',
        sourceKind: 'linkedin',
        evidenceSnippet: 'dataset field: info@brand.com',
      }),
    ).toBe(false);
  });

  it('RF-01.1: partnerships@ + linkedin is not person-attributed (regression 2)', () => {
    expect(
      canAttributeEmailToPerson({
        email: 'partnerships@brand.com',
        personName: 'Alex Partner',
        sourceKind: 'linkedin',
        evidenceSnippet: 'dataset field: partnerships@brand.com',
      }),
    ).toBe(false);
  });

  it('RF-01.1: support@ + linkedin is not person-attributed (regression 3)', () => {
    expect(
      canAttributeEmailToPerson({
        email: 'support@brand.com',
        personName: 'Alex Partner',
        sourceKind: 'linkedin',
        evidenceSnippet: 'Contact support@brand.com',
      }),
    ).toBe(false);
  });

  it('RF-01.1: generic in LinkedIn about text is not person-attributed (regression 5)', () => {
    expect(
      canAttributeEmailToPerson({
        email: 'hello@brand.com',
        personName: 'Alex Partner',
        sourceKind: 'linkedin',
        evidenceSnippet: 'Reach the team at hello@brand.com',
      }),
    ).toBe(false);
  });

  it('does not link generic inbox via brand_web (regression 8)', () => {
    expect(
      canAttributeEmailToPerson({
        email: 'info@brand.com',
        personName: 'Alex Partner',
        sourceKind: 'brand_web',
        evidenceSnippet: 'Contact us at info@brand.com',
      }),
    ).toBe(false);
  });

  it('does not link generic inbox via ocr (regression 8)', () => {
    expect(
      canAttributeEmailToPerson({
        email: 'marketing@brand.com',
        personName: 'Alex Partner',
        sourceKind: 'ocr',
        evidenceSnippet: 'Alex marketing@brand.com',
      }),
    ).toBe(false);
  });

  it('links person and email when published together on brand_web (regression 8)', () => {
    expect(
      canAttributeEmailToPerson({
        email: 'alex@brand.com',
        personName: 'Alex Partner',
        sourceKind: 'brand_web',
        evidenceSnippet: 'Reach Alex at alex@brand.com for partnerships',
      }),
    ).toBe(true);
  });

  it('links person and email when published together on ocr (regression 8)', () => {
    expect(
      canAttributeEmailToPerson({
        email: 'alex@brand.com',
        personName: 'Alex Partner',
        sourceKind: 'ocr',
        evidenceSnippet: 'Alex · alex@brand.com',
      }),
    ).toBe(true);
  });

  it('rejects brand_web personal email without name in evidence', () => {
    expect(
      canAttributeEmailToPerson({
        email: 'alex@brand.com',
        personName: 'Alex Partner',
        sourceKind: 'brand_web',
        evidenceSnippet: 'Write to alex@brand.com',
      }),
    ).toBe(false);
  });
});
