import {
  assessAgencyContactEmailDomain,
  buildCorroboratedAgencyDomains,
  isAgencyDomainEmail,
  isAllowedAgencyContactEmailDomain,
} from './agency-contact-domain.util';

describe('agency-contact-domain.util (2C.4.3)', () => {
  const agency = 'creatorpartners.example';

  it('allows exact agency domain', () => {
    expect(
      assessAgencyContactEmailDomain(
        'partnerships@creatorpartners.example',
        agency,
      ),
    ).toEqual({ decision: 'allow', reason: 'agency_domain' });
  });

  it('allows agency subdomain (mail.)', () => {
    expect(isAgencyDomainEmail('hello@mail.creatorpartners.example', agency)).toBe(
      true,
    );
    expect(
      assessAgencyContactEmailDomain(
        'hello@mail.creatorpartners.example',
        agency,
      ).decision,
    ).toBe('allow');
  });

  it('rejects textual lookalike that is not a subdomain', () => {
    expect(
      isAgencyDomainEmail(
        'x@creatorpartners.example.evil.com',
        agency,
      ),
    ).toBe(false);
    expect(
      assessAgencyContactEmailDomain(
        'x@notcreatorpartners.example',
        agency,
      ),
    ).toEqual({ decision: 'reject', reason: 'external_domain' });
  });

  it('rejects external brand/third-party domains', () => {
    expect(
      assessAgencyContactEmailDomain('press@nike.com', agency),
    ).toEqual({ decision: 'reject', reason: 'external_domain' });
  });

  it('rejects free-mail', () => {
    expect(
      assessAgencyContactEmailDomain('alex@gmail.com', agency),
    ).toEqual({ decision: 'reject', reason: 'free_mail' });
  });

  it('rejects noreply / blocked locals', () => {
    expect(
      assessAgencyContactEmailDomain('noreply@creatorpartners.example', agency),
    ).toEqual({ decision: 'reject', reason: 'blocked_local' });
    expect(
      assessAgencyContactEmailDomain(
        'mailer-daemon@creatorpartners.example',
        agency,
      ).reason,
    ).toBe('blocked_local');
  });

  it('rejects malformed email', () => {
    expect(assessAgencyContactEmailDomain('not-an-email', agency)).toEqual({
      decision: 'reject',
      reason: 'invalid',
    });
  });

  it('allows corroborated alternate host', () => {
    expect(
      assessAgencyContactEmailDomain(
        'hello@creatorpartners.es',
        agency,
        ['creatorpartners.es'],
      ),
    ).toEqual({ decision: 'allow', reason: 'corroborated_domain' });
  });

  it('buildCorroboratedAgencyDomains includes website host', () => {
    const hosts = buildCorroboratedAgencyDomains({
      agencyDomain: agency,
      website: 'https://www.creatorpartners.example/about',
    });
    expect(hosts).toContain(agency);
  });

  it('isAllowedAgencyContactEmailDomain mirrors assess', () => {
    expect(
      isAllowedAgencyContactEmailDomain(
        'partnerships@creatorpartners.example',
        agency,
      ),
    ).toBe(true);
    expect(isAllowedAgencyContactEmailDomain('a@gmail.com', agency)).toBe(
      false,
    );
  });
});
