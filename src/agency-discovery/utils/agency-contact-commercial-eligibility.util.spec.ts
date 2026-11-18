import {
  AgencyContactKind,
  AgencyRelevanceStatus,
  CommercialRelevance,
} from '../../generated/prisma/enums';
import {
  assessAgencyContactCommercialEligibility,
  inferAgencyContactResearchOperation,
} from './agency-contact-commercial-eligibility.util';

describe('agency-contact-commercial-eligibility (2C.4.7)', () => {
  it('RELEVANT + HIGH → ACTIONABLE priority', () => {
    expect(
      assessAgencyContactCommercialEligibility({
        agencyRelevanceStatus: AgencyRelevanceStatus.RELEVANT,
        commercialRelevance: CommercialRelevance.HIGH,
      }),
    ).toEqual({
      include: true,
      status: 'ACTIONABLE',
      reason: 'relevant_high',
      priority: true,
    });
  });

  it('RELEVANT + NEUTRAL → ACTIONABLE not priority', () => {
    expect(
      assessAgencyContactCommercialEligibility({
        agencyRelevanceStatus: AgencyRelevanceStatus.RELEVANT,
        commercialRelevance: CommercialRelevance.NEUTRAL,
      }),
    ).toEqual({
      include: true,
      status: 'ACTIONABLE',
      reason: 'relevant_neutral',
      priority: false,
    });
  });

  it('RELEVANT + UNKNOWN → VISIBLE_NOT_PRIORITY', () => {
    expect(
      assessAgencyContactCommercialEligibility({
        agencyRelevanceStatus: AgencyRelevanceStatus.RELEVANT,
        commercialRelevance: CommercialRelevance.UNKNOWN,
      }).status,
    ).toBe('VISIBLE_NOT_PRIORITY');
  });

  it('UNDER_REVIEW → VISIBLE_NOT_ACTIONABLE even if HIGH', () => {
    expect(
      assessAgencyContactCommercialEligibility({
        agencyRelevanceStatus: AgencyRelevanceStatus.UNDER_REVIEW,
        commercialRelevance: CommercialRelevance.HIGH,
      }),
    ).toMatchObject({
      include: true,
      status: 'VISIBLE_NOT_ACTIONABLE',
      priority: false,
    });
  });

  it.each([
    AgencyRelevanceStatus.NOT_RELEVANT,
    AgencyRelevanceStatus.DISCARDED,
  ])('excludes agency %s', (agencyRelevanceStatus) => {
    expect(
      assessAgencyContactCommercialEligibility({
        agencyRelevanceStatus,
        commercialRelevance: CommercialRelevance.HIGH,
      }).include,
    ).toBe(false);
  });

  it('excludes commercial LOW', () => {
    expect(
      assessAgencyContactCommercialEligibility({
        agencyRelevanceStatus: AgencyRelevanceStatus.RELEVANT,
        commercialRelevance: CommercialRelevance.LOW,
      }),
    ).toEqual({
      include: false,
      reason: 'commercial_low',
      priority: false,
    });
  });

  it('infers FIND_AGENCY_PEOPLE for PERSON / linkedin / ocr', () => {
    expect(
      inferAgencyContactResearchOperation({
        contactKind: AgencyContactKind.PERSON,
        sourceKind: 'agency_web',
      }),
    ).toBe('FIND_AGENCY_PEOPLE');
    expect(
      inferAgencyContactResearchOperation({
        contactKind: AgencyContactKind.MAILBOX,
        sourceKind: 'linkedin',
      }),
    ).toBe('FIND_AGENCY_PEOPLE');
    expect(
      inferAgencyContactResearchOperation({
        contactKind: AgencyContactKind.MAILBOX,
        sourceKind: 'ocr',
      }),
    ).toBe('FIND_AGENCY_PEOPLE');
  });

  it('infers FIND_AGENCY_EMAILS for MAILBOX agency_web / missing source', () => {
    expect(
      inferAgencyContactResearchOperation({
        contactKind: AgencyContactKind.MAILBOX,
        sourceKind: 'agency_web',
      }),
    ).toBe('FIND_AGENCY_EMAILS');
    expect(
      inferAgencyContactResearchOperation({
        contactKind: AgencyContactKind.MAILBOX,
        sourceKind: null,
      }),
    ).toBe('FIND_AGENCY_EMAILS');
  });
});
