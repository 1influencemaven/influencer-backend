import { ContactChannelType } from '../../generated/prisma/enums';
import { normalizeChannelValue } from './contact-channel-normalize.util';

describe('contact-channel-normalize.util', () => {
  it('normalizes email to lowercase', () => {
    expect(
      normalizeChannelValue(ContactChannelType.EMAIL, 'INFO@Company.COM'),
    ).toBe('info@company.com');
  });

  it('normalizes URL without query string', () => {
    expect(
      normalizeChannelValue(
        ContactChannelType.LINKEDIN,
        'https://LinkedIn.com/in/User?trk=foo',
      ),
    ).toBe('https://linkedin.com/in/user');
  });
});
