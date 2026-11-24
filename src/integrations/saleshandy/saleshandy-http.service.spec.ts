import { HttpStatus } from '@nestjs/common';

import { SaleshandyHttpService } from './saleshandy-http.service';
import {
  SALESHANDY_ERROR_CODES,
  SaleshandyApiException,
  parseSaleshandyErrorBody,
  toSaleshandyException,
} from './saleshandy.errors';

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as never;

const jsonResponse = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('Saleshandy error mapping', () => {
  it('parses "code: message<br>" bodies', () => {
    expect(parseSaleshandyErrorBody('1001: Invalid token<br><br>')).toEqual({
      upstreamCode: '1001',
      message: 'Invalid token',
    });
    expect(parseSaleshandyErrorBody({ message: ['a must be a string', 'b'] })).toEqual({
      message: 'a must be a string; b',
    });
  });

  it('never maps to 401 (would log the user out of the app)', () => {
    const invalidKey = toSaleshandyException(400, '1001: Invalid token');
    expect(invalidKey.code).toBe(SALESHANDY_ERROR_CODES.AUTH_FAILED);
    expect(invalidKey.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(toSaleshandyException(401, {}).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
  });

  it('maps validation, conflict, rate limit and upstream errors', () => {
    expect(toSaleshandyException(400, { message: ['senderFirstName must be a string'] })).toMatchObject({
      code: SALESHANDY_ERROR_CODES.VALIDATION,
      message: 'senderFirstName must be a string',
    });
    // Saleshandy reuses 1001 for duplicates: must not be reported as a bad API key.
    expect(toSaleshandyException(409, '1001: Email account already exists<br>')).toMatchObject({
      code: SALESHANDY_ERROR_CODES.CONFLICT,
      message: 'Email account already exists',
    });
    expect(toSaleshandyException(409, 'Email account already exists').code).toBe(
      SALESHANDY_ERROR_CODES.CONFLICT,
    );
    expect(toSaleshandyException(429, '').getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(toSaleshandyException(500, '5001: Internal').code).toBe(
      SALESHANDY_ERROR_CODES.UNAVAILABLE,
    );
  });
});

describe('SaleshandyHttpService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('sends x-api-key and returns payload', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(200, { message: 'Success', payload: { totalCredits: 5 } }),
    );
    global.fetch = fetchMock as never;
    const service = new SaleshandyHttpService(config({ SALESHANDY_API_KEY: 'k-123' }));

    const result = await service.request('GET', '/credits', { query: { page: 1, x: undefined } });

    expect(result).toEqual({ payload: { totalCredits: 5 }, message: 'Success' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://open-api.saleshandy.com/v1/credits?page=1');
    expect(init.headers['x-api-key']).toBe('k-123');
  });

  it('fails as NOT_CONFIGURED (503) without an API key, without calling out', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    const service = new SaleshandyHttpService(config({}));
    await expect(service.request('GET', '/credits')).rejects.toMatchObject({
      code: SALESHANDY_ERROR_CODES.NOT_CONFIGURED,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws mapped errors and reports timeouts', async () => {
    const service = new SaleshandyHttpService(config({ SALESHANDY_API_KEY: 'k' }));
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(400, '1001: Invalid token')) as never;
    await expect(service.request('POST', '/email-accounts')).rejects.toBeInstanceOf(
      SaleshandyApiException,
    );

    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    global.fetch = jest.fn().mockRejectedValue(timeout) as never;
    await expect(service.request('POST', '/email-accounts')).rejects.toMatchObject({
      code: SALESHANDY_ERROR_CODES.TIMEOUT,
    });
  });

  it('checkConnectivity reports credentials problems without throwing', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(400, '1001: Invalid token')) as never;
    const service = new SaleshandyHttpService(config({ SALESHANDY_API_KEY: 'bad' }));
    await expect(service.checkConnectivity()).resolves.toMatchObject({
      configured: true,
      connected: false,
      errorCode: SALESHANDY_ERROR_CODES.AUTH_FAILED,
    });
    await expect(new SaleshandyHttpService(config({})).checkConnectivity()).resolves.toMatchObject({
      configured: false,
      connected: false,
    });
  });
});
