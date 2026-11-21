import {
  AI_CONTRACT_VERSION,
  parseAiExecutionRequest,
} from '@influence-maven/ai-contracts';

/**
 * Smoke: Nest workspace can resolve and parse shared AI contracts.
 * No business logic change.
 */
describe('@influence-maven/ai-contracts (Nest import)', () => {
  it('exposes contract version 1.0', () => {
    expect(AI_CONTRACT_VERSION).toBe('1.0');
  });

  it('parses a minimal IBP request', () => {
    const req = parseAiExecutionRequest({
      contractVersion: '1.0',
      executionId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
      idempotencyKey: 'smoke',
      type: 'IBP_GENERATION',
      requestedAt: '2026-11-01T12:00:00.000Z',
      context: {
        userId: 'u1',
        resourceId: 'r1',
        resourceType: 'IDEAL_BRAND_PROFILE',
      },
      instructions: { business: 'test' },
      input: {
        influencer: { id: 'i1', name: 'Test' },
      },
    });

    expect(req.type).toBe('IBP_GENERATION');
  });
});
