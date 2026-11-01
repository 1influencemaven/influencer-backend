import { BrightDataSearchClient } from './brightdata-search.client';

describe('BrightDataSearchClient (re-export shim)', () => {
  it('exports BrightDataSearchClient from integrations', () => {
    expect(BrightDataSearchClient).toBeDefined();
  });
});
