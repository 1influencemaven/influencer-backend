import type { ScoredBrand } from '@influence-maven/ai-contracts';

import {
  buildBrandEvidenceAllowlist,
  canonicalizeEvidenceUrl,
  filterScoredBrandsByEvidence,
  isEvidenceUrlAuthorized,
  isWebsiteSyntacticallyValid,
} from './brand-evidence-filter.util';

function brand(
  overrides: Partial<ScoredBrand> & Pick<ScoredBrand, 'name' | 'website'>,
): ScoredBrand {
  return {
    score: 80,
    fitReason: 'Strong IBP fit',
    evidenceUrls: [],
    sector: 'wellness',
    market: 'Spain',
    brandSize: 'smb',
    ...overrides,
  };
}

describe('brand-evidence-filter.util (AI-004.5.3 classifier)', () => {
  describe('canonicalizeEvidenceUrl / isWebsiteSyntacticallyValid', () => {
    it('normalizes protocol and www for the same resource', () => {
      expect(canonicalizeEvidenceUrl('http://www.Example.com/path')).toBe(
        'example.com/path',
      );
      expect(canonicalizeEvidenceUrl('https://example.com/path')).toBe(
        'example.com/path',
      );
    });

    it('rejects empty or garbage websites', () => {
      expect(isWebsiteSyntacticallyValid('')).toBe(false);
      expect(isWebsiteSyntacticallyValid('   ')).toBe(false);
      expect(isWebsiteSyntacticallyValid('not a url :::')).toBe(false);
      expect(isWebsiteSyntacticallyValid('https://demo.example')).toBe(true);
    });
  });

  it('1: authorized website + evidenceUrl → VERIFIED', () => {
    const scored = brand({
      name: 'Demo',
      website: 'https://demo.example',
      score: 91,
      fitReason: 'Exact fit',
      evidenceUrls: ['https://demo.example/about'],
      sector: 'wellness',
    });

    const result = filterScoredBrandsByEvidence([scored], {
      searchHits: [{ url: 'https://demo.example/about' }],
    });

    expect(result.verified).toHaveLength(1);
    expect(result.unverified).toHaveLength(0);
    expect(result.discarded).toHaveLength(0);
    expect(result.verified[0]).toEqual(
      expect.objectContaining({
        name: 'Demo',
        website: 'https://demo.example',
        score: 91,
        fitReason: 'Exact fit',
        sector: 'wellness',
        evidenceUrls: ['https://demo.example/about'],
      }),
    );
  });

  it('2: authorized domain but no evidenceUrls → UNVERIFIED', () => {
    const scored = brand({
      name: 'No evidence',
      website: 'https://demo.example',
      evidenceUrls: [],
    });

    const result = filterScoredBrandsByEvidence([scored], {
      searchHits: [{ url: 'https://demo.example' }],
    });

    expect(result.verified).toHaveLength(0);
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0].evidenceUrls).toEqual([]);
    expect(result.unverified[0].name).toBe('No evidence');
    expect(result.unverified[0].score).toBe(80);
  });

  it('3: unauthorized evidenceUrls only → UNVERIFIED with empty evidence', () => {
    const scored = brand({
      name: 'Fake evidence',
      website: 'https://real.example',
      evidenceUrls: ['https://invented.example/page'],
    });

    const result = filterScoredBrandsByEvidence([scored], {
      searchHits: [{ url: 'https://real.example/home' }],
    });

    expect(result.verified).toHaveLength(0);
    expect(result.unverified).toEqual([
      expect.objectContaining({
        name: 'Fake evidence',
        website: 'https://real.example',
        evidenceUrls: [],
      }),
    ]);
  });

  it('4: empty allowlist → valid brands UNVERIFIED', () => {
    const scored = brand({
      name: 'Orphan',
      website: 'https://demo.example',
      evidenceUrls: ['https://demo.example'],
    });

    const result = filterScoredBrandsByEvidence([scored], {
      searchHits: [],
      seedBrands: [],
    });

    expect(result.verified).toEqual([]);
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0].evidenceUrls).toEqual([]);
    expect(result.discarded).toEqual([]);
  });

  it('5: website domain outside allowlist → UNVERIFIED', () => {
    const scored = brand({
      name: 'Wrong site',
      website: 'https://evil.example',
      evidenceUrls: ['https://serp.example/page'],
    });

    const result = filterScoredBrandsByEvidence([scored], {
      searchHits: [{ url: 'https://serp.example/page' }],
    });

    expect(result.verified).toHaveLength(0);
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0].evidenceUrls).toEqual([]);
  });

  it('6: empty website → discarded', () => {
    const scored = brand({
      name: 'No site',
      website: '   ',
      evidenceUrls: ['https://demo.example'],
    });

    const result = filterScoredBrandsByEvidence([scored], {
      searchHits: [{ url: 'https://demo.example' }],
    });

    expect(result.discarded).toEqual([
      expect.objectContaining({ reason: 'INVALID_WEBSITE' }),
    ]);
    expect(result.verified).toEqual([]);
    expect(result.unverified).toEqual([]);
  });

  it('7: syntactically invalid website → discarded', () => {
    const scored = brand({
      name: 'Bad url',
      website: '://bad',
      evidenceUrls: [],
    });

    const result = filterScoredBrandsByEvidence([scored], {
      searchHits: [{ url: 'https://demo.example' }],
    });

    expect(result.discarded[0].reason).toBe('INVALID_WEBSITE');
  });

  it('8: empty name → discarded', () => {
    const scored = brand({
      name: '  ',
      website: 'https://demo.example',
      evidenceUrls: ['https://demo.example'],
    });

    const result = filterScoredBrandsByEvidence([scored], {
      searchHits: [{ url: 'https://demo.example' }],
    });

    expect(result.discarded[0].reason).toBe('EMPTY_NAME');
  });

  it('9: candidata without evidenceUrls → UNVERIFIED (even with domain on allowlist)', () => {
    const scored = brand({
      name: 'Seed-backed domain',
      website: 'https://seed.example',
      evidenceUrls: [],
    });

    const result = filterScoredBrandsByEvidence([scored], {
      seedBrands: [{ website: 'https://seed.example' }],
    });

    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0].evidenceUrls).toEqual([]);
  });

  it('10: mixed statuses classified correctly', () => {
    const result = filterScoredBrandsByEvidence(
      [
        brand({
          name: 'Verified Co',
          website: 'https://demo.example',
          evidenceUrls: ['https://demo.example/about'],
        }),
        brand({
          name: 'Unverified Co',
          website: 'https://other.example',
          evidenceUrls: ['https://invented.example/x'],
        }),
        brand({
          name: '',
          website: 'https://demo.example',
          evidenceUrls: [],
        }),
      ],
      { searchHits: [{ url: 'https://demo.example/about' }] },
    );

    expect(result.verified.map((b) => b.name)).toEqual(['Verified Co']);
    expect(result.unverified.map((b) => b.name)).toEqual(['Unverified Co']);
    expect(result.discarded).toHaveLength(1);
    expect(result.discarded[0].reason).toBe('EMPTY_NAME');
  });

  it('11: UNVERIFIED evidenceUrls are always empty', () => {
    const scored = brand({
      name: 'Clear me',
      website: 'https://evil.example',
      evidenceUrls: ['https://serp.example/page', 'https://evil.example/x'],
    });

    const result = filterScoredBrandsByEvidence([scored], {
      searchHits: [{ url: 'https://serp.example/page' }],
    });

    expect(result.unverified[0].evidenceUrls).toEqual([]);
  });

  it('12: does not fill evidenceUrls from other brands or foreign SERP hits', () => {
    const result = filterScoredBrandsByEvidence(
      [
        brand({
          name: 'A',
          website: 'https://a.example',
          evidenceUrls: [],
        }),
      ],
      {
        searchHits: [
          { url: 'https://b.example/page' },
          { url: 'https://c.example/page' },
        ],
      },
    );

    expect(result.unverified[0].evidenceUrls).toEqual([]);
  });

  it('13: preserves commercial fields on VERIFIED and UNVERIFIED', () => {
    const verified = brand({
      name: 'V',
      website: 'https://demo.example',
      score: 88,
      fitReason: 'Verified reason',
      sector: 'wellness',
      market: 'Spain',
      brandSize: 'smb',
      evidenceUrls: ['https://demo.example/ok'],
    });
    const unverified = brand({
      name: 'U',
      website: 'https://other.example',
      score: 61,
      fitReason: 'Potential fit',
      sector: 'tech',
      market: 'EU',
      brandSize: 'mid',
      evidenceUrls: ['https://invented.example'],
    });

    const result = filterScoredBrandsByEvidence([verified, unverified], {
      searchHits: [{ url: 'https://demo.example/ok' }],
    });

    expect(result.verified[0]).toMatchObject({
      score: 88,
      fitReason: 'Verified reason',
      sector: 'wellness',
      market: 'Spain',
      brandSize: 'smb',
    });
    expect(result.unverified[0]).toMatchObject({
      score: 61,
      fitReason: 'Potential fit',
      sector: 'tech',
      market: 'EU',
      brandSize: 'mid',
      evidenceUrls: [],
    });
  });

  it('keeps only authorized evidence on VERIFIED when mixed', () => {
    const scored = brand({
      name: 'Mixed',
      website: 'https://demo.example',
      evidenceUrls: [
        'https://demo.example/ok',
        'https://invented.example/nope',
        'https://demo.example/also',
      ],
    });

    const result = filterScoredBrandsByEvidence([scored], {
      searchHits: [
        { url: 'https://demo.example/ok' },
        { url: 'https://demo.example/also' },
      ],
    });

    expect(result.verified[0].evidenceUrls).toEqual([
      'https://demo.example/ok',
      'https://demo.example/also',
    ]);
  });

  it('accepts seed-backed VERIFIED brands', () => {
    const scored = brand({
      name: 'Seed Co',
      website: 'seed.example',
      evidenceUrls: ['https://seed.example/press'],
    });

    const result = filterScoredBrandsByEvidence([scored], {
      seedBrands: [
        {
          website: 'https://seed.example',
          evidenceUrls: ['https://seed.example/press'],
        },
      ],
    });

    expect(result.verified).toHaveLength(1);
    expect(result.verified[0].website).toBe('seed.example');
  });

  it('requires exact subdomain match for VERIFIED (blog ≠ apex)', () => {
    const result = filterScoredBrandsByEvidence(
      [
        brand({
          name: 'Apex',
          website: 'https://example.com',
          evidenceUrls: ['https://blog.example.com/post'],
        }),
      ],
      { searchHits: [{ url: 'https://blog.example.com/post' }] },
    );

    expect(result.verified).toHaveLength(0);
    expect(result.unverified).toHaveLength(1);

    const matching = filterScoredBrandsByEvidence(
      [
        brand({
          name: 'Blog',
          website: 'https://blog.example.com',
          evidenceUrls: ['https://blog.example.com/post'],
        }),
      ],
      { searchHits: [{ url: 'https://blog.example.com/post' }] },
    );
    expect(matching.verified).toHaveLength(1);
  });

  it('matches URLs that differ only by query parameters', () => {
    const result = filterScoredBrandsByEvidence(
      [
        brand({
          name: 'UTM',
          website: 'https://demo.example',
          evidenceUrls: ['https://demo.example/path'],
        }),
      ],
      {
        searchHits: [{ url: 'https://demo.example/path?utm_source=serp' }],
      },
    );

    expect(result.verified).toHaveLength(1);
  });

  it('does not let Mastra URLs expand the allowlist', () => {
    const invented = 'https://model-invented.example/x';
    const allowlist = buildBrandEvidenceAllowlist({
      searchHits: [{ url: 'https://serp.example/a' }],
    });

    expect(isEvidenceUrlAuthorized(invented, allowlist)).toBe(false);

    const result = filterScoredBrandsByEvidence(
      [
        brand({
          name: 'Expand',
          website: 'https://model-invented.example',
          evidenceUrls: [invented],
        }),
      ],
      { searchHits: [{ url: 'https://serp.example/a' }] },
    );

    expect(result.verified).toHaveLength(0);
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0].evidenceUrls).toEqual([]);
  });

  it('returns empty buckets for empty brands list', () => {
    const result = filterScoredBrandsByEvidence([], {
      searchHits: [{ url: 'https://demo.example' }],
    });

    expect(result.verified).toEqual([]);
    expect(result.unverified).toEqual([]);
    expect(result.discarded).toEqual([]);
  });
});
