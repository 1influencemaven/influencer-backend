import {
  buildBrandDiscoveryScoreUserPrompt,
  DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS,
} from './brand-discovery-score.prompt';

const ibp = {
  targetSectors: ['wellness'],
  excludedSectors: ['gambling'],
  brandSize: ['smb'],
  markets: ['Spain'],
  collaborationTypes: ['ambassador'],
  summary: 'Fit brands',
  alertSignals: [],
  desirableCriteria: ['sustainability'],
};

describe('buildBrandDiscoveryScoreUserPrompt', () => {
  it('marks SERP scenario A when hits are present', () => {
    const prompt = buildBrandDiscoveryScoreUserPrompt({
      influencerName: 'Ada',
      niche: 'fitness',
      ibp,
      limit: 5,
      searchHits: [
        {
          title: 'Demo',
          url: 'https://demo.example',
          content: 'apparel',
        },
      ],
      businessInstructions: DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS,
    });

    expect(prompt).toContain('SERP scenario: A (1 web search hit');
    expect(prompt).toContain('Scenario A — search hits are present');
    expect(prompt).toContain('https://demo.example');
    expect(prompt).toContain(
      'Do not emit evidenceStatus, VERIFIED, UNVERIFIED',
    );
    expect(prompt).toContain('DIRECT vs SECONDARY sources');
    expect(prompt).toMatch(/Do NOT propose a company that is only named inside/i);
    expect(prompt).toMatch(/Omit brandSize when you lack evidence/i);
  });

  it('marks SERP scenario B when hits are empty', () => {
    const prompt = buildBrandDiscoveryScoreUserPrompt({
      influencerName: 'Ada',
      niche: 'fitness',
      ibp,
      limit: 5,
      searchHits: [],
      businessInstructions: DEFAULT_BRAND_DISCOVERY_INSTRUCTIONS,
    });

    expect(prompt).toContain('SERP scenario: B (no web search hits');
    expect(prompt).toContain('Scenario B — search hits are empty');
    expect(prompt).toContain('Leave evidenceUrls as []');
    expect(prompt).toContain('Returning ZERO brands is acceptable');
    expect(prompt).toContain('OVERRIDE generic Settings');
    expect(prompt).toContain('do NOT bias toward famous global mega-brands');
    expect(prompt).toContain('never invent evidence URLs');
    expect(prompt).toContain(
      'Do not emit evidenceStatus, VERIFIED, UNVERIFIED',
    );
  });
});
