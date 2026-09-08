import { classifyPublicEmailGeneric } from './public-email-generic.util';

describe('public-email-generic.util', () => {
  it('classifies functional mailboxes as generic', () => {
    expect(classifyPublicEmailGeneric('info@company.com')).toBe(true);
    expect(classifyPublicEmailGeneric('marketing@company.com')).toBe(true);
    expect(classifyPublicEmailGeneric('partnerships@company.com')).toBe(true);
  });

  it('does not classify personal-looking emails as generic', () => {
    expect(classifyPublicEmailGeneric('john.smith@company.com')).toBe(false);
    expect(classifyPublicEmailGeneric('m.said@liquid-iv.com')).toBe(false);
  });
});
