import {
  classifyUnlockerException,
  classifyUnlockerHttpResult,
  extractUnlockerErrorCause,
  sanitizeUnlockerErrorMessage,
  tallyPageOutcomes,
  type BusinessContactPageResult,
} from './unlocker-fetch.util';

function fetchFailedWithCause(causeFields: Record<string, unknown>) {
  const cause = Object.assign(
    new Error(String(causeFields.message ?? 'transport failed')),
    causeFields,
  );
  const err = new TypeError('fetch failed');
  Object.defineProperty(err, 'cause', { value: cause });
  return err;
}

describe('unlocker-fetch.util', () => {
  describe('classifyUnlockerHttpResult', () => {
    it('returns ok for 2xx with body', () => {
      expect(
        classifyUnlockerHttpResult({ httpStatus: 200, bodyLength: 120 }),
      ).toBe('ok');
    });

    it('returns http_error for non-2xx', () => {
      expect(
        classifyUnlockerHttpResult({ httpStatus: 403, bodyLength: 10 }),
      ).toBe('http_error');
      expect(
        classifyUnlockerHttpResult({ httpStatus: 500, bodyLength: 0 }),
      ).toBe('http_error');
    });

    it('returns empty_body for 2xx with zero length', () => {
      expect(
        classifyUnlockerHttpResult({ httpStatus: 200, bodyLength: 0 }),
      ).toBe('empty_body');
    });
  });

  describe('classifyUnlockerException', () => {
    it('classifies timeout / abort', () => {
      const timeout = new Error('The operation was aborted due to timeout');
      timeout.name = 'TimeoutError';
      expect(classifyUnlockerException(timeout).outcome).toBe('timeout');

      const abort = new Error('aborted');
      abort.name = 'AbortError';
      expect(classifyUnlockerException(abort).outcome).toBe('timeout');
    });

    it('classifies network / transport errors', () => {
      const err = new TypeError('fetch failed');
      expect(classifyUnlockerException(err).outcome).toBe('network_error');

      const reset = new Error('read ECONNRESET');
      expect(classifyUnlockerException(reset).outcome).toBe('network_error');
    });

    it('classifies unknown errors', () => {
      expect(classifyUnlockerException(new Error('weird')).outcome).toBe(
        'unknown_error',
      );
    });

    it('sanitizes secrets in exception messages', () => {
      const err = new Error(
        'Request failed Authorization: Bearer sk-secret-token api_key=abc123',
      );
      const classified = classifyUnlockerException(err);
      expect(classified.errorMessage).not.toMatch(/sk-secret|abc123/i);
      expect(classified.errorMessage).toContain('[REDACTED]');
      expect(classified.errorMessage).toContain('api_key=[REDACTED]');
    });

    it.each([
      [
        'ENOTFOUND',
        {
          code: 'ENOTFOUND',
          syscall: 'getaddrinfo',
          hostname: 'api.brightdata.com',
          message: 'getaddrinfo ENOTFOUND api.brightdata.com',
        },
      ],
      [
        'ECONNREFUSED',
        {
          code: 'ECONNREFUSED',
          syscall: 'connect',
          hostname: 'api.brightdata.com',
          port: 443,
          message: 'connect ECONNREFUSED api.brightdata.com:443',
        },
      ],
      [
        'ECONNRESET',
        {
          code: 'ECONNRESET',
          syscall: 'read',
          message: 'read ECONNRESET',
        },
      ],
    ])('extracts cause diagnostics for %s', (_label, causeFields) => {
      const classified = classifyUnlockerException(
        fetchFailedWithCause(causeFields),
      );
      expect(classified.outcome).toBe('network_error');
      expect(classified.causeCode).toBe(causeFields.code);
      expect(classified.causeSyscall).toBe(causeFields.syscall);
      if ('hostname' in causeFields) {
        expect(classified.causeHostname).toBe(causeFields.hostname);
      }
      if ('port' in causeFields) {
        expect(classified.causePort).toBe(causeFields.port);
      }
    });

    it('extracts TLS failure cause', () => {
      const classified = classifyUnlockerException(
        fetchFailedWithCause({
          code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
          message: 'unable to verify the first certificate',
        }),
      );
      expect(classified.outcome).toBe('network_error');
      expect(classified.causeCode).toBe('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    });

    it('returns no cause fields when cause is absent', () => {
      const classified = classifyUnlockerException(
        new TypeError('fetch failed'),
      );
      expect(classified.causeName).toBeUndefined();
      expect(classified.causeCode).toBeUndefined();
      expect(classified.causeSyscall).toBeUndefined();
      expect(classified.causeHostname).toBeUndefined();
      expect(classified.causePort).toBeUndefined();
      expect(extractUnlockerErrorCause(new TypeError('fetch failed'))).toBeUndefined();
    });

    it('selects errors[0] deterministically from an AggregateError cause', () => {
      const first = Object.assign(new Error('connect ECONNREFUSED a'), {
        code: 'ECONNREFUSED',
        syscall: 'connect',
        hostname: 'api.brightdata.com',
        port: 443,
      });
      const second = Object.assign(new Error('connect ECONNRESET b'), {
        code: 'ECONNRESET',
        syscall: 'read',
      });
      const aggregate = new AggregateError([first, second], 'all failed');
      const err = new TypeError('fetch failed');
      Object.defineProperty(err, 'cause', { value: aggregate });

      const classified = classifyUnlockerException(err);
      expect(classified.causeCode).toBe('ECONNREFUSED');
      expect(classified.causeHostname).toBe('api.brightdata.com');
    });

    it('sanitizes malformed cause fields (secrets, junk chars, bad port)', () => {
      const classified = classifyUnlockerException(
        fetchFailedWithCause({
          code: 'ENOTFOUND Bearer sk-secret-token\n<script>',
          syscall: 'getaddrinfo; rm -rf /',
          hostname: 'api.brightdata.com\r\nAuthorization: Bearer leak',
          port: '99999',
          message: 'boom',
        }),
      );
      const serialized = JSON.stringify(classified);
      expect(serialized).not.toMatch(/sk-secret|leak|<script>|rm/);
      expect(classified.causePort).toBeUndefined();
      expect(classified.causeHostname).toBe('api.brightdata.com');
      expect(classified.causeCode).toBe('ENOTFOUND');
    });

    it('bounds cause field length', () => {
      const classified = classifyUnlockerException(
        fetchFailedWithCause({
          code: `E${'X'.repeat(300)}`,
          hostname: `${'a'.repeat(300)}.example.com`,
          message: 'boom',
        }),
      );
      expect((classified.causeCode ?? '').length).toBeLessThanOrEqual(64);
      expect((classified.causeHostname ?? '').length).toBeLessThanOrEqual(253);
    });
  });

  describe('sanitizeUnlockerErrorMessage', () => {
    it('redacts bearer tokens and api keys', () => {
      const raw =
        'fail Bearer eyJhbGciOiJIUzI1NiJ9.xx password=hunter2 api_key: secret';
      const cleaned = sanitizeUnlockerErrorMessage(raw);
      expect(cleaned).not.toMatch(/eyJhbGci|hunter2|\bsecret\b/i);
      expect(cleaned).toContain('[REDACTED]');
      expect(cleaned).toContain('password=[REDACTED]');
      expect(cleaned).toContain('api_key=[REDACTED]');
    });

    it('truncates long messages', () => {
      const cleaned = sanitizeUnlockerErrorMessage('x'.repeat(500), 40);
      expect(cleaned.length).toBeLessThanOrEqual(41);
      expect(cleaned.endsWith('…')).toBe(true);
    });
  });

  describe('tallyPageOutcomes', () => {
    it('aggregates failure categories and skips ok', () => {
      const pages: BusinessContactPageResult[] = [
        {
          url: 'https://a.com/1',
          outcome: 'ok',
          apiHttpStatus: 200,
          bodyLength: 10,
          elapsedMs: 1,
          zone: 'mcp_unlocker',
        },
        {
          url: 'https://a.com/2',
          outcome: 'timeout',
          apiHttpStatus: 0,
          bodyLength: 0,
          elapsedMs: 30_000,
          zone: 'mcp_unlocker',
        },
        {
          url: 'https://a.com/3',
          outcome: 'http_error',
          apiHttpStatus: 429,
          bodyLength: 0,
          elapsedMs: 100,
          zone: 'mcp_unlocker',
        },
        {
          url: 'https://a.com/4',
          outcome: 'timeout',
          apiHttpStatus: 0,
          bodyLength: 0,
          elapsedMs: 30_000,
          zone: 'mcp_unlocker',
        },
      ];
      expect(tallyPageOutcomes(pages)).toEqual({
        timeout: 2,
        http_error: 1,
      });
    });
  });
});
