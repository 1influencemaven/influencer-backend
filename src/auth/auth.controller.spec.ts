import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';

jest.mock('./auth.service', () => ({
  AuthService: class AuthService {},
}));

jest.mock('./guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));

import { AuthCookieService } from './auth-cookie.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthUser } from './interfaces/auth-user.interface';

describe('AuthController', () => {
  let authController: AuthController;

  const authService = {
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
  };

  const authCookieService = {
    set: jest.fn(),
    clear: jest.fn(),
  };

  const res = {} as Response;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: AuthCookieService, useValue: authCookieService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    authController = module.get<AuthController>(AuthController);

    jest.clearAllMocks();
  });

  describe('login', () => {
    const loginDto = {
      email: 'test@test.com',
      password: 'password123',
    };

    it('should call authService.login, set cookies and return user', async () => {
      const serviceResult = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-id', email: 'test@test.com' },
      };

      authService.login.mockResolvedValue(serviceResult);

      const result = await authController.login(loginDto, res);

      expect(authService.login).toHaveBeenCalledWith(loginDto);
      expect(authCookieService.set).toHaveBeenCalledWith(
        res,
        'access-token',
        'refresh-token',
      );
      expect(result).toEqual({ user: serviceResult.user });
    });

    it('should propagate exceptions from authService.login', async () => {
      authService.login.mockRejectedValue(
        new UnauthorizedException('Invalid credentials'),
      );

      await expect(authController.login(loginDto, res)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(authCookieService.set).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const req = {
      cookies: { refresh_token: 'refresh-token' },
    } as Request;

    it('should call authService.refresh, set cookies and return user', async () => {
      const serviceResult = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        user: { id: 'user-id', email: 'test@test.com' },
      };

      authService.refresh.mockResolvedValue(serviceResult);

      const result = await authController.refresh(req, res);

      expect(authService.refresh).toHaveBeenCalledWith('refresh-token');
      expect(authCookieService.set).toHaveBeenCalledWith(
        res,
        'new-access-token',
        'new-refresh-token',
      );
      expect(result).toEqual({ user: serviceResult.user });
    });

    it('should propagate exceptions from authService.refresh', async () => {
      authService.refresh.mockRejectedValue(
        new UnauthorizedException('Invalid refresh token'),
      );

      await expect(authController.refresh(req, res)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(authCookieService.set).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    const req = {
      cookies: { refresh_token: 'refresh-token' },
    } as Request;

    it('should call authService.logout, clear cookies and return message', async () => {
      authService.logout.mockResolvedValue(undefined);

      const result = await authController.logout(req, res);

      expect(authService.logout).toHaveBeenCalledWith('refresh-token');
      expect(authCookieService.clear).toHaveBeenCalledWith(res);
      expect(result).toEqual({ message: 'Logged out successfully' });
    });

    it('should propagate exceptions from authService.logout', async () => {
      authService.logout.mockRejectedValue(new Error('unexpected error'));

      await expect(authController.logout(req, res)).rejects.toThrow(
        'unexpected error',
      );

      expect(authCookieService.clear).not.toHaveBeenCalled();
    });
  });

  describe('getMe', () => {
    it('should return the authenticated user', () => {
      const user: AuthUser = {
        id: 'user-id',
        email: 'test@test.com',
        role: 'ADMIN',
      };

      const result = authController.getMe(user);

      expect(result).toEqual(user);
    });
  });
});
