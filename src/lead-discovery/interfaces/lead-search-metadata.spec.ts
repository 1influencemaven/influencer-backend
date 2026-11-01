import { resolveLeadFallbackReason } from './lead-source-provider.interface';

describe('resolveLeadFallbackReason', () => {
  it('returns null when no AI plan fallback', () => {
    expect(resolveLeadFallbackReason(false)).toBeNull();
    expect(resolveLeadFallbackReason(false, true)).toBeNull();
  });

  it('returns ai_plan_failed only (no external search fallback)', () => {
    expect(resolveLeadFallbackReason(true)).toBe('ai_plan_failed');
    expect(resolveLeadFallbackReason(true, true)).toBe('ai_plan_failed');
  });
});
