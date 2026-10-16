import { parseBrandSearchStrategyPlan } from './brand-search-strategy.schema';

describe('parseBrandSearchStrategyPlan', () => {
  it('parses a valid queries payload', () => {
    const plan = parseBrandSearchStrategyPlan(
      JSON.stringify({
        queries: [
          'skincare brands Colombia influencer partnerships',
          'Colombia beauty brands affiliate program',
        ],
      }),
    );
    expect(plan.queries).toHaveLength(2);
  });

  it('strips markdown fences', () => {
    const plan = parseBrandSearchStrategyPlan(`\`\`\`json
{"queries":["skincare brands Colombia creator partnerships"]}
\`\`\``);
    expect(plan.queries).toEqual([
      'skincare brands Colombia creator partnerships',
    ]);
  });

  it('rejects empty queries array', () => {
    expect(() =>
      parseBrandSearchStrategyPlan(JSON.stringify({ queries: [] })),
    ).toThrow();
  });

  it('rejects invalid JSON', () => {
    expect(() => parseBrandSearchStrategyPlan('not-json')).toThrow();
  });
});
