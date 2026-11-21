import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}));

describe('UsersService', () => {
  let usersService: UsersService;

  const prismaService = {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockUser = {
    id: 'user-id',
    name: 'Jane Doe',
    email: 'jane@example.com',
    role: 'USER',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    usersService = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all users without passwords', async () => {
      prismaService.user.findMany.mockResolvedValue([mockUser]);

      await expect(usersService.findAll()).resolves.toEqual([mockUser]);
      expect(prismaService.user.findMany).toHaveBeenCalledWith({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(usersService.findOne('user-id')).resolves.toEqual(mockUser);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);

      await expect(usersService.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create a user with hashed password', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prismaService.user.create.mockResolvedValue(mockUser);

      const result = await usersService.create({
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'password123',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'hashed-password',
          role: 'USER',
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      expect(result).toEqual(mockUser);
    });

    it('should throw ConflictException when email already exists', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        usersService.create({
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('should update user fields and hash password when provided', async () => {
      prismaService.user.findUnique
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
      prismaService.user.update.mockResolvedValue({
        ...mockUser,
        email: 'updated@example.com',
      });

      const result = await usersService.update('user-id', {
        email: 'updated@example.com',
        password: 'new-password',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('new-password', 10);
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        data: {
          email: 'updated@example.com',
          password: 'new-hash',
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      expect(result.email).toBe('updated@example.com');
    });

    it('should throw ConflictException when email belongs to another user', async () => {
      prismaService.user.findUnique
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce({ ...mockUser, id: 'other-id' });

      await expect(
        usersService.update('user-id', { email: 'taken@example.com' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('should delete a user', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockUser);
      prismaService.user.delete.mockResolvedValue(mockUser);

      await expect(usersService.remove('user-id', 'admin-id')).resolves.toEqual(
        {
          message: 'User deleted successfully',
        },
      );

      expect(prismaService.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-id' },
      });
    });

    it('should forbid deleting the current user account', async () => {
      await expect(usersService.remove('admin-id', 'admin-id')).rejects.toThrow(
        ForbiddenException,
      );

      expect(prismaService.user.delete).not.toHaveBeenCalled();
    });
  });
});
