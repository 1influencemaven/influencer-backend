import { LeadEmailConfidence } from '../../generated/prisma/enums';
import { assessEmailConfidence } from './email-confidence.util';
import { isGenericEmail } from './generic-email.util';
import { sortContactsByTitlePriority } from './title-priority.util';

describe('generic-email.util', () => {
  it('detects generic local parts', () => {
    expect(isGenericEmail('info@acme.com')).toBe(true);
    expect(isGenericEmail('hola@acme.com')).toBe(true);
    expect(isGenericEmail('alex.rivera@acme.com')).toBe(false);
  });
});

describe('email-confidence.util', () => {
  it('marks invalid formats', () => {
    expect(assessEmailConfidence('not-an-email', 'acme.com')).toBe(
      LeadEmailConfidence.INVALID,
    );
  });

  it('marks matching domain name patterns as valid/probable', () => {
    expect(assessEmailConfidence('alex.rivera@acme.com', 'acme.com')).toBe(
      LeadEmailConfidence.VALID,
    );
    expect(assessEmailConfidence('alex@acme.com', 'acme.com')).toBe(
      LeadEmailConfidence.PROBABLE,
    );
  });
});

describe('title-priority.util', () => {
  it('sorts preferred roles first and generics last', () => {
    const sorted = sortContactsByTitlePriority([
      { title: 'Intern', isGeneric: false },
      { title: 'CEO', isGeneric: false },
      { title: 'Info', isGeneric: true },
      { title: 'Influencer Marketing Manager', isGeneric: false },
    ]);
    expect(sorted.map((c) => c.title)).toEqual([
      'Influencer Marketing Manager',
      'CEO',
      'Intern',
      'Info',
    ]);
  });
});
