import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

jest.mock('passport-jwt', () => ({
  ExtractJwt: {
    fromExtractors: jest.fn(() => jest.fn()),
  },
  Strategy: class Strategy {
    constructor(public readonly options: unknown) {}
  },
}));

jest.mock('@nestjs/passport', () => ({
  PassportStrategy: (Strategy: new (...args: unknown[]) => unknown) => Strategy,
}));

jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let jwtStrategy: JwtStrategy;

  const configService = {
    getOrThrow: jest.fn(),
  };

  const prismaService = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const validPayload = {
    sub: 'user-id',
    email: 'test@test.com',
  };

  const mockUser = {
    id: 'user-id',
    email: 'test@test.com',
    role: 'USER' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    configService.getOrThrow.mockReturnValue('access-secret');

    jwtStrategy = new JwtStrategy(
      configService as unknown as ConfigService,
      prismaService as unknown as PrismaService,
    );
  });

  describe('constructor', () => {
    it('should configure strategy with jwt access secret', () => {
      expect(configService.getOrThrow).toHaveBeenCalledWith('jwt.accessSecret');
      expect(jwtStrategy).toBeDefined();
    });
  });

  describe('validate', () => {
    it('should return user when found with valid payload', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await jwtStrategy.validate(validPayload);

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        select: { id: true, email: true, role: true },
      });
      expect(result).toEqual(mockUser);
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);

      await expect(jwtStrategy.validate(validPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
