import { normalizeUrlKey } from '../brightdata/normalize-url-key';
import {
  htmlFromPeeSnapshot,
  indexUsablePeeSnapshots,
  isAllowedBrandPageDomain,
} from './pee-snapshot-reuse';

describe('pee-snapshot-reuse (RF-04.3 / RF-04.3.1)', () => {
  const pee = [
    'https://demo.co/',
    'https://demo.co/contact',
    'https://demo.co/about',
  ];

  it('indexes matching on-domain PEE candidates (normalizeUrlKey)', () => {
    const { byKey, rejected } = indexUsablePeeSnapshots({
      snapshots: [
        {
          url: 'https://demo.co/contact/',
          normalizedUrl: normalizeUrlKey('https://demo.co/contact/'),
          fetchedAt: '2026-01-01T00:00:00.000Z',
          content: '<html>ok</html>',
          truncated: false,
        },
      ],
      peeCandidateUrls: pee,
      brandDomain: 'demo.co',
    });
    expect(rejected).toBe(0);
    expect(byKey.has(normalizeUrlKey('https://demo.co/contact'))).toBe(true);
  });

  it('RF-04.3.1: accepts when normalizedUrl matches key derived from url', () => {
    const url = 'https://demo.co/about';
    const key = normalizeUrlKey(url);
    const { byKey, rejected } = indexUsablePeeSnapshots({
      snapshots: [
        {
          url,
          normalizedUrl: key,
          fetchedAt: '2026-01-01T00:00:00.000Z',
          content: '<html>about</html>',
          truncated: false,
        },
      ],
      peeCandidateUrls: pee,
      brandDomain: 'demo.co',
    });
    expect(rejected).toBe(0);
    expect(byKey.get(key)?.content).toBe('<html>about</html>');
  });

  it('RF-04.3.1: rejects normalizedUrl manipulated to another PEE candidate', () => {
    const { byKey, rejected } = indexUsablePeeSnapshots({
      snapshots: [
        {
          // Origin page is pricing (not indexed as key); claims contact key.
          url: 'https://demo.co/pricing',
          normalizedUrl: normalizeUrlKey('https://demo.co/contact'),
          fetchedAt: '2026-01-01T00:00:00.000Z',
          content: '<html>stolen pricing body for contact slot</html>',
          truncated: false,
        },
      ],
      peeCandidateUrls: pee,
      brandDomain: 'demo.co',
    });
    expect(rejected).toBe(1);
    expect(byKey.size).toBe(0);
    expect(byKey.has(normalizeUrlKey('https://demo.co/contact'))).toBe(false);
  });

  it('RF-04.3.1: rejects on-domain url that is not a PEE candidate', () => {
    const { byKey, rejected } = indexUsablePeeSnapshots({
      snapshots: [
        {
          url: 'https://demo.co/pricing',
          normalizedUrl: normalizeUrlKey('https://demo.co/pricing'),
          fetchedAt: '2026-01-01T00:00:00.000Z',
          content: '<html>ok</html>',
          truncated: false,
        },
      ],
      peeCandidateUrls: pee,
      brandDomain: 'demo.co',
    });
    expect(byKey.size).toBe(0);
    expect(rejected).toBe(1);
  });

  it('RF-04.3.1: rejects inconsistent url vs normalizedUrl even when both are PEE paths', () => {
    const { byKey, rejected } = indexUsablePeeSnapshots({
      snapshots: [
        {
          url: 'https://demo.co/about',
          // Claims contact key while content belongs to about
          normalizedUrl: normalizeUrlKey('https://demo.co/contact'),
          fetchedAt: '2026-01-01T00:00:00.000Z',
          content: '<html>about body mis-keyed as contact</html>',
          truncated: false,
        },
      ],
      peeCandidateUrls: pee,
      brandDomain: 'demo.co',
    });
    expect(rejected).toBe(1);
    expect(byKey.size).toBe(0);
  });

  it('rejects non-PEE URLs', () => {
    const { byKey, rejected } = indexUsablePeeSnapshots({
      snapshots: [
        {
          url: 'https://demo.co/pricing',
          normalizedUrl: normalizeUrlKey('https://demo.co/pricing'),
          fetchedAt: '2026-01-01T00:00:00.000Z',
          content: '<html>ok</html>',
          truncated: false,
        },
      ],
      peeCandidateUrls: pee,
      brandDomain: 'demo.co',
    });
    expect(byKey.size).toBe(0);
    expect(rejected).toBe(1);
  });

  it('rejects different domain', () => {
    const { rejected } = indexUsablePeeSnapshots({
      snapshots: [
        {
          url: 'https://evil.test/contact',
          normalizedUrl: normalizeUrlKey('https://evil.test/contact'),
          fetchedAt: '2026-01-01T00:00:00.000Z',
          content: '<html>ok</html>',
          truncated: false,
        },
      ],
      peeCandidateUrls: pee,
      brandDomain: 'demo.co',
    });
    expect(rejected).toBe(1);
    expect(isAllowedBrandPageDomain('https://evil.test/contact', 'demo.co')).toBe(
      false,
    );
  });

  it('rejects empty content', () => {
    const { rejected } = indexUsablePeeSnapshots({
      snapshots: [
        {
          url: 'https://demo.co/contact',
          normalizedUrl: normalizeUrlKey('https://demo.co/contact'),
          fetchedAt: '2026-01-01T00:00:00.000Z',
          content: '',
          truncated: true,
        } as never,
      ],
      peeCandidateUrls: pee,
      brandDomain: 'demo.co',
    });
    expect(rejected).toBe(1);
  });

  it('reinjects mailtoEmails missing from truncated content', () => {
    const html = htmlFromPeeSnapshot({
      url: 'https://demo.co/contact',
      normalizedUrl: normalizeUrlKey('https://demo.co/contact'),
      fetchedAt: '2026-01-01T00:00:00.000Z',
      content: '<html>truncated without mailto</html>',
      truncated: true,
      mailtoEmails: ['press@demo.co'],
    });
    expect(html).toContain('mailto:press@demo.co');
    expect(html).toContain('press@demo.co');
  });
});
