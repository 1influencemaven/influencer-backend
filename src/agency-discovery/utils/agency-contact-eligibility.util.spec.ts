import { AgencyRelevanceStatus } from '../../generated/prisma/enums';
import {
  agencyContactEligibilitySkipReason,
  isAgencyEligibleForContactResearch,
} from './agency-contact-eligibility.util';

describe('agency-contact-eligibility.util (2C.4.3)', () => {
  it('allows RELEVANT and UNDER_REVIEW', () => {
    expect(
      isAgencyEligibleForContactResearch(AgencyRelevanceStatus.RELEVANT),
    ).toBe(true);
    expect(
      isAgencyEligibleForContactResearch(AgencyRelevanceStatus.UNDER_REVIEW),
    ).toBe(true);
    expect(
      agencyContactEligibilitySkipReason(AgencyRelevanceStatus.UNDER_REVIEW),
    ).toBeNull();
  });

  it('excludes NOT_RELEVANT and DISCARDED', () => {
    expect(
      isAgencyEligibleForContactResearch(AgencyRelevanceStatus.NOT_RELEVANT),
    ).toBe(false);
    expect(
      isAgencyEligibleForContactResearch(AgencyRelevanceStatus.DISCARDED),
    ).toBe(false);
    expect(
      agencyContactEligibilitySkipReason(AgencyRelevanceStatus.NOT_RELEVANT),
    ).toBe('relevance_not_relevant');
    expect(
      agencyContactEligibilitySkipReason(AgencyRelevanceStatus.DISCARDED),
    ).toBe('relevance_discarded');
  });
});
