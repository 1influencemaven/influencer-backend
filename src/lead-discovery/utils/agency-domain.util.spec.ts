import {
  normalizeAgencyDomain,
  normalizeAgencyName,
} from './agency-domain.util';

describe('agency-domain.util (2C.1)', () => {
  describe('normalizeAgencyDomain', () => {
    it('lowercases host and strips www', () => {
      expect(normalizeAgencyDomain('https://WWW.Demo-Agency.COM/path')).toBe(
        'demo-agency.com',
      );
      expect(normalizeAgencyDomain('www.demo-agency.com')).toBe(
        'demo-agency.com',
      );
    });

    it('is stable for equivalent URLs (uniqueness key)', () => {
      const a = normalizeAgencyDomain('https://agency.example/');
      const b = normalizeAgencyDomain('http://www.agency.example/contact');
      expect(a).toBe('agency.example');
      expect(b).toBe('agency.example');
      expect(a).toBe(b);
    });

    it('returns empty for blank input', () => {
      expect(normalizeAgencyDomain('')).toBe('');
      expect(normalizeAgencyDomain('   ')).toBe('');
    });

    it('does not treat different registrable domains as equal', () => {
      expect(normalizeAgencyDomain('https://alpha.agency.com')).not.toBe(
        normalizeAgencyDomain('https://beta.agency.com'),
      );
    });
  });

  describe('normalizeAgencyName', () => {
    it('collapses case and punctuation for soft matching', () => {
      expect(normalizeAgencyName('  Demo Influencer Agency, LLC. ')).toBe(
        'demo influencer agency llc',
      );
    });
  });
});
