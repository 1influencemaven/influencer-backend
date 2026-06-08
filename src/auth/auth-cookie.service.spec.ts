import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';

import { AuthCookieService } from './auth-cookie.service';

describe('AuthCookieService', () => {
  let authCookieService: AuthCookieService;

  const configService = {
    get: jest.fn(),
  };

  const res = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthCookieService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    authCookieService = module.get<AuthCookieService>(AuthCookieService);

    jest.clearAllMocks();
  });

  describe('set', () => {
    it('should set access and refresh cookies with secure false in development', () => {
      configService.get.mockReturnValue('development');

      authCookieService.set(res, 'access-token', 'refresh-token');

      const expectedOptions = {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
      };

      expect(res.cookie).toHaveBeenCalledTimes(2);
      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        'access-token',
        expectedOptions,
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-token',
        expectedOptions,
      );
    });

    it('should set cookies with secure true in production', () => {
      configService.get.mockReturnValue('production');

      authCookieService.set(res, 'access-token', 'refresh-token');

      const expectedOptions = {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      };

      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        'access-token',
        expectedOptions,
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-token',
        expectedOptions,
      );
    });
  });

  describe('clear', () => {
    it('should clear access and refresh cookies with secure false in development', () => {
      configService.get.mockReturnValue('development');

      authCookieService.clear(res);

      const expectedOptions = {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
      };

      expect(res.clearCookie).toHaveBeenCalledTimes(2);
      expect(res.clearCookie).toHaveBeenCalledWith(
        'access_token',
        expectedOptions,
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expectedOptions,
      );
    });

    it('should clear cookies with secure true in production', () => {
      configService.get.mockReturnValue('production');

      authCookieService.clear(res);

      const expectedOptions = {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      };

      expect(res.clearCookie).toHaveBeenCalledWith(
        'access_token',
        expectedOptions,
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expectedOptions,
      );
    });
  });
});
