import {
  AI_CONTRACT_VERSION,
  brandDiscoveryInputSchema,
} from '@influence-maven/ai-contracts';

/**
 * Fail fast if the resolved ai-contracts build lacks RESEARCH_BRAND
 * (stale require cache / outdated dist). Uses the shared schema — no parallel contracts.
 */
export function assertBrandDiscoveryContractsReady(): void {
  const research = brandDiscoveryInputSchema.safeParse({
    operation: 'RESEARCH_BRAND',
    influencerName: 'boot-check',
    ibp: {
      targetSectors: [],
      excludedSectors: [],
      brandSize: [],
      markets: [],
      collaborationTypes: [],
      summary: '',
      alertSignals: [],
      desirableCriteria: [],
    },
    brand: {
      name: 'Boot Check',
      website: 'https://boot-check.example',
      domain: 'boot-check.example',
    },
    pageSnapshots: [
      {
        url: 'https://boot-check.example/',
        role: 'homepage',
        textContent: 'boot',
      },
    ],
    maxPages: 4,
  });
  if (!research.success) {
    throw new Error(
      `ai-contracts@${AI_CONTRACT_VERSION} rejected RESEARCH_BRAND (rebuild/restart worker): ${research.error.message}`,
    );
  }
}
