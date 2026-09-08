import { toProfilePublicEmailInput } from './profile-public-email-input.util';

describe('toProfilePublicEmailInput', () => {
  it('maps RawLeadContact company context', () => {
    const input = toProfilePublicEmailInput({
      contactName: 'Ada Lovelace',
      profileUrl: 'https://linkedin.com/in/ada',
      companyName: 'Acme',
      companyLinkedInUrl: 'https://linkedin.com/company/acme',
      companyWebsite: 'https://acme.com',
      source: 'test',
    });

    expect(input).toEqual({
      personName: 'Ada Lovelace',
      profileUrl: 'https://linkedin.com/in/ada',
      companyName: 'Acme',
      companyLinkedInUrl: 'https://linkedin.com/company/acme',
      companyWebsite: 'https://acme.com',
    });
  });

  it('requires profileUrl', () => {
    expect(() =>
      toProfilePublicEmailInput({
        contactName: 'Ada',
        source: 'test',
      }),
    ).toThrow('profileUrl is required');
  });
});
