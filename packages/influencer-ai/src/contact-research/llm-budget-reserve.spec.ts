import {
  llmReservePages,
  llmReserveSerpQueries,
  maxSeedPagesForBudget,
  maxSerpSeedPagesForBudget,
  maxSerpSeedQueriesForBudget,
} from './llm-budget-reserve';
import { CONTACT_EMAIL_SEED_MAX_PAGES } from './seed-brand-pages';
import {
  COMMERCIAL_SERP_SEED_MAX_PAGES,
  COMMERCIAL_SERP_SEED_MAX_QUERIES,
} from './commercial-serp-seed';

describe('llm-budget-reserve (RF-02.1)', () => {
  it('reserves 1 page/serp when budgets are at least 2', () => {
    expect(llmReservePages(5)).toBe(1);
    expect(llmReserveSerpQueries(5)).toBe(1);
    expect(llmReservePages(1)).toBe(0);
    expect(llmReserveSerpQueries(1)).toBe(0);
  });

  it('leaves room for LLM after seed+SERP under default caps (5/5)', () => {
    const maxPages = 5;
    const maxSerp = 5;
    const seedPages = maxSeedPagesForBudget(
      maxPages,
      CONTACT_EMAIL_SEED_MAX_PAGES,
    );
    expect(seedPages).toBe(3); // min(3, 5-1)

    const afterSeedPages = seedPages; // assume seed uses full allotment
    const serpPages = maxSerpSeedPagesForBudget(
      maxPages,
      afterSeedPages,
      COMMERCIAL_SERP_SEED_MAX_PAGES,
    );
    // remaining after seed=3, reserve=1 → 1 page for SERP seed
    expect(serpPages).toBe(1);

    const serpQueries = maxSerpSeedQueriesForBudget(
      maxSerp,
      0,
      COMMERCIAL_SERP_SEED_MAX_QUERIES,
    );
    // min(2, 5-0-1) = 2
    expect(serpQueries).toBe(2);

    const pagesLeftForLlm = maxPages - afterSeedPages - serpPages;
    expect(pagesLeftForLlm).toBeGreaterThanOrEqual(1);
    const serpLeftForLlm = maxSerp - serpQueries;
    expect(serpLeftForLlm).toBeGreaterThanOrEqual(1);
  });

  it('does not over-consume when maxPages is tight (3)', () => {
    const seedPages = maxSeedPagesForBudget(3, CONTACT_EMAIL_SEED_MAX_PAGES);
    expect(seedPages).toBe(2); // min(3, 3-1)
    const serpPages = maxSerpSeedPagesForBudget(
      3,
      seedPages,
      COMMERCIAL_SERP_SEED_MAX_PAGES,
    );
    expect(serpPages).toBe(0); // 3 - 2 - 1 reserve = 0
    expect(3 - seedPages - serpPages).toBe(1);
  });
});
