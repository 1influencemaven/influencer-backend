jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { resolveNicheKeys } from '../brand-discovery/utils/brand-sector-taxonomy.util';
import {
  BrandKnowledgeService,
  decisionDeltas,
  type BrandDecisionStatus,
} from './brand-knowledge.service';

function build() {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'brand-1' }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    brandCandidate: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new BrandKnowledgeService(prisma as never);
  return { service, prisma };
}

describe('resolveNicheKeys', () => {
  it('maps broad terms to canonical keys without exploding them', () => {
    const { nicheKeys } = resolveNicheKeys(['beauty', 'Moda', 'home decor']);
    expect(nicheKeys.sort()).toEqual(['beauty', 'fashion', 'home-decor']);
  });

  it('drops abstract-only terms and reports concrete unknowns', () => {
    const result = resolveNicheKeys(['mindset', 'comedy', 'mycelium packaging']);
    expect(result.nicheKeys).toEqual([]);
    expect(result.unmappedTerms).toEqual(['mycelium packaging']);
  });

  it('ignores empty values and dedupes', () => {
    expect(resolveNicheKeys([null, undefined, '  ', 'beauty', 'skincare']))
      .toEqual({ nicheKeys: ['beauty'], unmappedTerms: [] });
  });
});

describe('decisionDeltas', () => {
  const d = (from: BrandDecisionStatus, to: BrandDecisionStatus) =>
    decisionDeltas(from, to);

  it('is a no-op for the same status', () => {
    expect(d('APPROVED', 'APPROVED')).toEqual({
      approved: 0,
      rejected: 0,
      postponed: 0,
    });
  });

  it('moves a counter from the old status to the new one', () => {
    expect(d('UNDER_REVIEW', 'APPROVED')).toEqual({
      approved: 1,
      rejected: 0,
      postponed: 0,
    });
    expect(d('APPROVED', 'REJECTED')).toEqual({
      approved: -1,
      rejected: 1,
      postponed: 0,
    });
    expect(d('REJECTED', 'UNDER_REVIEW')).toEqual({
      approved: 0,
      rejected: -1,
      postponed: 0,
    });
  });

  it('a chain of transitions nets out to the final status only', () => {
    const chain: BrandDecisionStatus[] = [
      'UNDER_REVIEW',
      'POSTPONED',
      'APPROVED',
      'REJECTED',
      'APPROVED',
    ];
    const total = { approved: 0, rejected: 0, postponed: 0 };
    for (let i = 1; i < chain.length; i += 1) {
      const delta = d(chain[i - 1], chain[i]);
      total.approved += delta.approved;
      total.rejected += delta.rejected;
      total.postponed += delta.postponed;
    }
    expect(total).toEqual({ approved: 1, rejected: 0, postponed: 0 });
  });
});

describe('BrandKnowledgeService.canonicalDomain', () => {
  const { service } = build();

  it('normalizes brand sites', () => {
    expect(service.canonicalDomain({ website: 'https://www.Glossier.com/x' })).toBe(
      'glossier.com',
    );
  });

  it('rejects empty, link-in-bio hosts and noise hosts', () => {
    expect(service.canonicalDomain({ website: '' })).toBeNull();
    expect(
      service.canonicalDomain({ website: 'https://linktr.ee/somebrand' }),
    ).toBeNull();
    expect(service.canonicalDomain({ website: 'https://www.amazon.com/x' })).toBeNull();
    expect(service.canonicalDomain({ website: 'https://apnews.com/a' })).toBeNull();
  });
});

describe('BrandKnowledgeService.nicheKeysFor', () => {
  const { service } = build();

  it('prefers the candidate sector over the influencer niches', () => {
    expect(
      service.nicheKeysFor({ sector: 'skincare beauty' }, ['fitness', 'travel']),
    ).toEqual(['beauty']);
  });

  it('falls back to the influencer niches, capped at 3', () => {
    const keys = service.nicheKeysFor({ sector: 'unknown thing' }, [
      'beauty',
      'fashion',
      'home decor',
      'fitness',
    ]);
    expect(keys).toHaveLength(3);
  });
});

describe('BrandKnowledgeService writes', () => {
  const candidate = {
    name: 'Glossier',
    website: 'https://glossier.com',
    domain: 'glossier.com',
    sector: 'beauty',
    score: 0.8,
    evidenceUrls: ['https://glossier.com/about'],
    evidenceStatus: 'VERIFIED',
    source: 'mastra',
  };

  it('recordSurfaced upserts the brand and one affinity per niche', async () => {
    const { service, prisma } = build();
    await service.recordSurfaced({
      influencerTerms: [],
      candidates: [candidate, { ...candidate, sector: 'home decor' }],
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('skips MODEL_PRIOR, noise hosts and candidates without a niche', async () => {
    const { service, prisma } = build();
    await service.recordSurfaced({
      influencerTerms: [],
      candidates: [
        { ...candidate, groundingSource: 'MODEL_PRIOR' },
        { ...candidate, website: 'https://amazon.com/x', domain: 'amazon.com' },
      ],
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('never throws when the database write fails', async () => {
    const { service, prisma } = build();
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));
    await expect(
      service.recordSurfaced({ influencerTerms: [], candidates: [candidate] }),
    ).resolves.toBeUndefined();
    await expect(
      service.recordDecision({
        candidate,
        influencerTerms: [],
        from: 'UNDER_REVIEW',
        to: 'APPROVED',
      }),
    ).resolves.toBeUndefined();
  });

  it('recordDecision does nothing for a no-op transition', async () => {
    const { service, prisma } = build();
    await service.recordDecision({
      candidate,
      influencerTerms: [],
      from: 'APPROVED',
      to: 'APPROVED',
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('rebuild skips ineligible rows and overwrites counters', async () => {
    const { service, prisma } = build();
    const row = (over: Record<string, unknown>) => ({
      id: String(Math.random()),
      name: 'B',
      website: 'https://b.com',
      domain: 'b.com',
      sector: 'beauty',
      market: null,
      brandSize: null,
      score: 0.5,
      evidenceUrls: [],
      evidenceStatus: 'VERIFIED',
      source: 'mastra',
      status: 'APPROVED',
      metadata: null,
      createdAt: new Date('2026-01-01'),
      influencer: { niche: null, subNiche: null, niches: [] },
      ...over,
    });
    prisma.brandCandidate.findMany
      .mockResolvedValueOnce([
        row({ id: 'a' }),
        row({ id: 'b', status: 'REJECTED' }),
        row({ id: 'c', metadata: { groundingSource: 'MODEL_PRIOR' } }),
        row({ id: 'd', evidenceStatus: 'NOT_ASSESSED', status: 'UNDER_REVIEW' }),
        row({ id: 'e', domain: 'linktr.ee', website: 'https://linktr.ee/x' }),
      ])
      .mockResolvedValueOnce([]);
    const summary = await service.rebuildFromCandidates();
    expect(summary).toEqual({
      candidatesScanned: 5,
      brands: 1,
      affinities: 1,
      skipped: 3,
    });
  });
});

describe('BrandKnowledgeService.suggestSeedBrands (read path)', () => {
  const brand = (domain: string) => ({
    domain,
    name: domain.split('.')[0],
    website: `https://${domain}`,
    sectors: ['beauty'],
    markets: ['US'],
    sizeTag: null,
    evidenceUrls: [`https://${domain}/about`],
  });
  const affinity = (domain: string, approved: number, rejected: number, avg = 80) => ({
    nicheKey: 'beauty',
    approvedCount: approved,
    rejectedCount: rejected,
    avgScore: avg,
    brand: brand(domain),
  });

  function withRows(rows: unknown[], existing: string[] = []) {
    const { service, prisma } = build();
    prisma.brandCandidate.findMany.mockResolvedValue(existing.map((domain) => ({ domain })));
    const brandNicheAffinity = { findMany: jest.fn().mockResolvedValue(rows) };
    Object.assign(prisma, { brandNicheAffinity });
    return { service, brandNicheAffinity };
  }

  it('suggests approved brands for the niche, skipping existing and mostly-rejected ones', async () => {
    const { service, brandNicheAffinity } = withRows(
      [
        affinity('pixibeauty.com', 2, 0),
        affinity('already.com', 3, 0),
        affinity('disliked.com', 1, 3),
        affinity('glow.com', 0, 0, 85),
      ],
      ['already.com'],
    );
    const seeds = await service.suggestSeedBrands({
      influencerId: 'inf-1',
      influencerTerms: ['skincare'],
      limit: 5,
    });
    expect(seeds.map((s) => s.website)).toEqual([
      'https://pixibeauty.com',
      'https://glow.com',
    ]);
    expect(seeds[0]).toMatchObject({ nicheKey: 'beauty', approvedCount: 2, sector: 'beauty' });
    expect(brandNicheAffinity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ nicheKey: { in: ['beauty'] } }),
      }),
    );
  });

  it('returns [] for unmapped niches, limit 0 or a failing query', async () => {
    const { service } = withRows([affinity('a.com', 1, 0)]);
    expect(
      await service.suggestSeedBrands({ influencerId: 'i', influencerTerms: ['mindset'], limit: 5 }),
    ).toEqual([]);
    expect(
      await service.suggestSeedBrands({ influencerId: 'i', influencerTerms: ['beauty'], limit: 0 }),
    ).toEqual([]);
    const failing = withRows([]);
    failing.brandNicheAffinity.findMany.mockRejectedValue(new Error('db down'));
    expect(
      await failing.service.suggestSeedBrands({ influencerId: 'i', influencerTerms: ['beauty'], limit: 5 }),
    ).toEqual([]);
  });
});
