import { parseLeadDiscoveryPlan } from './lead-discovery-plan.schema';

describe('leadDiscoveryPlanSchema', () => {
  it('parses plan without tavilyQueries', () => {
    const plan = parseLeadDiscoveryPlan(
      JSON.stringify({
        scraperIds: ['gd_test123'],
        priorityRoles: ['CEO', 'CMO'],
        notes: 'ok',
      }),
    );
    expect(plan.scraperIds).toEqual(['gd_test123']);
    expect(plan.priorityRoles).toEqual(['CEO', 'CMO']);
  });

  it('ignores legacy tavilyQueries field', () => {
    const plan = parseLeadDiscoveryPlan(
      JSON.stringify({
        scraperIds: ['gd_test123'],
        priorityRoles: ['CEO'],
        tavilyQueries: ['legacy query'],
      }),
    );
    expect(plan.tavilyQueries).toEqual(['legacy query']);
  });
});
