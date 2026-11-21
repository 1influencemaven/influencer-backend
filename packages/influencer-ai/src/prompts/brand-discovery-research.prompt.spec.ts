import {
  buildBrandDiscoveryResearchCorrectionPrompt,
  buildBrandDiscoveryResearchUserPrompt,
} from './brand-discovery-research.prompt';

const ibp = {
  targetSectors: ['wellness'],
  excludedSectors: [],
  brandSize: ['smb'],
  markets: ['Spain'],
  collaborationTypes: [],
  summary: 'x',
  alertSignals: [],
  desirableCriteria: [],
};

describe('brand-discovery-research.prompt', () => {
  it('includes snapshots and forbids inventing tools language via constraints', () => {
    const prompt = buildBrandDiscoveryResearchUserPrompt({
      influencerName: 'Ana',
      ibp,
      brand: {
        name: 'Demo',
        website: 'https://demo.example',
        domain: 'demo.example',
      },
      pageSnapshots: [
        {
          url: 'https://demo.example/',
          role: 'homepage',
          textContent: 'Hello Demo',
        },
      ],
      maxPages: 4,
      businessInstructions: 'Be careful',
    });
    expect(prompt).toContain('RESEARCH_BRAND');
    expect(prompt).toContain('https://demo.example/');
    expect(prompt).toContain('Hello Demo');
    expect(prompt).toContain('NOT_FOUND');
    expect(prompt).toContain('You do NOT browse');
    expect(prompt).toContain('NEVER use VERIFIED');
    expect(prompt).toContain('NEVER a bare string');
    expect(prompt).toContain('do NOT emit null');
  });

  it('builds correction prompt with previous raw and shape fixes', () => {
    const c = buildBrandDiscoveryResearchCorrectionPrompt({
      previousRaw: '{bad}',
      errorMessage: 'parse fail',
    });
    expect(c).toContain('parse fail');
    expect(c).toContain('{bad}');
    expect(c).toContain('not VERIFIED');
    expect(c).toContain('not a string');
  });
});
