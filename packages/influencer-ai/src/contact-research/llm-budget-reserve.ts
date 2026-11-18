/**
 * RF-02.1: leave room for the LLM agent after deterministic seed + SERP.
 * Does not raise AI_RESEARCH_MAX_* defaults — only reallocates within them.
 */

export const LLM_RESERVE_PAGES = 1;
export const LLM_RESERVE_SERP_QUERIES = 1;

export function llmReservePages(maxPages: number): number {
  return maxPages >= 2 ? LLM_RESERVE_PAGES : 0;
}

export function llmReserveSerpQueries(maxSerpQueries: number): number {
  return maxSerpQueries >= 2 ? LLM_RESERVE_SERP_QUERIES : 0;
}

/** Cap for deterministic seed Unlocker opens. */
export function maxSeedPagesForBudget(
  maxPages: number,
  seedCap: number,
): number {
  const reserve = llmReservePages(maxPages);
  return Math.max(0, Math.min(seedCap, maxPages - reserve));
}

/** Cap for pre-LLM commercial SERP (queries). */
export function maxSerpSeedQueriesForBudget(
  maxSerpQueries: number,
  serpCallsUsed: number,
  seedCap: number,
): number {
  const reserve = llmReserveSerpQueries(maxSerpQueries);
  return Math.max(
    0,
    Math.min(seedCap, maxSerpQueries - serpCallsUsed - reserve),
  );
}

/** Cap for pre-LLM commercial SERP (pages). */
export function maxSerpSeedPagesForBudget(
  maxPages: number,
  pageCallsUsed: number,
  seedCap: number,
): number {
  const reserve = llmReservePages(maxPages);
  return Math.max(0, Math.min(seedCap, maxPages - pageCallsUsed - reserve));
}
