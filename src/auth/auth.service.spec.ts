import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../prisma/prisma.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let authService: AuthService;

  const prismaService = {
    user: {
      findUnique: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const jwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };

  const configService = {
    getOrThrow: jest.fn(),
  };

  const mockUser = {
    id: 'user-id',
    email: 'test@test.com',
    password: 'hashed-password',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);

    jest.clearAllMocks();

    configService.getOrThrow.mockImplementation((key: string) => {
      const config: Record<string, string> = {
        'jwt.refreshSecret': 'refresh-secret',
        'jwt.refreshExpiresIn': '7d',
      };

      return config[key];
    });
  });

  describe('login', () => {
    it('should login successfully', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh-token');
      prismaService.refreshToken.create.mockResolvedValue({ id: 'token-id' });

      const result = await authService.login({
        email: 'test@test.com',
        password: 'password123',
      });

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@test.com' },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'password123',
        'hashed-password',
      );
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(prismaService.refreshToken.create).toHaveBeenCalled();
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-id',
          email: 'test@test.com',
        },
      });
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.login({
          email: 'test@test.com',
          password: 'password123',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when password is incorrect', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.login({
          email: 'test@test.com',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const refreshToken = 'valid-refresh-token';
    const payload = { sub: 'user-id', email: 'test@test.com' };

    it('should refresh tokens successfully', async () => {
      jwtService.verifyAsync.mockResolvedValue(payload);
      prismaService.user.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'test@test.com',
      });
      prismaService.refreshToken.findMany.mockResolvedValue([
        { id: 'token-id', hashedRefreshToken: 'stored-hash' },
      ]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jwtService.signAsync
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token');
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-refresh-token');
      prismaService.refreshToken.update.mockResolvedValue({ id: 'token-id' });

      const result = await authService.refresh(refreshToken);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith(refreshToken, {
        secret: 'refresh-secret',
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        refreshToken,
        'stored-hash',
      );
      expect(prismaService.refreshToken.update).toHaveBeenCalled();
      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        user: {
          id: 'user-id',
          email: 'test@test.com',
        },
      });
    });

    it('should throw UnauthorizedException when refresh token is invalid', async () => {
      await expect(authService.refresh(undefined)).rejects.toThrow(
        UnauthorizedException,
      );

      jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));

      await expect(authService.refresh('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );

      jwtService.verifyAsync.mockResolvedValue(payload);
      prismaService.user.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'test@test.com',
      });
      prismaService.refreshToken.findMany.mockResolvedValue([
        { id: 'token-id', hashedRefreshToken: 'stored-hash' },
      ]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(authService.refresh(refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should invalidate refresh token on logout', async () => {
      const refreshToken = 'valid-refresh-token';

      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-id',
        email: 'test@test.com',
      });
      prismaService.refreshToken.findMany.mockResolvedValue([
        { id: 'token-id', hashedRefreshToken: 'stored-hash' },
      ]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prismaService.refreshToken.update.mockResolvedValue({ id: 'token-id' });

      await authService.logout(refreshToken);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith(refreshToken, {
        secret: 'refresh-secret',
        ignoreExpiration: true,
      });
      expect(prismaService.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'token-id' },
        data: { hashedRefreshToken: null },
      });
    });

    it('should return silently when refresh token is not provided', async () => {
      await authService.logout(undefined);

      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
      expect(prismaService.refreshToken.update).not.toHaveBeenCalled();
    });
  });
});
