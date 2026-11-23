/**
 * Abort signal that fires when Nest stops waiting (`requestedAt + limits.timeoutMs`),
 * so a slow or runaway LLM call stops occupying the model after its result is useless.
 */
export function executionDeadlineSignal(request: {
  requestedAt: string;
  limits?: { timeoutMs?: number };
}): AbortSignal | undefined {
  const timeoutMs = request.limits?.timeoutMs;
  if (!timeoutMs) return undefined;
  const remainingMs = Date.parse(request.requestedAt) + timeoutMs - Date.now();
  return AbortSignal.timeout(Math.max(remainingMs, 1));
}
