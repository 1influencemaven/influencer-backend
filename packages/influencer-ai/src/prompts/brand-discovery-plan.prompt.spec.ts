import {
  DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS,
  buildBrandDiscoveryPlanCorrectionPrompt,
  buildBrandDiscoveryPlanUserPrompt,
  formatBrandDiscoveryPlanIbpSections,
} from './brand-discovery-plan.prompt';

const ibp = {
  targetSectors: ['hardware', 'consumer electronics'],
  excludedSectors: ['gambling', 'adult'],
  brandSize: ['smb', 'mid-market'],
  markets: ['Europe', 'Spain'],
  collaborationTypes: ['affiliate', 'brand ambassador'],
  summary: 'Tech creators for SMB electronics',
  alertSignals: ['miracle claims'],
  desirableCriteria: ['sustainability', 'creator program'],
};

describe('brand-discovery-plan.prompt (AI-004.5.4)', () => {
  describe('instruction text (prompt contract — not LLM behavior)', () => {
    it('states influencer-name quota: prefer zero, at most one', () => {
      expect(DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS).toMatch(
        /Prefer ZERO queries that contain the influencer/i,
      );
      expect(DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS).toMatch(
        /At most ONE query/i,
      );
    });

    it('requires IBP sectors/markets/commercial recipe and diversity slots', () => {
      expect(DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS).toContain(
        'QUERY RECIPE',
      );
      expect(DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS).toContain(
        'COMMERCIAL DIVERSITY',
      );
      expect(DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS).toMatch(
        /Brand \/ creator partnerships/i,
      );
      expect(DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS).toMatch(
        /Affiliate \/ performance/i,
      );
      expect(DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS).toMatch(
        /Ambassador \/ sponsorship/i,
      );
      expect(DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS).toMatch(
        /do not invent/i,
      );
      expect(DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS).toMatch(
        /excludedSectors/i,
      );
      expect(DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS).toMatch(/listicle/i);
    });

    it('allows fewer than maxQueries when IBP cannot support four intents', () => {
      expect(DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS).toMatch(
        /return FEWER queries/i,
      );
      expect(DEFAULT_BRAND_DISCOVERY_PLAN_INSTRUCTIONS).toMatch(
        /Never invent IBP fields to fill slots/i,
      );
    });
  });

  describe('formatBrandDiscoveryPlanIbpSections', () => {
    it('labels target sectors, markets, brand sizes, collaboration, desirable, alerts', () => {
      const sections = formatBrandDiscoveryPlanIbpSections(ibp);
      expect(sections).toContain(
        'TARGET SECTORS: hardware; consumer electronics',
      );
      expect(sections).toContain(
        'EXCLUDED SECTORS (never use in queries): gambling; adult',
      );
      expect(sections).toContain('MARKETS: Europe; Spain');
      expect(sections).toContain('BRAND SIZES: smb; mid-market');
      expect(sections).toContain(
        'COLLABORATION TYPES: affiliate; brand ambassador',
      );
      expect(sections).toContain(
        'DESIRABLE CRITERIA: sustainability; creator program',
      );
      expect(sections).toContain(
        'ALERT SIGNALS (avoid triggering): miracle claims',
      );
      expect(sections).toContain('SUMMARY: Tech creators for SMB electronics');
    });

    it('marks empty dimensions as none provided — do not invent', () => {
      const sections = formatBrandDiscoveryPlanIbpSections({
        ...ibp,
        markets: [],
        brandSize: [],
        collaborationTypes: [],
        desirableCriteria: [],
        alertSignals: [],
        summary: '',
      });
      expect(sections).toContain('MARKETS: (none provided — do not invent)');
      expect(sections).toContain(
        'BRAND SIZES: (none provided — do not invent)',
      );
      expect(sections).toContain(
        'COLLABORATION TYPES: (none provided — do not invent)',
      );
      expect(sections).toContain('SUMMARY: (none provided — do not invent)');
    });
  });

  describe('buildBrandDiscoveryPlanUserPrompt', () => {
    it('embeds labeled IBP sections, JSON, maxQueries, and name quota reminder', () => {
      const prompt = buildBrandDiscoveryPlanUserPrompt({
        influencerName: 'Solusat',
        niche: 'tech hardware',
        ibp,
        maxQueries: 4,
      });

      expect(prompt).toContain('Max queries: 4');
      expect(prompt).toContain('Influencer name: Solusat');
      expect(prompt).toContain('Niche: tech hardware');
      expect(prompt).toContain('TARGET SECTORS:');
      expect(prompt).toContain('MARKETS:');
      expect(prompt).toContain('"targetSectors"');
      expect(prompt).toContain('at most one query may contain the influencer');
      expect(prompt).toContain('Prefer zero queries that include "Solusat"');
      expect(prompt).toMatch(/queries: 1 to 4 strings/);
    });

    it('keeps schema as queries-only (no evidenceStatus / brands)', () => {
      const prompt = buildBrandDiscoveryPlanUserPrompt({
        influencerName: 'Ada',
        niche: 'fitness',
        ibp,
        maxQueries: 4,
      });
      expect(prompt).toContain('"queries": ["string"]');
      expect(prompt).not.toContain('"brands"');
      expect(prompt).not.toMatch(/\bevidenceStatus\b/);
    });

    it('documents name quota inside output contract for the given maxQueries', () => {
      const prompt = buildBrandDiscoveryPlanUserPrompt({
        influencerName: 'Ada',
        niche: null,
        ibp,
        maxQueries: 3,
      });
      expect(prompt).toMatch(/queries: 1 to 3 strings/);
      expect(prompt).toContain(
        "at most one query may contain the influencer's personal name (prefer zero)",
      );
    });
  });

  describe('buildBrandDiscoveryPlanCorrectionPrompt', () => {
    it('repeats name-quota and do-not-invent guidance', () => {
      const correction = buildBrandDiscoveryPlanCorrectionPrompt({
        previousRaw: '{bad}',
        errorMessage: 'invalid',
        maxQueries: 4,
      });
      expect(correction).toContain(
        'at most one query may contain the influencer name',
      );
      expect(correction).toContain('do not invent IBP fields');
      expect(correction).toContain('"queries"');
    });
  });
});
