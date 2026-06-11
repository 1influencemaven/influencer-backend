import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';

import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { parseExpiresInToMs } from './utils/parse-expires-in.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register({ email, password, role }: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    return this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: role ?? 'USER',
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async login({ email, password }: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { accessToken, refreshToken } = await this.getTokens(
      user.id,
      user.email,
    );

    const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);

    const refreshExpiresIn = this.configService.getOrThrow<string>(
      'jwt.refreshExpiresIn',
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        hashedRefreshToken,
        expiresAt: new Date(Date.now() + parseExpiresInToMs(refreshExpiresIn)),
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
      },
    };
  }

  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const storedTokens = await this.prisma.refreshToken.findMany({
      where: {
        userId: user.id,
        expiresAt: { gt: new Date() },
        hashedRefreshToken: { not: null },
      },
    });

    let matchedTokenId: string | null = null;

    for (const stored of storedTokens) {
      if (!stored.hashedRefreshToken) {
        continue;
      }

      const isMatch = await bcrypt.compare(
        refreshToken,
        stored.hashedRefreshToken,
      );

      if (isMatch) {
        matchedTokenId = stored.id;
        break;
      }
    }

    if (!matchedTokenId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const { accessToken, refreshToken: newRefreshToken } = await this.getTokens(
      user.id,
      user.email,
    );

    const hashedRefreshToken = await bcrypt.hash(newRefreshToken, 10);

    const refreshExpiresIn = this.configService.getOrThrow<string>(
      'jwt.refreshExpiresIn',
    );

    await this.prisma.refreshToken.update({
      where: { id: matchedTokenId },
      data: {
        hashedRefreshToken,
        expiresAt: new Date(Date.now() + parseExpiresInToMs(refreshExpiresIn)),
      },
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user,
    };
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) {
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(
        refreshToken,
        {
          secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
          ignoreExpiration: true,
        },
      );

      const storedTokens = await this.prisma.refreshToken.findMany({
        where: {
          userId: payload.sub,
          hashedRefreshToken: { not: null },
        },
      });

      for (const stored of storedTokens) {
        if (!stored.hashedRefreshToken) {
          continue;
        }

        const isMatch = await bcrypt.compare(
          refreshToken,
          stored.hashedRefreshToken,
        );

        if (isMatch) {
          await this.prisma.refreshToken.update({
            where: { id: stored.id },
            data: { hashedRefreshToken: null },
          });
          break;
        }
      }
    } catch {
      return;
    }
  }

  private async getTokens(userId: string, email: string) {
    const payload: JwtPayload = { sub: userId, email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
        expiresIn: this.configService.getOrThrow<string>(
          'jwt.refreshExpiresIn',
        ) as StringValue,
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
