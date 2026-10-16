import { resolveLeadFallbackReason } from './lead-source-provider.interface';

describe('resolveLeadFallbackReason', () => {
  it('returns null when no fallback', () => {
    expect(resolveLeadFallbackReason(false, false)).toBeNull();
  });

  it('returns ai_plan_failed', () => {
    expect(resolveLeadFallbackReason(true, false)).toBe('ai_plan_failed');
  });

  it('returns search_tavily', () => {
    expect(resolveLeadFallbackReason(false, true)).toBe('search_tavily');
  });

  it('returns combined reason', () => {
    expect(resolveLeadFallbackReason(true, true)).toBe(
      'ai_plan_failed_and_search_tavily',
    );
  });
});
