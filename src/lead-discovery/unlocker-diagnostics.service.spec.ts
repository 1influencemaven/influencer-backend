import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { UnlockerDiagnosticsService } from './unlocker-diagnostics.service';
import { UNLOCKER_DIAGNOSTIC_ALLOWED_URL } from './utils/unlocker-diagnostics.constants';

describe('UnlockerDiagnosticsService', () => {
  const unlocker = {
    isConfigured: jest.fn(),
    fetchRawHtml: jest.fn(),
  };
  const configService = {
    get: jest.fn(),
  };

  let service: UnlockerDiagnosticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'development';
      if (key === 'UNLOCKER_DIAGNOSTICS_ENABLED') return true;
      return undefined;
    });
    unlocker.isConfigured.mockReturnValue(true);
    service = new UnlockerDiagnosticsService(
      unlocker as never,
      configService as never,
    );
  });

  it('returns typed diagnostic without html on successful fetch', async () => {
    unlocker.fetchRawHtml.mockResolvedValue({
      html: '<html>secret body</html>',
      httpStatus: 200,
      elapsedMs: 420,
      emptyBody: false,
      bodyLength: 24,
      zone: 'mcp_unlocker',
      outcome: 'ok',
    });

    const result = await service.probe(UNLOCKER_DIAGNOSTIC_ALLOWED_URL);

    expect(unlocker.fetchRawHtml).toHaveBeenCalledTimes(1);
    expect(unlocker.fetchRawHtml).toHaveBeenCalledWith(
      UNLOCKER_DIAGNOSTIC_ALLOWED_URL,
    );
    expect(result).toEqual({
      url: UNLOCKER_DIAGNOSTIC_ALLOWED_URL,
      outcome: 'ok',
      apiHttpStatus: 200,
      bodyLength: 24,
      elapsedMs: 420,
      zone: 'mcp_unlocker',
    });
    expect(result).not.toHaveProperty('html');
    expect(JSON.stringify(result)).not.toContain('secret body');
  });

  it('propagates sanitized cause diagnostics without html', async () => {
    unlocker.fetchRawHtml.mockResolvedValue({
      html: '<html>must not leak</html>',
      httpStatus: 0,
      elapsedMs: 15,
      emptyBody: true,
      bodyLength: 0,
      zone: 'mcp_unlocker',
      outcome: 'network_error',
      errorName: 'TypeError',
      errorMessage: 'fetch failed',
      causeName: 'Error',
      causeCode: 'ECONNREFUSED',
      causeSyscall: 'connect',
      causeHostname: 'api.brightdata.com',
      causePort: 443,
    });

    const result = await service.probe(UNLOCKER_DIAGNOSTIC_ALLOWED_URL);

    expect(result.causeCode).toBe('ECONNREFUSED');
    expect(result.causeSyscall).toBe('connect');
    expect(result.causeHostname).toBe('api.brightdata.com');
    expect(result.causePort).toBe(443);
    expect(result).not.toHaveProperty('html');
    expect(JSON.stringify(result)).not.toContain('must not leak');
  });

  it('maps timeout outcome with sanitized error fields', async () => {
    unlocker.fetchRawHtml.mockResolvedValue({
      html: '',
      httpStatus: 0,
      elapsedMs: 30_000,
      emptyBody: true,
      bodyLength: 0,
      zone: 'mcp_unlocker',
      outcome: 'timeout',
      errorName: 'TimeoutError',
      errorMessage: 'Authorization: Bearer sk-secret timed out',
    });

    const result = await service.probe(UNLOCKER_DIAGNOSTIC_ALLOWED_URL);

    expect(result.outcome).toBe('timeout');
    expect(result.apiHttpStatus).toBe(0);
    expect(result.errorName).toBe('TimeoutError');
    expect(result.errorMessage).not.toMatch(/sk-secret/);
    expect(result.errorMessage).toContain('[REDACTED]');
  });

  it('rejects non-allowlisted urls', async () => {
    await expect(
      service.probe('https://lightartsy.com/partnerships'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(unlocker.fetchRawHtml).not.toHaveBeenCalled();
  });

  it('rejects when diagnostics flag is off', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'development';
      if (key === 'UNLOCKER_DIAGNOSTICS_ENABLED') return false;
      return undefined;
    });

    await expect(
      service.probe(UNLOCKER_DIAGNOSTIC_ALLOWED_URL),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(unlocker.fetchRawHtml).not.toHaveBeenCalled();
  });

  it('rejects in production even if flag is true', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'production';
      if (key === 'UNLOCKER_DIAGNOSTICS_ENABLED') return true;
      return undefined;
    });

    await expect(
      service.probe(UNLOCKER_DIAGNOSTIC_ALLOWED_URL),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(unlocker.fetchRawHtml).not.toHaveBeenCalled();
  });

  it('rejects when Unlocker API key is missing', async () => {
    unlocker.isConfigured.mockReturnValue(false);

    await expect(
      service.probe(UNLOCKER_DIAGNOSTIC_ALLOWED_URL),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(unlocker.fetchRawHtml).not.toHaveBeenCalled();
  });

  it('does not retry fetchRawHtml', async () => {
    unlocker.fetchRawHtml.mockResolvedValue({
      html: '',
      httpStatus: 500,
      elapsedMs: 10,
      emptyBody: true,
      bodyLength: 0,
      zone: 'mcp_unlocker',
      outcome: 'http_error',
    });

    await service.probe(UNLOCKER_DIAGNOSTIC_ALLOWED_URL);
    expect(unlocker.fetchRawHtml).toHaveBeenCalledTimes(1);
  });
});
