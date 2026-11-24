import {
  CommercialRelevance,
  LeadEmailConfidence,
} from '../../generated/prisma/enums';
import { businessContactTier, leadContactTier } from './contact-tier.util';

const lead = (over: Partial<Parameters<typeof leadContactTier>[0]>) => ({
  email: null,
  emailConfidence: LeadEmailConfidence.UNKNOWN,
  isGeneric: false,
  profileUrl: null,
  ...over,
});

describe('contact tiers', () => {
  it('TIER_1 only for verified nominal emails (valid or catch-all)', () => {
    expect(
      leadContactTier(lead({ email: 'ana@b.com', emailConfidence: LeadEmailConfidence.VALID })),
    ).toBe('TIER_1');
    expect(
      leadContactTier(lead({ email: 'ana@b.com', emailConfidence: LeadEmailConfidence.PROBABLE })),
    ).toBe('TIER_1');
    expect(
      leadContactTier(lead({ email: 'ana@b.com', profileUrl: 'https://www.linkedin.com/in/ana' })),
    ).toBe('TIER_3');
  });

  it('TIER_3 for LinkedIn people without a usable email', () => {
    expect(leadContactTier(lead({ profileUrl: 'https://www.linkedin.com/in/ana' }))).toBe('TIER_3');
    expect(
      leadContactTier(
        lead({
          email: 'ana@b.com',
          emailConfidence: LeadEmailConfidence.INVALID,
          profileUrl: 'https://www.linkedin.com/in/ana',
        }),
      ),
    ).toBe('TIER_3');
    expect(leadContactTier(lead({}))).toBe('REJECTED');
  });

  it('mailboxes: area → TIER_2, info/hello/support → GENERIC (kept)', () => {
    expect(
      businessContactTier({ email: 'partnerships@b.com', commercialRelevance: CommercialRelevance.HIGH }),
    ).toBe('TIER_2');
    expect(
      businessContactTier({ email: 'press@b.com', commercialRelevance: CommercialRelevance.NEUTRAL }),
    ).toBe('TIER_2');
    expect(
      businessContactTier({ email: 'hello@b.com', commercialRelevance: CommercialRelevance.UNKNOWN }),
    ).toBe('GENERIC');
    expect(
      businessContactTier({ email: 'support@b.com', commercialRelevance: CommercialRelevance.LOW }),
    ).toBe('GENERIC');
    expect(
      leadContactTier(lead({ email: 'pr@b.com', isGeneric: true, emailConfidence: LeadEmailConfidence.VALID })),
    ).toBe('TIER_2');
    expect(
      leadContactTier(lead({ email: 'info@b.com', isGeneric: true })),
    ).toBe('GENERIC');
  });
});
