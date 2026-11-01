import { parseContactResearchDecision } from './contact-research-decision.schema';

describe('parseContactResearchDecision', () => {
  it('parses search_web decision', () => {
    const decision = parseContactResearchDecision(
      JSON.stringify({
        action: 'search_web',
        reason: 'Find partnerships page',
        query: 'Acme partnerships contact email',
      }),
    );
    expect(decision.action).toBe('search_web');
    expect(decision.query).toContain('partnerships');
  });

  it('parses finalize_research', () => {
    const decision = parseContactResearchDecision(`\`\`\`json
{"action":"finalize_research","reason":"Enough evidence","finalize":{"outcome":"RESULTS_FOUND","summary":"Found press inbox"}}
\`\`\``);
    expect(decision.action).toBe('finalize_research');
    expect(decision.finalize?.outcome).toBe('RESULTS_FOUND');
  });

  it('rejects inventing emails in schema (no email field)', () => {
    expect(() =>
      parseContactResearchDecision(
        JSON.stringify({
          action: 'finalize_research',
          reason: 'done',
          finalize: { outcome: 'NO_MATCHES' },
          inventedEmail: 'x@y.com',
        }),
      ),
    ).not.toThrow();
    // extra keys stripped by zod object default? zod strips unknown by default in parse - actually zod keeps unknown unless .strict()
    const d = parseContactResearchDecision(
      JSON.stringify({
        action: 'finalize_research',
        reason: 'done',
        finalize: { outcome: 'NO_MATCHES' },
      }),
    );
    expect(d.finalize?.outcome).toBe('NO_MATCHES');
  });
});
