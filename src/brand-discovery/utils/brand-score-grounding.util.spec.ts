import type { ScoredBrand } from '@influence-maven/ai-contracts';

import {
  MODEL_PRIOR_FIT_REASON,
  applyScoreCap,
  detectIbpBrandSizeInconsistency,
  enrichScoredBrandForPersistence,
  resolveFitReason,
  resolveGroundingSource,
  sanitizeBrandSize,
  scoreCapForGrounding,
} from './brand-score-grounding.util';

const ibpSmb = {
  targetSectors: ['hardware'],
  excludedSectors: ['gambling'],
  brandSize: ['smb'],
  markets: ['Europe'],
  collaborationTypes: ['UGC'],
  summary: 'Tech',
  alertSignals: [],
  desirableCriteria: [],
};

function brand(overrides: Partial<ScoredBrand> = {}): ScoredBrand {
  return {
    name: 'Acme',
    website: 'https://acme.example',
    sector: 'hardware',
    market: 'Europe',
    brandSize: 'smb',
    score: 90,
    fitReason: 'Solid sector fit for the IBP.',
    evidenceUrls: [],
    ...overrides,
  };
}

describe('brand-score-grounding.util (AI-004.5.1.2)', () => {
  describe('sanitizeBrandSize', () => {
    it('accepts domain vocabulary and normalizes aliases', () => {
      expect(sanitizeBrandSize('smb')).toBe('smb');
      expect(sanitizeBrandSize('mid-market')).toBe('mid_market');
      expect(sanitizeBrandSize('enterprise')).toBe('enterprise');
      expect(sanitizeBrandSize('startup')).toBe('startup');
    });

    it('rejects invented sizes (unknown)', () => {
      expect(sanitizeBrandSize('mmb')).toBeUndefined();
      expect(sanitizeBrandSize('lrg')).toBeUndefined();
      expect(sanitizeBrandSize('huge')).toBeUndefined();
    });
  });

  describe('resolveGroundingSource', () => {
    it('SEARCH_EVIDENCE when website domain is in SERP hits', () => {
      const r = resolveGroundingSource({
        website: 'https://senic.com',
        evidenceUrls: ['https://senic.com/about'],
        searchHits: [{ url: 'https://senic.com/about' }],
        seedBrands: [],
      });
      expect(r.groundingSource).toBe('SEARCH_EVIDENCE');
      expect(r.serpMatched).toBe(true);
    });

    it('SEED_EVIDENCE when only seed matches (no SERP)', () => {
      const r = resolveGroundingSource({
        website: 'https://seed.example',
        evidenceUrls: ['https://seed.example'],
        searchHits: [],
        seedBrands: [
          {
            website: 'https://seed.example',
            evidenceUrls: ['https://seed.example'],
          },
        ],
      });
      expect(r.groundingSource).toBe('SEED_EVIDENCE');
      expect(r.seedMatched).toBe(true);
      expect(r.serpMatched).toBe(false);
    });

    it('SEARCH wins over seed when both match; provenance keeps seedMatched', () => {
      const r = resolveGroundingSource({
        website: 'https://both.example',
        evidenceUrls: ['https://both.example/a'],
        searchHits: [{ url: 'https://both.example/a' }],
        seedBrands: [{ website: 'https://both.example' }],
      });
      expect(r.groundingSource).toBe('SEARCH_EVIDENCE');
      expect(r.serpMatched).toBe(true);
      expect(r.seedMatched).toBe(true);
    });

    it('MODEL_PRIOR when no SERP/seed backing', () => {
      const r = resolveGroundingSource({
        website: 'https://epson.com',
        evidenceUrls: [],
        searchHits: [],
        seedBrands: [],
      });
      expect(r.groundingSource).toBe('MODEL_PRIOR');
    });
  });

  describe('score caps', () => {
    it('applies table caps with min(score, cap)', () => {
      expect(scoreCapForGrounding('SEARCH_EVIDENCE', 'VERIFIED')).toBe(100);
      expect(scoreCapForGrounding('SEED_EVIDENCE', 'VERIFIED')).toBe(100);
      expect(scoreCapForGrounding('SEED_EVIDENCE', 'UNVERIFIED')).toBe(80);
      expect(scoreCapForGrounding('MODEL_PRIOR', 'UNVERIFIED')).toBe(55);
      expect(applyScoreCap(80, 55)).toBe(55);
      expect(applyScoreCap(40, 55)).toBe(40);
    });
  });

  describe('fitReason', () => {
    it('forces deterministic copy for MODEL_PRIOR', () => {
      expect(
        resolveFitReason({
          groundingSource: 'MODEL_PRIOR',
          evidenceUrls: [],
          llmFitReason: 'Has affiliate program and sponsorships.',
        }),
      ).toBe(MODEL_PRIOR_FIT_REASON);
    });

    it('keeps SEARCH fitReason when evidence URLs exist', () => {
      const reason = 'Creator program page found on brand site.';
      expect(
        resolveFitReason({
          groundingSource: 'SEARCH_EVIDENCE',
          evidenceUrls: ['https://brand.example/creators'],
          llmFitReason: reason,
        }),
      ).toBe(reason);
    });

    it('replaces SEARCH/SEED claim without evidence URLs', () => {
      expect(
        resolveFitReason({
          groundingSource: 'SEARCH_EVIDENCE',
          evidenceUrls: [],
          llmFitReason: 'Known affiliate program in Europe.',
        }),
      ).toBe(MODEL_PRIOR_FIT_REASON);
    });
  });

  describe('enrichScoredBrandForPersistence', () => {
    it('1: SERP-authorized VERIFIED → SEARCH_EVIDENCE, score uncapped to 100', () => {
      const out = enrichScoredBrandForPersistence({
        brand: brand({
          website: 'https://senic.com',
          score: 88,
          evidenceUrls: ['https://senic.com/about'],
          fitReason: 'Strong hardware fit with evidence.',
        }),
        evidenceStatus: 'VERIFIED',
        searchHits: [{ url: 'https://senic.com/about' }],
        ibp: ibpSmb,
        website: 'https://senic.com',
        domain: 'senic.com',
      });
      expect(out.groundingSource).toBe('SEARCH_EVIDENCE');
      expect(out.score).toBe(88);
      expect(out.evidenceUrls).toEqual(['https://senic.com/about']);
      expect(out.metadata.groundingProvenance.serpMatched).toBe(true);
    });

    it('2: empty SERP → MODEL_PRIOR, cap 55, deterministic fitReason, empty evidence', () => {
      const out = enrichScoredBrandForPersistence({
        brand: brand({
          name: 'Epson',
          website: 'https://www.epson.com',
          score: 80,
          brandSize: 'smb',
          fitReason: 'Growing software brand with creator program.',
          evidenceUrls: [],
        }),
        evidenceStatus: 'UNVERIFIED',
        searchHits: [],
        ibp: ibpSmb,
        website: 'https://www.epson.com',
        domain: 'epson.com',
      });
      expect(out.groundingSource).toBe('MODEL_PRIOR');
      expect(out.score).toBe(55);
      expect(out.fitReason).toBe(MODEL_PRIOR_FIT_REASON);
      expect(out.evidenceUrls).toEqual([]);
      expect(out.evidenceStatus).toBe('UNVERIFIED');
    });

    it('4: seed-backed UNVERIFIED → SEED_EVIDENCE cap 80', () => {
      const out = enrichScoredBrandForPersistence({
        brand: brand({
          website: 'https://seed.example',
          score: 95,
          evidenceUrls: [],
        }),
        evidenceStatus: 'UNVERIFIED',
        searchHits: [],
        seedBrands: [{ website: 'https://seed.example' }],
        ibp: ibpSmb,
        website: 'https://seed.example',
        domain: 'seed.example',
      });
      expect(out.groundingSource).toBe('SEED_EVIDENCE');
      expect(out.score).toBe(80);
    });

    it('6–7: enterprise vs SMB IBP + invalid brandSize', () => {
      const enterprise = enrichScoredBrandForPersistence({
        brand: brand({
          brandSize: 'enterprise',
          score: 90,
          website: 'https://big.example',
        }),
        evidenceStatus: 'UNVERIFIED',
        searchHits: [],
        ibp: ibpSmb,
        website: 'https://big.example',
        domain: 'big.example',
      });
      expect(enterprise.brandSize).toBe('enterprise');
      expect(enterprise.metadata.ibpBrandSizeInconsistency).toBe(true);
      expect(enterprise.score).toBeLessThanOrEqual(50);

      const invalid = enrichScoredBrandForPersistence({
        brand: brand({ brandSize: 'mmb', score: 70 }),
        evidenceStatus: 'UNVERIFIED',
        searchHits: [],
        ibp: ibpSmb,
        website: 'https://acme.example',
        domain: 'acme.example',
      });
      expect(invalid.brandSize).toBeUndefined();
    });

    it('detectIbpBrandSizeInconsistency only when IBP excludes enterprise preference', () => {
      expect(detectIbpBrandSizeInconsistency(ibpSmb, 'enterprise')).toBe(true);
      expect(
        detectIbpBrandSizeInconsistency(
          { ...ibpSmb, brandSize: ['enterprise'] },
          'enterprise',
        ),
      ).toBe(false);
    });
  });
});
