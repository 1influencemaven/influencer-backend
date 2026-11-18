import { assertBrandDiscoveryContractsReady } from './assert-brand-discovery-contracts';

describe('assertBrandDiscoveryContractsReady', () => {
  it('accepts RESEARCH_BRAND from the same ai-contracts entry the worker resolves', () => {
    expect(() => assertBrandDiscoveryContractsReady()).not.toThrow();
  });
});
