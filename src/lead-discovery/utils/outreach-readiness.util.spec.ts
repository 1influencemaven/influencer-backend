import {
  ContactChannelStatus,
  ContactChannelType,
} from '../../generated/prisma/enums';
import { computeOutreachReadiness } from './outreach-readiness.util';

describe('outreach-readiness.util', () => {
  it('returns LIMITED when no active channels', () => {
    expect(computeOutreachReadiness([])).toBe('LIMITED');
    expect(
      computeOutreachReadiness([
        {
          type: ContactChannelType.EMAIL,
          status: ContactChannelStatus.INVALID,
          isGeneric: false,
        },
      ]),
    ).toBe('LIMITED');
  });

  it('returns PARTIAL for LinkedIn only (D1)', () => {
    expect(
      computeOutreachReadiness([
        {
          type: ContactChannelType.LINKEDIN,
          status: ContactChannelStatus.ACTIVE,
        },
      ]),
    ).toBe('PARTIAL');
  });

  it('returns PARTIAL for generic email (D1 — not READY)', () => {
    expect(
      computeOutreachReadiness([
        {
          type: ContactChannelType.EMAIL,
          status: ContactChannelStatus.ACTIVE,
          isGeneric: true,
        },
      ]),
    ).toBe('PARTIAL');
  });

  it('returns PARTIAL for non-generic email in D1 (no correlation yet)', () => {
    expect(
      computeOutreachReadiness([
        {
          type: ContactChannelType.EMAIL,
          status: ContactChannelStatus.ACTIVE,
          isGeneric: false,
        },
      ]),
    ).toBe('PARTIAL');
  });

  it('returns PARTIAL for website channel', () => {
    expect(
      computeOutreachReadiness([
        {
          type: ContactChannelType.WEBSITE,
          status: ContactChannelStatus.ACTIVE,
        },
      ]),
    ).toBe('PARTIAL');
  });
});
