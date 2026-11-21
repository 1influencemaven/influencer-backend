/**
 * Diagnostics for Bright Data Web Unlocker fetches (Track 2A / PEE).
 * `apiHttpStatus` is the HTTP status of api.brightdata.com/request — not the target site.
 */

export type UnlockerFetchOutcome =
  | 'ok'
  | 'http_error'
  | 'empty_body'
  | 'timeout'
  | 'network_error'
  | 'unknown_error';

/** Page-level outcome including discovery-layer failures. */
export type BusinessContactPageOutcome =
  | UnlockerFetchOutcome
  | 'url_normalization_error';

/**
 * Sanitized transport-cause diagnostics from `error.cause` (Undici `fetch`).
 * Hostname/port refer to the outbound connection (Bright Data API host or
 * proxy), never the target site. All fields optional and bounded.
 */
export type UnlockerErrorCauseDiagnostics = {
  causeName?: string;
  causeCode?: string;
  causeSyscall?: string;
  causeHostname?: string;
  causePort?: number;
};

export type UnlockerFetchResult = {
  html: string;
  /** HTTP status from Bright Data API `/request` (0 when no HTTP response). */
  httpStatus: number;
  elapsedMs: number;
  emptyBody: boolean;
  bodyLength: number;
  zone: string;
  outcome: UnlockerFetchOutcome;
  errorName?: string;
  /** Sanitized exception message — never credentials. */
  errorMessage?: string;
} & UnlockerErrorCauseDiagnostics;

export type BusinessContactPageResult = {
  url: string;
  outcome: BusinessContactPageOutcome;
  apiHttpStatus: number;
  bodyLength: number;
  elapsedMs: number;
  zone: string;
  errorName?: string;
  errorMessage?: string;
} & UnlockerErrorCauseDiagnostics;

export function sanitizeUnlockerErrorMessage(
  message: string,
  maxLen = 240,
): string {
  // Order matters: redact Bearer tokens before bare `Authorization: <token>`.
  const cleaned = message
    .replace(/Bearer\s+\S+/gi, '[REDACTED]')
    .replace(/api[_-]?key\s*[:=]\s*\S+/gi, 'api_key=[REDACTED]')
    .replace(/password\s*[:=]\s*\S+/gi, 'password=[REDACTED]')
    .replace(/authorization\s*[:=]\s*\S+/gi, 'authorization=[REDACTED]')
    .trim();
  if (cleaned.length <= maxLen) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLen)}…`;
}

const CAUSE_FIELD_MAX = 64;
const CAUSE_HOSTNAME_MAX = 253;
/** Only characters needed by error names/codes/syscalls/hostnames. */
const CAUSE_SAFE_CHARS = /[^A-Za-z0-9._\-:[\]]/g;

function sanitizeCauseField(
  value: unknown,
  maxLen: number,
): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  // Diagnostic identifiers are single tokens; anything after whitespace in a
  // malformed value is discarded rather than sanitized into the output.
  const firstToken = String(value).trim().split(/\s+/)[0] ?? '';
  const redacted = sanitizeUnlockerErrorMessage(firstToken, 256);
  if (!redacted || redacted.includes('[REDACTED]')) {
    return undefined;
  }
  const cleaned = redacted.replace(CAUSE_SAFE_CHARS, '').slice(0, maxLen);
  return cleaned || undefined;
}

function sanitizeCausePort(value: unknown): number | undefined {
  const port =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{1,5}$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return undefined;
  }
  return port;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Pick the representative transport cause deterministically.
 *
 * Node/Undici wraps transport errors twice:
 * `TypeError: fetch failed` → `cause` = syscall error, which for multi-address
 * DNS/connect can itself be an `AggregateError` with `errors[]`.
 *
 * Deterministic rule: follow `cause`; whenever the candidate is an
 * AggregateError-like value (`name === 'AggregateError'` with an `errors[]`
 * array), descend into `errors[0]` (first error in Node's reported order)
 * and repeat, max depth 4. No sorting or heuristics — same input, same cause.
 */
function pickRepresentativeCause(error: unknown): unknown {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    if (!isRecord(candidate)) {
      return candidate;
    }
    const next: unknown =
      'cause' in candidate && candidate.cause !== undefined
        ? candidate.cause
        : candidate.name === 'AggregateError' && Array.isArray(candidate.errors)
          ? candidate.errors[0]
          : undefined;
    if (next === undefined) {
      return candidate;
    }
    candidate = next;
    // Candidate is itself an AggregateError: loop descends into errors[0].
    if (
      isRecord(candidate) &&
      candidate.name === 'AggregateError' &&
      Array.isArray(candidate.errors)
    ) {
      continue;
    }
  }
  return candidate;
}

export function extractUnlockerErrorCause(
  error: unknown,
): UnlockerErrorCauseDiagnostics | undefined {
  const cause = pickRepresentativeCause(error);
  if (!isRecord(cause) || cause === error) {
    return undefined;
  }

  const diagnostics: UnlockerErrorCauseDiagnostics = {};
  const causeName = sanitizeCauseField(cause.name, CAUSE_FIELD_MAX);
  if (causeName) diagnostics.causeName = causeName;
  const causeCode = sanitizeCauseField(cause.code, CAUSE_FIELD_MAX);
  if (causeCode) diagnostics.causeCode = causeCode;
  const causeSyscall = sanitizeCauseField(cause.syscall, CAUSE_FIELD_MAX);
  if (causeSyscall) diagnostics.causeSyscall = causeSyscall;
  const causeHostname = sanitizeCauseField(
    cause.hostname ?? cause.host,
    CAUSE_HOSTNAME_MAX,
  );
  if (causeHostname) diagnostics.causeHostname = causeHostname;
  const causePort = sanitizeCausePort(cause.port);
  if (causePort !== undefined) diagnostics.causePort = causePort;

  return Object.keys(diagnostics).length > 0 ? diagnostics : undefined;
}

export function classifyUnlockerException(error: unknown): {
  outcome: Exclude<UnlockerFetchOutcome, 'ok' | 'http_error' | 'empty_body'>;
  errorName: string;
  errorMessage: string;
} & UnlockerErrorCauseDiagnostics {
  const name = error instanceof Error ? error.name : 'Error';
  const raw =
    error instanceof Error ? error.message : String(error ?? 'Request failed');
  const errorMessage = sanitizeUnlockerErrorMessage(raw);
  const cause = extractUnlockerErrorCause(error) ?? {};
  // Cause text participates in classification (e.g. cause.code ENOTFOUND
  // under a generic `fetch failed` message).
  const causeText = [cause.causeCode, cause.causeSyscall, cause.causeName]
    .filter(Boolean)
    .join(' ');
  const lower = `${name} ${raw} ${causeText}`.toLowerCase();

  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborted')
  ) {
    return { outcome: 'timeout', errorName: name, errorMessage, ...cause };
  }

  if (
    name === 'TypeError' ||
    lower.includes('fetch failed') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('network') ||
    lower.includes('socket') ||
    lower.includes('certificate') ||
    lower.includes('tls') ||
    lower.includes('ssl')
  ) {
    return {
      outcome: 'network_error',
      errorName: name,
      errorMessage,
      ...cause,
    };
  }

  return { outcome: 'unknown_error', errorName: name, errorMessage, ...cause };
}

export function classifyUnlockerHttpResult(args: {
  httpStatus: number;
  bodyLength: number;
}): UnlockerFetchOutcome {
  if (args.httpStatus < 200 || args.httpStatus >= 300) {
    return 'http_error';
  }
  if (args.bodyLength === 0) {
    return 'empty_body';
  }
  return 'ok';
}

export function tallyPageOutcomes(
  pageResults: BusinessContactPageResult[],
): Record<string, number> {
  const tallies: Record<string, number> = {};
  for (const page of pageResults) {
    if (page.outcome === 'ok') {
      continue;
    }
    tallies[page.outcome] = (tallies[page.outcome] ?? 0) + 1;
  }
  return tallies;
}
